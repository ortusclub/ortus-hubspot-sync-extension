# Ortus HubSpot proxy

This Cloudflare Worker keeps the HubSpot private-app token out of the Chrome
extension. Operators never configure credentials: the extension calls this
Worker, and the Worker adds the HubSpot token from its encrypted Cloudflare
secret before forwarding an allowlisted request.

## Deploy code changes

Maintainers can deploy a new Worker version without re-entering either secret:

```sh
cd proxy
npm ci
npm run deploy
```

Cloudflare preserves the existing `HUBSPOT_TOKEN` and `PROXY_KEY` secrets across
code deployments.

## Initial setup or rotation

These operations are for maintainers only. They are never part of extension
installation or updating.

```sh
cd proxy

# Initial authentication only.
npx wrangler login

# Initial setup or HubSpot token rotation.
sh set-hubspot-token.sh

# Initial setup or proxy-key rotation.
npx wrangler secret put PROXY_KEY
```

Secret values are entered only at Wrangler's private prompt. Do not place them
in source files, command arguments, documentation, `.env` files, or GitHub.

The non-secret `ALLOWED_ORIGIN` setting in `wrangler.jsonc` restricts browser
requests to the signed Ortus extension ID. The endpoint allowlist in `worker.js`
further limits which HubSpot operations the proxy can perform.
