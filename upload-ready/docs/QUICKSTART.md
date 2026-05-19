# Quick Start

Get Jericho running in 5 minutes.

---

## 1. Install Dependencies

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Tailscale (recommended)
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# Go (for terminal bridge)
# Arch: sudo pacman -S go
# Debian: sudo apt install golang-go
```

---

## 2. Clone & Configure

```bash
cd /srv
git clone https://github.com/YOUR_USERNAME/jericho.git
cd jericho
cp .env.example .env
bash scripts/setup.sh
```

Save the TOTP secret printed by `setup.sh` — add it to your authenticator app.

---

## 3. Start Services

```bash
# Docker services
docker compose up -d --build

# Terminal bridge (Go)
cd bridge/terminal-bridge
go build -o terminal-bridge main.go
./terminal-bridge &

# Host bridge (Python)
python3 bridge/host-bridge.py &
```

---

## 4. Configure Nginx

```bash
sudo cp config/nginx/jericho.conf /etc/nginx/jericho.conf
# Edit /etc/nginx/jericho.conf:
#   - Replace YOUR_TAILSCALE_IP with your Tailscale IP
#   - Replace YOUR_DOMAIN with your domain (optional)
sudo nginx -s reload
```

---

## 5. Access

Open your browser:
```
http://YOUR_TAILSCALE_IP:9000
```

Login with:
- Passphrase (set during `setup.sh`)
- 6-digit TOTP code from your authenticator app

---

## Next Steps

- Read the full [Architecture](ARCHITECTURE.md)
- Set up daily backups: `bash scripts/backup.sh`
- Add custom agents in `agents/registry.yaml`
