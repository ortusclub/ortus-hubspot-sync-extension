# In-Popup Tag & Lead-Status Editing — Design

**Date:** 2026-06-18
**Project:** Ortus Club · HubSpot Sync Chrome extension (`HS Extension New`), base build v0.1.34
**Status:** Approved design, ready for implementation plan

## Goal

Let an operator read and edit a HubSpot contact's **lead status** and **tag** directly
from the extension popup, writing straight to the shared HubSpot contact so every other
operator sees the change.

## The two real HubSpot properties (confirmed against portal 2748825, not guessed)

- **Lead status** → property `hs_lead_status`, type **enumeration (single-select)**.
  The 18 allowed values, in HubSpot's defined order:
  `Accepted`, `Waiting List`, `Provisional`, `In Communication (Active)`, `Dropped`,
  `Uninvited`, `Unqualified`, `Declined`, `Unsubscribed`, `In Communication (Passive)`,
  `In Communication (Passive Platinum)`, `In Communication (Passive Gold)`,
  `In Communication (Passive Silver Plus)`, `In Communication (Passive Silver)`,
  `In Communication (Passive Platinum Plus)`, `New`, `Push`, `Traction`.
- **Tag** → property `current_tag`, type **string (free text)** — no predefined values exist
  in HubSpot, so the control is a free-text input.

> Note: `hs_lead_status` is the same field the lead-lifecycle automation moves through
> (Provisional → In-comms → Accepted). Manual popup edits can override that flow. This is
> intended per the request; it is a shared field, not a private one.

## Global Constraints

- **Do NOT touch the scrape-timing path.** No edits to `content.js`, `scraper.js`, or the
  `getProfileState()` ordering in `background.js` (the sequential `ensurePropertyCheck()`
  → `scrapeActiveTab()` and the `forceLazyLoad` 15000ms budgets are load-bearing).
- **`npm test` must stay green**, especially `tests/content-readiness.test.js`. This feature
  touches neither `content.js` nor `getProfileState`, so it will.
- **Never commit `background.js`** to any public remote — it holds the live HubSpot token.
- **Version bump:** `manifest.json` `0.1.34` → `0.1.35` so the footer shows the new build.
- **Exact identifiers only:** `hs_lead_status`, `current_tag`, and the 18 status values above,
  verbatim. No invented values.

## Architecture

A **new, isolated write path** independent of the scrape:

- A new message `UPDATE_FIELDS { contactId, props }`.
- A new client method `updateProperties(contactId, props)` that PATCHes **only** the given
  properties. It never goes through `buildProperties()` (the scrape→properties mapping), so
  the protected path is byte-untouched.
- Current values are **read** by extending the existing `SEARCH_PROPERTIES` list so the
  `found` payload already carries `hs_lead_status` and `current_tag`.
- **Global persistence is inherent:** writing to the shared HubSpot contact *is* the shared
  store. No chrome.storage, no extra infrastructure.

### Why not the alternatives

- *Extend `buildProperties` / reuse `updateContact`*: would re-send scrape fields on every
  status save, re-coupling the feature to the protected path. Rejected.
- *One merged "Save everything" button*: merges the scrape write with the field write and
  muddies "what gets written when". Rejected.

## Components

### `hubspotClient.js`

- Add `"hs_lead_status"` and `"current_tag"` to `SEARCH_PROPERTIES` (line 25).
- New exported method:
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
  Add `updateProperties` to the returned client object.
- **Consumes:** `props` is a plain object containing only changed fields, e.g.
  `{ hs_lead_status: "Provisional" }` or `{ hs_lead_status: "...", current_tag: "warm-intro" }`.

### `background.js`

- New branch in the `chrome.runtime.onMessage` listener:
  ```js
  } else if (msg.type === "UPDATE_FIELDS") {
    if (!isPackagedBuild()) { sendResponse({ state: "error_unconfigured" }); return; }
    const r = await client.updateProperties(msg.contactId, msg.props);
    if (r.error) sendResponse({ state: mapClientErrorState(r) });
    else sendResponse({ state: "fields_saved", contactId: r.contactId });
  }
  ```
- `getProfileState()` is **not** modified.

### `popup.html`

A static, initially-hidden **Manage block** inside the dossier (markup styled to match the
existing popup; see `sketches/manage-fields-mockup.html` for the approved look):

