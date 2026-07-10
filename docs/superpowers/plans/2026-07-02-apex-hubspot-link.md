# Apex Strategy · HubSpot Link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone Chrome extension that pushes LinkedIn profiles into Apex Strategy's HubSpot, cloned forward from the Ortus v0.1.48 extension and fronted by a dedicated Cloudflare Worker proxy.

**Architecture:** Copy the current Ortus extension runtime into a new sibling folder, rebrand it (name, icons, dark-emerald theme, new signing key → own extension ID), and point it at a new `apex-hs-proxy` Worker that holds the Apex HubSpot token server-side. No changes to the Ortus extension or its proxy.

**Tech Stack:** Chrome MV3 extension (vanilla JS), Cloudflare Workers + wrangler, ImageMagick (icons already generated), openssl (signing key), Chrome CLI (`.crx` packing).

## Global Constraints

- Source of truth for the copy: `~/Desktop/Projects/HS Extension New/` at v0.1.48.
- New extension folder: `~/Desktop/Projects/Apex HS Extension/`.
- HubSpot token lives ONLY as a Worker secret — never in any committed file or shipped bundle.
- Apex HubSpot token: `[REDACTED_HUBSPOT_TOKEN]` (EU portal; upstream host stays `https://api.hubapi.com`).
- Proxy Worker name: `apex-hs-proxy`; deployed on the SAME Cloudflare account as `ortus-hs-proxy` → deterministic URL `https://apex-hs-proxy.ortus-eb6.workers.dev`.
- Extension display name: "Apex Strategy · HubSpot Link". New version lineage starts at `0.1.0`.
- Signing key file `apex-ext-signing-key.pem` must be git-ignored (the existing `.gitignore` already excludes `*.pem`).
- Icons already generated at `HS Extension New/sketches/apex-icons/hs-{16,32,48,128}.png`.
- Brand palette: bg `#041C19`, nav/panel-dark `#0B1120`, accent emerald `#00D084`, sage `#6A9690`, text white.

---

### Task 1: Scaffold the Apex extension folder

**Files:**
- Create: `~/Desktop/Projects/Apex HS Extension/` (copy of the Ortus runtime + build scripts)

**Interfaces:**
- Produces: a working copy of every runtime file (`manifest.json`, `background.js`, `content.js`, `scraper.js`, `hubspotClient.js`, `popupLogic.js`, `popup.html`, `popup.js`), `pack.sh`, `pack-crx.sh`, and `proxy/`, ready to rebrand. Consumed by all later tasks.

- [ ] **Step 1: Create the folder and copy runtime + build files**

```bash
SRC=~/Desktop/Projects/"HS Extension New"
DST=~/Desktop/Projects/"Apex HS Extension"
mkdir -p "$DST/icons" "$DST/proxy"
cp "$SRC"/manifest.json "$SRC"/background.js "$SRC"/content.js "$SRC"/scraper.js \
   "$SRC"/hubspotClient.js "$SRC"/popupLogic.js "$SRC"/popup.html "$SRC"/popup.js \
   "$SRC"/pack.sh "$SRC"/pack-crx.sh "$SRC"/.gitignore "$SRC"/package.json "$DST/"
cp "$SRC"/proxy/worker.js "$SRC"/proxy/wrangler.jsonc "$SRC"/proxy/package.json \
   "$SRC"/proxy/README.md "$DST/proxy/"
```

- [ ] **Step 2: Verify the copy has the expected files**

Run: `ls ~/Desktop/Projects/"Apex HS Extension"/ && ls ~/Desktop/Projects/"Apex HS Extension"/proxy/`
Expected: the 8 runtime files + `pack.sh`, `pack-crx.sh`, `.gitignore`, `package.json`; proxy has `worker.js`, `wrangler.jsonc`, `package.json`, `README.md`.

- [ ] **Step 3: Init git and commit the untouched baseline**

```bash
cd ~/Desktop/Projects/"Apex HS Extension"
git init -q
git add -A
git commit -q -m "chore: scaffold Apex extension from Ortus v0.1.48 baseline"
```

