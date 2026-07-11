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
  loadingHint: $("loadingHint"),
  diagnostic: $("diagnostic"),
  diagnosticText: $("diagnosticText"),
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
  installedVersion: $("installedVersion"),
  checkUpdateBtn: $("checkUpdateBtn"),
  updateFeedback: $("updateFeedback"),
  manageBlock:  $("manageBlock"),
  leadStatus:   $("leadStatus"),
  tagInput:     $("tagInput"),
  saveFields:   $("saveFields"),
  saveFeedback: $("saveFeedback"),
  noteInput:    $("noteInput"),
  addNote:      $("addNote"),
  noteFeedback: $("noteFeedback"),
  suggestBanner: $("suggestBanner"),
  suggestRevert: $("suggestRevert"),
  wasStatus:    $("wasStatus"),
  wasTag:       $("wasTag"),
  carryToggle:  $("carryToggle"),
};

let loadingHintTimer = null;
function clearLoadingHint() {
  if (loadingHintTimer) { clearTimeout(loadingHintTimer); loadingHintTimer = null; }
  if (els.loadingHint) els.loadingHint.hidden = true;
}
function scheduleLoadingHint() {
  clearLoadingHint();
  loadingHintTimer = setTimeout(() => {
    if (els.loadingHint) els.loadingHint.hidden = false;
  }, 2000);
}

let lastScrape = null;
let lastContactId = null;
let lastContactProperties = null;
let loadedFields = { status: "", tag: "" };       // the contact's REAL HubSpot values (Save diffs against this)
let suggestionBaseline = { status: "", tag: "" }; // the field values right after the last-used overlay
let lastUsed = { status: "", tag: "" };           // remembered across profiles (chrome.storage.local)
let carryEnabled = true;                           // toggle: carry last-used into new profiles
let installUpdateWhenReady = false;
let readyUpdateVersion = "";

// ── Side-panel navigation state ──
// The panel stays open while the operator works LinkedIn, so it follows them:
// re-read when they land on a DIFFERENT profile, but never blank when they move
// to a non-profile page or another app tab — it stays on the last profile.
let shownSlug = "";      // slug of the profile currently rendered ("" = idle/none)
let pendingSlug = "";    // a newer profile held back because edits are unsaved
let syncing = false;     // guard against overlapping syncToActiveTab() runs
let panelWindowId = null; // the browser window this side panel is docked in
let lastVoyName = "-";   // TEMP DIAG: Voyager name-extraction result of last load

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
  if (els.diagnostic) { els.diagnostic.hidden = true; els.diagnosticText.textContent = ""; }
  if (els.manageBlock) els.manageBlock.hidden = true;
  if (els.suggestBanner) els.suggestBanner.hidden = true;
  if (els.wasStatus) { els.wasStatus.hidden = true; els.wasStatus.innerHTML = ""; }
  if (els.wasTag) { els.wasTag.hidden = true; els.wasTag.innerHTML = ""; }
  if (els.saveFeedback) { els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = ""; }
  if (els.noteInput) els.noteInput.value = "";
  if (els.noteFeedback) { els.noteFeedback.className = "save-feedback"; els.noteFeedback.textContent = ""; }
  if (els.addNote) els.addNote.disabled = true;
  clearLoadingHint();
}

