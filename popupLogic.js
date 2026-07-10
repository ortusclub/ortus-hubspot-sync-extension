// popupLogic.js — pure helpers for the popup's "carry last-used tag/status"
// feature. No DOM, no chrome.* — so it is unit-testable directly (like
// hubspotClient.js). popup.js consumes it via window.OrtusPopupLogic; tests
// require() it.
//
// Two field values flow through the Manage block:
//   loaded     — the contact's REAL HubSpot values (Save diffs against this)
//   suggestion — the values shown after the last-used overlay is applied
// computeOverlay produces the overlay; saveDirty/manualDirty are the two
// distinct "dirty" notions the popup needs (Save button vs. nav-hold).

(function (root) {
  function str(v) { return v == null ? "" : String(v); }

  // Build the field values to display: start from the contact's stored values,
  // then overlay a remembered value ONLY when the toggle is on AND that value
  // is non-empty AND differs from stored. Empty remembered values never
  // overlay — the feature must not silently suggest blanking a tag/status.
  function computeOverlay(stored, lastUsed, enabled) {
    const s = { status: str(stored && stored.status), tag: str(stored && stored.tag) };
    const l = { status: str(lastUsed && lastUsed.status), tag: str(lastUsed && lastUsed.tag) };
    const fields = { status: s.status, tag: s.tag };
    const overlaid = { status: false, tag: false };
    if (enabled) {
      ["status", "tag"].forEach((f) => {
        if (l[f] !== "" && l[f] !== s[f]) { fields[f] = l[f]; overlaid[f] = true; }
      });
    }
    return { fields, overlaid };
  }

  // Fields differ from the contact's real stored values → there is something to
  // Save. Controls the Save button. (This is the popup's original fieldsDirty.)
  function saveDirty(cur, loaded) {
    return str(cur && cur.status) !== str(loaded && loaded.status)
        || str(cur && cur.tag)    !== str(loaded && loaded.tag);
  }

  // Fields differ from the post-overlay suggestion → the operator MANUALLY
  // edited. Controls the nav-hold: an untouched auto-fill suggestion is not
  // manual work and must not block navigating to the next profile.
  function manualDirty(cur, suggestion, noteDraft) {
    return str(cur && cur.status) !== str(suggestion && suggestion.status)
        || str(cur && cur.tag)    !== str(suggestion && suggestion.tag)
        || str(noteDraft).trim() !== "";
  }

  const api = { computeOverlay, saveDirty, manualDirty };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OrtusPopupLogic = api;
})(typeof self !== "undefined" ? self : globalThis);
