# State of Innovation — Phase 1B (Bet Detail Sidebar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the narrative-fields layer to the State of Innovation script — a hidden `BetDetail` sheet that stores Hypothesis / Kill criteria / Evidence link / Decision log per row, an HTML sidebar that displays and edits those fields, a modal that auto-prompts for a reason on meaningful status transitions, and a soft toast when an Idea gets promoted without a hypothesis.

**Architecture:** All changes in the single file `Projects/HS Extension/StateOfInnovationDashboard.js` (~1200 lines as of `soi-phase-1a`). New `BetDetail` hidden sheet keyed by `innovationKey` (the Innovation cell value). HTML sidebar + modal HTML strings inlined as JavaScript template functions to keep the deployment a single file. Sidebar reads via `google.script.run.getBetDetailFor(name)`, writes via `saveBetDetailFor(name, fields)`. Decision log is JSON-encoded array stored in one cell. Innovation rename hook in `onEdit` re-keys the BetDetail row.

**Tech Stack:** Google Apps Script (V8 runtime), `HtmlService.createHtmlOutput`, `google.script.run` for sidebar↔server messaging. Tests are runnable Apps Script functions whose results land in `Logger`.

**Reference spec:** `docs/superpowers/specs/2026-05-02-state-of-innovation-redesign-design.md` §3.3, §4.4, §4.5, §6.2, §6.3, §7 (Phase 1, narrative-fields portion).

**Working file** (relative to repo root): `Projects/HS Extension/StateOfInnovationDashboard.js`

**Starting state:** v6 + `soi-phase-1a` tag.

---

## File map

All changes land in the existing single file. New top-level identifiers introduced in this phase:

| New | Kind | Purpose |
|---|---|---|
| `BET_DETAIL_SHEET_NAME` (`"_BetDetail"`) | constant | Name of the hidden support sheet |
| `BET_DETAIL_HEADERS` | constant | Column headers for the BetDetail sheet |
| `ensureBetDetailSheet_()` | helper | Creates the hidden BetDetail sheet on first use |
| `getBetDetail_(innovationKey)` | helper | Returns `{hypothesis, killCriteria, evidenceLink, decisionLog: []}` |
| `setBetDetail_(innovationKey, fields)` | helper | Upserts a BetDetail row |
| `renameBetDetailKey_(oldKey, newKey)` | helper | Updates the key when an Innovation is renamed |
| `appendDecisionLogEntry_(innovationKey, entry)` | helper | Pushes one entry onto the decision log JSON array |
| `getBetDetailFor` (server-callable) | sidebar API | `google.script.run.getBetDetailFor(name)` |
| `saveBetDetailFor` (server-callable) | sidebar API | `google.script.run.saveBetDetailFor(name, fields)` |
| `submitDecisionLogEntry` (modal API) | modal API | Modal posts new entry back via this |
| `openBetDetailSidebar()` (menu function) | UI | Opens the sidebar for the currently-selected row |
| `betDetailSidebarHtml_(innovationKey)` | helper | Returns the sidebar HTML string |
| `decisionLogModalHtml_(context)` | helper | Returns the modal HTML string |
| `MEANINGFUL_TRANSITIONS` | constant | List of status transitions that fire the decision-log modal |
| `shouldPromptDecisionLog_(oldStatus, newStatus, oldConf, newConf)` | helper | Returns truthy when a prompt should fire |
| `promptForDecisionLog_(sheet, row, transition)` | helper | Shows the modal |
| `warnHypothesisMissing_(sheet, row)` | helper | Shows the soft toast |
| `test_betDetailRoundTrip` / `test_decisionLogAppend` / `test_renameRekeysBetDetail` / `test_shouldPromptOnMeaningfulTransitionsOnly` | tests | New regression guards |

---

### Task 1: BetDetail hidden sheet + read/write helpers

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — append a `// BET DETAIL` section after the `// SETTINGS` section (around line ~750)

**Why:** The data layer for narrative fields. All later tasks depend on this. Modeled after the existing `_Settings` pattern: hidden sheet, header row, key-based lookup, idempotent `ensure` function.

- [ ] **Step 1: Add the BetDetail data module**

Find the `// GUIDE SIDEBAR` section header. Insert this block IMMEDIATELY BEFORE it:

