# Architecture

Simplified system overview.

```
Client (Browser)
    │
    ▼
Nginx :9000
    │
    ├─▶ FastAPI :9001  (auth, API, files, notes)
    ├─▶ ttyd :7681     (web terminal)
    ├─▶ code-server :8080 (VS Code)
    └─▶ Go Bridge :9999 (WebSocket PTY)
```

## Auth Flow

1. Passphrase + TOTP → FastAPI
2. FastAPI returns JWT access token + refresh cookie
3. Client sends `Authorization: Bearer <token>` on API calls
4. Terminal ticket (5-min JWT) for WebSocket PTY

## Key Components

| Component | Language | Purpose |
|-----------|----------|---------|
| FastAPI backend | Python | REST API, auth, file browser, notes |
| Go PTY bridge | Go | WebSocket → bash PTY streaming |
| Host bridge | Python | Spawn Kimi CLI web UIs |
| Nginx | — | Reverse proxy, routing, static files |
| ttyd | C++ | Web-based TTY |
| code-server | TypeScript | Browser VS Code |

## Data

- SQLite: `data/jericho.db` (notes, audit, themes, tokens)
- Filesystem: `/srv` (projects, uploads)
- Config: `.env`, `config/*.yaml`, `config/*.json`
