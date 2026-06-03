#!/bin/bash
# Jericho Credential Rotation Script
# Safely rotates passphrase + TOTP without breaking other services.
# Only restarts the jericho-api container; ttyd and code-server keep running.
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env file found. Run scripts/setup.sh first."
  exit 1
fi

# ─── Backup ──────────────────────────────────────────────────────────────────
BACKUP=".env.backup.$(date +%s)"
cp .env "$BACKUP"
echo "[1/5] Backed up current .env to $BACKUP"

# ─── Prompt new passphrase ───────────────────────────────────────────────────
echo "[2/5] Enter new passphrase (this is your login password):"
read -s NEW_PASS
echo
echo "Confirm new passphrase:"
read -s NEW_PASS_CONFIRM
echo

if [ "$NEW_PASS" != "$NEW_PASS_CONFIRM" ]; then
  echo "Error: Passphrases do not match. Aborting. No changes were made."
  rm -f "$BACKUP"
  exit 1
fi

if [ ${#NEW_PASS} -lt 8 ]; then
  echo "Warning: Passphrase is shorter than 8 characters. Consider using a longer one."
fi

# ─── Generate hash + TOTP ────────────────────────────────────────────────────
echo "[3/5] Generating Argon2id hash and TOTP secret..."

PASS_HASH=$(python3 -c "
import argon2
ph = argon2.PasswordHasher(time_cost=3, memory_cost=65536, parallelism=1, hash_len=32, salt_len=16)
print(ph.hash('$NEW_PASS'))
")

TOTP_SECRET=$(python3 -c "import pyotp; print(pyotp.random_base32())")

# ─── Update .env (preserve all other vars) ───────────────────────────────────
echo "[4/5] Updating .env..."

# Update or append PASSPHRASE_HASH (wrap in single quotes to prevent Docker Compose $ interpolation)
if grep -q "^JERICHO_PASSPHRASE_HASH=" .env; then
  sed -i "s|^JERICHO_PASSPHRASE_HASH=.*|JERICHO_PASSPHRASE_HASH='$PASS_HASH'|" .env
else
  echo "JERICHO_PASSPHRASE_HASH='$PASS_HASH'" >> .env
fi

# Update or append TOTP_SECRET
if grep -q "^JERICHO_TOTP_SECRET=" .env; then
  sed -i "s|^JERICHO_TOTP_SECRET=.*|JERICHO_TOTP_SECRET=$TOTP_SECRET|" .env
else
  echo "JERICHO_TOTP_SECRET=$TOTP_SECRET" >> .env
fi

# ─── Graceful restart ────────────────────────────────────────────────────────
echo "[5/5] Restarting jericho-api container (ttyd + code-server stay running)..."
docker compose up -d jericho-api

# ─── Generate QR code ────────────────────────────────────────────────────────
QR_FILE="totp-qr-$(date +%s).png"
python3 -c "
import qrcode
qr = qrcode.QRCode(version=1, box_size=10, border=4)
qr.add_data('otpauth://totp/Jericho?secret=$TOTP_SECRET&issuer=Jericho')
qr.make(fit=True)
img = qr.make_image(fill_color='black', back_color='white')
img.save('$QR_FILE')
" 2>/dev/null || true

# ─── Display credentials ─────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "  ✅ Credential rotation complete"
echo "═══════════════════════════════════════════════════════════════════"
echo ""
echo "  📋 NOTE DOWN THESE CREDENTIALS NOW:"
echo ""
echo "  Passphrase:    (the one you just entered)"
echo "  TOTP Secret:   $TOTP_SECRET"
echo ""
if [ -f "$QR_FILE" ]; then
  echo "  QR Code:       $QR_FILE"
  echo "  (Scan this image with your Authenticator app)"
else
  echo "  QR Code URL:   otpauth://totp/Jericho?secret=$TOTP_SECRET&issuer=Jericho"
  echo "  (This is NOT a web URL — paste it into your Authenticator app)"
fi
echo ""
echo "  Add the TOTP secret to your Authenticator app:"
echo "    • Aegis Authenticator (recommended)"
echo "    • Google Authenticator"
echo "    • Authy / 2FAS"
echo ""
echo "───────────────────────────────────────────────────────────────────"
echo "  🔄 Rollback (if needed):"
echo "     cp $BACKUP .env && docker compose up -d jericho-api"
echo "───────────────────────────────────────────────────────────────────"
echo ""
