# Jericho Architecture

This document describes the system design, data flows, and component interactions of the Jericho Command Center.

---

## System Overview

Jericho is a single-host, container-assisted mission control dashboard. It consists of:

1. **Nginx Reverse Proxy** — Terminates all HTTP/WebSocket traffic, routes by path
2. **FastAPI Backend** — Authentication, API, file browsing, notes, service discovery
3. **ttyd** — Web-based TTY terminal (C++ binary, standalone container)
4. **code-server** — Browser-based VS Code (standalone container)
5. **Go PTY Bridge** — Native WebSocket PTY server for terminal streaming
6. **Host Bridge** — FastAPI service running on the host for spawning Kimi CLI web UIs

```
                    ┌─────────────┐
                    │   Client    │
                    │  (Browser)  │
                    └──────┬──────┘
                           │ HTTPS / HTTP
                    ┌──────┴──────┐
                    │    Nginx    │
                    │    :9000    │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────┴────┐     ┌──────┴──────┐   ┌──────┴──────┐
    │ FastAPI │     │    ttyd     │   │ code-server │
    │  :9001  │     │   :7681     │   │   :8080     │
    └────┬────┘     └─────────────┘   └─────────────┘
         │
    ┌────┴────┐
    │ SQLite  │
    │  /data  │
    └─────────┘
```

---

## Authentication Flow

Jericho uses a dual-auth system: legacy session cookies for backward compatibility, and JWT tokens for modern API access.

### Login Flow

```
┌─────────┐    passphrase + TOTP     ┌─────────┐
│ Client  │ ───────────────────────▶ │ FastAPI │
│         │                          │  Auth   │
│         │ ◀── access_token + refresh_cookie ─
│         │                          │         │
│         │ ── Bearer access_token ─▶│  API    │
└─────────┘                          └─────────┘
```

1. User submits passphrase + 6-digit TOTP code
2. FastAPI verifies Argon2id hash and TOTP secret
3. Server mints a 15-minute JWT access token and a 7-day refresh token
4. Refresh token is stored in an HTTP-only, Strict SameSite cookie
5. Access token is returned in the JSON response and sent as `Authorization: Bearer` header on subsequent requests

### Terminal WebSocket Flow

```
┌─────────┐   POST /api/web/tickets/terminal   ┌─────────┐
│ Client  │ ─────────────────────────────────▶ │ FastAPI │
│         │ ◀────── terminal ticket (JWT) ─────│         │
│         │                                    │         │
│         │ ── WSS /ws/terminal/web?t=TOKEN ─▶ │ Go PTY  │
│         │ ◀───── binary PTY output ──────────│ Bridge  │
└─────────┘                                    └─────────┘
```

1. Client requests a terminal ticket via authenticated API call
2. FastAPI mints a 5-minute JWT ticket with JTI claim
3. Client opens WebSocket to Go bridge with ticket as query parameter
4. Bridge verifies ticket signature, checks JTI not consumed (idempotent 30s window)
5. Bridge spawns bash PTY and begins bidirectional binary streaming
6. On disconnect, scrollback is gzip-persisted to `/srv/jericho/data/terminal-sessions/`

---

## Component Details

### Nginx Configuration

Two server blocks:
- **Port 9010** — Cache-bypass testing server (direct proxy to backend)
- **Port 9000** — Production server with full routing table

Key routes:
| Path | Destination | Notes |
|------|-------------|-------|
| `/jericho/` | FastAPI :9001 | Main app |
| `/jericho/terminal/` | ttyd :7681 | WebTTY |
| `/jericho/code/` | code-server :8080 | VS Code (with proxy_redirect fix) |
| `/ws/terminal/` | Go bridge :9999 | WebSocket PTY |
| `/platform/{name}/` | Local services :varies | AI platforms (Ollama, OpenClaw, Nemoclaw) |
| `~ ^/(stable\|vscode)-[a-f0-9]+/` | code-server :8080 | Catches VS Code absolute asset paths |

### FastAPI Backend

Modules:
- `auth.py` — Argon2id + TOTP + session cookie management
- `auth_jwt.py` — JWT access/refresh/ticket minting and verification
- `capabilities.py` — Client-type detection and feature gating (free / pro / team tiers)
- `main.py` — All API endpoints

Database schema (SQLite):
```sql
-- audit: timestamped security events
-- notes: markdown scratchpad (name, content, updated)
-- themes: custom CSS themes (id, name, tokens, fontFamily, effects)
-- refresh_tokens: JWT refresh token revocation tracking
```

### Go PTY Bridge

- Listens on `127.0.0.1:9999`
- Spawns `bash -l` or `kimi --session UUID` via `creack/pty`
- Binary WebSocket frames for PTY I/O
- Text JSON frames for control messages (resize, heartbeat)
- Ring buffer (256 KB) for scrollback
- Gzip-compressed session persistence on disconnect

### Host Bridge

- Runs **on the host** (not in Docker) so it can spawn processes
- FastAPI service on port 9998
- Manages ephemeral Kimi CLI web instances on ports 11000-11100
- SQLite tracking of active instances (port, uuid, pid, token)
- Auto-cleanup of dead processes

---

## Rate Limiting & Command Safety

### Token Bucket Limits

| Command Type | Rate | Burst |
|--------------|------|-------|
| Safe (`df`, `free`, `uptime`) | 10/sec | 20 |
| Dangerous (`rm`, `dd`, `shutdown`) | 1/min | 1 |

### Dangerous Pattern Blocklist

```python
DANGEROUS_PATTERNS = [
    r'^\s*rm\s+',
    r'^\s*dd\s+',
    r'^\s*mkfs\.?',
    r'^\s*fdisk\s+',
    r'^\s*shutdown\s+',
    r'^\s*reboot\s+',
    r'^\s*docker\s+system\s+prune',
    r'^\s*docker\s+volume\s+prune',
    r'^\s*kill\s+-9',
    r'^\s*pkill\s+-9',
]
```

When a dangerous command is detected, the API returns HTTP 429 with `retry_after`.

---

## Service Discovery

Jericho discovers services from three sources:

1. **Manual** — `config/public-routes.json` (static configuration)
2. **Cloudflared** — Parses `/etc/cloudflared/*.yml` tunnel configs
3. **Nginx** — Parses `/etc/nginx/**/*.conf` for `server_name` + `listen`

Results are merged, deduplicated by domain, and health-checked via TCP connect.

---

## BotFather Pattern Transfer

Jericho adapts several Telegram Bot API patterns:

| BotFather Pattern | Jericho Equivalent |
|-------------------|-------------------|
| `/newbot` → token | `scripts/setup.sh` → `.env` generation |
| `setMyCommands` | `COMMAND_REGISTRY` JSON API → UI command chips |
| Inline keyboards | Mobile control bar with tappable command chips |
| Webhook push | WebSocket PTY streaming + SSE notifications |
| Token-in-URL auth | `Authorization: Bearer <jwt>` header |
| `getMe` | `GET /api/me` — returns user tier + capabilities |
| Rate limit 429 | Token-bucket with `retry_after` in JSON body |

See the full [BotFather Analysis](../README.md#botfather-inspiration) for strategic context.