- `<select id="leadStatus">` with a leading **placeholder** option `value=""` label
  `— Select status —`, followed by the 18 status `<option>`s.
- `<input id="tagInput" type="text" autocomplete="off">` (free text).
- `<button id="saveFields">Save</button>` (disabled by default).
- `<span id="saveFeedback">` inline feedback line.

### `popup.js`

- New `els` refs: `manageBlock`, `leadStatus`, `tagInput`, `saveFields`, `saveFeedback`.
- `clearBody()` also hides `manageBlock` and clears `saveFeedback`, so it never bleeds across
  states.
- `renderManage(properties)`:
  - `leadStatus.value = properties?.hs_lead_status || ""` (falls back to the placeholder when
    the contact has no status).
  - `tagInput.value = properties?.current_tag || ""`.
  - Store `loaded = { status: leadStatus.value, tag: tagInput.value }`.
  - Show `manageBlock`; call `refreshSaveEnabled()`.
- Dirty tracking: `leadStatus` `change` and `tagInput` `input` clear feedback and call
  `refreshSaveEnabled()`, which enables Save only when a value differs from `loaded`.
- `onSaveFields()`:
  - Build `props` containing **only changed fields** (diff vs `loaded`); if empty, return.
    The placeholder (`""`) for status is never sent (we only send `hs_lead_status` when a real
    value differs from loaded).
  - `saveFeedback` → "Saving…"; disable Save.
  - `chrome.runtime.sendMessage({ type: "UPDATE_FIELDS", contactId: lastContactId, props })`.
  - On `{ state: "fields_saved" }`: update `loaded`, show "✓ Saved", `refreshSaveEnabled()`.
  - On error state: show a short inline message (see Error handling) — **do not** tear down
    the dossier.
- Call `renderManage(...)` from three states:
  - `found` → `renderManage(payload.contact.properties)` (`lastContactId` already set).
  - `success_pushed` → set `lastContactId = payload.contact.id`; `renderManage({})` (blank
    status placeholder, empty tag).
  - `success_updated` → same as `success_pushed`.

## Data flow

```
open popup → GET_PROFILE_STATE → found {contact.properties incl. hs_lead_status,current_tag}
  → renderManage prefit controls, remember loaded, Save disabled
operator edits status/tag → Save enables
click Save → UPDATE_FIELDS {contactId, props: changedOnly}
  → background → updateProperties → PATCH /contacts/{id}
  → fields_saved → "✓ Saved", loaded updated, Save disabled
(any operator opening the same profile later reads the new value from HubSpot)
```

## Error handling

Map the existing client error states to short inline messages in `saveFeedback`
(class `err`), without disturbing the rest of the dossier:

- `error_token` → "Token rejected (401)"
- `error_scope` → "Missing write scope"
- `error_rate_limit` → "Throttled — try again"
- `error_network` → "Offline — check connection"
- `error_hubspot` → "HubSpot error — try again"
- `error_unconfigured` → "Build not configured"

Diff-based save prevents accidental clears (empty tag only writes if it actually changed) and
no-op writes (Save disabled when nothing changed).

## Testing

- **`tests/hubspotClient.test.js`** (extend, following existing fetch-mock pattern):
  - `updateProperties(id, props)` issues `PATCH /crm/v3/objects/contacts/{id}` with body
    `{ properties: props }`; returns `{ contactId }` on 200; maps 401→token, 429→rate_limit,
    5xx→hubspot_5xx, network→network.
  - `SEARCH_PROPERTIES` includes `hs_lead_status` and `current_tag`.
- **Guardrail:** run `npm test`; `content-readiness` must stay green (proves the scrape-timing
  path is untouched).
- **Popup/DOM:** no automated harness exists for `popup.js` (DOM + `chrome.runtime`).
  Verify manually in the real browser: load unpacked → open the popup on a contact already in
  HubSpot → confirm status/tag prefill → change both → Save → confirm "✓ Saved" → check the
  contact in HubSpot → reopen the popup to confirm the values persisted → repeat the push flow
  to confirm the Manage block appears after a fresh push.

## Scope (v1)

In scope: read + edit `hs_lead_status` and `current_tag` in the `found`, `success_pushed`,
and `success_updated` states; explicit Save; diff-based isolated write; version bump.

Out of scope (deferred): tag autocomplete/datalist, editing any other property, bulk edits,
undo, optimistic UI, offline queueing.