```js
// ============================================================
// BET DETAIL — hidden sheet for narrative fields
// ============================================================

var BET_DETAIL_SHEET_NAME = "_BetDetail";
var BET_DETAIL_HEADERS = ["innovationKey", "hypothesis", "killCriteria", "evidenceLink", "decisionLogJson"];
var BD_COL = {
  key: 0,
  hypothesis: 1,
  killCriteria: 2,
  evidenceLink: 3,
  decisionLogJson: 4
};

function ensureBetDetailSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(BET_DETAIL_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(BET_DETAIL_SHEET_NAME);
    sheet.getRange(1, 1, 1, BET_DETAIL_HEADERS.length).setValues([BET_DETAIL_HEADERS])
      .setFontWeight("bold")
      .setBackground(CONFIG.colors.headerBg)
      .setFontColor(CONFIG.colors.headerFg);
    sheet.setColumnWidths(1, BET_DETAIL_HEADERS.length, 240);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }

  return sheet;
}

function getBetDetail_(innovationKey) {
  var key = clean_(innovationKey);
  if (!key) return blankBetDetail_();

  var sheet = ensureBetDetailSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return blankBetDetail_();

  var rows = sheet.getRange(2, 1, lastRow - 1, BET_DETAIL_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (clean_(rows[i][BD_COL.key]) === key) {
      return {
        innovationKey: key,
        hypothesis: clean_(rows[i][BD_COL.hypothesis]),
        killCriteria: clean_(rows[i][BD_COL.killCriteria]),
        evidenceLink: clean_(rows[i][BD_COL.evidenceLink]),
        decisionLog: parseDecisionLogJson_(rows[i][BD_COL.decisionLogJson])
      };
    }
  }
  return blankBetDetail_();
}

function setBetDetail_(innovationKey, fields) {
  var key = clean_(innovationKey);
  if (!key) return;

  var sheet = ensureBetDetailSheet_();
  var lastRow = sheet.getLastRow();

  var existing = getBetDetail_(key);
  var merged = {
    hypothesis:    fields.hypothesis    !== undefined ? fields.hypothesis    : existing.hypothesis,
    killCriteria:  fields.killCriteria  !== undefined ? fields.killCriteria  : existing.killCriteria,
    evidenceLink:  fields.evidenceLink  !== undefined ? fields.evidenceLink  : existing.evidenceLink,
    decisionLog:   fields.decisionLog   !== undefined ? fields.decisionLog   : existing.decisionLog
  };

  var newRow = [
    key,
    merged.hypothesis,
    merged.killCriteria,
    merged.evidenceLink,
    JSON.stringify(merged.decisionLog || [])
  ];

  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, BET_DETAIL_HEADERS.length).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (clean_(rows[i][BD_COL.key]) === key) {
        sheet.getRange(i + 2, 1, 1, BET_DETAIL_HEADERS.length).setValues([newRow]);
        return;
      }
    }
  }

  sheet.appendRow(newRow);
}

function appendDecisionLogEntry_(innovationKey, entry) {
  var detail = getBetDetail_(innovationKey);
  detail.decisionLog.push(entry);
  setBetDetail_(innovationKey, { decisionLog: detail.decisionLog });
}

function blankBetDetail_() {
  return { innovationKey: "", hypothesis: "", killCriteria: "", evidenceLink: "", decisionLog: [] };
}

function parseDecisionLogJson_(raw) {
  var text = clean_(raw);
  if (!text) return [];
  try {
    var parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}
```

- [ ] **Step 2: Append regression test**

Add to the `// TESTS` section at the bottom of the file:

```js

function test_betDetailRoundTrip() {
  var key = "__test_bet_" + Date.now();
  var initial = getBetDetail_(key);
  setBetDetail_(key, {
    hypothesis: "If X then Y",
    killCriteria: "Kill if Z",
    evidenceLink: "https://example.com/eval",
    decisionLog: [{ when: "2026-05-02", transition: "Idea→Working", what: "spike", who: "tester" }]
  });
  var after = getBetDetail_(key);

  var passed = initial.hypothesis === "" &&
               initial.decisionLog.length === 0 &&
               after.hypothesis === "If X then Y" &&
               after.killCriteria === "Kill if Z" &&
               after.evidenceLink === "https://example.com/eval" &&
               after.decisionLog.length === 1 &&
               after.decisionLog[0].what === "spike";

  Logger.log("test_betDetailRoundTrip: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  after = " + JSON.stringify(after));

  // Cleanup
  var sheet = SpreadsheetApp.getActive().getSheetByName(BET_DETAIL_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BET_DETAIL_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (clean_(rows[i][BD_COL.key]) === key) sheet.deleteRow(i + 2);
    }
  }
  return passed;
}

function test_decisionLogAppend() {
  var key = "__test_log_" + Date.now();
  appendDecisionLogEntry_(key, { when: "2026-05-02", transition: "→Done", what: "shipped", who: "tester" });
  appendDecisionLogEntry_(key, { when: "2026-05-03", transition: "Done→Working", what: "reopened", who: "tester" });
  var detail = getBetDetail_(key);
  var passed = detail.decisionLog.length === 2 &&
               detail.decisionLog[0].what === "shipped" &&
               detail.decisionLog[1].what === "reopened";
  Logger.log("test_decisionLogAppend: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  log = " + JSON.stringify(detail.decisionLog));

  // Cleanup
  var sheet = SpreadsheetApp.getActive().getSheetByName(BET_DETAIL_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BET_DETAIL_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (clean_(rows[i][BD_COL.key]) === key) sheet.deleteRow(i + 2);
    }
  }
  return passed;
}
```

- [ ] **Step 3: Push to Apps Script and run both tests**

In the editor, save (so the function picker re-scans), pick `test_betDetailRoundTrip` → **Run** → expect `PASS`. Then `test_decisionLogAppend` → **Run** → expect `PASS`.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add BetDetail hidden sheet + getBetDetail_/setBetDetail_/appendDecisionLogEntry_ helpers"
```

---

### Task 2: Innovation rename hook in onEdit

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — function `onEdit(e)` (around line 285)

**Why:** Without this, renaming an Innovation cell orphans its BetDetail row (the lookup key changes). This catches the rename via `e.oldValue` (Sheets provides it for single-cell edits) and re-keys the BetDetail row.

- [ ] **Step 1: Add the rename helper**

Just below `appendDecisionLogEntry_`, add:

```js
function renameBetDetailKey_(oldKey, newKey) {
  var oldClean = clean_(oldKey);
  var newClean = clean_(newKey);
  if (!oldClean || !newClean || oldClean === newClean) return;

  var sheet = ensureBetDetailSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var rows = sheet.getRange(2, 1, lastRow - 1, BET_DETAIL_HEADERS.length).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (clean_(rows[i][BD_COL.key]) === oldClean) {
      sheet.getRange(i + 2, BD_COL.key + 1).setValue(newClean);
      return;
    }
  }
}
```

- [ ] **Step 2: Wire the rename hook into onEdit**

Find:

```js
function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.source.getActiveSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row < CONFIG.dataStartRow) return;

  var innovation = clean_(sheet.getRange(row, COL.innovation + 1).getValue());
  if (!innovation || isDividerValue_(innovation)) return;

  if (isUserDataColumn_(col)) {
    updateTimestamp_(sheet, row);
  }

  if (isSortTriggerColumn_(col) && rowHasRequiredSortFields_(sheet, row)) {
    SpreadsheetApp.flush();
    groupByOwnerCore_();
  }
}
```

Replace with:

```js
function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.source.getActiveSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row < CONFIG.dataStartRow) return;

  var innovation = clean_(sheet.getRange(row, COL.innovation + 1).getValue());
  if (!innovation || isDividerValue_(innovation)) return;

  if (col === COL.innovation + 1 && e.oldValue) {
    renameBetDetailKey_(e.oldValue, e.value);
  }

  if (isUserDataColumn_(col)) {
    updateTimestamp_(sheet, row);
  }

  if (isSortTriggerColumn_(col) && rowHasRequiredSortFields_(sheet, row)) {
    SpreadsheetApp.flush();
    groupByOwnerCore_();
  }
}
```

- [ ] **Step 3: Append the regression test**

Add to TESTS:

```js