---

### Task 2: Generate the Apex signing key and lock the extension identity

**Files:**
- Create: `~/Desktop/Projects/Apex HS Extension/apex-ext-signing-key.pem` (git-ignored)
- Modify: `~/Desktop/Projects/Apex HS Extension/manifest.json` (`key` field)

**Interfaces:**
- Produces: `APEX_EXT_ID` (the deterministic extension ID) used later for the proxy origin lock (phase 2) and verification. The manifest `key` fixes this ID for both unpacked dev loads and the signed `.crx`.

- [ ] **Step 1: Generate a fresh 2048-bit RSA signing key**

```bash
cd ~/Desktop/Projects/"Apex HS Extension"
openssl genrsa 2048 2>/dev/null > apex-ext-signing-key.pem
```

- [ ] **Step 2: Derive the manifest `key` (base64 public key DER)**

```bash
APEX_KEY=$(openssl rsa -in apex-ext-signing-key.pem -pubout -outform DER 2>/dev/null | openssl base64 -A)
echo "$APEX_KEY"
```
Expected: a long base64 string (~392 chars) starting with `MIIBIjANBgkqhkiG9w0BAQEFA…`.

- [ ] **Step 3: Derive the extension ID (for later reference)**

```bash
openssl rsa -in apex-ext-signing-key.pem -pubout -outform DER 2>/dev/null \
  | shasum -a 256 | head -c 32 | tr '0-9a-f' 'a-p'; echo
```
Expected: a 32-char id using letters a–p. Record it as `APEX_EXT_ID`.

- [ ] **Step 4: Set the `key` field in manifest.json**

Replace the existing Ortus `"key": "…"` value with `$APEX_KEY` from Step 2. (Do this edit with the actual value pasted in — the manifest must contain the literal base64 string.)

- [ ] **Step 5: Verify manifest is valid JSON and carries the new key**

Run: `node -p "require('./manifest.json').key.slice(0,16)"`
Expected: prints `MIIBIjANBgkqhk` (the start of the new key), no JSON parse error.

- [ ] **Step 6: Commit (key file stays ignored)**

```bash
git add manifest.json
git status --short   # confirm apex-ext-signing-key.pem is NOT staged
git commit -q -m "feat: set Apex signing key and lock extension identity"
```

---

### Task 3: Deploy the apex-hs-proxy Worker with Apex secrets

**Files:**
- Modify: `~/Desktop/Projects/Apex HS Extension/proxy/wrangler.jsonc` (`name`)
- Modify: `~/Desktop/Projects/Apex HS Extension/proxy/package.json` (`name`)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent).
- Produces: a live Worker at `https://apex-hs-proxy.ortus-eb6.workers.dev` with secrets `HUBSPOT_TOKEN` (Apex token) and `PROXY_KEY` (freshly generated). `worker.js` is unchanged from Ortus (same gates + allowlist). The `PROXY_KEY` value is consumed by Task 4.

- [ ] **Step 1: Rename the Worker in wrangler.jsonc**

In `proxy/wrangler.jsonc`, change `"name": "ortus-hs-proxy"` → `"name": "apex-hs-proxy"`. Leave `ALLOWED_ORIGIN` empty for now (phase 2 hardening).

- [ ] **Step 2: Rename in package.json**

In `proxy/package.json`, change `"name": "ortus-hs-proxy"` → `"name": "apex-hs-proxy"` and the `description` to reference Apex.

- [ ] **Step 3: Install wrangler and confirm auth**

```bash
cd ~/Desktop/Projects/"Apex HS Extension"/proxy
npm install
npx wrangler whoami
```
Expected: prints the Cloudflare account that owns `ortus-hs-proxy`. If it errors with "not authenticated", the USER must run `! npx wrangler login` in the session before continuing.

- [ ] **Step 4: Generate a fresh proxy key**

```bash
APEX_PROXY_KEY=$(openssl rand -hex 24)
echo "$APEX_PROXY_KEY"
```
Expected: a 48-char hex string. Record it — it goes into both the Worker secret and the extension client.

