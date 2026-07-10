#!/bin/sh
# pack.sh — build an upload-ready package (.zip) containing ONLY the extension's
# runtime files. Excludes tests, node_modules, docs, sketches, tools, build
# files, and stray files.
#
# The HubSpot token is NO LONGER in this bundle — it lives server-side in the
# ortus-hs-proxy Cloudflare Worker. Only the low-value proxy key ships here.
# For the self-hosted force-install distribution, use pack-crx.sh instead.
#
# Usage:  sh pack.sh
set -e
cd "$(dirname "$0")"

VER=$(node -p "require('./manifest.json').version")
OUT="dist/ortus-hubspot-sync-$VER.zip"

mkdir -p dist
rm -f "$OUT"

zip -q "$OUT" \
  manifest.json \
  background.js \
  content.js \
  scraper.js \
  hubspotClient.js \
  popupLogic.js \
  popup.html \
  popup.js \
  icons/hs-16.png icons/hs-32.png icons/hs-48.png icons/hs-128.png

echo "Built $OUT"
echo "--- package contents (names only) ---"
unzip -l "$OUT"
