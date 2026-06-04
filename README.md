# 🏰 Jericho Command Center

> **Your personal, auth-walled mission control.**

A mobile-first dashboard for managing Linux servers, Docker containers, AI agents, and dev workflows from any device.

---

## 🚀 Quick Start

```bash
# 1. Configure
cp .env.example .env
# Edit .env with your secrets

# 2. Setup (generates Argon2 hash, TOTP secret, passwords, systemd units)
bash scripts/setup.sh

# 3. Start containers
docker compose up -d --build

# 4. Start host microservices
systemctl --user enable --now jericho-monitor jericho-agentd jericho-shell jericho-host-bridge jericho-terminal-bridge

# 5. Access
# Tailscale: http://YOUR_TAILSCALE_IP:9000
# Local:     http://localhost:9000
```

---

## 🏗 Installation

### Prerequisites
- Linux host with systemd
- Docker + Docker Compose
- Python 3.14+ (for host microservices)
- Go 1.22+ (to build terminal-bridge)
- Nginx (for reverse proxy)

### Step-by-Step

```bash
# 1. Clone and enter directory
git clone <repo> /srv/jericho
cd /srv/jericho

# 2. Run interactive setup
# This generates .env, nginx config, and systemd service files
bash scripts/setup.sh

# 3. Build the terminal-bridge binary
cd bridge/terminal-bridge
go build -o terminal-bridge
cd ../..

# 4. Start Docker services
docker compose up -d --build

# 5. Start host microservices (systemd user services)
systemctl --user enable --now jericho-monitor
systemctl --user enable --now jericho-agentd
systemctl --user enable --now jericho-shell
systemctl --user enable --now jericho-host-bridge
systemctl --user enable --now jericho-terminal-bridge

# 6. Verify health
curl -fsS http://localhost:9001/health
curl -fsS http://localhost:9002/health
curl -fsS http://localhost:9998/health
curl -fsS http://localhost:9999/health
```

### Directory Layout After Install
```
/srv/jericho/
├── api/                  # Runtime backend + frontend (live mount)
├── monitor/              # System metrics microservice
├── agentd/               # AI agent lifecycle manager
├── shell/                # Command middleware + executor
├── terminal-bridge/      # Go WebSocket PTY binary
├── host-bridge.py        # Kimi web UI spawner
├── .env                  # Secrets (gitignored)
├── config/
│   ├── nginx/
│   │   ├── jericho.conf          # Generated from template
│   │   └── jericho.conf.template # Source template
│   └── systemd/                  # Service templates
│       ├── jericho-monitor.service.template
│       ├── jericho-agentd.service.template
│       ├── jericho-shell.service.template
│       ├── jericho-host-bridge.service.template
│       └── jericho-terminal-bridge.service.template
└── docker-compose.yml
```

### Customization
All environment-specific values are in `.env`:
- `JERICHO_USER` — OS user running services
- `JERICHO_USER_HOME` — Home directory (for Kimi sessions path)
- `INSTALL_DIR` — Where Jericho is installed (default: `/srv/jericho`)
- `JERICHO_DOMAIN` — Your domain
- `TAILSCALE_IP` — Tailscale mesh IP

To regenerate systemd units after changing `.env`:
```bash
envsubst < config/systemd/jericho-monitor.service.template > ~/.config/systemd/user/jericho-monitor.service
systemctl --user daemon-reload
systemctl --user restart jericho-monitor
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

## 🔐 Credential Management

### First-Time Setup
```bash
# Generates .env with Argon2id hash, TOTP secret, and passwords
bash scripts/setup.sh
```

### Rotate Passphrase + TOTP (Zero-Downtime)
```bash
# Only restarts jericho-api; ttyd + code-server keep running
bash scripts/rotate-credentials.sh
```

**What happens:**
1. Current `.env` is backed up to `.env.backup.<timestamp>`
2. You enter a new passphrase (with confirmation)
3. A new TOTP secret is generated
4. Only the `jericho-api` container restarts (~1–2s)
5. New TOTP secret + QR code image are displayed for your Authenticator app

> ⚠️ **Important:** The `otpauth://` link shown is **not a web URL**. It is a URI scheme handled by authenticator apps (Aegis, Google Authenticator, Authy). If you try to open it in a browser, you will get `ERR_NAME_NOT_RESOLVED`. Either scan the generated QR code image or manually enter the TOTP secret into your app.

### Recovery
```bash
# List backups
ls -la .env.backup.*

# Restore and restart
cp .env.backup.1234567890 .env
docker compose up -d jericho-api
```

### Security Notes
- **Passphrase** is Argon2id-hashed (never stored plaintext)
- **TOTP** uses RFC 6238 with 30-second windows
- **`.env`** is gitignored — never commit it
- **Backups** are also gitignored automatically

---

## 📖 Docs

- [Quick Start](docs/QUICKSTART.md) — 5-minute setup
- [Architecture](docs/ARCHITECTURE.md) — System design

---

## 📜 License

MIT
