#!/bin/sh
# gen-updates.sh — regenerate updates.xml for the current manifest version.
#
# Usage:  sh distribution/gen-updates.sh "https://YOUR-HOST"
#   BASE is the folder URL where ortus-ext.crx and updates.xml are hosted,
#   with NO trailing slash. The .crx is referenced at <BASE>/ortus-ext.crx
#   (a stable filename you overwrite each release); Chrome triggers an update
#   when this file's version is higher than what's installed.
set -e
cd "$(dirname "$0")/.."

BASE="$1"
[ -n "$BASE" ] || { echo "Usage: sh distribution/gen-updates.sh https://your-host"; exit 1; }
BASE="${BASE%/}"

VER=$(node -p "require('./manifest.json').version")
APPID="fpkljmkadlmoblfafkohhgdcahjcdhfd"

cat > distribution/updates.xml <<XML
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='${APPID}'>
    <updatecheck codebase='${BASE}/ortus-ext.crx' version='${VER}' />
  </app>
</gupdate>
XML

echo "Wrote distribution/updates.xml  (version ${VER}, codebase ${BASE}/ortus-ext.crx)"
