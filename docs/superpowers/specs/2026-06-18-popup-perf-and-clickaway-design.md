> # ⛔ ABANDONED — DO NOT IMPLEMENT (2026-06-18)
> The work derived from this spec was **built and fully reverted** the same day because it
> **broke role/company display twice**. The root cause is a load-bearing scrape-timing
> dependency: the LinkedIn Experience section is lazy-mounted, and BOTH the caching/decoupling
> and the property-check‖scrape parallelization here cause the scrape to fire **before** that
> section renders, yielding name+id but **empty role/company**. The extension was restored to
> the known-good **v0.1.34**. A regression guardrail now exists at `tests/content-readiness.test.js`
> (mutation-tested) that goes red if this approach is reintroduced.
> **If you are considering this work: STOP.** Do not resume without (a) explicit instruction from
> Antonio AND (b) a way to load-test the extension live in Chrome. The analysis below is retained
> for reference only — its recommendations are known-harmful as written.

# Popup performance + click-away resilience — Design

**Date:** 2026-06-18
**Project:** Ortus Club · HubSpot Sync (Chrome MV3 extension) — `HS Extension New`, v0.1.34
**Scope:** Sub-project 1 of 3 from Antonio's improvement list. Covers **#1 (init lag)** and **#2 (click-away bug)** only. **#3 (in-extension tag/lead-status editing)** and **#4 (remove unpacked-folder install dependency)** are separate specs, out of scope here.

---

## 1. Problem

Opening the popup is slow, and navigating away / clicking off the popup mid-match either silently drops the result or leaves the popup stuck on the loading shimmer. Both stem from the same root cause: **all the expensive work is a single serial `await` chain owned by the popup's one-shot `chrome.runtime.sendMessage`, and nothing is cached off the popup's lifetime.**

### Verified current init path (evidence from code read 2026-06-18)
Triggered by `loadState()` → `chrome.runtime.sendMessage({type:"GET_PROFILE_STATE"})` (`popup.js:322-326`), handled by `getProfileState()` (`background.js:137-191`):

1. **HubSpot property check** — blocking network GET, *serial, before the scrape*; memoised per service-worker (SW) lifetime. `background.js:140`, `hubspotClient.js:97-102`
2. **Scrape** via `chrome.tabs.sendMessage(SCRAPE_PROFILE)` → content script. `background.js:36`
3. **`forceLazyLoad()`** — DOM readiness poll **up to 15 s** (`maxMs:15000, intervalMs:150`); legacy UI also scrolls the page to the bottom and back. `content.js:90-111` (`:100`, `:109`)
4. **`waitForSlugInHydration()`** — on SPA navigation, **adds up to 5 s** (`maxMs:5000`). `content.js:133-148` (`:144-147`)
5. **Member-ID resolution (3-tier):** DOM regex first (`scraper.js:96-134`); if miss → **Voyager** fetch (`background.js:53-80`); if still miss → **SalesNav** ×2 serial fetches (`background.js:99-131`). **No `AbortController`/timeout/retry on any fetch.**
6. **HubSpot lookup:** `searchByLinkedInBio` then (on miss) `searchByEmail("<memberId>@linkedinmembership.id")` — **two serial searches.** `background.js:169-174`

**Worst realistic case ≈ 20 s of polling before any network starts.** Caches today: `propertyCheckPromise` (SW lifetime), `memberIdCache` (SalesNav only, keyed by `profileUrn`, **caches `null` too**). **The HubSpot verdict is never cached.** No `chrome.storage` is used despite the permission being declared.

### Verified click-away failure modes
Popup ↔ background is one-shot `sendMessage` awaited at `popup.js:324`; the popup owns the only copy of the result.
- **Terminates:** popup destroyed on blur → SW may finish but `sendResponse` has no live channel → result silently discarded; reopen restarts everything.
- **Hangs:** no timeout and no `try/catch` around the await → the `"scraping"` shimmer (`popup.js` render `scraping` case) can stick indefinitely.
- The content-script `forceLazyLoad` poll keeps running (and may visibly scroll the page) after the popup is gone.

