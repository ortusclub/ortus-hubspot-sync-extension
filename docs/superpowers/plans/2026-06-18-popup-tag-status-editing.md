# In-Popup Tag & Lead-Status Editing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an operator read and edit a HubSpot contact's lead status (`hs_lead_status`) and tag (`current_tag`) from the extension popup, writing to the shared HubSpot contact.

**Architecture:** A new, isolated write path — message `UPDATE_FIELDS` → client `updateProperties(contactId, props)` PATCHing only changed fields — plus extending the existing `SEARCH_PROPERTIES` so the `found` payload already carries the current values. A "Manage" block in the popup renders in the `found`, `success_pushed`, and `success_updated` states. The scrape path (`content.js`, `scraper.js`, `getProfileState`) is never touched.

**Tech Stack:** Chrome MV3 extension (vanilla JS), Jest 29.7.0 + jsdom for tests.

## Global Constraints

- **DO NOT modify `content.js`, `scraper.js`, or the `getProfileState()` ordering in `background.js`** (the sequential `await ensurePropertyCheck()` → `await scrapeActiveTab()` and the `forceLazyLoad` 15000ms budgets are load-bearing).
- **`npm test` must stay fully green**, especially `tests/content-readiness.test.js` — it is the regression guardrail for the scrape-timing path.
- **DO NOT run `git add`/`git commit` in this repo.** It sits under the shared `~/Desktop` git root and `background.js` holds a live HubSpot token. End each task at the verification step; the user commits manually if/when they choose.
- **Version bump:** edit `manifest.json` `"version": "0.1.34"` → `"0.1.35"`. (`package.json` version is unmanaged at `0.1.0`; do not touch it.)
- **Exact identifiers only**, verbatim, no invented values:
  - Lead status property: `hs_lead_status` (enumeration). The 18 values, in this order: `Accepted`, `Waiting List`, `Provisional`, `In Communication (Active)`, `Dropped`, `Uninvited`, `Unqualified`, `Declined`, `Unsubscribed`, `In Communication (Passive)`, `In Communication (Passive Platinum)`, `In Communication (Passive Gold)`, `In Communication (Passive Silver Plus)`, `In Communication (Passive Silver)`, `In Communication (Passive Platinum Plus)`, `New`, `Push`, `Traction`.
  - Tag property: `current_tag` (free-text string).
- Test commands: full suite `npm test`; single file `npx jest tests/hubspotClient.test.js`.

## File Structure

- `hubspotClient.js` — add the two read properties to `SEARCH_PROPERTIES`; add the `updateProperties` write method. (Task 1)
- `tests/hubspotClient.test.js` — new `updateProperties` + `SEARCH_PROPERTIES` coverage tests. (Task 1)
- `background.js` — new `UPDATE_FIELDS` message branch + `updateFields()` helper. `getProfileState` untouched. (Task 2)
- `popup.html` — Manage-block markup + its CSS. (Task 3)
- `popup.js` — `renderManage`, dirty tracking, diff-based `onSaveFields`, wired into three states; `clearBody` hides the block. (Task 3)
- `manifest.json` — version bump. (Task 4)

---

### Task 1: hubspotClient — read properties + isolated `updateProperties`

**Files:**
- Modify: `hubspotClient.js` (`SEARCH_PROPERTIES` at line 25; new method before the `return {...}` at line 104)
- Test: `tests/hubspotClient.test.js`