- [ ] **Step 5: Deploy the Worker**

```bash
npx wrangler deploy
```
Expected: "Deployed apex-hs-proxy" with the URL `https://apex-hs-proxy.ortus-eb6.workers.dev`.

- [ ] **Step 6: Set the two secrets**

```bash
printf '[REDACTED_HUBSPOT_TOKEN]' | npx wrangler secret put HUBSPOT_TOKEN
printf '%s' "$APEX_PROXY_KEY" | npx wrangler secret put PROXY_KEY
```
Expected: each prints "Success! Uploaded secret …".

- [ ] **Step 7: Verify auth gating end-to-end**

```bash
# Wrong key → 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://apex-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts/search \
  -H "x-ortus-key: wrong" -H "Content-Type: application/json" \
  -d '{"filterGroups":[],"properties":["email"],"limit":1}'
# Correct key → 200 (HubSpot responds)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://apex-hs-proxy.ortus-eb6.workers.dev/crm/v3/objects/contacts/search \
  -H "x-ortus-key: $APEX_PROXY_KEY" -H "Content-Type: application/json" \
  -d '{"filterGroups":[],"properties":["email"],"limit":1}'
```
Expected: first prints `403`, second prints `200`. A `200` proves the Apex token reaches the Apex portal.

- [ ] **Step 8: Commit the proxy rename**

```bash
cd ~/Desktop/Projects/"Apex HS Extension"
git add proxy/wrangler.jsonc proxy/package.json
git commit -q -m "feat: deploy apex-hs-proxy worker (secrets set out-of-band)"
```

---

### Task 4: Point the extension at the Apex proxy

**Files:**
- Modify: `~/Desktop/Projects/Apex HS Extension/hubspotClient.js` (`PROXY_BASE`)
- Modify: `~/Desktop/Projects/Apex HS Extension/manifest.json` (`host_permissions`, and any hardcoded proxy key)

**Interfaces:**
- Consumes: the deployed proxy URL and `APEX_PROXY_KEY` from Task 3.
- Produces: an extension whose network calls resolve to the Apex portal.

- [ ] **Step 1: Repoint PROXY_BASE**

In `hubspotClient.js`, change:
`const PROXY_BASE = "https://ortus-hs-proxy.ortus-eb6.workers.dev";`
→ `const PROXY_BASE = "https://apex-hs-proxy.ortus-eb6.workers.dev";`

- [ ] **Step 2: Update host_permissions in manifest.json**

Replace `"https://ortus-hs-proxy.ortus-eb6.workers.dev/*"` with `"https://apex-hs-proxy.ortus-eb6.workers.dev/*"` in the `host_permissions` array.

- [ ] **Step 3: Locate and update where the proxy key is supplied**

Run: `grep -rn "x-ortus-key\|createClient\|PROXY_KEY\|ortus-key" background.js popupLogic.js popup.js hubspotClient.js`
Whatever value is passed as `createClient({ key })`, set it to `APEX_PROXY_KEY` from Task 3 Step 4. If the key is currently read from `chrome.storage`, update the stored/default value accordingly; if hardcoded, replace the literal.

- [ ] **Step 4: Verify no Ortus proxy references remain**

Run: `grep -rn "ortus-hs-proxy" manifest.json hubspotClient.js background.js popup.js popupLogic.js`
Expected: no matches.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js manifest.json background.js popup.js popupLogic.js
git commit -q -m "feat: point extension at apex-hs-proxy"
```

---

### Task 5: Rebrand manifest metadata and install the Apex icons

**Files:**
- Modify: `~/Desktop/Projects/Apex HS Extension/manifest.json` (`name`, `description`, `version`)
- Create: `~/Desktop/Projects/Apex HS Extension/icons/hs-{16,32,48,128}.png`

**Interfaces:**
- Consumes: generated icons from `HS Extension New/sketches/apex-icons/`.
- Produces: a distinctly-branded manifest + icon set.

- [ ] **Step 1: Copy the generated Apex icons**

```bash
cp ~/Desktop/Projects/"HS Extension New"/sketches/apex-icons/hs-16.png \
   ~/Desktop/Projects/"HS Extension New"/sketches/apex-icons/hs-32.png \
   ~/Desktop/Projects/"HS Extension New"/sketches/apex-icons/hs-48.png \
   ~/Desktop/Projects/"HS Extension New"/sketches/apex-icons/hs-128.png \
   ~/Desktop/Projects/"Apex HS Extension"/icons/
