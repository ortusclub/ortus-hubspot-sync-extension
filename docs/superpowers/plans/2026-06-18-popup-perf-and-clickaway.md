# Popup Performance + Click-Away Resilience — Implementation Plan

> # ⛔ ABANDONED — DO NOT EXECUTE (2026-06-18)
> This plan was executed and **fully reverted** the same day. It **broke role/company display twice**.
> The `matchCache.js` + `chrome.storage.session` decoupling, the shortened readiness budget, and the
> `Promise.all(propCheck, scrape)` parallelization all make the scrape fire **before** LinkedIn's
> lazy-mounted Experience section renders → name+id but **empty role/company**. The extension is
> restored to the known-good **v0.1.34**; `matchCache.js` and its test were deleted.
> A guardrail at `tests/content-readiness.test.js` (mutation-tested) fails if any of these are
> reintroduced — run `npm test` before touching the scrape-timing path.
> **Do NOT execute this plan.** Resume only with explicit instruction from Antonio AND a live
> in-Chrome load-test capability. Kept for reference, not for execution.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the popup open fast and survive click-away/navigation, by moving the match job off the popup's lifetime into the background with a `chrome.storage.session`-backed per-profile cache.

**Architecture:** A new pure `matchCache.js` module holds all cache + job-state logic (unit-tested). `background.js` runs the match as a deduped job, writes `running`/`done` state to `chrome.storage.session` keyed by tab and caches verdicts by `memberId` (stale-while-revalidate). `popup.js` becomes a cache reader: on open it paints the last stored result instantly, subscribes to `storage.onChanged` for live updates, and kicks the job — so closing the popup never aborts the work and reopening is instant.

**Tech Stack:** Chrome MV3 (service worker, `chrome.storage.session`, `chrome.tabs`, `chrome.runtime`), vanilla JS, Jest 29 + jsdom. Modules use the existing UMD/CommonJS shim pattern (`hubspotClient.js:107-110`).

## Global Constraints

- **Live secret:** `background.js:7` contains a REAL HubSpot token (`pat-na1-…`). NEVER reproduce it in code/tests/commits; treat `HUBSPOT_TOKEN` as an existing untouched constant. NEVER push `background.js` to any public remote.
- **Commit policy (this session):** committing is deferred. Work on an isolated branch; each commit does `git add <only the listed files>` — never `git add -A` (the shared git root has unrelated dirty files). Do not push without explicit user go-ahead. Confirm the branch with the user before the first commit.
- **Correctness guardrails — DO NOT:** make Voyager-first; reorder/remove the DOM-scrape-first strict slug-anchored `extractMemberId`; fire Voyager+SalesNav in parallel; add naive 429 retries; remove the SPA slug guards (`profileMatchesUrl`, `waitForSlugInHydration`). Each prevents pushing the **wrong contact** into HubSpot.
- **No new manifest permissions** — `storage` + `scripting` already suffice. `chrome.storage.session` needs no manifest change and is accessible to extension pages (popup) by default.
- **Tunables (verbatim):** stale-while-revalidate TTL = **60000 ms**; dead-job timeout = **15000 ms**; fetch timeout = **8000 ms**; `forceLazyLoad` poll ceiling = **6000 ms**; `waitForSlugInHydration` ceiling = **3000 ms**.
- **Cacheable states only:** `found`, `not_found`, `error_duplicate`. Never cache `error_token/scope/rate_limit/hubspot/network/unconfigured/property` or any `scrape_failed*`.
- **Test command:** `npm test` (jest). Run from the project root.

---

## File Structure

- **Create `matchCache.js`** — pure cache + job-state logic (keys, entry constructors, freshness/staleness, dead-job, cacheable-state). No `chrome`/`fetch`/`Date` inside; caller passes `now`.
- **Create `tests/matchCache.test.js`** — unit tests for the above.
- **Modify `hubspotClient.js`** — add `searchByAny(filters)` (OR-filter single search) and an `AbortController` timeout in `hsFetch`.
- **Modify `tests/hubspotClient.test.js`** — tests for `searchByAny` and the fetch timeout.
- **Modify `background.js`** — `importScripts("matchCache.js")`; `fetchWithTimeout` for Voyager/SalesNav; SalesNav null-cache fix; `Promise.all` for property∥scrape; slug→memberId cache; member verdict cache (SWR); collapse searches via `searchByAny`; `runProfileJob` with `storage.session` tab pointer + in-memory dedupe; invalidate on push/update; `RESET_CACHE` clears caches.
- **Modify `content.js`** — lower poll ceilings; abort polls on `visibilitychange`(hidden)/`pagehide`.
- **Modify `popup.html`** — load `matchCache.js` before `popup.js`.
- **Modify `popup.js`** — read tab pointer on open, subscribe to `storage.onChanged`, `try/catch` message awaits.
- **Modify `manifest.json` + `package.json`** — reconcile/bump version.
- **Modify `README.md`** — extend the manual smoke-test checklist.

---

## Task 1: `matchCache.js` pure module

**Files:**
- Create: `matchCache.js`
- Test: `tests/matchCache.test.js`

