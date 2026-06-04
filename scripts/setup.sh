#!/bin/bash
# Jericho Setup Script
set -e

cd "$(dirname "$0")/.."

echo "=== Jericho Setup ==="

# Source existing .env so we can use its values
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Generate secrets if .env doesn't exist
if [ ! -f .env ]; then
  SECRET_KEY=$(openssl rand -hex 32)
  TOTP_SECRET=$(python3 -c "import pyotp; print(pyotp.random_base32())")
  CODE_PASSWORD=$(openssl rand -hex 16)

  echo "Set your passphrase (this is your login password):"
  read -s PASSPHRASE
  echo

  PASSPHRASE_HASH=$(python3 -c "
import argon2
ph = argon2.PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16)
print(ph.hash('$PASSPHRASE'))
")

  # Prompt for deployment config if not set
  if [ -z "$JERICHO_USER" ]; then
    echo "Enter the OS user that will run Jericho services (e.g., archneo):"
    read JERICHO_USER
  fi
  if [ -z "$JERICHO_USER_HOME" ]; then
    JERICHO_USER_HOME=$(eval echo "~$JERICHO_USER")
  fi
  if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR=/srv/jericho
  fi
  if [ -z "$JERICHO_DOMAIN" ]; then
    echo "Enter your domain (e.g., trilokventures.org):"
    read JERICHO_DOMAIN
  fi
  if [ -z "$TAILSCALE_IP" ]; then
    echo "Enter your Tailscale IP (e.g., 100.114.140.23):"
    read TAILSCALE_IP
  fi
  if [ -z "$TAILSCALE_SOCK_PATH" ]; then
    TAILSCALE_SOCK_PATH=/run/tailscale/tailscaled.sock
  fi

  cat > .env <<EOF
JERICHO_SECRET_KEY=$SECRET_KEY
JERICHO_PASSPHRASE_HASH=$PASSPHRASE_HASH
JERICHO_TOTP_SECRET=$TOTP_SECRET
CODE_SERVER_PASSWORD=$CODE_PASSWORD
JERICHO_USER=$JERICHO_USER
JERICHO_USER_HOME=$JERICHO_USER_HOME
INSTALL_DIR=$INSTALL_DIR
JERICHO_DOMAIN=$JERICHO_DOMAIN
TAILSCALE_IP=$TAILSCALE_IP
TAILSCALE_SOCK_PATH=$TAILSCALE_SOCK_PATH
EOF

  echo "Generated .env file."
  echo "Your TOTP secret is: $TOTP_SECRET"
  echo "Add this to your Authenticator app (Aegis / Google Authenticator)."
else
  echo ".env already exists. Skipping generation."
fi

# Ensure public-routes.json exists
if [ ! -f public-routes.json ]; then
  DOMAIN="${JERICHO_DOMAIN:-YOUR_DOMAIN}"
  cat > public-routes.json <<EOF
[
  {"domain": "$DOMAIN", "url": "https://$DOMAIN", "port": 8888},
  {"domain": "sattva.$DOMAIN", "url": "https://sattva.$DOMAIN", "port": 8889},
  {"domain": "odoo.$DOMAIN", "url": "https://odoo.$DOMAIN", "port": 8069},
  {"domain": "n8n.$DOMAIN", "url": "https://n8n.$DOMAIN", "port": 8088},
  {"domain": "nc.$DOMAIN", "url": "https://nc.$DOMAIN", "port": 5679}
]
EOF
  echo "Created public-routes.json"
fi

# Generate nginx config from template
if [ -f config/nginx/jericho.conf.template ] && command -v envsubst >/dev/null 2>&1; then
  envsubst '$JERICHO_DOMAIN' < config/nginx/jericho.conf.template > config/nginx/jericho.conf
  echo "Generated config/nginx/jericho.conf"
fi

# Generate systemd services from templates
if [ -d config/systemd ]; then
  SYSTEMD_USER_DIR="${HOME}/.config/systemd/user"
  mkdir -p "$SYSTEMD_USER_DIR"
  for tmpl in config/systemd/*.service.template; do
    [ -f "$tmpl" ] || continue
    out="$SYSTEMD_USER_DIR/$(basename "$tmpl" .template)"
    envsubst < "$tmpl" > "$out"
    echo "Installed $out"
  done
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload
    echo "Run: systemctl --user enable --now jericho-{monitor,agentd,shell,host-bridge,terminal-bridge}"
  fi
fi

echo "Setup complete."
echo "Next steps:"
echo "  1. docker compose up -d --build"
echo "  2. systemctl --user enable --now jericho-monitor jericho-agentd jericho-shell jericho-host-bridge jericho-terminal-bridge"
