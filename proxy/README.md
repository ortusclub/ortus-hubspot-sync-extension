# ortus-hs-proxy — deploy guide

A tiny Cloudflare Worker that fronts the HubSpot API so the extension never
carries the HubSpot token. The extension sends a shared key; the Worker injects
the real token (a Worker secret) and forwards only the contact endpoints the
extension uses.

**You only need to do this once.** After it's live, send Claude the Worker URL
and we'll do Phase 2 (point the extension at it and strip the token from the
bundle).

## Prerequisites
- Node.js (you already have it).
- A **free** Cloudflare account → sign up at https://dash.cloudflare.com/sign-up

## Steps
Run these from inside the `proxy/` folder. (In this session you can prefix each
with `!` to run it here, or use your own terminal.)

```sh
cd "proxy"

# 1. Log in to Cloudflare (opens a browser to authorize).
npx wrangler login

# 2. Store the REAL HubSpot token as a secret. When prompted, paste the
#    pat-… value that is currently in background.js line 7.
npx wrangler secret put HUBSPOT_TOKEN

# 3. Store the shared proxy key as a secret. When prompted, paste EXACTLY:
#    ce8b7560178970035b975f8d467dbbb1da660ba85a80f2b9f84f90ba0240a1ec
npx wrangler secret put PROXY_KEY

# 4. Deploy. This prints your Worker URL, e.g.
#    https://ortus-hs-proxy.<your-subdomain>.workers.dev
npx wrangler deploy
```

## Verify it works
Replace `<URL>` with your deployed Worker URL.

```sh
# Should return 200 with JSON about the property (the key + endpoint are allowed):
curl -i "<URL>/crm/v3/properties/contacts/linkedin_membership_id" \
  -H "x-ortus-key: ce8b7560178970035b975f8d467dbbb1da660ba85a80f2b9f84f90ba0240a1ec"

# Should return 403 (no key):
curl -i "<URL>/crm/v3/properties/contacts/linkedin_membership_id"

# Should return 403 not_allowed (endpoint not on the allowlist):
curl -i "<URL>/crm/v3/objects/companies" \
  -H "x-ortus-key: ce8b7560178970035b975f8d467dbbb1da660ba85a80f2b9f84f90ba0240a1ec"
```

## Then
Send Claude the **Worker URL** from step 4. That's all that's needed to start
Phase 2 (extension swap + token removal + repackage).

## Later — rotating the HubSpot token
When HubSpot rotates the token, just run `npx wrangler secret put HUBSPOT_TOKEN`
again and paste the new value. **No extension rebuild, no operator action.**
