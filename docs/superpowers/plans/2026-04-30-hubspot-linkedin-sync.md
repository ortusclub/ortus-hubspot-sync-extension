# HubSpot LinkedIn Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that, when opened on a LinkedIn profile, looks up the person in Ortus Club's HubSpot via the synthetic `<numericId>@linkedinmembership.id` email and offers a one-click *Push to HubSpot* (if absent) or *Update / Skip* (if present).

**Architecture:** Background-driven. `content.js` scrapes the active LinkedIn tab on demand, `background.js` orchestrates HubSpot calls (token hardcoded), `popup.js` is a pure state-machine renderer. Mirrors the file layout of LinkedIn QuickConnect.

**Tech Stack:** Chrome MV3 service worker, vanilla JS, Jest + JSDOM for unit tests, plain HTML/CSS for popup (Ortus design tokens reused from QuickConnect).

**Spec:** `docs/superpowers/specs/2026-04-30-hubspot-linkedin-sync-design.md`
**Visual reference:** `sketches/states.html`
**Working directory:** `/Users/antoniovarlese/Desktop/Projects/HS Extension/` (all paths below are relative to this).

---

## File Structure

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest — permissions, host perms, content script, background worker |
| `background.js` | Service worker — token constant, message router, HubSpot orchestration |
| `content.js` | Injected on `linkedin.com` — listens for `SCRAPE_PROFILE`, runs scraper, returns result |
| `scraper.js` | Pure DOM-extraction (importable in JSDOM tests + bundled into `content.js`) |
| `hubspotClient.js` | Pure HubSpot API wrapper (importable for tests + bundled into `background.js`) |
| `popup.html` | Popup markup — Ortus design tokens ported from QuickConnect |
| `popup.js` | Popup state-machine renderer; talks to background via `chrome.runtime.sendMessage` |
| `icons/` | Extension icons (16 / 32 / 48 / 128 PNGs reused from QuickConnect for v0.1) |
| `tests/scraper.test.js` | Jest tests for `scraper.js` against fixture HTML |
| `tests/hubspotClient.test.js` | Jest tests for `hubspotClient.js` with mocked `fetch` |
| `tests/fixtures/` | Saved LinkedIn DOM snapshots for scraper regression tests |
| `package.json` | Dev deps (jest, jsdom), test script |
| `jest.config.js` | Jest config — JSDOM environment for scraper tests |
| `.gitignore` | Standard Node ignores |
| `README.md` | Install + smoke test + token rotation procedure |

**Bundling note:** `scraper.js` and `hubspotClient.js` are written as plain scripts (no ES modules) so they can be loaded directly by Chrome via `<script>` / service-worker `importScripts`. For Jest tests we run them through Node by reading the file and `eval`'ing into a sandbox, *or* we author them as CommonJS (`module.exports = …`) wrapped with a `if (typeof module !== "undefined")` guard. We use the **CommonJS-with-guard** pattern (Task 3) so the same file works in both environments.

---

## Task 1: Project skeleton and Jest setup

**Files:**
- Create: `package.json`
- Create: `jest.config.js`
- Create: `.gitignore`
- Create: `tests/.gitkeep`
- Create: `tests/fixtures/.gitkeep`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "ortus-hs-extension",
  "version": "0.1.0",
  "private": true,
  "description": "Ortus Club HubSpot Sync — LinkedIn profile lookup and push.",
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "jest-environment-jsdom": "^29.7.0"
  }
}
```

- [ ] **Step 2: Create `jest.config.js`**

```js
module.exports = {
  testEnvironment: "jsdom",
  testMatch: ["**/tests/**/*.test.js"],
  collectCoverageFrom: ["scraper.js", "hubspotClient.js"],
};
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
coverage/
.DS_Store
*.zip
```

- [ ] **Step 4: Create empty marker files for Jest test discovery**

```bash
mkdir -p tests/fixtures
: > tests/.gitkeep
: > tests/fixtures/.gitkeep
```

- [ ] **Step 5: Install dev dependencies**

Run: `npm install`
Expected: writes `node_modules/` and `package-lock.json`. No errors.

- [ ] **Step 6: Verify Jest runs (no tests yet)**

Run: `npm test`
Expected: `No tests found, exiting with code 1` is fine — Jest is wired correctly. Suppress the failure for this verification only by running: `npm test -- --passWithNoTests`. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json jest.config.js .gitignore tests/.gitkeep tests/fixtures/.gitkeep
git commit -m "Add HS Extension project skeleton and Jest setup"
```

---

## Task 2: MV3 manifest

**Files:**
- Create: `manifest.json`
- Create: `icons/` (copied from QuickConnect)

- [ ] **Step 1: Copy icons from QuickConnect**

```bash
mkdir -p icons
cp ../LinkedIn\ QuickConnect/icons/*.png icons/
ls icons/
```
Expected: 4 PNG files (16, 32, 48, 128).