**Interfaces:**
- Produces: `client.updateProperties(contactId: string, props: object) => Promise<{contactId: string} | {error: string, detail?: any}>`. `props` contains only the fields to write, e.g. `{ hs_lead_status: "Provisional" }` or `{ hs_lead_status: "...", current_tag: "warm-intro" }`.
- Produces: `SEARCH_PROPERTIES` now includes `"hs_lead_status"` and `"current_tag"`, so `searchByEmail`/`searchByLinkedInBio` results carry them in `.properties`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/hubspotClient.test.js` (uses the existing `mockFetch` helper at the top of the file):

```js
describe("updateProperties", () => {
  test("PATCHes /crm/v3/objects/contacts/{id} with exactly the given properties", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "7777" } }]);
    const client = createClient({ token: "pat-test" });
    const result = await client.updateProperties("7777", {
      hs_lead_status: "Provisional",
      current_tag: "warm-intro",
    });
    expect(result.contactId).toBe("7777");
    expect(calls[0].url).toBe("https://api.hubapi.com/crm/v3/objects/contacts/7777");
    expect(calls[0].opts.method).toBe("PATCH");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual({ hs_lead_status: "Provisional", current_tag: "warm-intro" });
  });

  test("sends only the fields it is given (single-field update)", async () => {
    const calls = mockFetch([{ status: 200, body: { id: "7777" } }]);
    const client = createClient({ token: "pat-test" });
    await client.updateProperties("7777", { hs_lead_status: "Accepted" });
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual({ hs_lead_status: "Accepted" });
    expect(body.properties.current_tag).toBeUndefined();
  });

  test("maps 401 to {error:'token'}", async () => {
    mockFetch([{ status: 401, body: { message: "bad token" } }]);
    const client = createClient({ token: "pat-bad" });
    const r = await client.updateProperties("7777", { hs_lead_status: "New" });
    expect(r.error).toBe("token");
  });

  test("returns {error:'unknown'} when 200 response has no body id", async () => {
    mockFetch([{ status: 200, body: null }]);
    const client = createClient({ token: "pat-test" });
    const r = await client.updateProperties("7777", { hs_lead_status: "New" });
    expect(r.error).toBe("unknown");
  });
});