function test_renameRekeysBetDetail() {
  var oldKey = "__test_old_" + Date.now();
  var newKey = "__test_new_" + Date.now();
  setBetDetail_(oldKey, { hypothesis: "carry-over" });

  renameBetDetailKey_(oldKey, newKey);

  var oldDetail = getBetDetail_(oldKey);
  var newDetail = getBetDetail_(newKey);

  var passed = oldDetail.hypothesis === "" && newDetail.hypothesis === "carry-over";

  Logger.log("test_renameRekeysBetDetail: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  oldDetail.hypothesis=" + oldDetail.hypothesis + " newDetail.hypothesis=" + newDetail.hypothesis);

  // Cleanup
  var sheet = SpreadsheetApp.getActive().getSheetByName(BET_DETAIL_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, BET_DETAIL_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      var k = clean_(rows[i][BD_COL.key]);
      if (k === newKey || k === oldKey) sheet.deleteRow(i + 2);
    }
  }
  return passed;
}
```

- [ ] **Step 4: Run the test → expect PASS**

- [ ] **Step 5: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Re-key BetDetail when Innovation cell is renamed via onEdit"
```

---

### Task 3: HTML sidebar — read-only display

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — append a `// BET DETAIL SIDEBAR` section after the BET DETAIL helpers (around line ~870), and add a menu item in `onOpen`

**Why:** Get the sidebar opening + showing data first. Editing comes in Task 4. Splitting reduces the surface area per commit.

- [ ] **Step 1: Add the sidebar opener + HTML template**

Insert just after the `parseDecisionLogJson_` function (end of BET DETAIL section):

```js
// ============================================================
// BET DETAIL SIDEBAR
// ============================================================

function openBetDetailSidebar() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range) {
    SpreadsheetApp.getUi().alert("Pick a row first, then open Bet Detail.");
    return;
  }

  var row = range.getRow();
  if (row < CONFIG.dataStartRow) {
    SpreadsheetApp.getUi().alert("Click a data row (not the header) before opening Bet Detail.");
    return;
  }

  var innovation = clean_(sheet.getRange(row, COL.innovation + 1).getValue());
  if (!innovation || isDividerValue_(innovation)) {
    SpreadsheetApp.getUi().alert("Pick a real bet row (not a divider or blank).");
    return;
  }

  var html = HtmlService.createHtmlOutput(betDetailSidebarHtml_(innovation))
    .setTitle("Bet Detail")
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

function getBetDetailFor(innovationKey) {
  return getBetDetail_(innovationKey);
}

function betDetailSidebarHtml_(innovationKey) {
  var safeKey = innovationKey.replace(/"/g, "&quot;");
  return '' +
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    '  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0a0a0a;background:#fafafa;margin:0;padding:18px;}' +
    '  h2{font-size:18px;margin:0 0 4px;letter-spacing:-0.01em;}' +
    '  .key{font-size:10px;color:#999;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:18px;}' +
    '  .field{margin-bottom:18px;}' +
    '  .label{font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;}' +
    '  .label .helper{font-weight:500;color:#c93b34;letter-spacing:0.04em;text-transform:none;font-size:10px;}' +
    '  .body{font-size:12px;line-height:1.5;color:#0a0a0a;background:#fff;padding:10px 12px;border:1px solid rgba(0,0,0,0.1);min-height:32px;white-space:pre-wrap;word-wrap:break-word;}' +
    '  .body.empty{color:#999;font-style:italic;}' +
    '  .body.kill{border-left:3px solid #c93b34;}' +
    '  .ev a{color:#0a0a0a;font-weight:600;text-decoration:none;border-bottom:1px solid #0a0a0a;}' +
    '  .ev a::after{content:" ↗";font-weight:400;}' +
    '  .log .entry{padding:8px 0;border-bottom:1px dashed rgba(0,0,0,0.1);font-size:11px;}' +
    '  .log .entry:last-child{border-bottom:0;}' +
    '  .log .when{font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#999;}' +
    '  .log .what{color:#0a0a0a;}' +
    '  .log .who{color:#666;}' +
    '  .log .empty{color:#999;font-style:italic;font-size:11px;padding:8px 0;}' +
    '</style>' +
    '</head><body>' +
    '<h2 id="bet-name"></h2>' +
    '<div class="key" id="bet-key"></div>' +
    '<div class="field"><div class="label">Hypothesis <span class="helper">required to leave Idea</span></div><div class="body" id="hypothesis"></div></div>' +
    '<div class="field"><div class="label">Kill criteria</div><div class="body kill" id="killCriteria"></div></div>' +
    '<div class="field ev"><div class="label">Evidence / eval link</div><div class="body" id="evidenceLink"></div></div>' +
    '<div class="field log"><div class="label">Decision log</div><div id="decisionLog"></div></div>' +
    '<script>' +
    '  var KEY = "' + safeKey + '";' +
    '  document.getElementById("bet-name").textContent = KEY;' +
    '  document.getElementById("bet-key").textContent = KEY.length > 0 ? "Bet" : "";' +
    '  google.script.run' +
    '    .withSuccessHandler(render)' +
    '    .withFailureHandler(function(e){ document.body.innerHTML = "<p>Error loading: " + e.message + "</p>"; })' +
    '    .getBetDetailFor(KEY);' +
    '  function render(detail){' +
    '    setField("hypothesis", detail.hypothesis);' +
    '    setField("killCriteria", detail.killCriteria);' +
    '    setEvidence(detail.evidenceLink);' +
    '    renderLog(detail.decisionLog);' +
    '  }' +
    '  function setField(id, value){' +
    '    var el = document.getElementById(id);' +
    '    if (!value || value.trim() === ""){ el.classList.add("empty"); el.textContent = "(not set)"; }' +
    '    else { el.classList.remove("empty"); el.textContent = value; }' +
    '  }' +
    '  function setEvidence(value){' +
    '    var el = document.getElementById("evidenceLink");' +
    '    if (!value || value.trim() === ""){ el.classList.add("empty"); el.textContent = "(no link)"; return; }' +
    '    el.classList.remove("empty");' +
    '    el.innerHTML = "<a href=\\"" + value + "\\" target=\\"_blank\\">" + value + "</a>";' +
    '  }' +
    '  function renderLog(entries){' +
    '    var el = document.getElementById("decisionLog");' +
    '    if (!entries || entries.length === 0){ el.innerHTML = "<div class=\\"empty\\">No decisions logged yet.</div>"; return; }' +
    '    el.innerHTML = entries.map(function(e){' +
    '      return "<div class=\\"entry\\"><div class=\\"when\\">" + (e.when || "") + " · " + (e.transition || "") + "</div>" +' +
    '             "<div class=\\"what\\">" + (e.what || "") + "</div>" +' +
    '             (e.who ? "<div class=\\"who\\">— " + e.who + "</div>" : "") + "</div>";' +
    '    }).join("");' +
    '  }' +
    '</script></body></html>';
}
```