- [ ] **Step 2: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Ortus Club · HubSpot Sync",
  "version": "0.1.0",
  "description": "Lookup or push the LinkedIn profile you're viewing into Ortus Club's HubSpot.",
  "permissions": ["storage", "scripting"],
  "host_permissions": [
    "*://*.linkedin.com/*",
    "https://api.hubapi.com/*"
  ],
  "background": { "service_worker": "background.js" },
  "icons": {
    "16":  "icons/ortus-club-16.png",
    "32":  "icons/ortus-club-32.png",
    "48":  "icons/ortus-club-48.png",
    "128": "icons/ortus-club-128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16":  "icons/ortus-club-16.png",
      "32":  "icons/ortus-club-32.png",
      "48":  "icons/ortus-club-48.png",
      "128": "icons/ortus-club-128.png"
    }
  },
  "content_scripts": [
    {
      "matches": ["*://*.linkedin.com/*"],
      "js": ["scraper.js", "content.js"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 3: Commit**

```bash
git add manifest.json icons/
git commit -m "Add MV3 manifest and icons"
```

---

## Task 3: `scraper.js` — module skeleton + page detection (TDD)

**Files:**
- Create: `scraper.js`
- Create: `tests/scraper.test.js`

- [ ] **Step 1: Write failing test for page detection**

`tests/scraper.test.js`:
```js
const { detectPageType, scrapeProfile } = require("../scraper.js");

describe("detectPageType", () => {
  test("returns 'profile' for /in/<slug>", () => {
    expect(detectPageType("https://www.linkedin.com/in/antonio-varlese/")).toBe("profile");
  });
  test("returns 'salesnav' for /sales/lead", () => {
    expect(detectPageType("https://www.linkedin.com/sales/lead/ACoAAB123,NAME_SEARCH/")).toBe("salesnav");
  });
  test("returns 'unknown' for feed", () => {
    expect(detectPageType("https://www.linkedin.com/feed/")).toBe("unknown");
  });
  test("returns 'unknown' for non-linkedin", () => {
    expect(detectPageType("https://example.com/")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- tests/scraper.test.js`
Expected: FAIL with `Cannot find module '../scraper.js'`.

- [ ] **Step 3: Create `scraper.js` with minimal CommonJS-with-guard**

```js
// scraper.js — works in Chrome content script (global) and Node tests (CommonJS).

(function (root) {
  const PROFILE_RE  = /^https?:\/\/([a-z]+\.)?linkedin\.com\/in\/[^/]+\/?/i;
  const SALESNAV_RE = /^https?:\/\/([a-z]+\.)?linkedin\.com\/sales\/lead\//i;

  function detectPageType(url) {
    if (PROFILE_RE.test(url))  return "profile";
    if (SALESNAV_RE.test(url)) return "salesnav";
    return "unknown";
  }

  function scrapeProfile(/* doc, url */) {
    // implemented in later tasks
    return { error: "not_implemented" };
  }

  const api = { detectPageType, scrapeProfile };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusScraper = api;
})(typeof window !== "undefined" ? window : globalThis);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/scraper.test.js`
Expected: 4 passing tests for `detectPageType`.

- [ ] **Step 5: Commit**

```bash
git add scraper.js tests/scraper.test.js
git commit -m "Add scraper module skeleton with page-type detection"
```

---

## Task 4: `scraper.js` — regular profile name + member ID (TDD)

**Files:**
- Modify: `scraper.js`
- Modify: `tests/scraper.test.js`
- Create: `tests/fixtures/profile-minimal.html`

- [ ] **Step 1: Create a minimal regular-profile fixture**

`tests/fixtures/profile-minimal.html`:
```html
<!DOCTYPE html>
<html>
<head><title>Antonio Varlese | LinkedIn</title></head>
<body>
  <main>
    <section class="top-card-layout">
      <h1 class="top-card-layout__title">Antonio Varlese</h1>
      <div class="text-body-medium break-words">Founder at Ortus Club</div>
    </section>
  </main>
  <code style="display:none">
    {"data":{"$type":"com.linkedin.voyager.dash.identity.profile.Profile","entityUrn":"urn:li:fsd_profile:ACoAABxxx","objectUrn":"urn:li:member:98750243","memberId":"98750243","firstName":"Antonio","lastName":"Varlese"}}
  </code>
</body>
</html>
```

- [ ] **Step 2: Write failing tests for name + memberId on regular profile**

Append to `tests/scraper.test.js`:
```js
const fs = require("fs");
const path = require("path");

function loadFixture(name) {
  const html = fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
  document.documentElement.innerHTML = html;
  return document;
}

describe("scrapeProfile - regular profile", () => {
  test("extracts firstName and lastName from h1", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.pageType).toBe("profile");
  });

  test("extracts numeric memberId from urn:li:member regex", () => {
    const doc = loadFixture("profile-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.memberId).toBe("98750243");
  });
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npm test -- tests/scraper.test.js`
Expected: 2 failing tests with `result.firstName` undefined etc.

- [ ] **Step 4: Implement `scrapeProfile` for regular profile name + memberId**

Replace the `scrapeProfile` body in `scraper.js`:
```js
function scrapeProfile(doc, url) {
  const pageType = detectPageType(url);
  if (pageType === "unknown") return { error: "not_on_profile" };

  if (pageType === "profile") return scrapeRegular(doc, url);
  if (pageType === "salesnav") return scrapeSalesNav(doc, url);
  return { error: "not_on_profile" };
}

function scrapeRegular(doc, url) {
  const html = doc.documentElement.outerHTML;

  const memberId = extractMemberId(html);
  const { firstName, lastName } = extractName(doc);

  if (!memberId)  return { error: "no_member_id" };
  if (!firstName) return { error: "no_name" };

  return {
    pageType: "profile",
    firstName,
    lastName,
    company: "",
    jobTitle: "",
    memberId,
  };
}

function scrapeSalesNav(/* doc, url */) {
  // implemented in Task 6
  return { error: "not_implemented" };
}

function extractMemberId(html) {
  // Primary: urn:li:member:<digits>
  const m1 = /"objectUrn":"urn:li:member:(\d+)"/.exec(html);
  if (m1) return m1[1];
  // Fallback: bare memberId field
  const m2 = /"memberId"\s*:\s*"?(\d+)"?/.exec(html);
  if (m2) return m2[1];
  return null;
}

function extractName(doc) {
  const h1 = doc.querySelector("h1.top-card-layout__title, h1");
  if (!h1) return { firstName: "", lastName: "" };
  const text = h1.textContent.trim().replace(/\s+/g, " ");
  if (!text) return { firstName: "", lastName: "" };
  const space = text.indexOf(" ");
  if (space === -1) return { firstName: text, lastName: "" };
  return { firstName: text.slice(0, space), lastName: text.slice(space + 1) };
}
```

Re-export the new internals so tests can validate them later (extend the IIFE's `api` object):
```js
const api = { detectPageType, scrapeProfile, extractMemberId, extractName };
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- tests/scraper.test.js`
Expected: 6 passing tests (4 from Task 3 + 2 new).

- [ ] **Step 6: Commit**

```bash
git add scraper.js tests/scraper.test.js tests/fixtures/profile-minimal.html
git commit -m "Add regular profile name and member ID extraction"
```

---

## Task 5: `scraper.js` — regular profile company + job title (TDD)

**Files:**
- Modify: `scraper.js`
- Modify: `tests/scraper.test.js`
- Modify: `tests/fixtures/profile-minimal.html`

- [ ] **Step 1: Update fixture so company + title are present**

The fixture already includes `<div class="text-body-medium break-words">Founder at Ortus Club</div>`. We will parse that single line to derive both fields.

- [ ] **Step 2: Write failing tests**

Append to `tests/scraper.test.js`:
```js
test("extracts jobTitle and company from headline 'X at Y' format", () => {
  const doc = loadFixture("profile-minimal.html");
  const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
  expect(result.jobTitle).toBe("Founder");
  expect(result.company).toBe("Ortus Club");
});

test("returns empty company when headline has no ' at '", () => {
  document.documentElement.innerHTML = `
    <h1>Mariana De Luca</h1>
    <div class="text-body-medium">Independent</div>
    <code>{"objectUrn":"urn:li:member:48201192"}</code>
  `;
  const result = scrapeProfile(document, "https://www.linkedin.com/in/mariana-deluca/");
  expect(result.firstName).toBe("Mariana");
  expect(result.lastName).toBe("De Luca");
  expect(result.jobTitle).toBe("Independent");
  expect(result.company).toBe("");
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npm test -- tests/scraper.test.js`
Expected: 2 new tests fail (`jobTitle` is `""`).

- [ ] **Step 4: Implement company + jobTitle extraction**

Add to `scraper.js`, and call from `scrapeRegular`:
```js
function extractRoleAndCompany(doc) {
  const el = doc.querySelector(".text-body-medium.break-words, .text-body-medium");
  if (!el) return { jobTitle: "", company: "" };
  const text = el.textContent.trim().replace(/\s+/g, " ");
  if (!text) return { jobTitle: "", company: "" };
  // Prefer "Title at Company"; else everything is the title.
  const m = /^(.*?)\s+at\s+(.*)$/i.exec(text);
  if (m) return { jobTitle: m[1].trim(), company: m[2].trim() };
  return { jobTitle: text, company: "" };
}
```

Update `scrapeRegular`:
```js
function scrapeRegular(doc, url) {
  const html = doc.documentElement.outerHTML;
  const memberId = extractMemberId(html);
  const { firstName, lastName } = extractName(doc);
  const { jobTitle, company } = extractRoleAndCompany(doc);

  if (!memberId)  return { error: "no_member_id" };
  if (!firstName) return { error: "no_name" };

  return { pageType: "profile", firstName, lastName, company, jobTitle, memberId };
}
```

Add `extractRoleAndCompany` to the exported `api`.

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- tests/scraper.test.js`
Expected: 8 passing tests.

- [ ] **Step 6: Commit**

```bash
git add scraper.js tests/scraper.test.js
git commit -m "Add regular profile company and job title extraction"
```

---

## Task 6: `scraper.js` — Sales Navigator variant (TDD)

**Files:**
- Modify: `scraper.js`
- Modify: `tests/scraper.test.js`
- Create: `tests/fixtures/salesnav-minimal.html`

- [ ] **Step 1: Create SalesNav fixture**

`tests/fixtures/salesnav-minimal.html`:
```html
<!DOCTYPE html>
<html>
<head><title>Antonio Varlese | Sales Navigator</title></head>
<body>
  <div data-anonymize="person-name">Antonio Varlese</div>
  <div data-anonymize="title">Founder</div>
  <div data-anonymize="company-name">
    <a href="/sales/company/12345">Ortus Club</a>
  </div>
  <code style="display:none">
    {"objectUrn":"urn:li:member:98750243","firstName":"Antonio","lastName":"Varlese","role":"Founder","companyName":"Ortus Club"}
  </code>
</body>
</html>
```

- [ ] **Step 2: Write failing test**

Append to `tests/scraper.test.js`:
```js
describe("scrapeProfile - sales navigator", () => {
  test("extracts all six fields from a salesnav page", () => {
    const doc = loadFixture("salesnav-minimal.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/sales/lead/ACoAAB,NAME_SEARCH/");
    expect(result.pageType).toBe("salesnav");
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.jobTitle).toBe("Founder");
    expect(result.company).toBe("Ortus Club");
    expect(result.memberId).toBe("98750243");
  });
});
```

- [ ] **Step 3: Run tests, verify failure**

Run: `npm test -- tests/scraper.test.js`
Expected: 1 new failing test.

- [ ] **Step 4: Implement `scrapeSalesNav`**

Replace `scrapeSalesNav` in `scraper.js`:
```js
function scrapeSalesNav(doc, url) {
  const html = doc.documentElement.outerHTML;
  const memberId = extractMemberId(html);

  const nameEl    = doc.querySelector('[data-anonymize="person-name"]');
  const titleEl   = doc.querySelector('[data-anonymize="title"]');
  const companyEl = doc.querySelector('[data-anonymize="company-name"]');

  let firstName = "", lastName = "";
  if (nameEl) {
    const text = nameEl.textContent.trim().replace(/\s+/g, " ");
    const space = text.indexOf(" ");
    firstName = space === -1 ? text : text.slice(0, space);
    lastName  = space === -1 ? ""   : text.slice(space + 1);
  } else {
    const m = /"firstName":"([^"]*)","lastName":"([^"]*)"/.exec(html);
    if (m) { firstName = m[1]; lastName = m[2]; }
  }

  let jobTitle = titleEl ? titleEl.textContent.trim() : "";
  if (!jobTitle) {
    const m = /"role":"([^"]*)"/.exec(html);
    if (m) jobTitle = m[1];
  }

  let company = companyEl ? companyEl.textContent.trim().replace(/\s+/g, " ") : "";
  if (!company) {
    const m = /"companyName":"([^"]*)"/.exec(html);
    if (m) company = m[1];
  }

  if (!memberId)  return { error: "no_member_id" };
  if (!firstName) return { error: "no_name" };

  return { pageType: "salesnav", firstName, lastName, company, jobTitle, memberId };
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `npm test -- tests/scraper.test.js`
Expected: 9 passing tests.

