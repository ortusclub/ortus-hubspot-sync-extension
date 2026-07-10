# Apex Strategy · HubSpot Link — Design

**Date:** 2026-07-02
**Status:** Approved (pending spec review)
**Author:** Antonio + Claude

## Summary

Build a **standalone Chrome extension** for pushing LinkedIn profiles into **Apex
Strategy's** HubSpot, as a sibling to the existing Ortus Club HubSpot Sync
extension. Rather than upgrading the stale v0.1.34 Apex fork feature-by-feature,
we **clone the current Ortus v0.1.48 codebase forward** and rebrand it — giving
Apex full feature parity (memberId identity gate, carry last-used tag/status, all
recent safety fixes) and the hardened proxy architecture for free.

Two extensions run side by side on an operator's browser; they must be
**visually unmistakable** from each other to prevent writing a lead to the wrong
HubSpot.

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Structure | **Separate standalone extension** (not a toggle in one build) |
| Token location | **Cloudflare Worker proxy** — token never shipped in the bundle |
| Toolbar icon | **Real Apex folded-banner logomark** (from apexstrategy.io), white on a dark tile with a 3px emerald hairline |
| Panel theme | **Dark emerald** re-skin of the existing panel layout |
| CF account | **Same account** as `ortus-hs-proxy` |

## Non-goals (YAGNI)

- No account switcher / toggle inside a single extension.
- No changes to the Ortus extension or `ortus-hs-proxy`.
- No new HubSpot endpoints — same allowlist as the Ortus proxy.
- No re-architecture of scraping / identity logic; inherited as-is from v0.1.48.

## Brand identity (from apexstrategy.io)

- Background deep teal-black `#041C19`; nav `#0B1120`
- Accent emerald `#00D084`; muted sage `#6A9690`; text white
- Logomark: geometric folded-banner mark, sourced from
  `/images/APEX_TransparentLogo2-White.png` (white on transparent)
- Wordmark: thin "APEX"

Isolated mark + generated icon set already produced at
`sketches/apex-icons/` (hs-16/32/48/128.png). Brand sketch at
`sketches/apex-brand-sketch.html`.

## Architecture

Two independent units, mirroring the Ortus setup:

### 1. Extension — `~/Desktop/Projects/Apex HS Extension/`

Copied from the current Ortus v0.1.48 extension, with only these changes:

- **manifest.json**
  - `name` → "Apex Strategy · HubSpot Link"
  - `description` → Apex wording
  - fresh `key` (new signing keypair) so it gets its own stable extension ID,
    independent of Ortus
  - `host_permissions` → replace the Ortus proxy host with the Apex proxy host
    (`https://apex-hs-proxy.<subdomain>.workers.dev/*`)
  - version reset to `0.1.0` for the new lineage (its own version track)
- **hubspotClient.js** — `PROXY_BASE` → the Apex Worker URL
- **icons/** — replace with the generated Apex icon set
- **popup.html** — re-theme the panel CSS to the dark-emerald palette; primary
  action button label → "Push to Apex HubSpot". Structure/markup unchanged
  (1:1 with v0.1.48), only tokens/colours.
- New signing `.pem` (Apex-specific), kept out of git via `.gitignore`.

Everything else — `background.js`, `content.js`, `scraper.js`, `popup.js`,
`popupLogic.js`, `hubspotClient.js` logic — is inherited unchanged.

### 2. Proxy — `apex-hs-proxy` Cloudflare Worker

A copy of the `proxy/` directory (`worker.js`, `wrangler.jsonc`, scripts),
deployed as a separate Worker on the **same** Cloudflare account:

- `wrangler.jsonc` → `name: "apex-hs-proxy"`
- Secrets (via `wrangler secret put`, never in source):
  - `HUBSPOT_TOKEN` = the Apex `[REDACTED_HUBSPOT_TOKEN]…` token
  - `PROXY_KEY` = a **freshly generated** shared key (distinct from Ortus's)
- `worker.js` unchanged — same gates (key match, optional origin lock, endpoint
  allowlist), same `HUBSPOT_BASE = https://api.hubapi.com` (correct for the EU
  `pat-eu1-` token).
- Optional hardening (phase 2): set `ALLOWED_ORIGIN` to the Apex extension's id
  once known.

## Data flow

Identical to Ortus: extension → `apex-hs-proxy` (with `x-ortus-key: <apex key>`)
→ Worker injects `Bearer <apex HUBSPOT_TOKEN>` → `api.hubapi.com`. Only the four
allowlisted contact operations are forwarded.

## Wrong-CRM guardrails

Running two extensions side by side, three independent visual/lexical cues make
mis-targeting obvious:

1. **Panel theme** — Apex dark-emerald vs Ortus cream/gold.
2. **Toolbar icon** — Apex folded-banner mark vs Ortus mark.
3. **Button label** — "Push to Apex HubSpot" names the target explicitly.

Additionally, the two proxies hold different tokens and different `PROXY_KEY`s,
so a mis-pointed extension simply fails auth rather than writing to the wrong
CRM.

## Build & release steps

1. Scaffold `~/Desktop/Projects/Apex HS Extension/` from the Ortus v0.1.48 tree.
2. Apply the manifest / client / icon / theme changes above; generate the new
   signing key.
3. Copy `proxy/` → deploy `apex-hs-proxy`; set the two secrets.
4. Point the extension's `PROXY_BASE` / `host_permissions` at the deployed URL.
5. Pack the extension (reuse `pack.sh` / `pack-crx.sh` adapted for Apex).
6. Manual verification (see below).

## Verification

- Worker: `curl` the search endpoint with the Apex `PROXY_KEY` → expect a
  HubSpot 200 with results shape; with a wrong key → 403.
- Extension: load unpacked, open a LinkedIn profile, confirm lookup hits the
  Apex portal (a known Apex contact resolves; an Ortus-only contact does not),
  then confirm a push creates/updates in Apex HubSpot.
- Confirm the Apex extension's ID differs from Ortus and both can be installed
  together.

## Risks / open items

- The Apex token is reused from the v0.1.34 fork; if Apex has rotated it, swap
  the secret (one-line, no rebuild).
- Signing key management: the new `.pem` must be backed up (same handling as the
  Ortus key) and never committed.