- [ ] **Step 2: Add the menu item**

In `onOpen`, find:

```js
    .addItem("Move completed to Done section", "consolidateDoneSection")
    .addSeparator()
```

Replace with:

```js
    .addItem("Move completed to Done section", "consolidateDoneSection")
    .addSeparator()
    .addItem("Open Bet Detail for selected row", "openBetDetailSidebar")
    .addSeparator()
```

- [ ] **Step 3: Manual smoke test**

Push to Apps Script, reload sheet. Click any data row → menu **State of Innovation → Open Bet Detail for selected row**. Verify:
1. Sidebar opens on the right at 360px wide.
2. The Innovation name shows as the title at the top.
3. Hypothesis / Kill criteria / Evidence link / Decision log fields show placeholder "(not set)" / "(no link)" / "No decisions logged yet."
4. Clicking the menu item without a row selected → alert "Pick a row first."
5. Clicking the menu item on a divider row → alert "Pick a real bet row."

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add Bet Detail HTML sidebar (read-only) + openBetDetailSidebar menu item"
```

---

### Task 4: Sidebar editing — save fields back to BetDetail

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — extend `betDetailSidebarHtml_` to include editable inputs + save button, add `saveBetDetailFor(innovationKey, fields)` server function

**Why:** Read-only is one half. Editing closes the loop and makes the sidebar useful.

- [ ] **Step 1: Add the server-callable save function**

Just below `getBetDetailFor`, add:

```js
function saveBetDetailFor(innovationKey, fields) {
  setBetDetail_(innovationKey, {
    hypothesis:   fields.hypothesis,
    killCriteria: fields.killCriteria,
    evidenceLink: fields.evidenceLink
  });
  return getBetDetail_(innovationKey);
}
```

(Note: `decisionLog` is intentionally not editable from this surface — only the modal in Task 6 can append entries. Keeps the audit trail honest.)

- [ ] **Step 2: Replace the sidebar HTML to include editable form + save button**

Replace the entire `betDetailSidebarHtml_` function from Task 3 with:

```js
function betDetailSidebarHtml_(innovationKey) {
  var safeKey = innovationKey.replace(/"/g, "&quot;");
  return '' +
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    '  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0a0a0a;background:#fafafa;margin:0;padding:18px;}' +
    '  h2{font-size:18px;margin:0 0 4px;letter-spacing:-0.01em;}' +
    '  .key{font-size:10px;color:#999;letter-spacing:0.16em;text-transform:uppercase;margin-bottom:18px;}' +
    '  .field{margin-bottom:18px;}' +
    '  .label{font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;}' +
    '  .label .helper{font-weight:500;color:#c93b34;letter-spacing:0.04em;text-transform:none;font-size:10px;}' +
    '  textarea{width:100%;font-family:inherit;font-size:12px;line-height:1.5;color:#0a0a0a;background:#fff;padding:10px 12px;border:1px solid rgba(0,0,0,0.15);box-sizing:border-box;resize:vertical;min-height:60px;}' +
    '  textarea:focus{outline:none;border-color:#0a0a0a;}' +
    '  textarea.kill{border-left:3px solid #c93b34;}' +
    '  input[type=text]{width:100%;font-family:inherit;font-size:12px;color:#0a0a0a;background:#fff;padding:8px 12px;border:1px solid rgba(0,0,0,0.15);box-sizing:border-box;}' +
    '  input[type=text]:focus{outline:none;border-color:#0a0a0a;}' +
    '  .actions{display:flex;gap:8px;margin-top:24px;align-items:center;}' +
    '  button.save{background:#0a0a0a;color:#F7BE68;border:1px solid #0a0a0a;font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;padding:10px 20px;cursor:pointer;}' +
    '  button.save[disabled]{opacity:0.5;cursor:default;}' +
    '  .status{font-size:11px;color:#666;}' +
    '  .log .entry{padding:8px 0;border-bottom:1px dashed rgba(0,0,0,0.1);font-size:11px;}' +
    '  .log .entry:last-child{border-bottom:0;}' +
    '  .log .when{font-size:9px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#999;}' +
    '  .log .what{color:#0a0a0a;}' +
    '  .log .who{color:#666;}' +
    '  .log .empty{color:#999;font-style:italic;font-size:11px;padding:8px 0;}' +
    '</style>' +
    '</head><body>' +
    '<h2 id="bet-name"></h2>' +
    '<div class="key">Bet</div>' +
    '<div class="field"><div class="label">Hypothesis <span class="helper">required to leave Idea</span></div><textarea id="hypothesis" rows="3"></textarea></div>' +
    '<div class="field"><div class="label">Kill criteria</div><textarea id="killCriteria" class="kill" rows="3"></textarea></div>' +
    '<div class="field"><div class="label">Evidence / eval link</div><input type="text" id="evidenceLink" placeholder="https://…"></div>' +
    '<div class="field log"><div class="label">Decision log <span class="helper">auto-populated on status changes</span></div><div id="decisionLog"></div></div>' +
    '<div class="actions"><button class="save" id="save-btn">Save</button><span class="status" id="status"></span></div>' +
    '<script>' +
    '  var KEY = "' + safeKey + '";' +
    '  document.getElementById("bet-name").textContent = KEY;' +
    '  google.script.run' +
    '    .withSuccessHandler(render)' +
    '    .withFailureHandler(function(e){ document.body.innerHTML = "<p>Error loading: " + e.message + "</p>"; })' +
    '    .getBetDetailFor(KEY);' +
    '  function render(detail){' +
    '    document.getElementById("hypothesis").value = detail.hypothesis || "";' +
    '    document.getElementById("killCriteria").value = detail.killCriteria || "";' +
    '    document.getElementById("evidenceLink").value = detail.evidenceLink || "";' +
    '    renderLog(detail.decisionLog);' +
    '  }' +
    '  function renderLog(entries){' +
    '    var el = document.getElementById("decisionLog");' +
    '    if (!entries || entries.length === 0){ el.innerHTML = "<div class=\\"empty\\">No decisions logged yet.</div>"; return; }' +
    '    el.innerHTML = entries.map(function(e){' +
    '      return "<div class=\\"entry\\"><div class=\\"when\\">" + (e.when || "") + " · " + (e.transition || "") + "</div>" +' +
    '             "<div class=\\"what\\">" + (e.what || "") + "</div>" +' +
    '             (e.who ? "<div class=\\"who\\">— " + e.who + "</div>" : "") + "</div>";' +
    '    }).join("");' +
    '  }' +
    '  document.getElementById("save-btn").addEventListener("click", function(){' +
    '    var btn = this; btn.disabled = true;' +
    '    var status = document.getElementById("status"); status.textContent = "Saving…";' +
    '    var fields = {' +
    '      hypothesis: document.getElementById("hypothesis").value,' +
    '      killCriteria: document.getElementById("killCriteria").value,' +
    '      evidenceLink: document.getElementById("evidenceLink").value' +
    '    };' +
    '    google.script.run' +
    '      .withSuccessHandler(function(detail){ render(detail); status.textContent = "Saved."; btn.disabled = false; setTimeout(function(){ status.textContent = ""; }, 2000); })' +
    '      .withFailureHandler(function(e){ status.textContent = "Error: " + e.message; btn.disabled = false; })' +
    '      .saveBetDetailFor(KEY, fields);' +
    '  });' +
    '</script></body></html>';
}
```

- [ ] **Step 3: Manual smoke test**

Push, reload sheet. Pick a row → **Open Bet Detail**. Verify:
1. Hypothesis / Kill criteria / Evidence link fields are now editable textareas/input.
2. Type something in Hypothesis, click **Save** → "Saving…" → "Saved." → status clears after 2s.
3. Close sidebar, reopen on the same row → values persist.
4. Open sidebar on a DIFFERENT row → fields show that row's values (or blank).
5. Bet name in the header reads correctly.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Make Bet Detail sidebar fields editable + save back to BetDetail"
```

---

### Task 5: Decision log modal — transition detection + storage

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — extend `onEdit`, add `MEANINGFUL_TRANSITIONS` constant + `shouldPromptDecisionLog_` + `promptForDecisionLog_` + `submitDecisionLogEntry` + modal HTML + test

**Why:** Captures *why* a status flipped, not just that it did. The bigger task — decision log entries are the core "discipline" feature of this phase.

- [ ] **Step 1: Add constants + transition detector**

Just below `STATUSES_EXEMPT_FROM_STALE`, add:

```js
var MEANINGFUL_TRANSITIONS_TO = [STATUS.DONE, STATUS.PAUSED, STATUS.FIXING, STATUS.WAITING];
```

In the HELPERS section (just before `clean_`), add:

```js
function shouldPromptDecisionLog_(oldStatus, newStatus, oldConfidencePercent, newConfidencePercent) {
  var prevStatus = clean_(oldStatus);
  var nextStatus = clean_(newStatus);

  if (prevStatus !== nextStatus) {
    if (MEANINGFUL_TRANSITIONS_TO.indexOf(nextStatus) !== -1) return true;
    if (prevStatus === STATUS.IDEA && nextStatus === STATUS.WORKING) return true;
  }

  if (oldConfidencePercent != null && newConfidencePercent != null &&
      oldConfidencePercent - newConfidencePercent >= 20) {
    return true;
  }

  return false;
}
```

- [ ] **Step 2: Add the modal HTML + opener + submit handler**

Insert just below `betDetailSidebarHtml_` (end of BET DETAIL SIDEBAR section):

```js
function promptForDecisionLog_(innovationKey, transitionLabel) {
  var html = HtmlService.createHtmlOutput(decisionLogModalHtml_(innovationKey, transitionLabel))
    .setWidth(420)
    .setHeight(320);
  SpreadsheetApp.getUi().showModalDialog(html, "Why this change?");
}

function submitDecisionLogEntry(innovationKey, what) {
  var who = "";
  try { who = Session.getActiveUser().getEmail() || ""; } catch (e) { who = ""; }
  var when = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  appendDecisionLogEntry_(innovationKey, {
    when: when,
    transition: "(see context)",
    what: clean_(what),
    who: who
  });
  return true;
}

function decisionLogModalHtml_(innovationKey, transitionLabel) {
  var safeKey = innovationKey.replace(/"/g, "&quot;");
  var safeTrans = (transitionLabel || "").replace(/"/g, "&quot;");
  return '' +
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    '  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0a0a0a;background:#fafafa;margin:0;padding:20px;}' +
    '  .eyebrow{font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999;margin-bottom:4px;}' +
    '  h2{font-size:18px;margin:0 0 4px;line-height:1.2;}' +
    '  .meta{font-size:11px;color:#666;margin-bottom:14px;}' +
    '  textarea{width:100%;font-family:inherit;font-size:12px;line-height:1.5;color:#0a0a0a;background:#fff;padding:10px 12px;border:1px solid rgba(0,0,0,0.15);box-sizing:border-box;resize:vertical;min-height:90px;}' +
    '  textarea:focus{outline:none;border-color:#0a0a0a;}' +
    '  .actions{display:flex;gap:8px;margin-top:14px;justify-content:flex-end;}' +
    '  button{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:9px 18px;cursor:pointer;border:1px solid #0a0a0a;background:#fff;color:#0a0a0a;}' +
    '  button.primary{background:#0a0a0a;color:#F7BE68;}' +
    '  button[disabled]{opacity:0.5;cursor:default;}' +
    '  .status{font-size:10px;color:#666;margin-right:auto;}' +
    '</style></head><body>' +
    '<div class="eyebrow">Decision log entry</div>' +
    '<h2 id="bet-name"></h2>' +
    '<div class="meta" id="trans"></div>' +
    '<textarea id="what" placeholder="One line on why — kept short, but visible to anyone reading this row later."></textarea>' +
    '<div class="actions"><span class="status" id="status"></span><button id="skip">Skip this one</button><button class="primary" id="save">Save entry</button></div>' +
    '<script>' +
    '  var KEY = "' + safeKey + '";' +
    '  var TRANS = "' + safeTrans + '";' +
    '  document.getElementById("bet-name").textContent = KEY;' +
    '  document.getElementById("trans").textContent = TRANS;' +
    '  document.getElementById("save").addEventListener("click", function(){' +
    '    var btn = this; btn.disabled = true;' +
    '    var status = document.getElementById("status"); status.textContent = "Saving…";' +
    '    google.script.run' +
    '      .withSuccessHandler(function(){ google.script.host.close(); })' +
    '      .withFailureHandler(function(e){ status.textContent = "Error: " + e.message; btn.disabled = false; })' +
    '      .submitDecisionLogEntry(KEY, document.getElementById("what").value);' +
    '  });' +
    '  document.getElementById("skip").addEventListener("click", function(){' +
    '    google.script.run' +
    '      .withSuccessHandler(function(){ google.script.host.close(); })' +
    '      .submitDecisionLogEntry(KEY, "(no reason given)");' +
    '  });' +
    '</script></body></html>';
}
```

- [ ] **Step 3: Wire transition detection into onEdit**

Find:

```js
  if (col === COL.innovation + 1 && e.oldValue) {
    renameBetDetailKey_(e.oldValue, e.value);
  }

  if (isUserDataColumn_(col)) {
    updateTimestamp_(sheet, row);
  }
```

Replace with:

```js
  if (col === COL.innovation + 1 && e.oldValue) {
    renameBetDetailKey_(e.oldValue, e.value);
  }

  if (col === COL.status + 1 && e.oldValue !== undefined && e.value !== undefined) {
    if (shouldPromptDecisionLog_(e.oldValue, e.value, null, null)) {
      var transition = clean_(e.oldValue) + " → " + clean_(e.value);
      promptForDecisionLog_(innovation, transition);
    }
  }

  if (col === COL.confidence + 1 && e.oldValue !== undefined && e.value !== undefined) {
    var oldPct = parseConfidencePercent_(e.oldValue);
    var newPct = parseConfidencePercent_(e.value);
    if (shouldPromptDecisionLog_("", "", oldPct, newPct)) {
      promptForDecisionLog_(innovation, "Confidence " + oldPct + "% → " + newPct + "%");
    }
  }

  if (isUserDataColumn_(col)) {
    updateTimestamp_(sheet, row);
  }
```

- [ ] **Step 4: Append regression test**

Add to TESTS:

```js

function test_shouldPromptOnMeaningfulTransitionsOnly() {
  var cases = [
    { o: STATUS.WORKING, n: STATUS.DONE,    expect: true,  why: "→ Done is meaningful" },
    { o: STATUS.WORKING, n: STATUS.PAUSED,  expect: true,  why: "→ Paused is meaningful" },
    { o: STATUS.WORKING, n: STATUS.FIXING,  expect: true,  why: "→ Fixing is meaningful" },
    { o: STATUS.WORKING, n: STATUS.WAITING, expect: true,  why: "→ Waiting is meaningful" },
    { o: STATUS.IDEA,    n: STATUS.WORKING, expect: true,  why: "Idea → Working is meaningful" },
    { o: STATUS.WORKING, n: STATUS.TESTING, expect: false, why: "Working → Testing is routine" },
    { o: STATUS.ABOUT,   n: STATUS.WORKING, expect: false, why: "About → Working is routine" },
    { o: STATUS.WORKING, n: STATUS.WORKING, expect: false, why: "no change at all" }
  ];

  var allPass = true;
  cases.forEach(function(c) {
    var got = shouldPromptDecisionLog_(c.o, c.n, null, null);
    if (got !== c.expect) {
      Logger.log("  FAIL: " + c.o + " → " + c.n + " expected " + c.expect + " got " + got + " (" + c.why + ")");
      allPass = false;
    }
  });

  // Confidence drop ≥ 20 pts triggers
  var confDrop = shouldPromptDecisionLog_("", "", 70, 50);
  var confSmallDrop = shouldPromptDecisionLog_("", "", 70, 60);
  var confRise = shouldPromptDecisionLog_("", "", 30, 70);
  if (!confDrop) { Logger.log("  FAIL: 70→50 conf drop should prompt"); allPass = false; }
  if (confSmallDrop) { Logger.log("  FAIL: 70→60 conf small drop should NOT prompt"); allPass = false; }
  if (confRise) { Logger.log("  FAIL: 30→70 conf rise should NOT prompt"); allPass = false; }

  Logger.log("test_shouldPromptOnMeaningfulTransitionsOnly: " + (allPass ? "PASS" : "FAIL"));
  return allPass;
}
```

- [ ] **Step 5: Run the test → expect PASS**

- [ ] **Step 6: Manual smoke test**

In real sheet:
1. Pick a row that's currently "Working." Change Status to "Done." Verify the modal pops with the bet name + "Working → Done" + a textarea.
2. Type "shipped to internal users" → click **Save entry**. Modal closes.
3. Open the Bet Detail sidebar on that row. Decision log shows the new entry: today's date · `(see context)` · "shipped to internal users".
4. Change Status to "Working" then to "Testing" → no modal (Working → Testing is routine).
5. Change Confidence on a row from 70% → 50% → modal pops with "Confidence 70% → 50%" → save or skip.

- [ ] **Step 7: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Auto-prompt decision log on meaningful status + confidence transitions"
```

---

### Task 6: Soft hypothesis warning on Idea → other status

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — extend the `onEdit` status handler, add `warnHypothesisMissing_` helper

**Why:** Spec §4.5: when a user promotes an Idea to Working (or any other state), warn (don't block) if no Hypothesis is set. Soft toast — never blocks.

- [ ] **Step 1: Add the warning helper**

Insert in the BET DETAIL SIDEBAR section, just below `submitDecisionLogEntry`:

```js
function warnHypothesisMissing_(innovationKey) {
  var detail = getBetDetail_(innovationKey);
  if (clean_(detail.hypothesis) !== "") return;
  var msg = "Heads up: \"" + innovationKey + "\" doesn't have a hypothesis yet. Open Bet Detail to add one.";
  toast_(msg);
}
```

- [ ] **Step 2: Wire it into onEdit**

Find the status transition block (just added in Task 5):

```js
  if (col === COL.status + 1 && e.oldValue !== undefined && e.value !== undefined) {
    if (shouldPromptDecisionLog_(e.oldValue, e.value, null, null)) {
      var transition = clean_(e.oldValue) + " → " + clean_(e.value);
      promptForDecisionLog_(innovation, transition);
    }
  }
```

Replace with:

```js
  if (col === COL.status + 1 && e.oldValue !== undefined && e.value !== undefined) {
    if (clean_(e.oldValue) === STATUS.IDEA && clean_(e.value) !== STATUS.IDEA) {
      warnHypothesisMissing_(innovation);
    }
    if (shouldPromptDecisionLog_(e.oldValue, e.value, null, null)) {
      var transition = clean_(e.oldValue) + " → " + clean_(e.value);
      promptForDecisionLog_(innovation, transition);
    }
  }
```

(Order matters: warn first, then prompt for decision log. The toast and the modal can both appear without conflict.)

- [ ] **Step 3: Manual smoke test**

In real sheet:
1. Pick a row whose Status = "Idea" and whose Hypothesis is empty. Change Status to "Working."
2. Verify a yellow toast appears: `Heads up: "<bet name>" doesn't have a hypothesis yet. Open Bet Detail to add one.` — visible for ~5 seconds.
3. Verify the row was NOT blocked from changing — Status really did change to Working.
4. Repeat with a row that has a Hypothesis already set → toast does NOT appear.
5. Repeat the Idea → Working transition AND a decision log prompt is also expected (Task 5 contract). Both fire — toast first, then modal.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Soft toast: warn when Idea row leaves Idea without a hypothesis set"
```

---

### Task 7: Wire BetDetail cleanup on Innovation deletion

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — extend `renameBetDetailKey_` semantics OR add a separate `deleteBetDetail_` invoked when Innovation cell becomes empty

**Why:** If a user clears an Innovation cell (deletes the bet), its BetDetail row becomes orphaned forever. Small but worth handling.

- [ ] **Step 1: Add the delete helper**

Below `renameBetDetailKey_`, add:

```js
function deleteBetDetail_(innovationKey) {
  var key = clean_(innovationKey);
  if (!key) return;

  var sheet = ensureBetDetailSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var rows = sheet.getRange(2, 1, lastRow - 1, BET_DETAIL_HEADERS.length).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    if (clean_(rows[i][BD_COL.key]) === key) {
      sheet.deleteRow(i + 2);
    }
  }
}
```

- [ ] **Step 2: Extend the rename hook in onEdit to handle deletion**

Find:

```js
  if (col === COL.innovation + 1 && e.oldValue) {
    renameBetDetailKey_(e.oldValue, e.value);
  }
