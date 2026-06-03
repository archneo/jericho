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

  # Prompt for network config if not set
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
JERICHO_DOMAIN=$JERICHO_DOMAIN
TAILSCALE_IP=$TAILSCALE_IP
TAILSCALE_SOCK_PATH=$TAILSCALE_SOCK_PATH
JERICHO_USER_HOME=${JERICHO_USER_HOME:-$HOME}
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

echo "Setup complete. Run: docker compose up -d --build"