- [ ] **Step 6: Commit**

```bash
git add scraper.js tests/scraper.test.js tests/fixtures/salesnav-minimal.html
git commit -m "Add Sales Navigator scraping variant"
```

---

## Task 7: `scraper.js` — hard-fail and soft-fail rules (TDD)

**Files:**
- Modify: `tests/scraper.test.js`
- Create: `tests/fixtures/profile-no-memberid.html`
- Create: `tests/fixtures/profile-no-title.html`

- [ ] **Step 1: Create fixtures**

`tests/fixtures/profile-no-memberid.html`:
```html
<!DOCTYPE html>
<html><body><h1>Antonio Varlese</h1><div class="text-body-medium">Founder at Ortus Club</div></body></html>
```

`tests/fixtures/profile-no-title.html`:
```html
<!DOCTYPE html>
<html><body>
  <h1>Antonio Varlese</h1>
  <code>{"objectUrn":"urn:li:member:98750243"}</code>
</body></html>
```

- [ ] **Step 2: Write hard-fail and soft-fail tests**

Append to `tests/scraper.test.js`:
```js
describe("scrapeProfile - failure modes", () => {
  test("hard-fails with no_member_id when member id absent", () => {
    const doc = loadFixture("profile-no-memberid.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.error).toBe("no_member_id");
  });

  test("soft-fails on missing job title (still returns full record)", () => {
    const doc = loadFixture("profile-no-title.html");
    const result = scrapeProfile(doc, "https://www.linkedin.com/in/antonio-varlese/");
    expect(result.error).toBeUndefined();
    expect(result.firstName).toBe("Antonio");
    expect(result.lastName).toBe("Varlese");
    expect(result.memberId).toBe("98750243");
    expect(result.jobTitle).toBe("");
    expect(result.company).toBe("");
  });

  test("returns not_on_profile for unrelated URLs", () => {
    document.documentElement.innerHTML = "<html><body></body></html>";
    const result = scrapeProfile(document, "https://example.com/");
    expect(result.error).toBe("not_on_profile");
  });
});
```

- [ ] **Step 3: Run tests, verify pass**

Run: `npm test -- tests/scraper.test.js`
Expected: 12 passing tests. (No new code needed — Tasks 4-6 already implemented these paths.)

- [ ] **Step 4: Commit**

```bash
git add tests/scraper.test.js tests/fixtures/profile-no-memberid.html tests/fixtures/profile-no-title.html
git commit -m "Add scraper failure mode tests"
```

---

## Task 8: `hubspotClient.js` — `searchByEmail` (TDD)

