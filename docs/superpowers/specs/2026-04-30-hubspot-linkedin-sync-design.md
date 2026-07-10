# Ortus HubSpot Sync — Chrome Extension Design

**Date**: 2026-04-30
**Status**: Approved (brainstorm complete, awaiting spec review)
**Project location**: `/Users/antoniovarlese/Desktop/Projects/HS Extension/`
**Visual reference**: `sketches/states.html`
**Visual lineage**: matches LinkedIn QuickConnect & DM Assistant (Ortus editorial: ivory paper, gold accents, Newsreader serif, Geist sans, mono eyebrows)

---

## 1. Purpose

A Chrome extension for Ortus Club operators that, when opened on a LinkedIn profile, checks whether the person is already in Ortus Club's HubSpot — and if not, pushes them with one click. If already present, offers a single-click update.

The numeric LinkedIn member ID is the dedupe anchor. It is encoded in a synthetic email of the form `<numericId>@linkedinmembership.id`, identical to the format the existing **Ortus SalesNav scraper** writes — so records remain consistent between this extension and the SalesNav pipeline.

## 2. User flow

1. Operator navigates to a LinkedIn profile (`linkedin.com/in/<slug>/` or `linkedin.com/sales/lead/...`).
2. Operator clicks the extension's toolbar icon. Popup opens.
3. Popup shows the dossier (name, role, company) it scraped from the page.
4. Popup tells the operator one of:
   - **Not in HubSpot** — primary CTA: *Push to HubSpot*.
   - **Already in HubSpot** — primary CTA: *Update*. Secondary: *Skip*.
5. On click, the extension creates or patches the contact in HubSpot via the REST API.
6. Popup transitions to a success state with a *View in HubSpot* link, or to an error state with a clear message and a *Retry*.

Auto-send is **off by default and there is no toggle** — every push or update requires an explicit click.

## 3. Architecture

### 3.1 File layout

```
HS Extension/
├── manifest.json          # MV3
├── background.js          # service worker — orchestration, HubSpot calls, token
├── content.js             # injected on linkedin.com — receives SCRAPE_PROFILE
├── scraper.js             # pure DOM-extraction functions (testable)
├── hubspotClient.js       # thin HubSpot API wrapper (search, create, patch)
├── popup.html             # Ortus dossier UI (tokens & layout from QuickConnect)
├── popup.js               # popup state machine, message wiring
├── icons/                 # reuse from QuickConnect for v0.1
├── tests/                 # Jest unit tests for scraper + hubspotClient
│   └── fixtures/          # saved LinkedIn DOM snapshots
└── README.md              # install + smoke-test
```

### 3.2 Manifest essentials

- `manifest_version: 3`
- `permissions`: `storage`, `scripting`
- `host_permissions`: `*://*.linkedin.com/*`, `https://api.hubapi.com/*`
- `background.service_worker`: `background.js`
- `content_scripts`: `linkedin.com/*` → `content.js`
- `action.default_popup`: `popup.html`

### 3.3 Message flow on popup open

1. `popup.js` → `background.js`: `GET_PROFILE_STATE`
2. `background.js` → `content.js` on the active tab: `SCRAPE_PROFILE`
3. `content.js` runs `scraper.js` against `document` → `{firstName, lastName, company, jobTitle, memberId}` or `{error}`
4. `background.js` builds `email = ${memberId}@linkedinmembership.id`
5. `background.js` → `hubspotClient.searchByEmail(email)` → `{found: true, contactId, properties}` or `{found: false}`
6. `background.js` → `popup.js`: state payload (see § 6)
7. Popup renders the matching state.

### 3.4 State machine (popup)

```
INIT
 ├── not_on_profile         ──► "Open a LinkedIn profile to begin."
 ├── scraping               ──► shimmer
 ├── scrape_failed (hard)   ──► "Couldn't read this profile." + Retry
 ├── checking               ──► shimmer
 ├── not_found              ──► dossier + "Push to HubSpot" CTA
 ├── found                  ──► dossier + "Update" / "Skip"
 ├── pushing | updating     ──► CTA disabled + spinner
 ├── success_pushed         ──► "✓ Pushed" + View in HubSpot
 ├── success_updated        ──► "✓ Updated" + View in HubSpot
 └── error_*                ──► see § 7 error matrix
```