function renderDiagnostic(debug) {
  if (!debug || !els.diagnostic) return;
  let version = "?";
  try { version = chrome.runtime.getManifest().version; } catch (e) {}
  const yes = (v) => v === true ? "yes" : v === false ? "no" : (v == null ? "?" : String(v));
  const fmt = (v, max = 80) => {
    if (v == null) return "(none)";
    const s = String(v);
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };
  const pad = (label, w = 13) => (label + " ".repeat(w)).slice(0, w);
  const lines = [
    `${pad("version")}v${version}`,
    `${pad("url")}${fmt(debug.url, 70)}`,
    `${pad("slug")}${fmt(debug.slug)}`,
    `${pad("top h1")}${fmt(debug.topH1)}`,
    `${pad("top title")}${fmt(debug.topTitle)}`,
    `${pad("og:title")}${fmt(debug.ogTitle)}`,
    `${pad("top urns")}${yes(debug.topMemberCount)}`,
    `${pad("iframe")}${yes(debug.hasIframe)}`,
    `${pad("ifr h1")}${fmt(debug.ifrH1)}`,
    `${pad("ifr title")}${fmt(debug.ifrTitle)}`,
    `${pad("ifr urns")}${yes(debug.ifrMemberCount)}`,
    `${pad("doc used")}${fmt(debug.profileDocSource)}`,
  ];
  if (debug.topErr) lines.push(`${pad("top err")}${fmt(debug.topErr)}`);
  if (debug.ifrErr) lines.push(`${pad("ifr err")}${fmt(debug.ifrErr)}`);
  lines.push(`${pad("top mode")}${fmt(debug.topMode)}`);
  lines.push(`${pad("ifr mode")}${fmt(debug.ifrMode)}`);
  if (debug.topProbe) lines.push(`${pad("top body")}card:${yes(debug.topProbe.card)} exp:${yes(debug.topProbe.exp)} pid:${yes(debug.topProbe.pid)} h1n:${fmt(debug.topProbe.h1n)}`);
  if (debug.ifrProbe) lines.push(`${pad("ifr body")}card:${yes(debug.ifrProbe.card)} exp:${yes(debug.ifrProbe.exp)} pid:${yes(debug.ifrProbe.pid)} h1n:${fmt(debug.ifrProbe.h1n)}`);
  if (debug.allFrames && debug.allFrames.length) {
    lines.push("frames:");
    for (const f of debug.allFrames) lines.push(`  ${fmt(f.testid, 22)} ${fmt(f.src, 34)}`);
  }
  const showExp = (label, e) => {
    if (!e) return;
    if (e.found) {
      lines.push(`${label} FOUND <${fmt(e.tag, 20)}${e.id ? " #" + e.id : ""}>`);
      lines.push(`  dvn ${fmt((e.dvn || []).join(","), 160)}`);
      lines.push(`  html ${fmt(e.html, 2200)}`);
    } else {
      lines.push(`${label} not-found${e.err ? " err:" + e.err : ""}${e.noifr ? " (no iframe doc)" : ""}`);
    }
  };
  showExp("EXP top:", debug.expTop);
  showExp("EXP ifr:", debug.expIfr);
  if (debug.voyager) {
    lines.push("");
    lines.push("Voyager resolve:");
    if (debug.voyager.skipped) lines.push(`  skipped: ${debug.voyager.skipped}`);
    if (debug.voyager.error) lines.push(`  err: ${fmt(debug.voyager.error, 60)}`);
    if (debug.voyager.status) lines.push(`  ${debug.voyager.status} ${debug.voyager.bodyLen || 0}b${debug.voyager.errBodyHead ? " " + fmt(debug.voyager.errBodyHead, 50) : ""}`);
    if (debug.voyager.role) {
      const rr = debug.voyager.role;
      lines.push(`  role: n=${fmt(rr.n)} jt=${fmt(rr.jt)} co=${fmt(rr.co)}${rr.err ? " err:" + fmt(rr.err, 50) : ""}`);
      if (rr.types && rr.types.length) lines.push(`  types: ${fmt(rr.types.join(","), 160)}`);
    }
  }
  if (debug.salesNav) {
    lines.push("");
    lines.push("SalesNav resolve:");
    if (debug.salesNav.from) lines.push(`  from: ${debug.salesNav.from}`);
    for (const t of (debug.salesNav.tried || [])) {
      if (t.error) lines.push(`  err: ${fmt(t.error, 60)}`);
      else lines.push(`  ${t.status} ${t.onLeadPage ? "on-lead" : "off-lead"} ${t.bodyLen}b → ${t.memberId || "(none)"}`);
    }
  }
  els.diagnosticText.textContent = lines.join("\n");
  els.diagnostic.hidden = false;
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
  if (!memberId) { els.metaLine.hidden = true; return; }
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
      scheduleLoadingHint();
      return;

    case "not_found": {
      setBadge("default", "Connected");
      setEyebrow("Not in HubSpot");
      lastScrape = payload.scrape;
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      renderMeta(payload.scrape.memberId);
      renderWarnings(payload.scrape);
      if (!payload.scrape.jobTitle && !payload.scrape.company) renderDiagnostic(payload.scrape._debug);
      els.actions.hidden = false;
      els.actions.appendChild(ctaPrimary("Push to HubSpot", onPushClick));
      return;
    }

    case "found": {
      setBadge("default", "Connected");
      setEyebrow("Already in HubSpot", "ok");
      lastScrape = payload.scrape;
      lastContactId = payload.contact.id;
      lastContactProperties = payload.contact.properties || {};
      dossierName(payload.scrape.firstName, payload.scrape.lastName);
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      if (!payload.scrape.jobTitle && !payload.scrape.company) renderDiagnostic(payload.scrape._debug);
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
      renderManage(payload.contact.properties);
      return;
    }

    case "success_pushed":
      setBadge("default", "Connected");
      setEyebrow("Pushed", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> added to HubSpot.`;
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      lastContactId = payload.contact.id;
      lastContactProperties = {};
      renderManage({});
      return;

    case "success_updated":
      setBadge("default", "Connected");
      setEyebrow("Updated", "ok");
      els.headline.innerHTML = `${escape(payload.scrape.firstName)} <em>${escape(payload.scrape.lastName || "")}</em> updated.`;
      renderRole(payload.scrape.jobTitle, payload.scrape.company);
      els.sinceLine.hidden = false;
      els.sinceLine.innerHTML = `<a href="${escape(payload.contact.url)}" target="_blank">View in HubSpot ›</a>`;
      lastContactId = payload.contact.id;
      lastContactProperties = payload.contact.properties || {};
      renderManage(lastContactProperties);
      return;

    case "scrape_failed_id":
      setBadge("default", "Connected");
      setError("Couldn't read the profile",
        "Couldn't read the LinkedIn ID for this profile.",
        "LinkedIn may have updated the page structure. Reload the profile and try again.");
      renderDiagnostic(payload.debug);
      return;

    case "scrape_failed_name":
    case "scrape_failed":
      setBadge("default", "Connected");
      setError("Couldn't read the profile",
        "Couldn't read the name for this profile.",
        "Reload the profile and try again.");
      renderDiagnostic(payload.debug);
      return;

    case "error_token":
      setBadge("error", "Auth error");
      return setError("HubSpot rejected the token",
        "Token may have been rotated.",
        "401 · Antonio needs to ship an updated build with a fresh token.");

    case "error_unconfigured":
      setBadge("error", "Install error");
      return setError("This GitHub build is not configured",
        "Install the packaged version from Google Sheets.",
        "The public GitHub ZIP does not include the private HubSpot token.");

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

function renderManage(properties) {
  const p = properties || {};
  // Baseline = the contact's REAL HubSpot values. Set the controls first, then
  // read BACK the resolved values (a status outside the 18-option list resolves
  // to "") so the baseline matches what the control can actually hold — exactly
  // as the original code did. Save always diffs against this.
  els.leadStatus.value = p.hs_lead_status || "";
  els.tagInput.value   = p.current_tag || "";
  loadedFields = { status: els.leadStatus.value, tag: els.tagInput.value };

  // Overlay the remembered last-used values onto the FIELDS only (never the
  // baseline): an unsaved suggestion is shown and Save lights up, but the diff
  // that actually gets written is still computed against the real values.
  const ov = OrtusPopupLogic.computeOverlay(loadedFields, lastUsed, carryEnabled);
  els.leadStatus.value = ov.fields.status;
  els.tagInput.value   = ov.fields.tag;
  suggestionBaseline = { status: els.leadStatus.value, tag: els.tagInput.value };

  renderSuggestionHints(ov.overlaid);
  els.saveFeedback.className = "save-feedback";
  els.saveFeedback.textContent = "";
  els.noteInput.value = "";
  els.noteFeedback.className = "save-feedback";
  els.noteFeedback.textContent = "";
  els.manageBlock.hidden = false;
  refreshSaveEnabled();
  refreshNoteEnabled();
}

// Variant A: a banner whenever something was carried over, plus a per-field
// "was: <stored value>" line so the contact's real HubSpot value stays visible.
function renderSuggestionHints(overlaid) {
  els.suggestBanner.hidden = !(overlaid.status || overlaid.tag);
  setWasLine(els.wasStatus, overlaid.status, loadedFields.status);
  setWasLine(els.wasTag,    overlaid.tag,    loadedFields.tag);
}

function setWasLine(el, show, storedValue) {
  if (!show) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = "was <b>" + escape(storedValue || "—") + "</b>";
}

function currentFields() {
  return { status: els.leadStatus.value, tag: els.tagInput.value };
}

// Fields differ from the contact's real stored values → there is something to
// Save. Controls the Save button.
function saveDirty() {
  return OrtusPopupLogic.saveDirty(currentFields(), loadedFields);
}

// Fields differ from the post-overlay suggestion → the operator MANUALLY edited.
// Controls the nav-hold: an untouched auto-fill suggestion must not block moving
// to the next profile (it is re-suggested there anyway).
function manualDirty() {
  return OrtusPopupLogic.manualDirty(currentFields(), suggestionBaseline, els.noteInput.value);
}

function refreshSaveEnabled() {
  els.saveFields.disabled = !saveDirty();
}

function refreshNoteEnabled() {
  els.addNote.disabled = !lastContactId || els.noteInput.value.trim() === "";
}

// Persist the just-saved values so the next profile can carry them over.
function rememberLastUsed(status, tag) {
  lastUsed = { status: status || "", tag: tag || "" };
  try { chrome.storage.local.set({ lastUsed }); } catch (e) {}
}

// Drop the carried-over suggestion: show the contact's real stored values, clear
// the pending state, and let any held profile load.
function revertSuggestion() {
  els.leadStatus.value = loadedFields.status;
  els.tagInput.value   = loadedFields.tag;
  suggestionBaseline = { status: loadedFields.status, tag: loadedFields.tag };
  els.suggestBanner.hidden = true;
  els.wasStatus.hidden = true; els.wasStatus.innerHTML = "";
  els.wasTag.hidden = true; els.wasTag.innerHTML = "";
  els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = "";
  refreshSaveEnabled();
  consumePendingIfClean();
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
  // NOTE: temporary diagnostic build (v0.1.36) — this surfaces the exact failure
  // reason on screen so we can find the root cause without DevTools. Will be
  // tidied back to fieldsErrorText() once the cause is known.
  if (!lastContactId) {
    els.saveFeedback.className = "save-feedback show err";
    els.saveFeedback.textContent = "No contact id — reopen the popup";
    return;
  }
  const props = changedFieldProps();
  if (Object.keys(props).length === 0) {
    els.saveFeedback.className = "save-feedback show";
    els.saveFeedback.textContent = "No changes to save";
    refreshSaveEnabled();
    return;
  }
  els.saveFields.disabled = true;
  els.saveFeedback.className = "save-feedback show";
  els.saveFeedback.textContent = "Saving…";
  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: "UPDATE_FIELDS", contactId: lastContactId, props });
  } catch (e) {
    els.saveFeedback.className = "save-feedback show err";
    els.saveFeedback.textContent = "Save crashed: " + String((e && e.message) || e).slice(0, 90);
    refreshSaveEnabled();
    return;
  }
  if (r && r.state === "fields_saved") {
    lastContactProperties = { ...(lastContactProperties || {}), ...props };
    loadedFields = { status: els.leadStatus.value, tag: els.tagInput.value };
    suggestionBaseline = { status: els.leadStatus.value, tag: els.tagInput.value };
    rememberLastUsed(els.leadStatus.value, els.tagInput.value); // carry to next profile
    els.suggestBanner.hidden = true;
    els.wasStatus.hidden = true; els.wasStatus.innerHTML = "";
    els.wasTag.hidden = true; els.wasTag.innerHTML = "";
    els.saveFeedback.className = "save-feedback show ok";
    els.saveFeedback.textContent = "✓ Saved";
  } else {
    els.saveFeedback.className = "save-feedback show err";
    const why = r ? (r.state || "(no state field)") : "(no response from background)";
    const detail = r && r.detail ? " — " + String(r.detail).slice(0, 80) : "";
    els.saveFeedback.textContent = "Save failed: " + why + detail;
  }
  refreshSaveEnabled();
  consumePendingIfClean(); // edits resolved — load any profile held back
}

async function onAddNote() {
  const body = els.noteInput.value.trim();
  if (!lastContactId || !body) {
    refreshNoteEnabled();
    return;
  }

  els.addNote.disabled = true;
  els.noteFeedback.className = "save-feedback show";
  els.noteFeedback.textContent = "Adding…";

  let r;
  try {
    r = await chrome.runtime.sendMessage({ type: "ADD_NOTE", contactId: lastContactId, body });
  } catch (e) {
    els.noteFeedback.className = "save-feedback show err";
    els.noteFeedback.textContent = "Could not add note";
    refreshNoteEnabled();
    return;
  }

  if (r && r.state === "note_added") {
    els.noteInput.value = "";
    els.noteFeedback.className = "save-feedback show ok";
    els.noteFeedback.textContent = "Note added";
  } else {
    els.noteFeedback.className = "save-feedback show err";
    els.noteFeedback.textContent = OrtusPopupLogic.noteErrorText(
      r,
      fieldsErrorText(r && r.state)
    );
  }
  refreshNoteEnabled();
  consumePendingIfClean();
}

async function loadState() {
  render({ state: "scraping" });
  const r = await chrome.runtime.sendMessage({ type: "GET_PROFILE_STATE" });
  render(r);
  try {
    const vn = r && r.scrape && r.scrape._debug && r.scrape._debug.voyager && r.scrape._debug.voyager.name;
    lastVoyName = vn ? `${vn.matched || "?"}/f:${vn.f || "n"}/l:${vn.l || "n"}` : "-";
  } catch (e) { lastVoyName = "-"; }
  setNavDiag(shownSlug, "after-load");
}

async function onPushClick() {
  if (!lastScrape) return;
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({ type: "PUSH_TO_HUBSPOT", scrape: lastScrape });
  render(r);
}

async function onUpdateClick() {
  if (!lastScrape || !lastContactId) return;
  if (manualDirty()) {
    const feedback = els.noteInput.value.trim() ? els.noteFeedback : els.saveFeedback;
    feedback.className = "save-feedback show err";
    feedback.textContent = "Save or clear pending edits before updating";
    return;
  }
  render({ state: "checking" });
  const r = await chrome.runtime.sendMessage({
    type: "UPDATE_CONTACT",
    contactId: lastContactId,
    scrape: lastScrape,
    contactProperties: lastContactProperties,
  });
  render(r);
}

// ── Side-panel navigation tracking ──
// We follow the active tab's URL: tab.url reflects LinkedIn's pushState (in-tab
// profile→profile clicks) AND browser-tab switches, so watching it catches both
// without any content-script or webNavigation permission. Only a genuinely
// different profile triggers a re-read; anything else leaves the panel as-is.
function profileSlugFromUrl(url) {
  const m = /https?:\/\/[^/]*linkedin\.com\/in\/([^/?#]+)/i.exec(url || "");
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

async function activeTabUrl() {
  try {
    // Pin to THIS panel's window when we know it — currentWindow is unreliable
    // from a persistent side-panel context. Falls back to currentWindow if the
    // window id couldn't be resolved.
    const q = panelWindowId != null
      ? { active: true, windowId: panelWindowId }
      : { active: true, currentWindow: true };
    const [tab] = await chrome.tabs.query(q);
    return tab ? tab.url || "" : "";
  } catch (e) {
    return "";
  }
}

// TEMP DIAGNOSTIC (v0.1.43): a live line at the bottom of the panel showing what
// the nav tracker actually sees, so a single screenshot is conclusive if the
// auto-update still misbehaves. Strip once confirmed working.
function setNavDiag(polled, action) {
  let el = document.getElementById("navDiag");
  if (!el) {
    el = document.createElement("div");
    el.id = "navDiag";
    el.style.cssText =
      "font-family:var(--mono);font-size:9px;line-height:1.4;color:#A39B89;white-space:pre-wrap;" +
      "padding:4px 20px;background:#F1ECDF;border-top:1px solid #E5DFD0;word-break:break-all;";
    document.body.appendChild(el);
  }
  el.textContent =
    `nav · polled:${polled || "∅"} shown:${shownSlug || "∅"} ` +
    `dirty:${manualDirty() ? "y" : "n"} win:${panelWindowId == null ? "?" : panelWindowId} → ${action || "—"}` +
    `\nname rendered:"${(els.headline.textContent || "").trim().slice(0, 28)}" voy:${lastVoyName}`;
}

// The single decision point, honoring the sticky + edit-safe rules.
async function syncToActiveTab() {
  if (syncing) return;
  syncing = true;
  let polled = "", action = "";
  try {
    polled = profileSlugFromUrl(await activeTabUrl());
    if (!polled) { action = "skip:non-profile"; return; }   // sticky — keep last
    if (polled === shownSlug) { action = "skip:same"; return; }
    if (manualDirty()) {                                     // edit-safe — hold (manual edits only)
      pendingSlug = polled;
      const feedback = els.noteInput.value.trim() ? els.noteFeedback : els.saveFeedback;
      feedback.className = "save-feedback show";
      feedback.textContent = "Newer profile open — save or clear to switch";
      action = "hold:dirty";
      return;
    }
    pendingSlug = "";
    shownSlug = polled;
    action = "load:" + polled;
    loadState();                                            // fire-and-forget
  } finally {
    syncing = false;
    setNavDiag(polled, action);
  }
}

// Once edits resolve (saved, or reverted to clean) pick up a profile that the
// edit-safe rule held back.
function consumePendingIfClean() {
  if (pendingSlug && !manualDirty()) syncToActiveTab();
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

// ── Manage block (lead status + tag) ──
els.leadStatus.addEventListener("change", () => {
  els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = "";
  refreshSaveEnabled();
  consumePendingIfClean(); // reverted to clean → load any profile held back
});
els.tagInput.addEventListener("input", () => {
  els.saveFeedback.className = "save-feedback"; els.saveFeedback.textContent = "";
  refreshSaveEnabled();
  consumePendingIfClean(); // reverted to clean → load any profile held back
});
els.saveFields.addEventListener("click", onSaveFields);
els.noteInput.addEventListener("input", () => {
  els.noteFeedback.className = "save-feedback";
  els.noteFeedback.textContent = "";
  refreshNoteEnabled();
  consumePendingIfClean();
});
els.addNote.addEventListener("click", onAddNote);
els.suggestRevert.addEventListener("click", revertSuggestion);
els.carryToggle.addEventListener("change", () => {
  carryEnabled = els.carryToggle.checked;
  try { chrome.storage.local.set({ carryLastUsed: carryEnabled }); } catch (e) {}
});

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

function setUpdateFeedback(text, state = "") {
  els.updateFeedback.className = "update-feedback" + (state ? ` ${state}` : "");
  els.updateFeedback.textContent = text;
}

async function checkForExtensionUpdate() {
  if (readyUpdateVersion) {
    setUpdateFeedback(`Installing v${readyUpdateVersion}…`, "ok");
    chrome.runtime.reload();
    return;
  }

  els.checkUpdateBtn.disabled = true;
  installUpdateWhenReady = true;
  setUpdateFeedback("Checking…");

  try {
    const result = await chrome.runtime.requestUpdateCheck();
    if (result.status === "update_available") {
      setUpdateFeedback(`Downloading v${result.version || "new"}…`, "ok");
      return;
    }

    installUpdateWhenReady = false;
    if (result.status === "throttled") {
      setUpdateFeedback("Chrome will check automatically", "ok");
    } else {
      setUpdateFeedback("You have the latest version", "ok");
    }
  } catch (e) {
    installUpdateWhenReady = false;
    const message = String((e && e.message) || e).toLowerCase();
    setUpdateFeedback(
      message.includes("unpacked") || message.includes("update url")
        ? "Packaged updates unavailable in developer mode"
        : "Update check failed",
      "err"
    );
  } finally {
    if (!installUpdateWhenReady) els.checkUpdateBtn.disabled = false;
  }
}

els.checkUpdateBtn.addEventListener("click", checkForExtensionUpdate);

try {
  chrome.runtime.onUpdateAvailable.addListener((details) => {
    readyUpdateVersion = details && details.version ? details.version : "new";
    if (installUpdateWhenReady) {
      setUpdateFeedback(`Installing v${readyUpdateVersion}…`, "ok");
      setTimeout(() => chrome.runtime.reload(), 250);
      return;
    }
    els.checkUpdateBtn.disabled = false;
    els.checkUpdateBtn.textContent = `Install v${readyUpdateVersion}`;
    setUpdateFeedback("Update ready", "ok");
  });
} catch (e) { /* runtime update events unavailable */ }

// Show the actual manifest version in the footer so reloads are visible at a glance.
document.addEventListener("DOMContentLoaded", () => {
  try {
    const v = chrome.runtime.getManifest().version;
    els.installedVersion.textContent = `v${v}`;
    const labels = document.querySelectorAll(".footer span");
    if (labels.length >= 2) labels[labels.length - 1].textContent = `v${v}`;
  } catch (e) { /* ignore */ }
  bootstrap();
});

// Load the remembered last-used values + toggle BEFORE the first render, so the
// very first profile can carry them over.
async function loadPrefs() {
  try {
    const got = await chrome.storage.local.get(["lastUsed", "carryLastUsed"]);
    if (got && got.lastUsed && typeof got.lastUsed === "object") {
      lastUsed = { status: got.lastUsed.status || "", tag: got.lastUsed.tag || "" };
    }
    carryEnabled = got && typeof got.carryLastUsed === "boolean" ? got.carryLastUsed : true;
  } catch (e) {
    carryEnabled = true;
  }
  if (els.carryToggle) els.carryToggle.checked = carryEnabled;
}

async function bootstrap() {
  // Pin to the window this panel is docked in, so tab queries can't drift to
  // another window or go stale in the persistent panel context.
  try {
    const w = await chrome.windows.getCurrent();
    panelWindowId = w && w.id != null ? w.id : null;
  } catch (e) {
    panelWindowId = null;
  }

  await loadPrefs(); // last-used + toggle must be ready before the first render

  // Read whatever profile is already open when the panel launches (or idle).
  shownSlug = profileSlugFromUrl(await activeTabUrl());
  loadState();

  // Event-driven detection (reliable — no dependency on poll snapshots):
  //  • onUpdated fires on a URL change in the active tab, INCLUDING LinkedIn's
  //    in-tab SPA pushState (profile→profile clicks) — this is the case the old
  //    poll missed, which left the panel stuck on the previously-pushed person.
  //  • onActivated fires when the operator switches browser tabs.
  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (!tab || !tab.active) return;
      if (panelWindowId != null && tab.windowId !== panelWindowId) return;
      if (changeInfo.url || changeInfo.status === "complete") syncToActiveTab();
    });
  } catch (e) {}
  try {
    chrome.tabs.onActivated.addListener((info) => {
      if (panelWindowId == null || info.windowId === panelWindowId) syncToActiveTab();
    });
  } catch (e) {}

  // Backstop poll in case an event is ever missed (slow — events do the work).
  setInterval(() => syncToActiveTab(), 1500);
}