```

Replace with:

```js
  if (col === COL.innovation + 1 && e.oldValue) {
    if (!e.value || clean_(e.value) === "") {
      deleteBetDetail_(e.oldValue);
    } else {
      renameBetDetailKey_(e.oldValue, e.value);
    }
  }
```

- [ ] **Step 3: Manual smoke test**

In real sheet:
1. Pick a row with BetDetail set (open sidebar, save a Hypothesis).
2. Open `_Settings`-style: temporarily un-hide `_BetDetail` via right-click → Show. Verify the row exists with the hypothesis text.
3. Back on the main sheet, delete the Innovation cell content (set to blank).
4. Re-check `_BetDetail` → that row is gone.
5. Re-hide `_BetDetail`.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Delete BetDetail row when its Innovation cell is cleared"
```

---

### Task 8: Final integration smoke + tag soi-phase-1b

**Files:** none (verification only).

- [ ] **Step 1: End-to-end round trip on real sheet**

1. Pick a row whose Hypothesis is empty. Open **Bet Detail** sidebar. Verify all 4 fields (Hypothesis, Kill criteria, Evidence link, Decision log) render with empty placeholders.
2. Type a Hypothesis ("If X then Y"), Kill criteria, and Evidence link. Click **Save**. Status reads "Saved." Close sidebar.
3. Reopen sidebar on the same row → all values persist.
4. Change the row's Status from current → **Done**. Modal appears asking for a decision-log entry. Type "shipped to internal users" → **Save entry** → modal closes.
5. Reopen Bet Detail → Decision log shows the new entry.
6. Change Status to **Working** → modal does NOT appear (Done → Working is not in MEANINGFUL_TRANSITIONS_TO).
7. Change Status to **Paused** → modal appears.
8. Change Confidence from 70% → 50% → modal appears with "Confidence 70% → 50%" — type a reason, save, verify entry appears.
9. Change Confidence from 50% → 90% → modal does NOT appear (rises don't trigger).
10. Pick a different row whose Status = **Idea** with no Hypothesis set. Change Status to **Working** → toast warns about missing hypothesis. Decision log modal also appears (Idea → Working triggers both).
11. Rename an Innovation cell. Reopen Bet Detail on the renamed row → values still there (rename hook re-keyed BetDetail).
12. Delete an Innovation cell. Inspect `_BetDetail` (un-hide via right-click) → that row is gone.

- [ ] **Step 2: Run all 4 new regression tests**

In Apps Script editor: `test_betDetailRoundTrip`, `test_decisionLogAppend`, `test_renameRekeysBetDetail`, `test_shouldPromptOnMeaningfulTransitionsOnly`. All four must report PASS in Logger.

Plus the 7 prior tests from Phase 0/1A: `test_doneRowsStayWithOwner`, `test_consolidateDoneMovesToSection`, `test_confidenceDropdownPresent`, `test_settingsRoundTrip`, `test_isStaleRespectsTierAndStatus`, `test_staleBadgePrepended`, `test_chapterHeaderRendersStats`. All 11 must pass.

- [ ] **Step 3: Tag the release**

```bash
git tag soi-phase-1b
git log --oneline soi-phase-1a..soi-phase-1b
```

---

## Out of scope (deferred to Phase 2)

- AI Toolkit (7 modes) — Diff modes that propose cell changes + Report modes that produce text
- Claude API client + AILog telemetry + token budget guardrail
- API-key configuration UI + Script Properties storage
- TriageRejected quarantine

## Out of scope (intentionally not in 1B)

- Hypothesis hard-block (spec §4.5 explicitly chose soft warning)
- Decision log entry editing/deletion (audit-trail honesty — entries are append-only via the modal only)
- Multi-user "who" attribution beyond email lookup
- Time-driven trigger to recompute stale badges (spec mentions; not blocking, can be added later)

---

## Self-review notes

- **Spec coverage:** §3.3 BetDetail panel fields → Task 1 (data store) + Tasks 3-4 (sidebar). §4.4 Decision log prompt on meaningful transitions → Task 5. §4.5 Soft hypothesis warning → Task 6. §6.2 Hidden support sheet pattern → Task 1. §6.3 Innovation key collisions / rename → Tasks 2 + 7. All covered.
- **Type / name consistency:** All references to v6 + 1A globals (`CONFIG.*`, `COL.*`, `STATUS.*`, `PRIORITY.*`, `HEADERS`, `clean_`, `toast_`, `isDividerValue_`, `parseConfidencePercent_`, `getSetting_`, `setSetting_`) match the file at `soi-phase-1a`. New identifiers (`BET_DETAIL_SHEET_NAME`, `BET_DETAIL_HEADERS`, `BD_COL`, `ensureBetDetailSheet_`, `getBetDetail_`, `setBetDetail_`, `appendDecisionLogEntry_`, `parseDecisionLogJson_`, `blankBetDetail_`, `renameBetDetailKey_`, `deleteBetDetail_`, `getBetDetailFor`, `saveBetDetailFor`, `betDetailSidebarHtml_`, `openBetDetailSidebar`, `MEANINGFUL_TRANSITIONS_TO`, `shouldPromptDecisionLog_`, `promptForDecisionLog_`, `submitDecisionLogEntry`, `decisionLogModalHtml_`, `warnHypothesisMissing_`) follow conventions: private helpers end in `_`, server-callable functions (those invoked via `google.script.run`) don't end in `_`, test functions don't end in `_`.
- **No placeholders:** every code block is complete and runnable. No "TBD," no "implement later."
- **HTML is inline as JS strings** (per the architecture decision to keep deployment as one file). If the user later switches to clasp + multi-file, the `betDetailSidebarHtml_` and `decisionLogModalHtml_` functions are easy to convert to `HtmlService.createHtmlOutputFromFile("Sidebar")` calls.
