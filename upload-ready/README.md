# 🏰 Jericho Command Center

> **Your personal, auth-walled mission control.**

A mobile-first dashboard for managing Linux servers, Docker containers, AI agents, and dev workflows from any device.

---

## 🚀 Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env with your secrets

# 2. Setup (generates Argon2 hash, TOTP secret, passwords)
bash scripts/setup.sh

# 3. Start
docker compose up -d --build

# 4. Access
# Tailscale: http://YOUR_TAILSCALE_IP:9000
# Local:     http://localhost:9000
```

---

## ✨ Features

- **Desktop Window Manager** — Floating app windows with drag, minimize, maximize, close. Switch between tabbed and desktop modes.
- **File Browser** — Image preview, markdown rendering, syntax highlighting, CSV tables, Mermaid diagrams
- **Terminal** — Full bash via WebSocket PTY bridge (Go + ttyd)
- **Code Forge** — VS Code in browser via code-server
- **Scratchpad** — Auto-saving markdown notes
- **Docker Pulse** — Live container status
- **Tailscale Watch** — Mesh peer discovery
- **Kimi Sessions** — Launch Kimi CLI web UIs on demand
- **Quick Capture** — Camera upload to `/srv/inbox/`
- **Themes** — 3 minimal presets: Paper Desktop, Slate Dark, The Construct

---

## 🛠 Tech Stack

- Python 3.14 + FastAPI + SQLite
- Vanilla JS PWA (Service Worker + Manifest)
- Go WebSocket PTY bridge
- ttyd + code-server (Docker)
- Nginx reverse proxy
- CSS Custom Properties design system (PostHog-inspired OS aesthetic)
- GPU-composited transform-based window dragging

---

## 📂 Structure

```
jericho/
├── backend/       # FastAPI app
├── frontend/      # PWA templates & assets
├── bridge/        # Go PTY bridge + Kimi host bridge
├── config/        # Nginx, agent platforms
├── agents/        # Agent registry
├── scripts/       # setup.sh, backup.sh
└── docker-compose.yml
```

---

## 📖 Docs

- [Quick Start](docs/QUICKSTART.md) — 5-minute setup
- [Architecture](docs/ARCHITECTURE.md) — System design

---

## 📜 License

MIT