**Files:**
- Create: `hubspotClient.js`
- Create: `tests/hubspotClient.test.js`

- [ ] **Step 1: Write failing test**

`tests/hubspotClient.test.js`:
```js
const { createClient } = require("../hubspotClient.js");

function mockFetch(responses) {
  const calls = [];
  global.fetch = jest.fn((url, opts) => {
    calls.push({ url, opts });
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body),
    });
  });
  return calls;
}

describe("searchByEmail", () => {
  test("returns {found:false} when search yields no contacts", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(false);
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/search");
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.Authorization).toBe("Bearer pat-test");
  });

  test("returns {found:true, contactId, properties} when search yields one", async () => {
    const calls = mockFetch([{ status: 200, body: {
      results: [{ id: "1234", properties: { firstname: "Antonio", lastname: "Varlese", company: "Ortus Club" } }]
    }}]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.found).toBe(true);
    expect(result.contactId).toBe("1234");
    expect(result.properties.firstname).toBe("Antonio");
  });

  test("returns {error:'duplicate'} when search yields multiple", async () => {
    mockFetch([{ status: 200, body: {
      results: [{ id: "1" }, { id: "2" }]
    }}]);
    const client = createClient({ token: "pat-test" });
    const result = await client.searchByEmail("98750243@linkedinmembership.id");
    expect(result.error).toBe("duplicate");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: `Cannot find module '../hubspotClient.js'`.

- [ ] **Step 3: Create `hubspotClient.js`**

```js
// hubspotClient.js — works in service worker (global) and Node tests (CommonJS).

