#!/bin/sh
# pack-crx.sh — build a SIGNED .crx for the self-hosted force-install distribution.
#
# The .crx is signed with ortus-ext-signing-key.pem. That key fixes the
# permanent extension ID (fpkljmkadlmoblfafkohhgdcahjcdhfd). Keep the key
# safe and backed up: lose it and you can't ship updates Chrome will accept;
# leak it and someone else can sign updates for this ID.
#
# The .crx carries NO hosting URL — for policy force-installs the update URL
# comes from the Admin console policy, so the same .crx works wherever it's
# hosted. Only updates.xml references the download URL.
#
# Usage:  sh pack-crx.sh
set -e
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
KEY="ortus-ext-signing-key.pem"
VER=$(node -p "require('./manifest.json').version")
STAGE="build/ortus-ext"

[ -f "$KEY" ] || { echo "Missing $KEY — cannot sign. Aborting."; exit 1; }

rm -rf build
mkdir -p "$STAGE/icons" dist

cp manifest.json background.js content.js scraper.js hubspotClient.js \
   popupLogic.js popup.html popup.js "$STAGE/"
cp icons/hs-16.png icons/hs-32.png icons/hs-48.png icons/hs-128.png "$STAGE/icons/"

# Fresh throwaway profile so we don't attach to a running Chrome (which would
# ignore --pack-extension and just open a tab).
PROFILE=$(mktemp -d)
"$CHROME" --pack-extension="$PWD/$STAGE" --pack-extension-key="$PWD/$KEY" \
          --user-data-dir="$PROFILE" --no-first-run --no-startup-window >/dev/null 2>&1 || true
rm -rf "$PROFILE"

OUT="dist/ortus-hubspot-sync-$VER.crx"
[ -f "build/ortus-ext.crx" ] || { echo "Pack failed — build/ortus-ext.crx not produced."; exit 1; }
mv -f "build/ortus-ext.crx" "$OUT"
rm -rf build

echo "Built $OUT"
echo "Extension ID: fpkljmkadlmoblfafkohhgdcahjcdhfd"
echo "Size: $(wc -c < "$OUT") bytes"
