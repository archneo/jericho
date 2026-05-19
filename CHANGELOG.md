# Changelog

All notable changes to Jericho Command Center are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.10.0] — 2026-05-19

### Added
- Full JWT auth system (access + refresh tokens) replacing legacy session-only auth
- Terminal ticket system for WebSocket PTY bridge authentication
- Client type detection (web / iOS / Android) with capability tiers
- Rate limiting with token-bucket algorithm (safe: 10/sec, dangerous: 1/min)
- Dangerous command blocklist (`rm`, `dd`, `mkfs`, `shutdown`, `reboot`, etc.)
- Kimi Sessions module — discover, launch, and manage Kimi CLI web UIs
- Host bridge (port 9998) for spawning ephemeral Kimi web instances
- Go WebSocket PTY bridge with ring-buffer scrollback and gzip persistence
- Theme engine with custom token-based CSS theming
- Command registry with categorized shortcuts (system, network, docker, git)
- File browser with image preview, text preview, and markdown rendering
- Docker container status endpoint
- Tailscale peer discovery
- Quick Capture camera upload to `/srv/inbox/`
- PWA manifest and Service Worker for offline shell
- Nginx reverse proxy with VS Code absolute asset path fix
- `public-routes.json` for hybrid service discovery (manual + cloudflared + nginx)

### Security
- Argon2id passphrase hashing (t=3, m=65536)
- TOTP 2FA with 30-second windows
- HTTP-only session and refresh cookies with Strict SameSite
- CORS whitelist enforcement
- Path traversal guards on all file operations

### Infrastructure
- Docker Compose with health checks and auto-restart
- Multi-service nginx config (ports 9000, 9010)
- `setup.sh` for automated secret generation
- `backup.sh` for data preservation
