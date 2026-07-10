# Carry last-used tag/status to the next profile — design

**Date:** 2026-06-22
**Extension version:** 0.1.47 → **0.1.48**
**Scope:** popup only. No change to scraper.js / content.js / background.js scrape-timing path.

## Goal

When an operator works a batch of LinkedIn profiles, pre-fill the popup's **Status**
and **Tag** fields with the values from their last successful Save, so re-applying the
same tag/status is one click (review → Save) instead of re-selecting every time.

## Decisions (locked with Antonio)

- **Behaviour:** auto-fill the fields, shown as a *pending change* (Save lights up). Never auto-saves — explicit Save only.
- **Persistence:** `chrome.storage.local` — survives Chrome restart / panel close.
- **What to remember:** **both** fields' values at every successful Save.
- **Visibility:** **Variant A** — a "Pre-filled from last used" banner over the Manage block, plus a per-field `was: <stored value>` line so the real HubSpot value stays visible.
- **Toggle:** a Settings checkbox "Carry last-used tag/status to new profiles", **default ON**.

## Mechanic

`renderManage(properties)` today sets the fields from the contact's real HubSpot values
and records `loadedFields` (the baseline Save diffs against). The feature adds an
**overlay**: after `loadedFields` is set to the real values, the remembered `lastUsed`
values are written into the *fields only* (never into `loadedFields`). So:

- Save lights up because the fields differ from the contact's stored values (existing diff).
- Save still sends only the real diff (`changedFieldProps`) and still never writes a blank status.
- Nothing reaches HubSpot without an explicit Save click.

### Two notions of "dirty" (the load-bearing part)

The side panel currently **holds back** loading a newly-navigated profile while fields are
dirty, to protect unsaved edits. Auto-fill makes every profile dirty on load, which would
make the nav-hold fire constantly and break the batch flow. So "dirty" splits in two:

- **saveDirty** = fields ≠ `loadedFields` (the contact's real values) → controls the **Save button**. (This is today's `fieldsDirty`.)
- **manualDirty** = fields ≠ `suggestionBaseline` (the values after overlay) → controls the **nav-hold** and `consumePendingIfClean`.

`suggestionBaseline` = the field values immediately after the overlay is applied.
On a profile with no overlay, `suggestionBaseline === loadedFields`, so **manualDirty ===
saveDirty** and today's behaviour is preserved byte-for-byte. An untouched suggestion is
`manualDirty === false`, so it flows freely as you navigate (re-suggested next profile,
since it's persisted); a value you *manually* type over becomes `manualDirty === true` and
the nav-hold protects it exactly as before.

### Overlay safety rule

Overlay a field **only when** the remembered value is **non-empty** and **differs from the
contact's stored value**. This means:
- An empty remembered value never overlays (so the feature never silently *suggests
  clearing* an existing tag, and never touches status — `current_tag`/`hs_lead_status`
  blanking is not a default).
- A remembered value equal to the stored value produces no overlay/banner/`was:` for that
  field (nothing to carry).
- The banner shows whenever ≥1 field was overlaid; each overlaid field gets its `was:` line.

### Capture

On a **successful** Save, set `lastUsed = { status: <status field>, tag: <tag field> }`
(both, per the decision) and persist to `chrome.storage.local`. Also set
`suggestionBaseline = loadedFields = current` so the just-saved profile is clean
(no lingering manualDirty). Capture runs regardless of the toggle (cheap; makes turning
the toggle on instant). The **overlay** is what the toggle gates.

### Revert

The banner's **Revert** sets the fields back to `loadedFields` (stored values) **and** sets
`suggestionBaseline = loadedFields`, so the row becomes clean: Save dims, manualDirty clears,
and any held profile is picked up. It means "I don't want the carried values for this person."

### Toggle

`carryLastUsed` boolean in `chrome.storage.local`, default `true`, loaded at bootstrap and
reflected by the Settings checkbox. When OFF, `renderManage` skips the overlay (today's
behaviour). Toggling OFF does not yank an already-shown suggestion; it just stops overlaying
the next profile.

## Files

- **`popupLogic.js`** (new, pure, dual-export like `hubspotClient.js`): `computeOverlay(stored, lastUsed, enabled)`, `saveDirty(cur, loaded)`, `manualDirty(cur, suggestion)`. Unit-tested directly.
- **`popup.html`**: load `popupLogic.js` before `popup.js`; add the Variant-A banner + two `was:` lines inside `#manageBlock`; add the Settings toggle row.
- **`popup.js`**: load `lastUsed` + `carryLastUsed` at bootstrap; apply overlay in `renderManage`; introduce `suggestionBaseline` and the saveDirty/manualDirty split across `refreshSaveEnabled`, `syncToActiveTab`, `consumePendingIfClean`, `setNavDiag`; capture on Save success; wire Revert and the toggle.
- **`manifest.json`**: add `"storage"` permission; version → `0.1.48`.
- **`pack-crx.sh` / `pack.sh`**: add `popupLogic.js` to the staged file list.
- **`tests/popupLogic.test.js`** (new): cover the overlay safety rule and the two dirty notions.

## Done looks like

- Open a profile already in HubSpot after a prior Save → Status/Tag pre-filled with the
  last-used values, banner + `was:` lines shown, Save enabled.
- Click Save → writes only the real diff; banner clears; `lastUsed` updated.
- Navigate to another profile **without** touching the suggestion → it loads immediately
  (no "save or clear" nag) and re-suggests.
- **Manually** edit a field, then navigate → nav-hold still fires ("save or clear to switch").
- Revert → fields show stored values, Save dims, nav flows.
- Toggle OFF in Settings → next profile shows stored values only, Save disabled (today's behaviour).
- `npm test` fully green, **including** content-readiness.

## Don't do

- Don't auto-save. Ever.
- Don't overlay an empty remembered value (no silent blanking of tag/status).
- Don't write `loadedFields` from the overlay — it must stay equal to the contact's real values.
- Don't touch scraper.js / content.js / background.js scrape-timing path, the readiness budget, or the property-check→scrape ordering.
- Don't remove or weaken the on-screen diagnostics or the never-blank-status guard.
- Don't print/cat/commit background.js.