## 4. HubSpot integration

### 4.1 Authentication

The HubSpot **Private App token** is hardcoded in `background.js` as a constant. No operator ever pastes it. No popup UI for the token. Distribution implications:

- The token is in plain text in any `.zip` / unpacked extension folder we hand out.
- The build is shared **only** with trusted Ortus Club operators.
- If a laptop with the extension installed is lost or compromised, **rotate the HubSpot Private App token immediately** and ship a new build.
- The token must be scoped to the minimum needed: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`. Nothing else.

### 4.2 Properties used

| Field scraped from LinkedIn | HubSpot property (internal name) | Type |
|---|---|---|
| First name | `firstname` | standard |
| Last name | `lastname` | standard |
| Company | `company` | standard |
| Job title | `jobtitle` | standard |
| `<numericId>@linkedinmembership.id` | `email` | standard (dedupe key) |
| Numeric LinkedIn member ID | `linkedin_membership_id` | **custom** (already created by SalesNav scraper) |

### 4.3 API calls

1. **Search** — `POST /crm/v3/objects/contacts/search`
   ```json
   { "filterGroups": [{ "filters": [{
     "propertyName": "email", "operator": "EQ", "value": "<syntheticEmail>"
   }]}], "limit": 2 }
   ```
   Expected: 0 or 1 result. 2+ results → `error_duplicate` (defensive).

2. **Create** — `POST /crm/v3/objects/contacts`
   ```json
   { "properties": {
     "firstname": "...", "lastname": "...", "company": "...",
     "jobtitle": "...", "email": "...", "linkedin_membership_id": "..."
   }}
   ```

3. **Update** — `PATCH /crm/v3/objects/contacts/{contactId}`
   Same body as Create. Per the agreed semantics (option B), an update overwrites all **populated** scraped fields with the freshly scraped values. Soft-failed fields (empty `lastName`, `company`, or `jobTitle`) are **omitted** from the payload so HubSpot does not blank existing data — see § 5.5. `email` and `linkedin_membership_id` are always present and will not change in practice.

### 4.4 First-open health check

On the first popup open per service-worker session, `background.js` runs:

- `GET /crm/v3/properties/contacts/linkedin_membership_id` — confirms the custom property exists.
- The result is cached in-memory for the service worker's lifetime.

If the property is missing, every dossier renders `error_property` (see § 7) with a clear instruction. We do **not** create the property silently.

## 5. LinkedIn scraping (`scraper.js`)

### 5.1 Public surface

```js
scrapeProfile(document, url) → {
  firstName: string,
  lastName: string,    // may be ""
  company: string,     // may be ""
  jobTitle: string,    // may be ""
  memberId: string,    // numeric, required
  pageType: "profile" | "salesnav",
} | { error: "not_on_profile" | "no_member_id" | "no_name" }
```

### 5.2 Page detection

- URL matches `^https?://([a-z]+\.)?linkedin\.com/in/[^/]+/?` → regular profile.
- URL matches `^https?://([a-z]+\.)?linkedin\.com/sales/lead/` → Sales Navigator profile.
- Otherwise → `{error: "not_on_profile"}`.

### 5.3 Field sources — regular profile

| Field | Primary | Fallback |
|---|---|---|
| First / last name | `<h1>` in top card; split on first space | `<title>` parse |
| Job title | `<div>` with class containing `text-body-medium` directly under the `<h1>` | meta description |
| Company | First `<li>` of the experience section, current-role bold company line | second line of `text-body-medium` block when format `Title at Company` |
| Numeric member ID | regex on `document.documentElement.outerHTML`: `"objectUrn":"urn:li:member:(\d+)"` | regex `"memberId"\s*:\s*"?(\d+)` |

