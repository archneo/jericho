# Deployment Guide

This guide covers deploying Jericho on a Linux host (bare metal, VPS, or Raspberry Pi).

---

## Requirements

- Linux (Arch, Debian, Ubuntu, Fedora)
- Docker + Docker Compose
- Tailscale (recommended) or public IP with firewall rules
- 2 GB RAM minimum, 4 GB recommended
- 10 GB disk space

---

## Step 1: Install Dependencies

```bash
# Docker
sudo pacman -S docker docker-compose   # Arch
# OR
sudo apt install docker.io docker-compose-plugin   # Debian/Ubuntu

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Go (for terminal bridge)
sudo pacman -S go
# OR
sudo apt install golang-go
```

---

## Step 2: Clone & Configure

```bash
cd /srv
git clone https://github.com/YOUR_USERNAME/jericho.git
cd jericho

# Copy environment template
cp .env.example .env

# Generate secrets
bash scripts/setup.sh
```

The setup script will:
1. Generate a 32-byte hex `JERICHO_SECRET_KEY`
2. Generate a random Base32 `JERICHO_TOTP_SECRET`
3. Prompt for your passphrase and create an Argon2id hash
4. Generate a random `CODE_SERVER_PASSWORD`

**Save the TOTP secret** — you will need it to configure your authenticator app.

---

## Step 3: Build & Start

```bash
docker compose up -d --build
```

Services started:
| Service | Port | Access |
|---------|------|--------|
| jericho-api | 9001 (host) | Internal |
| ttyd | 7681 (localhost) | Internal |
| code-server | 8080 (localhost) | Internal |

Nginx (running on the host, not Docker) binds port 9000 and routes to all services.

---

## Step 4: Configure Nginx

Copy the nginx config and reload:

```bash
sudo cp config/nginx/jericho.conf /etc/nginx/jericho.conf
# Ensure your main nginx.conf includes this file:
# include /etc/nginx/jericho.conf;
sudo nginx -s reload
```

Update the config with your values:
- Replace `YOUR_TAILSCALE_IP` with your Tailscale IP
- Replace `YOUR_DOMAIN` with your public domain (if using Cloudflare)

---

## Step 5: Start Host Services

```bash
# Terminal bridge (Go WebSocket PTY)
cd bridge/terminal-bridge
go build -o terminal-bridge main.go
./terminal-bridge &

# Host bridge (Kimi session manager)
python3 bridge/host-bridge.py &
```

For production, create systemd services:

```ini
# /etc/systemd/system/jericho-terminal-bridge.service
[Unit]
Description=Jericho Terminal Bridge
After=network.target

[Service]
Type=simple
User=YOUR_USER
WorkingDirectory=/srv/jericho/bridge/terminal-bridge
ExecStart=/srv/jericho/bridge/terminal-bridge/terminal-bridge
Restart=always
Environment=JERICHO_SECRET_KEY=YOUR_SECRET_KEY

[Install]
WantedBy=multi-user.target
```

---

## Step 6: Access

### Via Tailscale (Recommended)
1. Connect your device to the same Tailscale network
2. Open browser: `http://YOUR_TAILSCALE_IP:9000`
3. Enter passphrase + TOTP code

### Via Localhost
- `http://localhost:9000` (when sitting at the server)

### Via Public Domain (Optional)
- Configure Cloudflare Tunnel or reverse proxy
- Set `YOUR_DOMAIN` in nginx config and CORS origins

---

## Step 7: Backup

```bash
# Manual backup
bash scripts/backup.sh

# Cron job (daily at 3 AM)
0 3 * * * /srv/jericho/scripts/backup.sh >> /var/log/jericho-backup.log 2>&1
```

Backups include:
- SQLite databases (`data/`)
- Environment config (`.env`)
- Public routes (`public-routes.json`)

---

## Updating

```bash
cd /srv/jericho
git pull origin main
docker compose up -d --build
sudo nginx -s reload
```

If `docker-compose.yml` changed, you may need:
```bash
docker compose down
docker compose up -d --build
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `502 Bad Gateway` | Backend not running | `docker compose ps`, check logs |
| `401 Unauthorized` | Session expired | Log in again |
| `429 Too Many Requests` | Rate limit hit | Wait for `retry_after` seconds |
| Terminal blank | ttyd not reachable | Check `docker ps`, restart ttyd container |
| VS Code assets 404 | Nginx regex not matching | Verify nginx config has `location ~ ^/(stable\|vscode)-[a-f0-9]+/` |
| Kimi Sessions empty | Host bridge not running | `ps aux \| grep host-bridge`, restart it |