**Interfaces:**
- Produces (exported on `module.exports` for Node and `root.OrtusMatchCache` for the SW):
  - Constants: `TTL_MS = 60000`, `DEAD_JOB_MS = 15000`
  - `normalizeUrl(url) -> string` (strips `?`/`#` onward)
  - `tabKey(tabId) -> string`, `memberKey(memberId) -> string`, `slugKey(slug) -> string`
  - `isCacheableState(state) -> boolean`
  - `runningEntry(now, url) -> {status:"running",state:"scraping",startedAt,updatedAt,url}`
  - `doneEntry(payload, now, url) -> {status:"done",state,scrape,contact,debug,startedAt,updatedAt,url}`
  - `memberEntry(payload, now) -> {state,scrape,contact,updatedAt}`
  - `isDoneFresh(entry, now, ttlMs?) -> boolean`, `isMemberFresh(entry, now, ttlMs?) -> boolean`
  - `isLiveJob(entry, now, deadMs?) -> boolean`, `isDeadJob(entry, now, deadMs?) -> boolean`
  - `payloadFromEntry(entry, scrapeOverride?) -> {state,scrape?,contact?,debug?}`

- [ ] **Step 1: Write the failing test**

Create `tests/matchCache.test.js`:

```javascript
const MC = require("../matchCache.js");

describe("keys", () => {
  test("tab/member/slug keys are namespaced and stable", () => {
    expect(MC.tabKey(42)).toBe("match:tab:42");
    expect(MC.memberKey("98750243")).toBe("match:member:98750243");
    expect(MC.slugKey("Erica-Piazza")).toBe("mid:slug:erica-piazza");
  });
  test("normalizeUrl strips query and hash", () => {
    expect(MC.normalizeUrl("https://www.linkedin.com/in/foo?x=1#y")).toBe("https://www.linkedin.com/in/foo");
    expect(MC.normalizeUrl("")).toBe("");
  });
});

describe("isCacheableState", () => {
  test("caches only terminal verdicts", () => {
    ["found", "not_found", "error_duplicate"].forEach(s => expect(MC.isCacheableState(s)).toBe(true));
    ["error_token", "error_rate_limit", "error_network", "error_hubspot",
     "error_scope", "error_unconfigured", "error_property",
     "scrape_failed", "scrape_failed_id", "scrape_failed_name", "scraping"]
      .forEach(s => expect(MC.isCacheableState(s)).toBe(false));
  });
});

describe("entries + freshness", () => {
  test("runningEntry/doneEntry carry status and timestamps", () => {
    const r = MC.runningEntry(1000, "u");
    expect(r.status).toBe("running");
    expect(r.startedAt).toBe(1000);
    const d = MC.doneEntry({ state: "found", scrape: { memberId: "1" }, contact: { id: "c" } }, 2000, "u");
    expect(d.status).toBe("done");
    expect(d.state).toBe("found");
    expect(d.scrape.memberId).toBe("1");
    expect(d.contact.id).toBe("c");
    expect(d.updatedAt).toBe(2000);
  });
  test("isDoneFresh true within TTL, false after", () => {
    const d = MC.doneEntry({ state: "not_found" }, 1000, "u");
    expect(MC.isDoneFresh(d, 1000 + 59999)).toBe(true);
    expect(MC.isDoneFresh(d, 1000 + 60000)).toBe(false);
    expect(MC.isDoneFresh(null, 1)).toBe(false);
    expect(MC.isDoneFresh(MC.runningEntry(1000, "u"), 1000)).toBe(false); // running is not "done"
  });
  test("isMemberFresh respects TTL", () => {
    const m = MC.memberEntry({ state: "found", contact: { id: "c" } }, 1000);
    expect(MC.isMemberFresh(m, 1000 + 59999)).toBe(true);
    expect(MC.isMemberFresh(m, 1000 + 60000)).toBe(false);
    expect(MC.isMemberFresh(null, 1)).toBe(false);
  });
  test("live vs dead job by startedAt age", () => {
    const r = MC.runningEntry(1000, "u");
    expect(MC.isLiveJob(r, 1000 + 14999)).toBe(true);
    expect(MC.isLiveJob(r, 1000 + 15000)).toBe(false);
    expect(MC.isDeadJob(r, 1000 + 15000)).toBe(true);
    expect(MC.isDeadJob(MC.doneEntry({ state: "found" }, 1000, "u"), 9e9)).toBe(false);
  });
  test("payloadFromEntry reconstructs popup payload; scrapeOverride wins", () => {
    const e = MC.memberEntry({ state: "found", scrape: { firstName: "Old" }, contact: { id: "c" } }, 1000);
    const p = MC.payloadFromEntry(e);
    expect(p.state).toBe("found");
    expect(p.scrape.firstName).toBe("Old");
    expect(p.contact.id).toBe("c");
    const p2 = MC.payloadFromEntry(e, { firstName: "New" });
    expect(p2.scrape.firstName).toBe("New");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- matchCache`
Expected: FAIL — `Cannot find module '../matchCache.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `matchCache.js`:

```javascript
// matchCache.js — pure cache + job-state logic. Runs in the service worker
// (global OrtusMatchCache) and in Node tests (CommonJS). No chrome/fetch/Date:
// callers pass `now` so behavior is fully deterministic and unit-testable.