### 5.4 Field sources — Sales Navigator

| Field | Primary | Fallback |
|---|---|---|
| First / last name | the lead-name element on the SalesNav card | regex on outerHTML for `"firstName":"…","lastName":"…"` |
| Job title | role line under the name | regex on outerHTML for `"role":"…"` |
| Company | current-company link in role block | regex on outerHTML for `"companyName":"…"` |
| Numeric member ID | regex on outerHTML: `"objectUrn":"urn:li:member:(\d+)"` (same hydration data is present) | URL path decode of `/sales/lead/<id>` |

### 5.5 Hard-fail vs soft-fail

- **`memberId` missing** → hard fail. Refuses to push. Without it the synthetic email and dedupe key cannot be built; pushing would create duplicate junk.
- **`firstName` missing** → hard fail. HubSpot needs at least a first name for a usable record.
- **`lastName`, `company`, `jobTitle` missing** → soft fail. The popup renders a `warning-chip` like *"Pushing without job title"* and the push proceeds with the empty field omitted from the payload (so existing values on update are blanked only when we have a value).

### 5.6 Loom verification

The user's boss has documented their own extraction method on Loom (`https://www.loom.com/share/ec56261b69c34ebba644e5c3afd10fae`). The current spec follows the well-documented Apollo-style approach (`urn:li:member:` regex on hydration data). If the Loom shows a different/simpler technique, the implementation in `scraper.js` will be swapped during the build — the rest of the design is independent of how scraping works internally.

## 6. Popup UI

### 6.1 Visual system

Identical tokens to QuickConnect's `popup.html`:

- Width 390px, paper background `#FDFBF7` over warm gradient body
- Newsreader serif for dossier headlines (26px, weight 500)
- Geist sans for body, Geist Mono for eyebrows / captions
- Gold `#C99046` accents — eyebrow rule, gold pod inside the dark CTA, gold tint chips
- Same subtle paper-noise overlay on `.popup::before`

### 6.2 Frame inventory (matches `sketches/states.html`)

| # | State | Eyebrow | Headline | Sub | CTA(s) |
|---|---|---|---|---|---|
| 1 | `not_on_profile` | *muted* OPEN A PROFILE | "Open a LinkedIn profile to begin." | — | — |
| 2 | `scraping` | READING PROFILE | shimmer | shimmer | — |
| 3 | `not_found` | NOT IN HUBSPOT | **First *Last*** | role · company + synthetic-email mono line | **Push to HubSpot** (gold-pod CTA) |
| 4 | `not_found` (partial) | NOT IN HUBSPOT | **First *Last*** | partial sub | warning-chip + Push CTA |
| 5 | `found` | *ok* ALREADY IN HUBSPOT | **First *Last*** | role · company + "in HubSpot since {month year}" link | **Update** + **Skip** |
| 6 | `success_pushed` | *ok* PUSHED | "First *Last* added to HubSpot." | View link | — |
| 7 | `success_updated` | *ok* UPDATED | "First *Last* updated." | role · company + View link | — |
| 8 | `error_token` | *error* HUBSPOT REJECTED THE TOKEN | "Token may have been rotated." | 401 detail block | Retry (ghost) |
| 9 | `scrape_failed` | *error* COULDN'T READ THE PROFILE | "Couldn't read the LinkedIn ID for this profile." | helpful detail block | Retry (ghost) |
| 10 | Settings tab | CONNECTION | "HubSpot connection" | three green check rows + Test / Reset buttons | — |

### 6.3 Wording

- "Found" state: **"Update" / "Skip"** (editorial, matches Ortus voice). Locked.
- Success: "added to HubSpot." / "updated."
- Errors: short headline + a mono detail block beneath. No long paragraphs.

### 6.4 Tabs

Two tabs only in v0.1:

- **Profile** (default) — the dossier above.
- **Settings** — the health check rows. No token input. No Activity tab in v0.1 (cut to keep scope tight; can come back in v0.2).

### 6.5 Footer

