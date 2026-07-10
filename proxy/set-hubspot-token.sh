#!/bin/sh
# Prompts for the HubSpot token and stores it directly as a Worker secret.
# The token is never read from or written to the extension source tree.
# Run this yourself:  sh proxy/set-hubspot-token.sh
set -e
cd "$(dirname "$0")"

echo "Wrangler will prompt for HUBSPOT_TOKEN; the value is stored only in Cloudflare."
exec ./node_modules/.bin/wrangler secret put HUBSPOT_TOKEN