(function (root) {
  const TTL_MS = 60000;       // stale-while-revalidate window for a cached verdict
  const DEAD_JOB_MS = 15000;  // a "running" entry older than this = SW died mid-job

  const CACHEABLE = new Set(["found", "not_found", "error_duplicate"]);

  function normalizeUrl(url) {
    if (!url) return "";
    const i = url.search(/[?#]/);
    return i === -1 ? url : url.slice(0, i);
  }

  function tabKey(tabId) { return "match:tab:" + tabId; }
  function memberKey(memberId) { return "match:member:" + memberId; }
  function slugKey(slug) { return "mid:slug:" + String(slug || "").toLowerCase(); }

  function isCacheableState(state) { return CACHEABLE.has(state); }

  function runningEntry(now, url) {
    return { status: "running", state: "scraping", startedAt: now, updatedAt: now, url: url || null };
  }
  function doneEntry(payload, now, url) {
    return {
      status: "done",
      state: payload.state,
      scrape: payload.scrape || null,
      contact: payload.contact || null,
      debug: payload.debug || null,
      startedAt: now,
      updatedAt: now,
      url: url || null,
    };
  }
  function memberEntry(payload, now) {
    return {
      state: payload.state,
      scrape: payload.scrape || null,
      contact: payload.contact || null,
      updatedAt: now,
    };
  }

  function isDoneFresh(entry, now, ttlMs) {
    if (!entry || entry.status !== "done") return false;
    return (now - entry.updatedAt) < (ttlMs == null ? TTL_MS : ttlMs);
  }
  function isMemberFresh(entry, now, ttlMs) {
    if (!entry || entry.updatedAt == null) return false;
    return (now - entry.updatedAt) < (ttlMs == null ? TTL_MS : ttlMs);
  }
  function isLiveJob(entry, now, deadMs) {
    if (!entry || entry.status !== "running") return false;
    return (now - entry.startedAt) < (deadMs == null ? DEAD_JOB_MS : deadMs);
  }
  function isDeadJob(entry, now, deadMs) {
    if (!entry || entry.status !== "running") return false;
    return (now - entry.startedAt) >= (deadMs == null ? DEAD_JOB_MS : deadMs);
  }

  function payloadFromEntry(entry, scrapeOverride) {
    return {
      state: entry.state,
      scrape: scrapeOverride || entry.scrape || undefined,
      contact: entry.contact || undefined,
      debug: entry.debug || undefined,
    };
  }

  const api = {
    TTL_MS, DEAD_JOB_MS,
    normalizeUrl, tabKey, memberKey, slugKey,
    isCacheableState,
    runningEntry, doneEntry, memberEntry,
    isDoneFresh, isMemberFresh, isLiveJob, isDeadJob,
    payloadFromEntry,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusMatchCache = api;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- matchCache`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add matchCache.js tests/matchCache.test.js
git commit -m "feat(cache): add pure matchCache module for per-profile match state"
```

---

## Task 2: `searchByAny` — collapse two HubSpot searches into one

**Files:**
- Modify: `hubspotClient.js` (add `searchByAny`, export it)
- Test: `tests/hubspotClient.test.js`

**Interfaces:**
- Consumes: existing `hsFetch`, `SEARCH_PROPERTIES`, `mapHttpError` (`hubspotClient.js`)
- Produces: `searchByAny(filters)` where `filters = [{propertyName, value}]`; returns `{found:false}` | `{found:true, contactId, properties}` | `{error:"duplicate"}` | `mapHttpError(...)`. Each filter becomes its own `filterGroup` (filterGroups are OR-ed). Filters with a falsy `value` are dropped; empty list → `{found:false}`.

> **Behavior note (intentional):** sequential bio→email hid a duplicate when the bio match and email match were *different* contacts; the single OR search now surfaces that as `error_duplicate` (correct — operator should dedupe). Single-contact and not-found semantics are unchanged.

- [ ] **Step 1: Write the failing test**

Append to `tests/hubspotClient.test.js`:

```javascript
describe("searchByAny", () => {
  test("ORs each filter into its own filterGroup and returns found on single hit", async () => {
    const calls = mockFetch([{ status: 200, body: {
      results: [{ id: "77", properties: { firstname: "Erica" } }]
    }}]);
    const client = createClient({ token: "pat-test" });
    const r = await client.searchByAny([
      { propertyName: "linkedinbio", value: "https://www.linkedin.com/in/erica" },
      { propertyName: "email", value: "98750243@linkedinmembership.id" },
    ]);
    expect(r.found).toBe(true);
    expect(r.contactId).toBe("77");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.filterGroups).toHaveLength(2);
    expect(body.filterGroups[0].filters[0]).toEqual({ propertyName: "linkedinbio", operator: "EQ", value: "https://www.linkedin.com/in/erica" });
    expect(body.filterGroups[1].filters[0]).toEqual({ propertyName: "email", operator: "EQ", value: "98750243@linkedinmembership.id" });
    expect(body.limit).toBe(2);
  });
  test("drops falsy-value filters", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ token: "pat-test" });
    const r = await client.searchByAny([
      { propertyName: "linkedinbio", value: "" },
      { propertyName: "email", value: "1@linkedinmembership.id" },
    ]);
    expect(r.found).toBe(false);
    const body = JSON.parse(calls[0].opts.body);
    expect(body.filterGroups).toHaveLength(1);
    expect(body.filterGroups[0].filters[0].propertyName).toBe("email");
  });
  test("no fetch when no usable filters", async () => {
    const calls = mockFetch([]);
    const client = createClient({ token: "pat-test" });
    const r = await client.searchByAny([{ propertyName: "email", value: "" }]);
    expect(r.found).toBe(false);
    expect(calls).toHaveLength(0);
  });
  test("returns duplicate when >1 result", async () => {
    mockFetch([{ status: 200, body: { results: [{ id: "1" }, { id: "2" }] } }]);
    const client = createClient({ token: "pat-test" });
    const r = await client.searchByAny([{ propertyName: "email", value: "1@linkedinmembership.id" }]);
    expect(r.error).toBe("duplicate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hubspotClient`
Expected: FAIL — `client.searchByAny is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `hubspotClient.js`, add this function after `searchByProperty` (after line 49):

```javascript
    async function searchByAny(filters) {
      const groups = (filters || [])
        .filter(f => f && f.value)
        .map(f => ({ filters: [{ propertyName: f.propertyName, operator: "EQ", value: f.value }] }));
      if (groups.length === 0) return { found: false };
      const r = await hsFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({ filterGroups: groups, properties: SEARCH_PROPERTIES, limit: 2 }),
      });
      if (!r.ok) return mapHttpError(r);
      const results = r.body.results || [];
      if (results.length === 0) return { found: false };
      if (results.length > 1)  return { error: "duplicate" };
      return { found: true, contactId: results[0].id, properties: results[0].properties || {} };
    }
```

Then add `searchByAny` to the returned object (`hubspotClient.js:104`):

```javascript
    return { searchByEmail, searchByLinkedInBio, searchByAny, createContact, updateContact, checkProperty };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hubspotClient`
Expected: PASS (new + all existing tests).

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "feat(hubspot): add searchByAny OR-filter search to collapse two lookups into one"
```

---

## Task 3: `hsFetch` request timeout (AbortController)

**Files:**
- Modify: `hubspotClient.js` (`hsFetch`, lines 7-23)
- Test: `tests/hubspotClient.test.js`

**Interfaces:**
- Produces: `hsFetch` now accepts `opts.timeoutMs` (default 8000); on abort/timeout it returns `{status:0, ok:false, body:null, networkError:true}` → maps to `{error:"network"}`. All existing callers are unaffected (default applies).

- [ ] **Step 1: Write the failing test**

Append to `tests/hubspotClient.test.js`:

```javascript
describe("hsFetch timeout", () => {
  test("aborts a stalled request after the timeout and maps to network", async () => {
    jest.useFakeTimers();
    global.fetch = jest.fn((url, opts) => new Promise((_, reject) => {
      opts.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const client = createClient({ token: "pat" });
    const p = client.searchByEmail("x@y.id");
    await jest.advanceTimersByTimeAsync(8001);
    const r = await p;
    expect(r.error).toBe("network");
    jest.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- hubspotClient`
Expected: FAIL — the stalled promise never rejects (no abort wired), so the test times out / does not return `network`.

- [ ] **Step 3: Write minimal implementation**

Replace `hsFetch` (`hubspotClient.js:7-23`) with:

```javascript
    async function hsFetch(path, opts = {}) {
      const { timeoutMs = 8000, ...fetchOpts } = opts;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res;
      try {
        res = await fetch(HUBSPOT_BASE + path, {
          ...fetchOpts,
          signal: ctrl.signal,
          headers: {
            ...(fetchOpts.headers || {}),
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        });
      } catch (e) {
        return { status: 0, ok: false, body: null, networkError: true };
      } finally {
        clearTimeout(timer);
      }
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- hubspotClient`
Expected: PASS (timeout test + all existing).

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "feat(hubspot): add 8s AbortController timeout to hsFetch"
```

---

## Task 4: Voyager/SalesNav fetch timeouts + SalesNav null-cache fix

**Files:**
- Modify: `background.js` (add `fetchWithTimeout`; use it in `resolveMemberIdViaVoyager` line 59 and `resolveMemberIdViaSalesNav` line 110; remove `null` caching at line 129)

**Interfaces:**
- Produces: `fetchWithTimeout(url, opts?, timeoutMs=8000) -> Promise<Response>` (throws `AbortError` on timeout — callers already `try/catch` into a null result).

> Not unit-tested (no chrome/fetch harness for `background.js`); verify manually in Task 8. Logic is a thin wrapper + a one-line cache change.

- [ ] **Step 1: Add `fetchWithTimeout` helper**

In `background.js`, immediately after `const memberIdCache = new Map();` (line 51), add:

```javascript
async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 2: Use it for the Voyager fetch**

In `resolveMemberIdViaVoyager`, replace `const r = await fetch(url, {` (line 59) with `const r = await fetchWithTimeout(url, {` — keep the same options object. (The existing `try/catch` at lines 58/77 already converts an abort into `{ memberId: null, diag: { error } }`.)

- [ ] **Step 3: Use it for the SalesNav fetch + stop caching null**

In `resolveMemberIdViaSalesNav`:
- Replace `const r = await fetch(url, { credentials: "include", redirect: "follow" });` (line 110) with `const r = await fetchWithTimeout(url, { credentials: "include", redirect: "follow" });`
- Replace the final two lines (118-119 region) — change:

```javascript
  memberIdCache.set(profileUrn, null);
  return { memberId: null, diag };
```

to:

```javascript
  // Do NOT cache a null result — a transient SalesNav miss must not make this
  // profile permanently unresolvable for the service-worker lifetime.
  return { memberId: null, diag };
```

(Keep the positive `memberIdCache.set(profileUrn, memberId)` on a hit at line 122.)

- [ ] **Step 4: Sanity-check the build loads**

Run: `npm test`
Expected: PASS (existing suites unaffected — `background.js` is not imported by tests, but confirm nothing broke).
Then reload the unpacked extension at `chrome://extensions` and confirm the service worker registers with no console errors.

- [ ] **Step 5: Commit**

```bash
git add background.js
git commit -m "fix(resolve): add 8s fetch timeouts to Voyager/SalesNav and stop caching null memberId"
```

---

## Task 5: Wire `matchCache` into `background.js` (job + storage + caches)

**Files:**
- Modify: `background.js` (`importScripts`; `getProfileState`; new `runProfileJob`; message handler; `pushToHubSpot`/`updateContact` invalidation; `RESET_CACHE`)

**Interfaces:**
- Consumes: `self.OrtusMatchCache` (Task 1) — `tabKey, memberKey, slugKey, isCacheableState, runningEntry, doneEntry, memberEntry, isMemberFresh, isLiveJob, payloadFromEntry`; `client.searchByAny` (Task 2).
- Produces: `runProfileJob(tab)` — runs/dedupes the match for a tab, writes `match:tab:<id>` running→done into `chrome.storage.session`, returns the payload. `getProfileState()` now resolves memberId via a slug cache and short-circuits the HubSpot search on a fresh member-cache hit.

> Not unit-tested (no chrome harness). Each step is a precise edit; correctness is verified by the Task 8 smoke test. This task is large because a half-wired `background.js` is not independently runnable — its deliverable is a working, decoupled, cached background.

- [ ] **Step 1: Import the cache module**

In `background.js`, change line 3 from:

```javascript
importScripts("hubspotClient.js");
```

to:

```javascript
importScripts("hubspotClient.js", "matchCache.js");
const MC = self.OrtusMatchCache;
```

- [ ] **Step 2: Parallelize the property check with the scrape**

In `getProfileState` (lines 140-145), replace:

```javascript
  const propCheck = await ensurePropertyCheck();
  if (propCheck.error)  return { state: mapClientErrorState(propCheck) };
  if (!propCheck.exists) return { state: "error_property" };

  const scrape = await scrapeActiveTab();
  if (scrape.error) return { state: mapScrapeErrorState(scrape.error), debug: scrape._debug || null };
```

with:

```javascript
  // Property check (HubSpot) and scrape (LinkedIn tab) are independent — run them
  // together so cold-start doesn't pay them serially.
  const [propCheck, scrape] = await Promise.all([ensurePropertyCheck(), scrapeActiveTab()]);
  if (propCheck.error)  return { state: mapClientErrorState(propCheck) };
  if (!propCheck.exists) return { state: "error_property" };
  if (scrape.error) return { state: mapScrapeErrorState(scrape.error), debug: scrape._debug || null };
```

- [ ] **Step 3: Slug→memberId cache around the fallback resolution**

In `getProfileState`, replace the resolution block (lines 147-166) with:

```javascript
  // Derive the URL-bar slug (used as the slug-cache key and the Voyager key).
  const slugMatch = (scrape.linkedinBio || "").match(/\/in\/([^/?#]+)/);
  const slug = slugMatch ? slugMatch[1] : null;

  if (!scrape.memberId && slug) {
    // Reuse a previously-resolved memberId for this slug (positive hits only),
    // so repeat opens skip Voyager/SalesNav entirely.
    const sKey = MC.slugKey(slug);
    const cachedId = (await chrome.storage.session.get(sKey))[sKey];
    if (cachedId) scrape.memberId = cachedId;
  }

  if (!scrape.memberId) {
    if (slug && scrape._csrf) {
      const v = await resolveMemberIdViaVoyager(slug, scrape._csrf);
      scrape.memberId = v.memberId;
      scrape._debug = { ...(scrape._debug || {}), voyager: v.diag };
    }
    if (!scrape.memberId && scrape.profileUrn) {
      const { memberId, diag } = await resolveMemberIdViaSalesNav(scrape.profileUrn);
      scrape.memberId = memberId;
      scrape._debug = { ...(scrape._debug || {}), salesNav: diag };
    }
  }
  if (!scrape.memberId) {
    return { state: "scrape_failed_id", scrape, debug: scrape._debug || null };
  }
  // Cache the resolved id by slug (positive only).
  if (slug) {
    await chrome.storage.session.set({ [MC.slugKey(slug)]: scrape.memberId });
  }
```

- [ ] **Step 4: Member verdict cache (SWR) + collapse the searches**

In `getProfileState`, replace the search block (lines 168-190) with:

```javascript
  // Fresh cached verdict for this memberId → skip HubSpot entirely. Stale-while-
  // revalidate is delivered by the popup: it paints the last tab result instantly
  // while this (possibly re-run) job refreshes the cache.
  const mKey = MC.memberKey(scrape.memberId);
  const cachedVerdict = (await chrome.storage.session.get(mKey))[mKey];
  if (cachedVerdict && MC.isMemberFresh(cachedVerdict, Date.now())) {
    return MC.payloadFromEntry(cachedVerdict, scrape);
  }

  // One OR-filter search instead of bio-then-email (Task 2).
  const filters = [];
  if (scrape.linkedinBio) filters.push({ propertyName: "linkedinbio", value: scrape.linkedinBio });
  filters.push({ propertyName: "email", value: `${scrape.memberId}@linkedinmembership.id` });
  const search = await client.searchByAny(filters);

  let payload;
  if (search.error === "duplicate") {
    payload = { state: "error_duplicate", scrape };
  } else if (search.error) {
    payload = { state: mapClientErrorState(search), scrape };
  } else if (search.found) {
    payload = {
      state: "found",
      scrape,
      contact: {
        id: search.contactId,
        url: hubspotContactUrl(search.contactId),
        properties: search.properties,
      },
    };
  } else {
    payload = { state: "not_found", scrape };
  }

  // Cache only terminal verdicts; never transient/error states.
  if (MC.isCacheableState(payload.state)) {
    await chrome.storage.session.set({ [mKey]: MC.memberEntry(payload, Date.now()) });
  }
  return payload;
```

- [ ] **Step 5: Add `runProfileJob` (dedupe + tab pointer)**

In `background.js`, immediately before `function mapScrapeErrorState(err)` (line 193), add:

```javascript
// One in-flight job per tab (in-memory dedupe within the SW lifetime). The job
// also writes its state to chrome.storage.session so it survives popup teardown
// AND service-worker death — the popup reads/subscribes to it.
const inFlightJobs = new Map();

async function runProfileJob(tab) {
  if (!tab || tab.id == null) return await getProfileState();
  const key = MC.tabKey(tab.id);
  const existing = inFlightJobs.get(tab.id);
  if (existing) return await existing;

  await chrome.storage.session.set({ [key]: MC.runningEntry(Date.now(), tab.url) });
  const job = (async () => {
    const payload = await getProfileState();
    await chrome.storage.session.set({ [key]: MC.doneEntry(payload, Date.now(), tab.url) });
    return payload;
  })();
  inFlightJobs.set(tab.id, job);
  try {
    return await job;
  } finally {
    inFlightJobs.delete(tab.id);
  }
}

// Refresh the tab pointer + member cache after a write so a reopen reflects it.
async function refreshCachesAfterWrite(payload) {
  try {
    const tab = await getActiveTab();
    if (tab && tab.id != null) {
      await chrome.storage.session.set({ [MC.tabKey(tab.id)]: MC.doneEntry(payload, Date.now(), tab.url) });
    }
    if (payload.scrape && payload.scrape.memberId && MC.isCacheableState(payload.state)) {
      await chrome.storage.session.set({ [MC.memberKey(payload.scrape.memberId)]: MC.memberEntry(payload, Date.now()) });
    }
  } catch (e) { /* best-effort */ }
}
```

- [ ] **Step 6: Invalidate caches on push/update**

`pushToHubSpot` returns `success_pushed`, which is NOT a cacheable verdict, but the underlying contact is now `found`. After a push/update, overwrite the member cache as `found` so a reopen shows it. In the message handler (lines 238-241), replace:

```javascript
      } else if (msg.type === "PUSH_TO_HUBSPOT") {
        sendResponse(await pushToHubSpot(msg.scrape));
      } else if (msg.type === "UPDATE_CONTACT") {
        sendResponse(await updateContact(msg.contactId, msg.scrape));
```

with:

```javascript
      } else if (msg.type === "PUSH_TO_HUBSPOT") {
        const r = await pushToHubSpot(msg.scrape);
        if (r.state === "success_pushed") {
          await refreshCachesAfterWrite({ state: "found", scrape: msg.scrape, contact: r.contact });
        }
        sendResponse(r);
      } else if (msg.type === "UPDATE_CONTACT") {
        const r = await updateContact(msg.contactId, msg.scrape);
        if (r.state === "success_updated") {
          await refreshCachesAfterWrite({ state: "found", scrape: msg.scrape, contact: r.contact });
        }
        sendResponse(r);
```

- [ ] **Step 7: Route GET_PROFILE_STATE through `runProfileJob`; clear caches on RESET_CACHE**

In the message handler, replace the `GET_PROFILE_STATE` branch (lines 236-237):

```javascript
      if (msg.type === "GET_PROFILE_STATE") {
        sendResponse(await getProfileState());
```

with:

```javascript
      if (msg.type === "GET_PROFILE_STATE") {
        sendResponse(await runProfileJob(await getActiveTab()));
```

And replace the `RESET_CACHE` branch (lines 249-251):

```javascript
      } else if (msg.type === "RESET_CACHE") {
        propertyCheckPromise = null;
        sendResponse({ ok: true });
```

with:

```javascript
      } else if (msg.type === "RESET_CACHE") {
        propertyCheckPromise = null;
        memberIdCache.clear();
        inFlightJobs.clear();
        await chrome.storage.session.clear();
        sendResponse({ ok: true });
```

- [ ] **Step 8: Build sanity check**

Run: `npm test`
Expected: PASS (existing suites; `background.js` not imported by tests).
Reload the unpacked extension; confirm the service worker has no console errors and `chrome.storage.session` is writable (open a profile, then in the SW console: `chrome.storage.session.get(null).then(console.log)` shows `match:tab:*` / `match:member:*` keys).

- [ ] **Step 9: Commit**

```bash
git add background.js
git commit -m "feat(bg): run match as a deduped storage.session-backed job with slug+verdict caches"
```

---

## Task 6: Bound + abort the content-script polls

**Files:**
- Modify: `content.js` (`waitFor` lines 81-88; ceilings at lines 100, 109, 147; add abort listeners)

**Interfaces:**
- Produces: `waitFor` returns early when the page is hidden or unloading (click-away/navigation), instead of polling a departed DOM for the full budget.

> Not unit-tested (visibility/lifecycle is environmental). Verified by the Task 8 click-away smoke test.

- [ ] **Step 1: Add abort signal + make `waitFor` honor it**

In `content.js`, replace `waitFor` (lines 81-88) with:

```javascript
// When the user clicks away (tab hidden) or navigates (pagehide), stop polling
// a DOM that no longer corresponds to what the popup asked about. `unloading` is
// one-way; visibility is read live so returning to the tab resumes normal waits.
let unloading = false;
window.addEventListener("pagehide", () => { unloading = true; });
function scrapeShouldAbort() {
  return unloading || document.visibilityState === "hidden";
}

async function waitFor(predicate, { maxMs = 8000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (predicate()) return true;
    if (scrapeShouldAbort()) return predicate();
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return predicate();
}
```

- [ ] **Step 2: Lower the poll ceilings**

- Line 100 (`forceLazyLoad`, legacy branch): change `{ maxMs: 15000, intervalMs: 150 }` → `{ maxMs: 6000, intervalMs: 150 }`.
- Line 109 (`forceLazyLoad`, Aero branch): change `{ maxMs: 15000, intervalMs: 150 }` → `{ maxMs: 6000, intervalMs: 150 }`.
- Line 147 (`waitForSlugInHydration`): change `{ maxMs: 5000, intervalMs: 100 }` → `{ maxMs: 3000, intervalMs: 100 }`.

- [ ] **Step 3: Verify load + happy path**

Run: `npm test` (unaffected; confirm green).
Reload the unpacked extension. Open a normal `/in/` profile, open the popup → it still resolves correctly (name/role/HubSpot state), now within the shorter budget.

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "perf(content): bound scrape polls to 6s/3s and abort on click-away/navigation"
```

---

## Task 7: Popup reads cache + subscribes to updates

**Files:**
- Modify: `popup.html` (load `matchCache.js` before `popup.js`, line 400)
- Modify: `popup.js` (`loadState` lines 322-326; add `entryToPayload`)

**Interfaces:**
- Consumes: `chrome.storage.session`, `chrome.storage.onChanged`, `chrome.tabs.query`; `OrtusMatchCache.tabKey` / `payloadFromEntry` (now loaded in the popup).
- Produces: on open the popup paints the last stored `done` entry for the active tab instantly, then live-updates from `storage.onChanged`, and still kicks the job. Closing the popup no longer aborts the match (the background job + storage write are independent).

> Not unit-tested. Verified by the Task 8 click-away + reopen smoke test.

- [ ] **Step 1: Load the cache module in the popup**

In `popup.html`, change line 400 from:

```html
  <script src="popup.js"></script>
```

to:

```html
  <script src="matchCache.js"></script>
  <script src="popup.js"></script>
```

- [ ] **Step 2: Rewrite `loadState` to be cache-first + subscription-driven**

In `popup.js`, replace `loadState` (lines 322-326) with:

```javascript
function entryToPayload(entry) {
  return {
    state: entry.state,
    scrape: entry.scrape || undefined,
    contact: entry.contact || undefined,
    debug: entry.debug || undefined,
  };
}

let sessionListener = null;

async function loadState() {
  render({ state: "scraping" });

  let tabId = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = tab && tab.id != null ? tab.id : null;
  } catch (e) { /* fall through to message-only path */ }

  if (tabId != null) {
    const key = OrtusMatchCache.tabKey(tabId);
    // 1) Instant paint from the last stored result for this tab (survives teardown).
    try {
      const stored = (await chrome.storage.session.get(key))[key];
      if (stored && stored.status === "done") render(entryToPayload(stored));
    } catch (e) { /* ignore */ }
    // 2) Live updates while the popup is open (covers a job that finishes after
    //    a click-away/reopen, or the stale-while-revalidate refresh).
    sessionListener = (changes, area) => {
      if (area !== "session" || !changes[key]) return;
      const v = changes[key].newValue;
      if (v && v.status === "done") render(entryToPayload(v));
    };
    chrome.storage.onChanged.addListener(sessionListener);
  }

  // 3) Kick the (deduped) job. If the channel closes because the popup is being
  //    torn down, the background still finishes and writes to storage.session.
  try {
    const r = await chrome.runtime.sendMessage({ type: "GET_PROFILE_STATE" });
    if (r) render(r);
  } catch (e) { /* "message port closed" — storage.onChanged delivers the result */ }
}
```

- [ ] **Step 3: Verify reopen-is-instant + click-away**

Run: `npm test` (unaffected; confirm green).
Reload the unpacked extension. Then:
- Open a profile, open the popup, let it resolve, close it, **reopen** → it paints the prior result immediately (no shimmer round-trip).
- Open the popup on a fresh profile and **immediately click back into the page** (close the popup) before it resolves; reopen a moment later → the result is there, no stuck shimmer.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.js
git commit -m "feat(popup): cache-first render via storage.session + live onChanged updates"
```

---

## Task 8: Version bump, README smoke test, full verification

**Files:**
- Modify: `manifest.json` (line 4), `package.json` (line 3), `README.md` (smoke-test section, lines 47-58)

- [ ] **Step 1: Reconcile + bump the version**

- `manifest.json:4`: `"version": "0.1.34"` → `"version": "0.1.35"`.
- `package.json:3`: `"version": "0.1.0"` → `"version": "0.1.35"` (reconcile the long-standing mismatch).

- [ ] **Step 2: Extend the README manual smoke test**

In `README.md`, under `## Manual smoke test` (after line 58), append:

```markdown
- [ ] **Fast open:** popup resolves a normal `/in/` profile noticeably faster than before (no multi-second hang on a settled page).
- [ ] **Reopen is instant:** after a profile resolves once, close and reopen the popup → it paints the prior result immediately.
- [ ] **Click-away survives:** open the popup on a fresh profile, immediately click back into the page (closing it) before it resolves, wait a moment, reopen → the result is shown, no stuck shimmer.
- [ ] **Correct profile after SPA nav:** navigate from profile A to profile B in the same tab, open the popup on each → each shows the correct contact (no A-shown-on-B).
- [ ] **Push invalidates cache:** on a `not_found` profile, Push to HubSpot, then reopen → shows **Already in HubSpot** (found).
- [ ] **Stalled network fails clean:** with HubSpot/LinkedIn throttled or offline, the popup resolves to an error state within ~8s rather than hanging indefinitely.
- [ ] **Reset cache:** Settings → Reset cache, then reopen a previously-cached profile → it re-runs the match fresh.
```

- [ ] **Step 3: Full test suite**

Run: `npm test`
Expected: PASS — all suites: `matchCache` (Task 1), `hubspotClient` incl. `searchByAny` + timeout (Tasks 2-3), `scraper` (unchanged).

- [ ] **Step 4: Full manual smoke test**

Reload the unpacked extension at `chrome://extensions`. Confirm the popup footer shows `v0.1.35`. Work through the entire `## Manual smoke test` checklist in `README.md`, including all items added in Step 2. Pay special attention to the **Voyager/SalesNav fallback** path (open a profile whose numeric ID is NOT in the page DOM) since that path has no unit coverage — confirm it still resolves and that a transient miss no longer poisons subsequent opens.

- [ ] **Step 5: Commit**

```bash
git add manifest.json package.json README.md
git commit -m "chore: bump to v0.1.35, reconcile package version, extend smoke test"
```

---

## Self-Review

**1. Spec coverage:**
- Decouple from popup lifetime → Task 7 (cache-first popup + onChanged) + Task 5 (storage.session tab pointer). ✓
- Match-verdict cache, cacheable-only, SWR 60s → Task 1 (logic) + Task 5 Step 4. ✓
- memberId-by-slug cache (positive only) → Task 1 (`slugKey`) + Task 5 Step 3. ✓
- Never cache transient errors → Task 1 `isCacheableState` + Task 5 Steps 4/6. ✓
- Invalidate on push/update/reset → Task 5 Steps 6-7. ✓
- Parallelize property∥scrape → Task 5 Step 2. ✓
- Bound + abort content waits (6s/3s) → Task 6. ✓
- Fetch timeouts: HubSpot → Task 3; Voyager/SalesNav → Task 4. ✓
- SalesNav null-cache fix → Task 4 Step 3. ✓
- Collapse two searches → Task 2 + Task 5 Step 4. ✓
- matchCache unit-tested; README smoke updated → Task 1 + Task 8. ✓
- Version reconcile → Task 8 Step 1. ✓
- Don't-do guardrails + token caution → Global Constraints. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; manual-verification steps name exact actions and expected output. ✓

**3. Type consistency:** `MC.*` names used in Task 5 (`tabKey, memberKey, slugKey, isCacheableState, runningEntry, doneEntry, memberEntry, isMemberFresh, payloadFromEntry`) all match the exports defined in Task 1. `searchByAny(filters)` signature in Task 5 matches Task 2. `entryToPayload`/`OrtusMatchCache.tabKey` in Task 7 match Task 1's exports + `payloadFromEntry` shape. ✓