```

- [ ] **Step 2: Update manifest name/description/version**

In `manifest.json`: `name` → "Apex Strategy · HubSpot Link"; `description` → "Lookup or push the LinkedIn profile you're viewing into Apex Strategy's HubSpot."; `version` → "0.1.0".

- [ ] **Step 3: Verify manifest + icons**

Run: `node -p "const m=require('./manifest.json'); m.name+' v'+m.version" && ls icons/`
Expected: `Apex Strategy · HubSpot Link v0.1.0` and four `hs-*.png` files.

- [ ] **Step 4: Commit**

```bash
git add manifest.json icons/
git commit -q -m "feat: Apex branding — name, description, icons"
```

---

### Task 6: Re-theme the side panel to the dark-emerald palette

**Files:**
- Modify: `~/Desktop/Projects/Apex HS Extension/popup.html` (`:root` CSS variables, body/panel backgrounds, title, primary button label)

**Interfaces:**
- Consumes: the brand palette (Global Constraints) and the approved sketch `HS Extension New/sketches/apex-brand-sketch.html`.
- Produces: the dark-emerald panel. Markup/IDs/classes unchanged so `popup.js` keeps working.

- [ ] **Step 1: Retheme the CSS design tokens**

In `popup.html`'s `<style> :root`, remap the warm/gold tokens to Apex dark-emerald values (keep the variable NAMES so nothing downstream breaks):
```
--ink: #F4FBF8; --ink-2: #F4FBF8; --ink-soft: #A9C4BC; --ink-faint: #6A8A82;
--paper: #0C2A25; --paper-2: #0F332C; --paper-warm: #0F332C;
--rule: rgba(0,208,132,.16); --rule-2: rgba(0,208,132,.30);
--gold: #00D084; --gold-deep: #00D084; --gold-warm: #0BA268; --gold-tint: rgba(0,208,132,.12);
--ok: #00D084; --err: #E5674B;
```
Also set `color-scheme: dark;`.

- [ ] **Step 2: Retheme body + shell backgrounds**

Replace the light gradients:
- `body { background: linear-gradient(180deg,#ECE5D2 0%,#DCD3BC 100%); }` → `background: radial-gradient(120% 90% at 50% -10%, #0A302A 0%, #041C19 60%);`
- `.popup-shell { background: linear-gradient(180deg,#ECE5D2 0%,#DCD3BC 100%); … }` → `background: linear-gradient(180deg,#07231F,#041C19);`
- `.masthead { background: linear-gradient(180deg,var(--paper) 0%,var(--paper-2) 100%); }` stays (now uses dark tokens).
- Remove or lighten the `.popup::before` multiply noise overlay (set `opacity: 0` — it's tuned for paper).

- [ ] **Step 3: Update the title and primary button label**

- `<title>` → "Apex · HubSpot Link".
- Find the primary push button text in `popup.html` (grep `grep -n "Push\|Sync\|Add to" popup.html`) and set its label to "Push to Apex HubSpot". If the label is injected from `popup.js`, change it there instead and note the file.

- [ ] **Step 4: Visually verify against the sketch**

```bash
cd ~/Desktop/Projects/"Apex HS Extension" && python3 -m http.server 8792 >/dev/null 2>&1 &
```
Load `http://localhost:8792/popup.html` in the browser; confirm dark-emerald theme, emerald "Live" badge, emerald primary button reading "Push to Apex HubSpot", text legible. Kill the server after (`kill %1`).

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.js
git commit -q -m "feat: dark-emerald Apex panel theme"
```

---

### Task 7: Adapt the pack scripts and build the extension

**Files:**
- Modify: `~/Desktop/Projects/Apex HS Extension/pack.sh` (output name)
- Modify: `~/Desktop/Projects/Apex HS Extension/pack-crx.sh` (key filename, stage/output names, ID echo)

**Interfaces:**
- Consumes: `apex-ext-signing-key.pem` (Task 2), the rebranded runtime.
- Produces: `dist/apex-hubspot-link-0.1.0.zip` and a signed `dist/apex-hubspot-link-0.1.0.crx`.

- [ ] **Step 1: Update pack.sh output name**

In `pack.sh`, change `OUT="dist/ortus-hubspot-sync-$VER.zip"` → `OUT="dist/apex-hubspot-link-$VER.zip"`.

- [ ] **Step 2: Update pack-crx.sh**

In `pack-crx.sh`: `KEY="ortus-ext-signing-key.pem"` → `KEY="apex-ext-signing-key.pem"`; `STAGE="build/ortus-ext"` → `STAGE="build/apex-ext"`; the two `build/ortus-ext.crx` references → `build/apex-ext.crx`; `OUT="dist/ortus-hubspot-sync-$VER.crx"` → `OUT="dist/apex-hubspot-link-$VER.crx"`; update the `Extension ID:` echo to print `$APEX_EXT_ID` (from Task 2 Step 3) or drop the hardcoded Ortus id.

- [ ] **Step 3: Build the zip**

Run: `cd ~/Desktop/Projects/"Apex HS Extension" && sh pack.sh`
Expected: "Built dist/apex-hubspot-link-0.1.0.zip" and a contents listing of the 8 runtime files + 4 icons.

- [ ] **Step 4: Build the signed .crx**

Run: `sh pack-crx.sh`
Expected: "Built dist/apex-hubspot-link-0.1.0.crx" and an Extension ID matching `APEX_EXT_ID` from Task 2.

- [ ] **Step 5: Commit the script changes (dist is git-ignored)**

```bash
git add pack.sh pack-crx.sh
git commit -q -m "chore: Apex pack scripts (zip + signed crx)"
```

---

### Task 8: End-to-end verification with both extensions installed

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Load the Apex extension unpacked**

In Chrome → `chrome://extensions` → Developer mode → "Load unpacked" → select `~/Desktop/Projects/Apex HS Extension/`. Confirm it appears as "Apex Strategy · HubSpot Link" with the folded-banner icon, and its ID equals `APEX_EXT_ID`.

- [ ] **Step 2: Confirm side-by-side distinction**

With the Ortus extension also installed, confirm the two are unmistakable: Apex icon (folded banner) vs Ortus icon, and Apex dark-emerald panel vs Ortus cream/gold.

- [ ] **Step 3: Lookup routes to the Apex portal**

Open a LinkedIn profile of a known Apex contact; open the Apex panel; confirm it resolves the contact from the Apex HubSpot. Open a profile only in the Ortus portal; confirm the Apex panel reports "not found" (proving it queries the Apex portal, not Ortus).

- [ ] **Step 4: Push creates/updates in Apex HubSpot**

On a test LinkedIn profile, use "Push to Apex HubSpot"; confirm the contact is created/updated in the Apex portal (check HubSpot), with `linkedin_membership_id` set. Confirm nothing was written to the Ortus portal.

- [ ] **Step 5: Record the result**

Note `APEX_EXT_ID`, the proxy URL, and pass/fail of each check in the commit message of a final docs update (e.g. append a "Verified" line to the spec). Commit.

---

## Notes / phase-2 (out of scope for this plan)

- Origin-lock the proxy: set `ALLOWED_ORIGIN` in `proxy/wrangler.jsonc` to `chrome-extension://<APEX_EXT_ID>` and redeploy, once the ID is confirmed stable in production.
- Back up `apex-ext-signing-key.pem` to the same secure location as the Ortus key.