(function (root) {
  const HUBSPOT_BASE = "https://api.hubapi.com";

  function createClient({ token }) {
    async function hsFetch(path, opts = {}) {
      const res = await fetch(HUBSPOT_BASE + path, {
        ...opts,
        headers: {
          ...(opts.headers || {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      const body = await res.json().catch(() => null);
      return { status: res.status, ok: res.ok, body };
    }

    async function searchByEmail(email) {
      const r = await hsFetch("/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
          properties: ["firstname", "lastname", "company", "jobtitle", "email", "linkedin_membership_id", "createdate"],
          limit: 2,
        }),
      });
      if (!r.ok) return mapHttpError(r);
      const results = r.body.results || [];
      if (results.length === 0) return { found: false };
      if (results.length > 1)  return { error: "duplicate" };
      return { found: true, contactId: results[0].id, properties: results[0].properties || {} };
    }

    function mapHttpError(r) {
      if (r.status === 401) return { error: "token" };
      if (r.status === 403) return { error: "scope", detail: r.body };
      if (r.status === 429) return { error: "rate_limit" };
      if (r.status >= 500)  return { error: "hubspot_5xx", detail: r.body };
      return { error: "unknown", detail: r.body };
    }

    return { searchByEmail };
  }

  const api = { createClient };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusHubSpot = api;
})(typeof self !== "undefined" ? self : globalThis);
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "Add HubSpot client with searchByEmail"
```

---

## Task 9: `hubspotClient.js` — `createContact` (TDD)

**Files:**
- Modify: `hubspotClient.js`
- Modify: `tests/hubspotClient.test.js`

- [ ] **Step 1: Write failing test**

Append to `tests/hubspotClient.test.js`:
```js
describe("createContact", () => {
  test("POSTs to /crm/v3/objects/contacts with all six properties", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.createContact({
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "Founder",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Antonio");
    expect(body.properties.lastname).toBe("Varlese");
    expect(body.properties.company).toBe("Ortus Club");
    expect(body.properties.jobtitle).toBe("Founder");
    expect(body.properties.email).toBe("98750243@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("98750243");
  });

  test("omits empty optional fields from payload", async () => {
    const calls = mockFetch([{ status: 201, body: { id: "5556" } }]);
    const client = createClient({ token: "pat-test" });
    await client.createContact({
      firstName: "Mariana", lastName: "",
      company: "", jobTitle: "",
      memberId: "48201192",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.firstname).toBe("Mariana");
    expect(body.properties.lastname).toBeUndefined();
    expect(body.properties.company).toBeUndefined();
    expect(body.properties.jobtitle).toBeUndefined();
    expect(body.properties.email).toBe("48201192@linkedinmembership.id");
    expect(body.properties.linkedin_membership_id).toBe("48201192");
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 2 new failing tests.

- [ ] **Step 3: Implement `createContact`**

Add inside `createClient` in `hubspotClient.js`:
```js
function syntheticEmail(memberId) {
  return `${memberId}@linkedinmembership.id`;
}

function buildProperties(input) {
  const props = {
    firstname: input.firstName,
    email: syntheticEmail(input.memberId),
    linkedin_membership_id: input.memberId,
  };
  if (input.lastName)  props.lastname  = input.lastName;
  if (input.company)   props.company   = input.company;
  if (input.jobTitle)  props.jobtitle  = input.jobTitle;
  return props;
}

async function createContact(input) {
  const r = await hsFetch("/crm/v3/objects/contacts", {
    method: "POST",
    body: JSON.stringify({ properties: buildProperties(input) }),
  });
  if (!r.ok) return mapHttpError(r);
  return { contactId: r.body.id };
}
```

Add `createContact` to the returned client object.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "Add HubSpot createContact with synthetic email"
```

---

## Task 10: `hubspotClient.js` — `updateContact` (TDD)

**Files:**
- Modify: `hubspotClient.js`
- Modify: `tests/hubspotClient.test.js`

- [ ] **Step 1: Write failing test**

Append:
```js
describe("updateContact", () => {
  test("PATCHes /crm/v3/objects/contacts/{id} with populated fields", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.updateContact("5555", {
      firstName: "Antonio", lastName: "Varlese",
      company: "Ortus Club", jobTitle: "CEO",
      memberId: "98750243",
    });
    expect(result.contactId).toBe("5555");
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/5555");
    expect(calls[0].opts.method).toBe("PATCH");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.jobtitle).toBe("CEO");
  });

  test("omits empty optional fields so HubSpot does not blank existing data", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "5555" } }]);
    const client = createClient({ token: "pat-test" });
    await client.updateContact("5555", {
      firstName: "Antonio", lastName: "",
      company: "", jobTitle: "",
      memberId: "98750243",
    });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties.lastname).toBeUndefined();
    expect(body.properties.company).toBeUndefined();
    expect(body.properties.jobtitle).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 2 new failing tests.

- [ ] **Step 3: Implement `updateContact`**

Add inside `createClient` in `hubspotClient.js`:
```js
async function updateContact(contactId, input) {
  const r = await hsFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    body: JSON.stringify({ properties: buildProperties(input) }),
  });
  if (!r.ok) return mapHttpError(r);
  return { contactId: r.body.id };
}
```

Add `updateContact` to the returned client object.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 7 passing tests.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "Add HubSpot updateContact"
```

---

## Task 11: `hubspotClient.js` — `checkProperty` (TDD)

**Files:**
- Modify: `hubspotClient.js`
- Modify: `tests/hubspotClient.test.js`

- [ ] **Step 1: Write failing test**

Append:
```js
describe("checkProperty", () => {
  test("returns {exists:true} when GET returns 200", async () => {
    mockFetch([{ status: 200, body: { name: "linkedin_membership_id" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.checkProperty("linkedin_membership_id");
    expect(result.exists).toBe(true);
  });

  test("returns {exists:false} when GET returns 404", async () => {
    mockFetch([{ status: 404, body: { message: "Property not found" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.checkProperty("linkedin_membership_id");
    expect(result.exists).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify failure**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 2 new failing tests.

- [ ] **Step 3: Implement `checkProperty`**

Add inside `createClient` in `hubspotClient.js`:
```js
async function checkProperty(internalName) {
  const r = await hsFetch(`/crm/v3/properties/contacts/${encodeURIComponent(internalName)}`);
  if (r.status === 404) return { exists: false };
  if (!r.ok) return mapHttpError(r);
  return { exists: true };
}
```

Add `checkProperty` to the returned client object.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "Add HubSpot checkProperty for custom property health check"
```

---

## Task 12: `hubspotClient.js` — error mapping coverage (TDD)

**Files:**
- Modify: `tests/hubspotClient.test.js`

- [ ] **Step 1: Write tests for each HTTP error class**

Append:
```js
describe("error mapping", () => {
  test("401 returns {error:'token'}", async () => {
    mockFetch([{ status: 401, body: { message: "bad token" } }]);
    const client = createClient({ token: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("token");
  });
  test("403 returns {error:'scope', detail}", async () => {
    mockFetch([{ status: 403, body: { message: "missing scope" } }]);
    const client = createClient({ token: "pat-bad" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("scope");
    expect(r.detail.message).toBe("missing scope");
  });
  test("429 returns {error:'rate_limit'}", async () => {
    mockFetch([{ status: 429, body: {} }]);
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("rate_limit");
  });
  test("500 returns {error:'hubspot_5xx'}", async () => {
    mockFetch([{ status: 500, body: { message: "server" } }]);
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("hubspot_5xx");
  });
  test("network failure returns {error:'network'}", async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const client = createClient({ token: "pat" });
    const r = await client.searchByEmail("x@y.id");
    expect(r.error).toBe("network");
  });
});
```

- [ ] **Step 2: Run tests, verify failure on the network test only**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: HTTP-status tests pass (already covered by `mapHttpError`); network test fails because the current `hsFetch` lets the rejection bubble up.

- [ ] **Step 3: Wrap `hsFetch` in try/catch**

Replace `hsFetch` in `hubspotClient.js`:
```js
async function hsFetch(path, opts = {}) {
  let res;
  try {
    res = await fetch(HUBSPOT_BASE + path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return { status: 0, ok: false, body: null, networkError: true };
  }
  const body = await res.json().catch(() => null);
  return { status: res.status, ok: res.ok, body };
}
```

Update `mapHttpError` to handle `networkError`:
```js
function mapHttpError(r) {
  if (r.networkError)  return { error: "network" };
  if (r.status === 401) return { error: "token" };
  if (r.status === 403) return { error: "scope", detail: r.body };
  if (r.status === 429) return { error: "rate_limit" };
  if (r.status >= 500)  return { error: "hubspot_5xx", detail: r.body };
  return { error: "unknown", detail: r.body };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/hubspotClient.test.js`
Expected: 14 passing tests.

- [ ] **Step 5: Commit**

```bash
git add hubspotClient.js tests/hubspotClient.test.js
git commit -m "Add error mapping for 401, 403, 429, 5xx, and network failures"
```

---

## Task 13: `content.js` — message listener

**Files:**
- Create: `content.js`

- [ ] **Step 1: Implement content script**

`content.js`:
```js
// content.js — runs on every linkedin.com page; replies to SCRAPE_PROFILE messages.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "SCRAPE_PROFILE") {
    try {
      const result = window.OrtusScraper.scrapeProfile(document, location.href);
      sendResponse({ ok: true, result });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
    return true; // async-safe even though sendResponse is sync here
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add content.js
git commit -m "Add content script that scrapes profile on demand"
```

---

## Task 14: `background.js` — service worker, token, message router

**Files:**
- Create: `background.js`

- [ ] **Step 1: Implement service worker**

`background.js`:
```js
// background.js — service worker. Hardcoded HubSpot token. Orchestrates lookups.

importScripts("hubspotClient.js");

// === HARDCODED CREDENTIALS ===
// Rotate by editing these two values, bumping manifest.json version, rebuilding,
// and redistributing the .zip. Never share unmodified tokens externally.
const HUBSPOT_TOKEN = "[REDACTED_HUBSPOT_TOKEN]";
const HUBSPOT_PORTAL_ID = "PASTE-PORTAL-ID-HERE";
// ==============================

const client = self.OrtusHubSpot.createClient({ token: HUBSPOT_TOKEN });

let propertyCheckPromise = null; // memoised for service worker lifetime
function ensurePropertyCheck() {
  if (!propertyCheckPromise) {
    propertyCheckPromise = client.checkProperty("linkedin_membership_id");
  }
  return propertyCheckPromise;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function scrapeActiveTab() {
  const tab = await getActiveTab();
  if (!tab || !tab.url || !/linkedin\.com/.test(tab.url)) {
    return { error: "not_on_profile" };
  }
  try {
    const reply = await chrome.tabs.sendMessage(tab.id, { type: "SCRAPE_PROFILE" });
    if (!reply || !reply.ok) return { error: "scrape_failed" };
    return reply.result;
  } catch (e) {
    return { error: "not_on_profile" }; // content script not injected
  }
}

function hubspotContactUrl(contactId) {
  return `https://app.hubspot.com/contacts/${HUBSPOT_PORTAL_ID}/contact/${contactId}`;
}

async function getProfileState() {
  const propCheck = await ensurePropertyCheck();
  if (propCheck.error)  return { state: mapClientErrorState(propCheck) };
  if (!propCheck.exists) return { state: "error_property" };

  const scrape = await scrapeActiveTab();
  if (scrape.error) return { state: mapScrapeErrorState(scrape.error) };

  const search = await client.searchByEmail(`${scrape.memberId}@linkedinmembership.id`);
  if (search.error === "duplicate") {
    return { state: "error_duplicate", scrape };
  }
  if (search.error) {
    return { state: mapClientErrorState(search), scrape };
  }
  if (search.found) {
    return {
      state: "found",
      scrape,
      contact: {
        id: search.contactId,
        url: hubspotContactUrl(search.contactId),
        properties: search.properties,
      },
    };
  }
  return { state: "not_found", scrape };
}

function mapScrapeErrorState(err) {
  if (err === "not_on_profile") return "not_on_profile";
  if (err === "no_member_id")    return "scrape_failed_id";
  if (err === "no_name")         return "scrape_failed_name";
  return "scrape_failed";
}

function mapClientErrorState(r) {
  if (r.error === "token")       return "error_token";
  if (r.error === "scope")       return "error_scope";
  if (r.error === "rate_limit")  return "error_rate_limit";
  if (r.error === "hubspot_5xx") return "error_hubspot";
  if (r.error === "network")     return "error_network";
  return "error_hubspot";
}

async function pushToHubSpot(scrape) {
  const r = await client.createContact(scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  return {
    state: "success_pushed",
    contact: { id: r.contactId, url: hubspotContactUrl(r.contactId) },
    scrape,
  };
}

async function updateContact(contactId, scrape) {
  const r = await client.updateContact(contactId, scrape);
  if (r.error) return { state: mapClientErrorState(r) };
  return {
    state: "success_updated",
    contact: { id: r.contactId, url: hubspotContactUrl(r.contactId) },
    scrape,
  };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === "GET_PROFILE_STATE") {
        sendResponse(await getProfileState());
      } else if (msg.type === "PUSH_TO_HUBSPOT") {
        sendResponse(await pushToHubSpot(msg.scrape));
      } else if (msg.type === "UPDATE_CONTACT") {
        sendResponse(await updateContact(msg.contactId, msg.scrape));
      } else if (msg.type === "TEST_CONNECTION") {
        const propCheck = await client.checkProperty("linkedin_membership_id");
        sendResponse({ propertyExists: !!propCheck.exists, error: propCheck.error || null });
      } else if (msg.type === "RESET_CACHE") {
        propertyCheckPromise = null;
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: "unknown_message" });
      }
    } catch (e) {
      sendResponse({ state: "error_hubspot", detail: e.message });
    }
  })();
  return true; // keep message channel open for async response
});
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "Add background service worker with hardcoded token and message router"
```

---

## Task 15: `popup.html` — Ortus shell

**Files:**
- Create: `popup.html`

- [ ] **Step 1: Author popup markup**

The CSS is the same token system as `sketches/states.html`. Copy the `:root` token block, the `.popup-shell`, `.popup`, `.masthead`, `.dossier`, `.actions`, `.cta`, `.ghost`, `.shimmer-*`, `.warning-chip`, `.tabs`, `.tab-body`, `.check-row`, `.footer`, and `.err-line` rules verbatim from `sketches/states.html`.

`popup.html`:
```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ortus · HubSpot Sync</title>
<style>
  /* === BEGIN — paste tokens & component rules from sketches/states.html === */
  /* :root { --ink, --paper, --gold, ... }
     body { width:390px; ... }
     .popup, .masthead, .dossier, .actions, .cta, .ghost,
     .shimmer-headline, .shimmer-line, .warning-chip, .tabs, .tab,
     .tab-body, .check-row, .footer, .err-line, .since-line, .meta-line
     === END === */
</style>
</head>
<body>
  <main class="popup-shell"><div class="popup">

    <header class="masthead">
      <div class="brand">
        <span class="ortus-mark" aria-hidden="true">O</span>
        <div>
          <div class="brand-name">Ortus · HubSpot Sync</div>
          <div class="brand-sub">
            <span id="liveBadge" class="live-badge" data-state="standby" role="status" aria-live="polite">
              <span class="dot"></span><span id="liveBadgeText">Standby</span>
            </span>
          </div>
        </div>
      </div>
    </header>

    <section id="dossier" class="dossier standby">
      <div class="eyebrow muted" id="eyebrow">Open a profile</div>
      <h1 class="dossier-name" id="headline">Open a LinkedIn profile to begin.</h1>
      <p class="dossier-role" id="role" hidden></p>
      <div class="meta-line" id="metaLine" hidden></div>
      <div class="since-line" id="sinceLine" hidden></div>
      <span class="warning-chip" id="warningChip" hidden><span class="dot"></span><span id="warningText"></span></span>
      <div class="err-line" id="errLine" hidden></div>
      <div class="actions" id="actions" hidden></div>
    </section>

    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" id="tab-profile" aria-selected="true">Profile</button>
      <button class="tab" role="tab" id="tab-settings" aria-selected="false">Settings</button>
    </nav>

    <section class="tab-body" id="panel-settings" hidden>
      <span class="eyebrow">Connection</span>
      <h3>HubSpot connection</h3>
      <p class="desc">Token is bundled in this build. No setup needed per operator.</p>
      <div class="check-row">
        <div class="check-label"><span class="check-icon" id="tokenIcon">…</span><span>API token valid</span></div>
        <span class="check-status" id="tokenStatus">Checking</span>
      </div>
      <div class="check-row">
        <div class="check-label"><span class="check-icon" id="propIcon">…</span><span>Custom property <code>linkedin_membership_id</code></span></div>
        <span class="check-status" id="propStatus">Checking</span>
      </div>
      <div class="button-row">
        <button id="testConnectionBtn" class="btn btn-primary" type="button">Test connection</button>
        <button id="resetCacheBtn" class="btn btn-ghost" type="button">Reset cache</button>
      </div>
    </section>

    <footer class="footer">
      <span>Ortus Club · 2026</span>
      <span>v0.1</span>
    </footer>

  </div></main>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Paste the CSS body**

Open `sketches/states.html`, copy everything between `<style>` and `</style>` *except* the dark-page-only rules (`body { background:#2C2A24; ... }`, `.grid`, `.frame`, `.frame-label`, `.section-divider`, `h1.title`, `p.subtitle`). Paste into the `<style>` block in `popup.html`. Keep `body` from QuickConnect's pattern: `body { width:390px; padding:8px; background: linear-gradient(180deg,#ECE5D2 0%,#DCD3BC 100%); ... }`.

- [ ] **Step 3: Commit**

```bash
git add popup.html
git commit -m "Add popup HTML shell with Ortus design tokens"
```

---

## Task 16: `popup.js` — state machine renderer

**Files:**
- Create: `popup.js`

- [ ] **Step 1: Implement popup logic**

`popup.js`:
```js
// popup.js — pure renderer. Sends GET_PROFILE_STATE on open; renders whatever comes back.

const $ = (id) => document.getElementById(id);

const els = {
  dossier:   $("dossier"),
  eyebrow:   $("eyebrow"),
  headline:  $("headline"),
  role:      $("role"),
  metaLine:  $("metaLine"),
  sinceLine: $("sinceLine"),
  warning:   $("warningChip"),
  warningTx: $("warningText"),
  errLine:   $("errLine"),
  actions:   $("actions"),
  liveBadge: $("liveBadge"),
  liveText:  $("liveBadgeText"),
  tabProfile: $("tab-profile"),
  tabSettings: $("tab-settings"),
  panelSettings: $("panel-settings"),
  testBtn:   $("testConnectionBtn"),
  resetBtn:  $("resetCacheBtn"),
  tokenIcon: $("tokenIcon"),
  tokenStatus: $("tokenStatus"),
  propIcon:  $("propIcon"),
  propStatus: $("propStatus"),
};

let lastScrape = null;
let lastContactId = null;

function setBadge(state, text) {
  els.liveBadge.dataset.state = state;
  els.liveText.textContent = text;
}

function clearBody() {
  els.dossier.classList.remove("standby");
  els.eyebrow.className = "eyebrow";
  [els.role, els.metaLine, els.sinceLine, els.warning, els.errLine, els.actions]
    .forEach(el => { el.hidden = true; el.innerHTML = ""; });
  els.actions.innerHTML = "";
}

function setEyebrow(text, kind = "") {
  els.eyebrow.className = "eyebrow " + kind;
  els.eyebrow.textContent = text;
}

function dossierName(first, last) {
  els.headline.innerHTML = last
    ? `${escape(first)} <em>${escape(last)}</em>`
    : escape(first);
}

function escape(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function renderRole(jobTitle, company) {
  if (!jobTitle && !company) { els.role.hidden = true; return; }
  els.role.hidden = false;
  els.role.innerHTML = jobTitle && company
    ? `${escape(jobTitle)}<span class="sep">·</span>${escape(company)}`
    : escape(jobTitle || company);
}

function renderMeta(memberId) {
  els.metaLine.hidden = false;
  els.metaLine.innerHTML = `<b>id</b>&nbsp;&nbsp;${escape(memberId)}@linkedinmembership.id`;
}

function renderWarnings(scrape) {
  const missing = [];
  if (!scrape.jobTitle) missing.push("job title");
  if (!scrape.company)  missing.push("company");
  if (!scrape.lastName) missing.push("last name");
  if (missing.length === 0) return;
  els.warning.hidden = false;
  els.warningTx.textContent = `Pushing without ${missing.join(", ")}`;
}

function ctaPrimary(label, onClick) {
  const b = document.createElement("button");
  b.className = "cta";
  b.innerHTML = `<span>${escape(label)}</span>
    <span class="icon-pod">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>
    </span>`;
  b.addEventListener("click", onClick);
  return b;
}

function ctaGhost(label, onClick) {
  const b = document.createElement("button");
  b.className = "ghost";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function setError(eyebrow, headline, detail) {
  clearBody();
  setEyebrow(eyebrow, "error");
  els.headline.textContent = headline;
  els.dossier.classList.add("standby");
  if (detail) {
    els.errLine.hidden = false;
    els.errLine.textContent = detail;
  }
}

function render(payload) {
  clearBody();
  const s = payload.state;
  switch (s) {
    case "not_on_profile":
      setBadge("standby", "Standby");
      setEyebrow("Open a profile", "muted");
      els.headline.textContent = "Open a LinkedIn profile to begin.";
      els.dossier.classList.add("standby");
      return;

    case "scraping":
    case "checking":
      setBadge("default", "Checking");
      setEyebrow("Reading profile");
      els.headline.innerHTML = `<span class="shimmer-headline" style="display:inline-block;width:70%;height:26px;"></span>`;
      return;

    case "not_found": {
      setBadge("default", "Connected");
      setEyebrow("Not in HubSpot");
      lastScrape = payload.scrape;
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      renderMeta(payload.scrape.memberId);
      renderWarnings(payload.scrape);
      els.actions.hidden = false;
      els.actions.appendChild(ctaPrimary("Push to HubSpot", onPushClick));
      return;
    }

    case "found": {
      setBadge("default", "Connected");
      setEyebrow("Already in HubSpot", "ok");
      lastScrape = payload.scrape;
      lastContactId = payload.contact.id;
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      const since = payload.contact.properties.createdate
        ? new Date(payload.contact.properties.createdate).toLocaleString("en-US", { month: "short", year: "numeric" })
        : null;
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = since
        ? `Added <a href="${escape(payload.contact.url)}" target="_blank">in HubSpot since ${since}</a>`
        : `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      els.actions.hidden = false;
      els.actions.appendChild(ctaPrimary("Update", onUpdateClick));
      els.actions.appendChild(ctaGhost("Skip", () => window.close()));
      return;
    }

    case "success_pushed":
      setBadge("default", "Connected");
      setEyebrow("Pushed", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> added to HubSpot.`;
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      return;

    case "success_updated":
      setBadge("default", "Connected");
      setEyebrow("Updated", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> updated.`;
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      return;

    case "scrape_failed_id":
      setBadge("default", "Connected");
      return setError("Couldn't read the profile",
        "Couldn't read the LinkedIn ID for this profile.",
        "LinkedIn may have updated the page structure. Reload the profile and try again.");

    case "scrape_failed_name":
    case "scrape_failed":
      setBadge("default", "Connected");
      return setError("Couldn't read the profile",
        "Couldn't read the name for this profile.",
        "Reload the profile and try again.");

    case "error_token":
      setBadge("error", "Auth error");
      return setError("HubSpot rejected the token",
        "Token may have been rotated.",
        "401 · Antonio needs to ship an updated build with a fresh token.");

    case "error_scope":
      setBadge("error", "Scope error");
      return setError("HubSpot scope missing",
        "Token is missing required scopes.",
        "Required: contacts.read, contacts.write, schemas.contacts.read.");

    case "error_property":
      setBadge("error", "Setup");
      return setError("Custom property missing",
        "HubSpot is missing the linkedin_membership_id property.",
        "SalesNav scraper should have created it. Ask Antonio.");

    case "error_network":
      setBadge("error", "Offline");
      return setError("Network error",
        "Couldn't reach HubSpot.",
        "Check your connection and click Retry.");

    case "error_rate_limit":
      setBadge("error", "Throttled");
      return setError("HubSpot is throttling",
        "Wait a moment and try again.",
        "429 · Try in 10 seconds.");

    case "error_hubspot":
      setBadge("error", "HubSpot error");
      return setError("HubSpot is having a moment",
        "Please try again.",
        "500 · Click Retry to try again.");

    case "error_duplicate":
      setBadge("error", "Duplicate");
      return setError("Duplicate contacts in HubSpot",
        "Multiple contacts share this LinkedIn ID.",
        "Open HubSpot to dedupe before pushing again.");

    default:
      setBadge("error", "Unknown");
      return setError("Unexpected state", `state: ${s}`, "");
  }
}

async function loadState() {
  render({ state: "scraping" });
  const r = await chrome.runtime.sendMessage({ type: "GET_PROFILE_STATE" });
  render(r);
}

async function onPushClick() {
  if (!lastScrape) return;
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({ type: "PUSH_TO_HUBSPOT", scrape: lastScrape });
  render(r);
}

async function onUpdateClick() {
  if (!lastScrape || !lastContactId) return;
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({
    type: "UPDATE_CONTACT", contactId: lastContactId, scrape: lastScrape
  });
  render(r);
}

// ── Tabs ──
function showTab(name) {
  const isProfile = name === "profile";
  els.tabProfile.setAttribute("aria-selected", String(isProfile));
  els.tabSettings.setAttribute("aria-selected", String(!isProfile));
  els.dossier.hidden = !isProfile;
  els.panelSettings.hidden = isProfile;
  if (!isProfile) refreshSettings();
}
els.tabProfile.addEventListener("click", () => showTab("profile"));
els.tabSettings.addEventListener("click", () => showTab("settings"));

// ── Settings panel ──
async function refreshSettings() {
  els.tokenStatus.textContent = "Checking";
  els.propStatus.textContent = "Checking";
  els.tokenIcon.className = "check-icon";
  els.propIcon.className = "check-icon";
  els.tokenIcon.textContent = "…";
  els.propIcon.textContent = "…";

  const r = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
  const tokenOk = !r.error || r.error === null;
  els.tokenIcon.className = "check-icon " + (tokenOk ? "ok" : "err");
  els.tokenIcon.textContent = tokenOk ? "✓" : "!";
  els.tokenStatus.className = "check-status " + (tokenOk ? "ok" : "err");
  els.tokenStatus.textContent = tokenOk ? "Connected" : "Token rejected";

  els.propIcon.className = "check-icon " + (r.propertyExists ? "ok" : "err");
  els.propIcon.textContent = r.propertyExists ? "✓" : "!";
  els.propStatus.className = "check-status " + (r.propertyExists ? "ok" : "err");
  els.propStatus.textContent = r.propertyExists ? "Found" : "Missing";
}

els.testBtn.addEventListener("click", refreshSettings);
els.resetBtn.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "RESET_CACHE" });
  refreshSettings();
});

document.addEventListener("DOMContentLoaded", loadState);
```

- [ ] **Step 2: Commit**

```bash
git add popup.js
git commit -m "Add popup state-machine renderer and message wiring"
```

---

## Task 17: README + manual smoke checklist

**Files:**
- Create: `README.md`

- [ ] **Step 1: Author README**

`README.md`:
````markdown
# Ortus Club · HubSpot Sync (Chrome Extension)

Lookup or push the LinkedIn profile you're viewing into Ortus Club's HubSpot.

## How it works

1. Open a LinkedIn profile (regular `linkedin.com/in/<slug>` or Sales Navigator).
2. Click the extension's toolbar icon.
3. The popup scrapes name, company, job title, and the numeric LinkedIn member ID, then searches HubSpot for `<memberId>@linkedinmembership.id`.
4. If absent → **Push to HubSpot**. If present → **Update / Skip**.

## Install (developer mode)

1. `chrome://extensions` → enable **Developer mode** (top right).
2. Click **Load unpacked** → select this folder.
3. Pin the extension to the toolbar.

## Ship a new build

```bash
zip -r "HS-Sync-v0.1.0.zip" \
  manifest.json background.js content.js scraper.js hubspotClient.js \
  popup.html popup.js icons/
```

Distribute the zip only to trusted operators. The HubSpot token is hardcoded inside `background.js`.

## Token rotation

The HubSpot Private App token lives at the top of `background.js`:

```js
const HUBSPOT_TOKEN = "[REDACTED_HUBSPOT_TOKEN]";
const HUBSPOT_PORTAL_ID = "...";
```

To rotate:

1. In HubSpot, rotate the Private App token. Confirm scopes: `crm.objects.contacts.read`, `crm.objects.contacts.write`, `crm.schemas.contacts.read`.
2. Paste the new token into `background.js`.
3. Bump `version` in `manifest.json`.
4. Rebuild the zip with the command above.
5. Re-distribute to operators (each operator reloads via `chrome://extensions`).

## Manual smoke test

After installing:

- [ ] **Settings tab** shows ✓ for "API token valid" and "Custom property `linkedin_membership_id`".
- [ ] On a non-LinkedIn tab, popup says *"Open a LinkedIn profile to begin."*
- [ ] On a regular `linkedin.com/in/<slug>` profile that is **not** in HubSpot, popup shows the dossier and a **Push to HubSpot** CTA.
- [ ] Click *Push to HubSpot* → popup transitions to *Pushed ✓* with a *View in HubSpot* link. Clicking the link opens the contact, with `firstname`, `lastname`, `company`, `jobtitle`, `email`, and `linkedin_membership_id` set.
- [ ] Reopen the popup on the same profile → it shows *Already in HubSpot* with **Update** and **Skip**.
- [ ] Click *Update* → *Updated ✓*. The contact in HubSpot reflects the latest scraped values.
- [ ] Repeat on a Sales Navigator profile (`linkedin.com/sales/lead/...`) — same outcomes.
- [ ] On a profile where job title is unparseable, popup shows the *Pushing without job title* warning chip and the push still succeeds.

## Tests

Unit tests cover the scraper (against fixture HTML) and the HubSpot client (with mocked `fetch`). They do not hit real HubSpot.

```bash
npm install
npm test
```

## Architecture

See `docs/superpowers/specs/2026-04-30-hubspot-linkedin-sync-design.md`.
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with install, token rotation, and smoke checklist"
```

---

## Task 18: Final verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All scraper + hubspotClient tests pass (≥ 23 tests across both files).

- [ ] **Step 2: Verify no token committed**

Run: `grep -n "PASTE-TOKEN-HERE\|PASTE-PORTAL-ID-HERE" background.js`
Expected: 2 lines printed — confirms placeholders are still in place. The real token must be pasted only at distribution time and never committed to git.

- [ ] **Step 3: Confirm full file inventory exists**

Run: `ls -1 manifest.json background.js content.js scraper.js hubspotClient.js popup.html popup.js README.md && ls -1 icons/ tests/`
Expected: every file listed, no errors.

- [ ] **Step 4: Manual smoke test**

Follow the checklist in `README.md`. Tick every box. If any step fails, file a follow-up task — do not patch over the failure.

- [ ] **Step 5: Final commit (if any cleanup)**

```bash
git status
# only commit anything you intentionally changed during smoke testing
```

---

## Self-review notes (for the implementer)

1. **Spec coverage** — every section of the spec maps to one or more tasks:
   - Architecture & files (§ 3) → Tasks 1, 2, 13–16
   - HubSpot integration (§ 4) → Tasks 8–12, 14
   - LinkedIn scraping (§ 5) → Tasks 3–7
   - Popup UI (§ 6) → Tasks 15–16, sketches reference
   - Error handling (§ 7) → Tasks 12, 14, 16
   - Testing strategy (§ 8) → Tasks 3–12, 17 (smoke), 18

2. **Open items** from spec § 11:
   - "in HubSpot since" date — Task 16 reads `properties.createdate`. If the SalesNav scraper sets a different field as the meaningful "since" timestamp, swap in `popup.js:render('found')`.
   - View in HubSpot URL format — Task 14 uses `app.hubspot.com/contacts/<portalId>/contact/<id>`. The portal ID is the second hardcoded constant.

3. **Loom verification** (spec § 5.6) — after watching the Loom, re-run `npm test` and update `tests/fixtures/profile-minimal.html` if a different scraping technique is shown. Tests should still pass.
