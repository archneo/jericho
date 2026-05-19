# 🏰 Jericho Command Center

> **Your personal, auth-walled mission control.**
>
> *"Walls that keep others out. Doors that let you in."*

Jericho is a mobile-first, auth-walled dashboard for managing Linux servers, containers, AI agents, and development workflows from any device — no app install required.

Inspired by [Telegram BotFather](https://core.telegram.org/bots)'s zero-friction developer experience: *one command to stand up, one token to authenticate, one interface to rule them all.*

---

## ✨ Features

| Module | What it does |
|--------|--------------|
| **📁 Projects** | Cards for every folder in `/srv` — one-tap context switching |
| **🌐 Service Directory** | Two tabs: **Local Links** (Tailscale IPs + ports) and **Public Faces** (Cloudflare domains) |
| **💻 Hawkman Terminal** | Full bash terminal in your browser via `ttyd` |
| **🖊️ Code Forge** | VS Code in browser via `code-server` |
| **📝 Scratchpad** | Auto-saving markdown notes stored in Jericho's SQLite database |
| **📸 Quick Capture** | Camera upload straight to `/srv/inbox/` |
| **🤖 Kimi Sessions** | Discover, launch, and interact with Kimi CLI sessions via native Web UI |
| **🐳 Docker Pulse** | Live container status from the host Docker daemon |
| **🔗 Tailscale Watch** | Peer list from your Tailscale mesh network |
| **🎨 Theme Engine** | Custom token-based themes with live preview |

---

## 🚀 Quick Start

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/jericho.git
cd jericho

# 2. Configure environment
cp .env.example .env
# Edit .env with your secrets (see scripts/setup.sh for generation)

# 3. Run setup (generates Argon2 hash, TOTP secret, passwords)
bash scripts/setup.sh

# 4. Start services
docker compose up -d --build

# 5. Access
# Via Tailscale:  http://YOUR_TAILSCALE_IP:9000
# Via localhost:  http://localhost:9000
```

---

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Mobile    │────▶│   Nginx      │────▶│  FastAPI        │
│   Browser   │     │  :9000       │     │  :9001          │
└─────────────┘     └──────────────┘     └─────────────────┘
                                                │
       ┌────────────────────────────────────────┼────────────┐
       ▼                                        ▼            ▼
┌─────────────┐  ┌──────────────┐  ┌─────────────────┐  ┌──────────┐
│   ttyd      │  │ code-server  │  │  Go PTY Bridge  │  │  Host    │
│   :7681     │  │   :8080      │  │    :9999        │  │  Bridge  │
└─────────────┘  └──────────────┘  └─────────────────┘  │  :9998   │
                                                        └──────────┘
```

**Request Flow:**
1. Nginx (port 9000) reverse-proxies all traffic
2. `/jericho/` → FastAPI backend (auth, API, file browser)
3. `/jericho/terminal/` → ttyd WebTTY
4. `/jericho/code/` → code-server VS Code
5. `/ws/terminal/` → Go WebSocket PTY bridge (ticket-based auth)
6. Host bridge (port 9998) spawns Kimi CLI web instances on demand

---

## 🔐 Security Model

| Layer | Implementation |
|-------|---------------|
| **Authentication** | Argon2id passphrase + TOTP (time-based 6-digit code) |
| **Session** | JWT access tokens (15 min) + HTTP-only refresh cookies (7 days) |
| **Terminal** | Ticket-based WebSocket auth (5-minute expiry, single-use JTI) |
| **Rate Limiting** | Token-bucket per client: 10 cmd/sec safe, 1 cmd/min dangerous |
| **Command Safety** | Regex blocklist for `rm`, `dd`, `mkfs`, `shutdown`, `reboot`, etc. |
| **Path Sandbox** | File browser resolves all paths against `/` root with traversal guards |
| **CORS** | Strict origin whitelist (`https://YOUR_DOMAIN`) |

---

## 🛠 Tech Stack

- **Frontend**: Vanilla JS, CSS Grid, PWA (Service Worker + Web App Manifest)
- **Backend**: Python 3.14 + FastAPI + SQLite
- **Terminal**: ttyd (C++ WebTTY) + custom Go PTY bridge with ring-buffer scrollback
- **IDE**: code-server (VS Code OSS)
- **Auth**: Argon2id + TOTP + PyJWT + itsdangerous sessions
- **Network**: Tailscale primary; nginx reverse proxy; Cloudflare Tunnel optional

---

## 📂 Project Structure

```
jericho/
├── backend/           # FastAPI application
├── frontend/          # PWA templates & static assets
├── bridge/            # Host-side services (Go PTY, Kimi host bridge)
├── config/            # Nginx, agent platforms, public routes
├── agents/            # Agent registry (Kimi, Ollama, Docker agents)
├── scripts/           # setup.sh, backup.sh
├── docs/              # Architecture, API, Security, Deployment guides
├── docker-compose.yml # Docker orchestration
└── .env.example       # Environment template
```

---

## 🧪 Development

```bash
# Backend tests
cd backend
python -m pytest

# Go bridge
cd bridge/terminal-bridge
go build -o terminal-bridge main.go

# Frontend (no build step — static files)
# Edit files in frontend/ directly
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for commit conventions, branch strategy, and code style.

---

## 📜 License

MIT — see [LICENSE](LICENSE).

---

*Built with 💙 for the homelab and self-hosting community.*
