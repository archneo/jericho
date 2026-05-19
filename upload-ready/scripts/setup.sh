#!/bin/bash
# Jericho Setup Script
set -e

cd "$(dirname "$0")/.."

echo "=== Jericho Setup ==="

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

  cat > .env <<EOF
JERICHO_SECRET_KEY=$SECRET_KEY
JERICHO_PASSPHRASE_HASH=$PASSPHRASE_HASH
JERICHO_TOTP_SECRET=$TOTP_SECRET
CODE_SERVER_PASSWORD=$CODE_PASSWORD
EOF

  echo "Generated .env file."
  echo "Your TOTP secret is: $TOTP_SECRET"
  echo "Add this to your Authenticator app (Aegis / Google Authenticator)."
else
  echo ".env already exists. Skipping generation."
fi

# Ensure public-routes.json exists
if [ ! -f public-routes.json ]; then
  cat > public-routes.json <<'EOF'
[
  {"domain": "trilokventures.org", "url": "https://trilokventures.org", "port": 8888},
  {"domain": "sattva.trilokventures.org", "url": "https://sattva.trilokventures.org", "port": 8889},
  {"domain": "odoo.trilokventures.org", "url": "https://odoo.trilokventures.org", "port": 8069},
  {"domain": "n8n.trilokventures.org", "url": "https://n8n.trilokventures.org", "port": 8088},
  {"domain": "nc.trilokventures.org", "url": "https://nc.trilokventures.org", "port": 5679}
]
EOF
  echo "Created public-routes.json"
fi

echo "Setup complete. Run: docker compose up -d --build"
