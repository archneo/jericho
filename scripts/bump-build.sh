#!/bin/bash
# bump-build.sh — Increment build number across all files
# Usage: cd /srv/jericho && ./scripts/bump-build.sh

set -e

API_DIR="${1:-api}"
CONFIG_FILE="$API_DIR/config.py"
TEMPLATE_FILE="$API_DIR/templates/index.html"
CONFIG_JS="$API_DIR/static/js/modules/config.js"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: $CONFIG_FILE not found"
    exit 1
fi

OLD_BUILD=$(grep 'JERICHO_BUILD' "$CONFIG_FILE" | head -1 | cut -d'"' -f2)
NEW_BUILD=$((OLD_BUILD + 1))

# Update config.py
sed -i "s/JERICHO_BUILD = \"$OLD_BUILD\"/JERICHO_BUILD = \"$NEW_BUILD\"/" "$CONFIG_FILE"

# Update HTML template (badge and BUILD_ID)
sed -i "s/b$OLD_BUILD/b$NEW_BUILD/g" "$TEMPLATE_FILE"
sed -i "s/BUILD_ID = '$OLD_BUILD'/BUILD_ID = '$NEW_BUILD'/g" "$TEMPLATE_FILE"

echo "✓ Build bumped: b$OLD_BUILD → b$NEW_BUILD"
echo "  Updated: $CONFIG_FILE"
echo "  Updated: $TEMPLATE_FILE"
if [ -f "$CONFIG_JS" ]; then
    echo "  NOTE: $CONFIG_JS may need manual changelog update"
fi
echo ""
echo "Next step: docker compose up -d --build jericho-api"