### MV3 constraints the fix must respect (from official Chrome docs)
- SW terminates after **30 s idle** or a **5 min** single task; a `fetch` whose response takes >30 s itself triggers termination.
- **Since Chrome 114, an idle `runtime.connect` port does NOT keep the SW alive** — you must actively message it (~every 25 s) or use `chrome.alarms`.
- SW termination abandons in-flight `fetch`es and wipes all in-memory module state (`propertyCheckPromise`, `memberIdCache`).
- `chrome.storage.session` is **in-memory, SW-accessible, ~10 MB, cleared on browser restart / extension reload**, and not exposed to content scripts unless `setAccessLevel` is called. Popup and SW lifetimes are independent.

---

## 2. Goal — "Done looks like"
1. Clicking away or navigating mid-match **never aborts or hangs** the match.
2. **Reopening the popup is instant** — shows the cached verdict (or in-progress state), never silently blank, never a stuck shimmer.
3. **First open of a fresh profile is meaningfully faster** than today.
4. **No HubSpot lookups for profiles the operator never opens** (lazy, not proactive).

## 3. Non-goals — "Don't do"
- No tag/lead-status editing (sub-project #3). No install/distribution change (sub-project #4).
- No proactive/eager matching on profile load.
- **Do not change member-ID resolution ordering or correctness:** keep DOM-scrape-first + the strict slug-anchored `extractMemberId`; do **not** make Voyager-first; do **not** fire Voyager+SalesNav in parallel; do **not** add naive 429 retries; do **not** remove the SPA slug guards (`waitForSlugInHydration`, `profileMatchesUrl`). Each protects against pushing the **wrong contact** into HubSpot.
- No new manifest permissions (`storage` + `scripting` already cover this).

---

## 4. Design

### 4.1 Mechanism — `chrome.storage.session` as source of truth (not a port)
The background runs the match job and writes its state to `chrome.storage.session`; the popup reads that and subscribes to changes. This decouples the job from the popup (fixes click-away) **and** survives SW death (state is persisted), without the Chrome-114 port-keepalive problem.

- **Cache entry shape**, keyed by `memberId`:
  `{ status: "running" | "done" | "error", state, scrape, contact?, startedAt, updatedAt }`
- **Pre-ID index:** before the memberId is known, index the in-flight job by `tabId + ":" + normalizedUrl` so a reopened popup on the same tab finds the running job; re-key to `memberId` once resolved.
- **Popup on open** (`loadState`): read `storage.session` for the active tab's entry → if present, **render immediately**; subscribe to `chrome.storage.onChanged` for live updates while open; only send a "start job" message if no fresh entry exists. Remaining message awaits wrapped in `try/catch` so a closed channel can never strand the UI.
- **Background job** is idempotent and checkpointed: writes `running` immediately, writes `done`/`error` on completion. A `running` entry older than the **dead-job timeout (~15 s)** is treated as abandoned (SW death) and restarted. Concurrent requests for the same key share the one in-flight job (dedupe — no double scrape/search).

### 4.2 Caching
- **`matchCache` (HubSpot verdict)** — new pure module `matchCache.js`, keyed by `memberId`. Cache **only `found` / `not_found`**. **Stale-while-revalidate ~60 s:** serve the cached verdict instantly; if `updatedAt` is older than 60 s (or the tab URL changed), re-check HubSpot in the background and push an update via `storage.onChanged` if it changed.
- **memberId-by-slug cache** — cache the resolved memberId keyed by URL slug, **positive hits only**, so repeat opens skip Voyager/SalesNav. (Also memoise the Voyager positive result.)
- **Never cache transient errors:** `error_rate_limit` (429), `error_hubspot` (5xx), `error_network`, `error_token`, `error_scope`, `error_unconfigured`, and all `scrape_failed*` states bypass the cache write. `error_duplicate` may be cached but is cleared by TTL (it resolves by a human deduping in HubSpot).
- **Invalidation:** `success_pushed` upserts the entry to `found` with the new `contactId`; `success_updated` refreshes stored properties; `RESET_CACHE` clears `matchCache` + `memberIdCache`; plus the 60 s TTL.
- Back the caches with `chrome.storage.session` (survives SW eviction within the session); keep an in-memory `Map` mirror for hot reads.

### 4.3 Latency cuts
- **Parallelize** `ensurePropertyCheck()` with the scrape via `Promise.all` — removes one serial HubSpot round-trip from cold start. `background.js:140` vs `:144`
- **Bound + abort the long waits:** lower the poll ceilings — proposed defaults `forceLazyLoad` 15 s → **6 s**, `waitForSlugInHydration` 5 s → **3 s** (tunable; the happy path already returns on the first ready tick, so these only cap the failure case) — and **abort the content-script poll on `visibilitychange` / `pagehide`** (i.e. exactly when the user clicks away) so it resolves fast instead of polling a departed DOM.

### 4.4 Adjacent items folded in (approved scope)
- **Fetch timeouts:** add an `AbortController` (~8 s) to every network call — Voyager (`background.js:59`), SalesNav (`background.js:110`), HubSpot (`hubspotClient.js:10`). A stalled socket currently has no ceiling and can silently trigger SW death.
- **Fix SalesNav null-cache poisoning:** stop caching `null` in `memberIdCache` (`background.js:129`) — today a transient SalesNav miss makes the profile unresolvable for the whole SW lifetime. Cache positive resolutions only (or expire negatives).
- **Collapse the two HubSpot searches into one** OR-filter search (`linkedinbio` OR synthetic `email`) — one round-trip instead of two. Preserve exact found/not-found/duplicate semantics; the synthetic-email match remains the identity key.

---

## 5. Components / files touched
- **new `matchCache.js`** — pure, testable cache + job-state logic (key derivation, TTL/staleness, dead-job detection, invalidation). UMD/CommonJS shim mirroring `hubspotClient.js:107-110`; `importScripts("matchCache.js")` in `background.js`.
- `background.js` — job manager + `storage.session` read/write + dedupe + cache wiring + invalidate-on-push/update; `Promise.all` for property-check ∥ scrape; `AbortController` on Voyager/SalesNav; collapse searches; SalesNav null-cache fix.
- `content.js` — bound the poll ceilings; abort on `visibilitychange`/`pagehide`.
- `hubspotClient.js` — `AbortController` timeout in `hsFetch`; single OR-filter search method.
- `popup.js` — read cache + render on open; subscribe to `storage.onChanged`; `try/catch` around message awaits; keep pure-renderer model.
- `manifest.json` — unchanged.

## 6. Error handling
Keep the existing `mapClientErrorState` / `mapScrapeErrorState` mapping (`background.js:200-207`). Transient vs terminal classification (above) governs what may be cached. A new fetch-timeout abort maps to `error_network` (renderable, retryable), not a hang.

## 7. Testing
- Keep `tests/scraper.test.js` and `tests/hubspotClient.test.js` green.
- **New unit tests for `matchCache.js`** (pure logic; jest + fake timers for TTL/dead-job). No `chrome.*` mock needed if logic stays pure.
- Voyager / SalesNav / `background.js` orchestration remain unit-untested (no `chrome` harness today) → cover via an **extended manual smoke test** in README:
  - Open popup on a fresh profile → faster than before.
  - Open, **click away mid-load**, reopen → shows result instantly, no stuck shimmer.
  - Navigate between two profiles → each shows the **correct** contact (slug guards intact).
  - Push to HubSpot → reopen same profile → shows **found** (cache invalidated correctly).
  - Force a network stall → resolves to a clean error state within ~8 s, not an indefinite hang.
- Implementation follows TDD (test-first for `matchCache.js`).

## 8. Risks
- **Staleness vs external HubSpot edits** — bounded by the 60 s stale-while-revalidate window.
- **SW death mid-job** — mitigated by `storage.session` checkpointing + the 15 s dead-job restart.
- **Voyager/SalesNav untested** — the timeout + null-cache changes touch this path; validate manually against live profiles (e.g. a profile whose ID is *not* in the DOM, forcing the fallback).
- **Collapsing the two searches** touches identity-match logic — must preserve duplicate detection; add/extend a `hubspotClient` test for the OR-filter path.
- **Version mismatch noted:** `manifest.json` = 0.1.34 but `package.json` = 0.1.0 — reconcile when bumping for the ship.

## 9. Out of scope (tracked for later specs)
- **#3** In-extension tag + lead-status editing, options read from HubSpot property definitions, written back to HubSpot.
- **#4** Remove the unpacked-desktop-folder install dependency (e.g. private/unlisted Chrome Web Store or self-hosted auto-update).
