# Jericho API Reference

Base URL: `http://YOUR_TAILSCALE_IP:9000` or `https://YOUR_DOMAIN`

---

## Authentication

### POST /api/auth/login

Login with passphrase + TOTP.

**Request:**
```json
{
  "passphrase": "YOUR_PASSPHRASE",
  "totp": "123456"
}
```

**Response:**
```json
{
  "ok": true,
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "client_type": "web",
  "tier": "free",
  "capabilities": {
    "terminal": true,
    "agent_control": true,
    "file_browser": true,
    "push_notifications": false
  }
}
```

Sets `jericho_refresh` HTTP-only cookie.

---

### POST /api/auth/logout

Revoke refresh tokens and clear cookies.

**Response:**
```json
{"ok": true}
```

---

### POST /api/auth/refresh

Exchange refresh cookie for new access token.

**Response:**
```json
{
  "ok": true,
  "access_token": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### GET /api/me

Get current user info.

**Response:**
```json
{
  "ok": true,
  "user_id": "user_001",
  "client_type": "web",
  "tier": "free",
  "attested": false,
  "capabilities": { ... }
}
```

---

## Terminal

### POST /api/web/tickets/terminal

Mint a terminal WebSocket ticket.

**Headers:** `Authorization: Bearer <access_token>`

**Response:**
```json
{
  "ticket": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 300
}
```

Use the ticket to open a WebSocket:
```
wss://YOUR_DOMAIN/ws/terminal/web?ticket=<ticket>
```

---

## Projects & Files

### GET /api/web/projects

List directory contents.

**Query:** `?path=/srv`

**Response:**
```json
{
  "path": "/srv",
  "parent": "/",
  "entries": [
    {"name": "projects", "path": "/srv/projects", "type": "directory", "size": null, "modified": "2026-05-19T10:00:00+00:00"},
    {"name": "file.txt", "path": "/srv/file.txt", "type": "file", "size": 1024, "modified": "2026-05-19T10:00:00+00:00"}
  ]
}
```

---

### GET /api/web/download

Download a file.

**Query:** `?path=/srv/file.txt`

Returns `FileResponse` with attachment disposition.

---

### GET /api/web/preview

Preview file content.

**Query:** `?path=/srv/readme.md`

**Response:**
```json
{
  "name": "readme.md",
  "type": "markdown",
  "size": 2048,
  "content": "# Hello...",
  "truncated": false
}
```

Supports: images (base64), text, markdown, JSON, code files.

---

### POST /api/web/upload

Upload a file.

**Form data:** `file=<binary>`, `folder=inbox`

**Response:**
```json
{"ok": true, "path": "/srv/inbox/photo.jpg"}
```

---

## Services

### GET /api/web/services/local

Discover local services from `ss -tlnp` and `docker ps`.

**Response:**
```json
[
  {"port": 9001, "ip": "127.0.0.1", "url": "http://127.0.0.1:9001", "process": ""},
  {"port": 0, "ip": "docker", "url": "", "process": "jericho-api", "ports": "0.0.0.0:9001->9001/tcp"}
]
```

---

### GET /api/web/services/public

Discover public services from manual config + cloudflared + nginx.

**Response:**
```json
[
  {"domain": "YOUR_DOMAIN", "url": "https://YOUR_DOMAIN", "port": 8888, "source": "manual", "description": "...", "healthy": true}
]
```

---

## Docker

### GET /api/web/docker/containers

List running Docker containers.

**Response:**
```json
[
  {"id": "a1b2c3d4e5f6", "name": "jericho-api", "status": "Up 3 hours", "image": "jericho-api:latest"}
]
```

---

## Tailscale

### GET /api/web/tailscale/peers

List Tailscale mesh peers.

**Response:**
```json
[
  {"name": "homelab", "ip": "YOUR_TAILSCALE_IP", "os": "linux", "online": true, "last_seen": "2026-05-19T10:00:00Z", "is_self": true},
  {"name": "phone", "ip": "100.x.x.x", "os": "android", "online": true, "last_seen": "...", "is_self": false}
]
```

---

## Notes (Scratchpad)

### GET /api/web/notes

List all notes.

**Response:**
```json
[{"name": "todo", "updated": "2026-05-19T10:00:00+00:00"}]
```

---

### GET /api/web/notes/{name}

Get a note.

**Response:**
```json
{"name": "todo", "content": "- [ ] Fix nginx reload", "updated": ""}
```

---

### POST /api/web/notes/{name}

Save a note.

**Body:**
```json
{"name": "todo", "content": "- [x] Fix nginx reload"}
```

**Response:**
```json
{"ok": true}
```

---

## Kimi Sessions

### GET /api/web/kimi/sessions

List available Kimi CLI sessions.

**Response:**
```json
[
  {
    "uuid": "abc123",
    "title": "API Refactor",
    "plan_mode": false,
    "todo_done": 3,
    "todo_total": 5,
    "archived": false,
    "last_active": "2026-05-19T10:00:00"
  }
]
```

---

### POST /api/web/kimi/sessions/{uuid}/launch

Launch a Kimi web UI for a session.

**Response:**
```json
{
  "url": "http://YOUR_TAILSCALE_IP:11000",
  "token": "deadbeef...",
  "port": 11000,
  "pid": 12345
}
```

---

## Commands

### GET /api/web/commands

Get the command registry (future endpoint).

Currently commands are embedded in `backend/main.py` as `COMMAND_REGISTRY`.

Categories: `system`, `network`, `docker`, `git`, `dangerous`.

Each command has: `id`, `command`, `description`, `icon`, `dangerous`.

---

## Health

### GET /health

**Response:**
```json
{"ok": true, "service": "jericho-api"}
```
