#!/bin/bash
# Jericho Backup Script
set -e

DATE=$(date +%Y%m%d-%H%M%S)
DEST="/srv/backups/jericho-${DATE}"
mkdir -p "$DEST"

cp -r /srv/jericho/data "$DEST/"
cp /srv/jericho/.env "$DEST/env.backup"
cp /srv/jericho/public-routes.json "$DEST/"

echo "Backup saved to $DEST"