`Ortus Club · 2026` left, `v0.1` right. Same as QuickConnect.

## 7. Error handling

| Cause | Popup state | Wording |
|---|---|---|
| Active tab is not a LinkedIn profile URL | `not_on_profile` | "Open a LinkedIn profile to begin." |
| Content script not yet injected | `not_on_profile` | same |
| Scrape returns no member ID | `scrape_failed` | "Couldn't read the LinkedIn ID for this profile." + Retry |
| Scrape returns no first name | `scrape_failed` | "Couldn't read the name for this profile." + Retry |
| Scrape returns partial (no last name / company / job title) | `not_found` or `found` with `warning-chip` | "Pushing without job title" / etc. |
| HubSpot 401 | `error_token` | "HubSpot rejected the token — token may have been rotated. Antonio needs to ship an update." |
| HubSpot 403 | `error_scope` | "Token is missing the required scope: <scope name>." |
| `linkedin_membership_id` property missing | `error_property` | "HubSpot is missing the `linkedin_membership_id` property." + how to fix |
| Network failure | `error_network` | "Couldn't reach HubSpot — check your connection." + Retry |
| HubSpot 429 | `error_rate_limit` | "HubSpot is throttling — wait a moment." Auto-retries once after 10s. |
| HubSpot 5xx | `error_hubspot` | "HubSpot is having a moment — try again." + Retry |
| Search returns >1 contact | `error_duplicate` | "Multiple HubSpot contacts share this LinkedIn ID — open HubSpot to dedupe." |

All errors render in the dossier slot using the `eyebrow.error` style (red rule + red eyebrow). No silent failures.

## 8. Testing strategy

- **Unit tests on `scraper.js`** (Node, Jest-style). `tests/fixtures/` holds saved LinkedIn DOM snapshots — one regular profile, one Sales Navigator profile, one regular profile with a missing job title (soft-fail case), and one minimal page (hard-fail case for missing member ID). Each test loads a fixture into JSDOM and asserts the extracted fields.
- **Mocked HubSpot client tests**. `hubspotClient.js` is the only network surface; tests stub `fetch` and cover: not-found path, found-and-update path, 401, 403, missing-property check, 429 with auto-retry, 5xx, network failure, duplicate-contact case.
- **Manual smoke checklist in README**:
  1. Load unpacked.
  2. Open a known-not-in-HubSpot profile → confirm "Push to HubSpot" → click → confirm `success_pushed` and that the contact exists in HubSpot with the six properties set.
  3. Reopen the same profile → confirm "Already in HubSpot" + Update works (re-PATCHes the fields).
  4. Open a profile in Sales Navigator → confirm dossier renders.
  5. Open a non-LinkedIn tab → confirm `not_on_profile`.
- **No CI integration tests against real HubSpot** — those need a live token and pollute the real CRM. Manual only.

## 9. Out of scope for v0.1

- Activity tab (cut, may return in v0.2).
- Keyboard shortcut to push without opening popup.
- Bulk push from a list view.
- Phone numbers, location, or any LinkedIn field beyond the six listed.
- Auto-detect on profile load (popup-only trigger keeps user in control).
- Backwards-compatibility with older HubSpot API versions.

## 10. Distribution & deployment

- Same `build-zip.sh` pattern as QuickConnect (one zip → side-load).
- `manifest.json` `version` follows `0.x.0` for v0.1 builds, bumping minor on each release.
- README documents the smoke-test checklist and the token-rotation procedure.
- Token rotation procedure: HubSpot admin rotates the Private App token → developer pastes the new token into `background.js` → bumps version → rebuilds zip → distributes.

## 11. Open items (for review)

1. The exact "in HubSpot since" date — depends on whether HubSpot's `createdate` for this contact is what we want to surface, or the SalesNav `hs_lifecyclestage` change date. Pick during implementation.
2. Whether the *View in HubSpot* link should open the contact at `app.hubspot.com/contacts/<portalId>/contact/<contactId>` — the `portalId` is also bundled into the build alongside the token.