describe("SEARCH_PROPERTIES coverage", () => {
  test("search requests hs_lead_status and current_tag so the popup can prefill them", async () => {
    const calls = mockFetch([{ status: 200, body: { results: [] } }]);
    const client = createClient({ token: "pat-test" });
    await client.searchByEmail("x@y.id");
    const body = JSON.parse(calls[0].opts.body);
    expect(body.properties).toEqual(expect.arrayContaining(["hs_lead_status", "current_tag"]));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/hubspotClient.test.js -t "updateProperties|SEARCH_PROPERTIES coverage"`
Expected: FAIL — `client.updateProperties is not a function` for the `updateProperties` block; the coverage test fails because `hs_lead_status`/`current_tag` are not yet in the requested properties.

- [ ] **Step 3: Extend `SEARCH_PROPERTIES`**

In `hubspotClient.js` line 25, replace:

```js
    const SEARCH_PROPERTIES = ["firstname", "lastname", "company", "jobtitle", "email", "linkedin_membership_id", "linkedinbio", "createdate"];
```

with:

```js
    const SEARCH_PROPERTIES = ["firstname", "lastname", "company", "jobtitle", "email", "linkedin_membership_id", "linkedinbio", "createdate", "hs_lead_status", "current_tag"];
```

- [ ] **Step 4: Add the `updateProperties` method**

In `hubspotClient.js`, immediately after the `updateContact` function (it ends at line 95, before `async function checkProperty`), insert:

```js
    async function updateProperties(contactId, props) {
      const r = await hsFetch(`/crm/v3/objects/contacts/${encodeURIComponent(contactId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties: props }),
      });
      if (!r.ok) return mapHttpError(r);
      if (!r.body || !r.body.id) return { error: "unknown", detail: r.body };
      return { contactId: r.body.id };
    }
```

Then add it to the returned object (line 104). Replace:

```js
    return { searchByEmail, searchByLinkedInBio, createContact, updateContact, checkProperty };
```

with:

```js
    return { searchByEmail, searchByLinkedInBio, createContact, updateContact, updateProperties, checkProperty };
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/hubspotClient.test.js`
Expected: PASS — all existing + new tests green.

- [ ] **Step 6: Checkpoint (no commit — see Global Constraints)**

Report: `SEARCH_PROPERTIES` extended, `updateProperties` added + tested. Do not run git.

---

### Task 2: background — `UPDATE_FIELDS` message handler

**Files:**
- Modify: `background.js` (new helper near `updateContact` at lines 221-231; new branch in the `onMessage` listener at lines 233-260)

**Interfaces:**
- Consumes: `client.updateProperties(contactId, props)` from Task 1.
- Produces: message `{ type: "UPDATE_FIELDS", contactId, props }` → response `{ state: "fields_saved", contactId }` on success, or `{ state: "<error_*>" }` mapped via the existing `mapClientErrorState`.

- [ ] **Step 1: Add the `updateFields` helper**

In `background.js`, immediately after the `updateContact` function (ends at line 231, before the `chrome.runtime.onMessage.addListener` at line 233), insert:

```js
async function updateFields(contactId, props) {
  if (!isPackagedBuild()) return { state: "error_unconfigured" };
  const r = await client.updateProperties(contactId, props);
  if (r.error) return { state: mapClientErrorState(r) };
  return { state: "fields_saved", contactId: r.contactId };
}
```

- [ ] **Step 2: Wire the message branch**

In the `onMessage` listener, after the `UPDATE_CONTACT` branch (lines 240-241):

```js
      } else if (msg.type === "UPDATE_CONTACT") {
        sendResponse(await updateContact(msg.contactId, msg.scrape));
```

insert a new branch directly below it:

```js
      } else if (msg.type === "UPDATE_FIELDS") {
        sendResponse(await updateFields(msg.contactId, msg.props));
```

- [ ] **Step 3: Verify the scrape-timing guardrail is intact**

Run: `npm test`
Expected: PASS — all suites green. In particular `content-readiness.test.js` must stay green: its tripwire asserts `await ensurePropertyCheck()` still precedes `await scrapeActiveTab()` in `background.js` with no `Promise.all`. Adding `updateFields` and a new message branch does not touch `getProfileState`, so this passes. If `content-readiness` goes red, you edited the protected path — revert and re-do.

- [ ] **Step 4: Manual smoke (service worker loads)**

In Chrome → `chrome://extensions` → reload the unpacked extension → confirm the service worker registers with no errors in its console (the new branch is syntactically valid and the handler is reachable). No HubSpot write happens yet (the popup sends `UPDATE_FIELDS` in Task 3).

- [ ] **Step 5: Checkpoint (no commit — see Global Constraints)**

Report: `UPDATE_FIELDS` handler added; full suite green; service worker loads clean.

---

### Task 3: popup — Manage block markup, styles, and behavior

**Files:**
- Modify: `popup.html` (CSS into `<style>` after the `.ghost.danger` rule at line 189; markup into `#dossier` after `#diagnostic` which closes at line 367, before `#actions` at line 368)
- Modify: `popup.js` (`els` map at lines 5-30; `clearBody` at lines 52-60; `render` cases for `found`/`success_pushed`/`success_updated`; new functions + listeners)

**Interfaces:**
- Consumes: message `UPDATE_FIELDS` from Task 2; `payload.contact.properties.hs_lead_status` / `.current_tag` (now present via Task 1's `SEARCH_PROPERTIES`); `payload.contact.id`.
- Produces: no exports (popup is a leaf renderer).

- [ ] **Step 1: Add the Manage-block CSS to `popup.html`**

In `popup.html`, inside `<style>`, immediately after the `.ghost.danger { ... }` rule (line 189) and before the `/* Spinner shimmer */` comment (line 191), insert:

```css
  /* ── Manage block (lead status + tag) ── */
  .manage { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--rule); }
  .manage[hidden] { display: none; }
  .manage-head {
    display: inline-flex; align-items: center; gap: 6px;
    font-family: var(--mono); font-size: 9.5px;
    letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--ink-faint); margin-bottom: 14px;
  }
  .manage-head::before { content: ""; width: 16px; height: 1px; background: var(--ink-faint); }
  .field {
    display: grid; grid-template-columns: 50px 1fr; align-items: center;
    gap: 12px; margin-bottom: 10px;
  }
  .field > label {
    font-family: var(--mono); font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--ink-soft);
  }
  .control select, .control input {
    width: 100%; height: 36px; padding: 0 12px;
    border-radius: 9px; border: 1px solid var(--rule-2);
    background: var(--paper-2); color: var(--ink);
    font: 13px/1 var(--sans); appearance: none; -webkit-appearance: none;
  }
  .control select {
    padding-right: 30px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236B6557' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='6 9 12 15 18 9'/></svg>");
    background-repeat: no-repeat; background-position: right 10px center; cursor: pointer;
  }
  .control input::placeholder { color: var(--ink-faint); }
  .manage-actions { display: flex; align-items: center; gap: 12px; margin-top: 14px; min-height: 34px; }
  .save-feedback {
    margin-right: auto;
    font-family: var(--mono); font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase;
    color: var(--ink-faint); opacity: 0; transition: opacity .25s var(--ease);
  }
  .save-feedback.show { opacity: 1; }
  .save-feedback.ok { color: var(--ok); }
  .save-feedback.err { color: var(--err); }
  .save-btn {
    height: 34px; padding: 0 22px; border-radius: 999px; border: 0;
    background: var(--ink); color: var(--paper);
    font: 500 12.5px/1 var(--sans); cursor: pointer;
    box-shadow: 0 10px 24px -12px rgba(20,15,5,0.5);
  }
  .save-btn:disabled { opacity: 0.38; cursor: not-allowed; box-shadow: none; }
```

- [ ] **Step 2: Add the Manage-block markup to `popup.html`**

In `popup.html`, inside `<section id="dossier">`, immediately after the `#diagnostic` block (closing `</div>` on line 367) and before `<div class="actions" id="actions" hidden></div>` (line 368), insert:

```html
      <div class="manage" id="manageBlock" hidden>
        <div class="manage-head">Manage</div>
        <div class="field">
          <label for="leadStatus">Status</label>
          <div class="control">
            <select id="leadStatus">
              <option value="">— Select status —</option>
              <option>Accepted</option>
              <option>Waiting List</option>
              <option>Provisional</option>
              <option>In Communication (Active)</option>
              <option>Dropped</option>
              <option>Uninvited</option>
              <option>Unqualified</option>
              <option>Declined</option>
              <option>Unsubscribed</option>
              <option>In Communication (Passive)</option>
              <option>In Communication (Passive Platinum)</option>
              <option>In Communication (Passive Gold)</option>
              <option>In Communication (Passive Silver Plus)</option>
              <option>In Communication (Passive Silver)</option>
              <option>In Communication (Passive Platinum Plus)</option>
              <option>New</option>
              <option>Push</option>
              <option>Traction</option>
            </select>
          </div>
        </div>
        <div class="field">
          <label for="tagInput">Tag</label>
          <div class="control">
            <input id="tagInput" type="text" autocomplete="off" placeholder="e.g. warm-intro">
          </div>
        </div>
        <div class="manage-actions">
          <span id="saveFeedback" class="save-feedback"></span>
          <button id="saveFields" class="save-btn" type="button" disabled>Save</button>
        </div>
      </div>
```

- [ ] **Step 3: Add the new element refs in `popup.js`**

In `popup.js`, in the `els` object (lines 5-30), add these entries before the closing `};` (after the `propStatus` line at line 29):

```js
  manageBlock:  $("manageBlock"),
  leadStatus:   $("leadStatus"),
  tagInput:     $("tagInput"),
  saveFields:   $("saveFields"),
  saveFeedback: $("saveFeedback"),
```

- [ ] **Step 4: Hide the Manage block in `clearBody`**

In `popup.js` `clearBody()` (lines 52-60), add before its closing `}` (after the `if (els.diagnostic) {...}` line at line 58):

```js
  if (els.manageBlock) els.manageBlock.hidden = true;
  if (els.saveFeedback) { els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = ""; }
```

- [ ] **Step 5: Add the Manage state + functions in `popup.js`**

In `popup.js`, after the `let lastContactId = null;` line (line 45), add the module state:

```js
let loadedFields = { status: "", tag: "" };
```

Then add these functions (place them just before `async function loadState()` at line 322):

```js
function renderManage(properties) {
  const p = properties || {};
  els.leadStatus.value = p.hs_lead_status || "";
  els.tagInput.value   = p.current_tag || "";
  loadedFields = { status: els.leadStatus.value, tag: els.tagInput.value };
  els.saveFeedback.className = "save-feedback";
  els.saveFeedback.textContent = "";
  els.manageBlock.hidden = false;
  refreshSaveEnabled();
}

function fieldsDirty() {
  return els.leadStatus.value !== loadedFields.status
      || els.tagInput.value   !== loadedFields.tag;
}

function refreshSaveEnabled() {
  els.saveFields.disabled = !fieldsDirty();
}

// Only changed fields are sent. Lead status is never written as the empty
// placeholder value, so the popup can never blank an existing status.
function changedFieldProps() {
  const props = {};
  if (els.leadStatus.value !== loadedFields.status && els.leadStatus.value !== "") {
    props.hs_lead_status = els.leadStatus.value;
  }
  if (els.tagInput.value !== loadedFields.tag) {
    props.current_tag = els.tagInput.value;
  }
  return props;
}

function fieldsErrorText(state) {
  switch (state) {
    case "error_token":        return "Token rejected (401)";
    case "error_scope":        return "Missing write scope";
    case "error_rate_limit":   return "Throttled — try again";
    case "error_network":      return "Offline — check connection";
    case "error_unconfigured": return "Build not configured";
    default:                   return "HubSpot error — try again";
  }
}

async function onSaveFields() {
  if (!lastContactId) return;
  const props = changedFieldProps();
  if (Object.keys(props).length === 0) { refreshSaveEnabled(); return; }
  els.saveFields.disabled = true;
  els.saveFeedback.className = "save-feedback show";
  els.saveFeedback.textContent = "Saving…";
  const r = await chrome.runtime.sendMessage({ type: "UPDATE_FIELDS", contactId: lastContactId, props });
  if (r && r.state === "fields_saved") {
    loadedFields = { status: els.leadStatus.value, tag: els.tagInput.value };
    els.saveFeedback.className = "save-feedback show ok";
    els.saveFeedback.textContent = "✓ Saved";
  } else {
    els.saveFeedback.className = "save-feedback show err";
    els.saveFeedback.textContent = fieldsErrorText(r && r.state);
  }
  refreshSaveEnabled();
}
```

- [ ] **Step 6: Wire the listeners in `popup.js`**

In `popup.js`, after the existing tab listeners (after line 354, `els.tabSettings.addEventListener(...)`), add:

```js
// ── Manage block (lead status + tag) ──
els.leadStatus.addEventListener("change", () => {
  els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = "";
  refreshSaveEnabled();
});
els.tagInput.addEventListener("input", () => {
  els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = "";
  refreshSaveEnabled();
});
els.saveFields.addEventListener("click", onSaveFields);
```

- [ ] **Step 7: Render the Manage block in the three states**

In `popup.js` `render()`:

In the `found` case, after `els.actions.appendChild(ctaGhost("Skip", () => window.close()));` (line 230) and before the `return;` (line 231), add:

```js
      renderManage(payload.contact.properties);
```

In the `success_pushed` case (lines 234-240), after `els.sinceLine.innerHTML = ...` (line 239) and before `return;` (line 240), add:

```js
      lastContactId = payload.contact.id;
      renderManage({});
```

In the `success_updated` case (lines 242-249), after `els.sinceLine.innerHTML = ...` (line 248) and before `return;` (line 249), add:

```js
      lastContactId = payload.contact.id;
      renderManage({});
```

- [ ] **Step 8: Confirm the unit suite still passes**

Run: `npm test`
Expected: PASS — popup changes have no automated tests but must not break `hubspotClient`, `scraper`, or `content-readiness`. All green.

- [ ] **Step 9: Manual browser verification (the faithful path)**

Load the unpacked extension in Chrome and verify against a real logged-in session:
1. Open the popup on a LinkedIn profile **already in HubSpot** → the Manage block shows, with the dropdown pre-set to the contact's current `hs_lead_status` (or "— Select status —" if none) and the tag box pre-filled with `current_tag`. Save is **disabled**.
2. Change the status and/or type a tag → Save **enables**.
3. Click **Save** → "Saving…" then "✓ Saved"; Save disables again.
4. Open the contact in HubSpot → confirm the new lead status / tag were written.
5. Reopen the popup on the same profile → the new values are pre-filled (proves global persistence via the shared contact).
6. On a profile **not yet in HubSpot** → push it → confirm the Manage block appears on the success screen and a status/tag can be saved against the new contact.
7. Role/company still display correctly (sanity check the scrape path is unaffected).

- [ ] **Step 10: Checkpoint (no commit — see Global Constraints)**

Report results of the manual checklist. Do not run git.

---

### Task 4: Version bump + full-suite gate

**Files:**
- Modify: `manifest.json` (line 4)

- [ ] **Step 1: Bump the manifest version**

In `manifest.json`, change:

```json
  "version": "0.1.34",
```

to:

```json
  "version": "0.1.35",
```

- [ ] **Step 2: Full test gate**

Run: `npm test`
Expected: PASS — every suite green, including `content-readiness` (proves the scrape-timing path is untouched end-to-end).

- [ ] **Step 3: Confirm the build version is visible**

Reload the unpacked extension; open the popup → the footer shows `v0.1.35`. This confirms the operator-visible build updated.

- [ ] **Step 4: Checkpoint (no commit — see Global Constraints)**

Report: version bumped to 0.1.35, full suite green, footer shows the new build. The user decides when/whether to package and commit.
