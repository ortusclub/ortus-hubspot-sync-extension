# State of Innovation — Phase 1A (Visual + Schema) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the light Ortus Outreach Command Deck visual style to the State of Innovation sheet, add the Confidence column, give each owner chapter a numbered Bebas-style header with a stat trail, surface stale rows with inline red badges using per-tier thresholds, and lay down the Settings sheet that later phases will configure.

**Architecture:** All changes in the single file `Projects/HS Extension/StateOfInnovationDashboard.js` (~780 lines as of `soi-phase-0`). Visual tokens move into `CONFIG`. The `Confidence` column is appended at column 9 — no existing column is shifted, so the migration is just "add a header + apply a dropdown." Stale state is recomputed during every sort by `isStale_()` and prepended to the Innovation cell as a red rich-text badge. Owner chapter headers replace the existing dark-navy divider rendering with an Ortus-styled chapter band that includes a numbered prefix and a per-owner stat trail. The Settings sheet is a hidden support sheet with a small read/write helper module — used now for stale-threshold overrides, will be reused in Phases 1B and 2.

**Tech Stack:** Google Apps Script (V8 runtime). Tests are runnable Apps Script functions (no trailing `_` so they appear in the editor's function picker) whose results land in `Logger`. Visual changes verified manually on a real sheet copy.

**Reference spec:** `docs/superpowers/specs/2026-05-02-state-of-innovation-redesign-design.md` §2, §3.2, §4.2, §4.3, §6.2, §7 (Phase 1, visual + schema portion).

**Working file** (relative to repo root): `Projects/HS Extension/StateOfInnovationDashboard.js`

**Starting state:** v6 + `soi-phase-0` tag (`6fb2994`).

---

## File map

All changes land in `Projects/HS Extension/StateOfInnovationDashboard.js`. New top-level identifiers introduced in this phase:

| New | Kind | Purpose |
|---|---|---|
| `CONFIG.colors.*` (rewritten) | constants | Light Ortus palette tokens |
| `CONFIG.font.display` (new) | constant | Display font family for chapter headers |
| `CONFIG.staleDays` (new) | constants | Per-tier stale thresholds (Boulder/Stone/Rock/Pebble) |
| `STATUS_STYLES` (rewritten) | constants | Light-theme pill colors per status |
| `COL.confidence` (new, value 8) | constant | Confidence column index |
| `CONFIDENCE_OPTIONS` (new) | constants | Dropdown values: 10/30/50/70/90 |
| `migrateToPhase1aSchema` | menu function | One-shot migration for existing sheets |
| `getSetting_` / `setSetting_` / `ensureSettingsSheet_` | helpers | Settings hidden sheet API |
| `openSettings` | menu function | Unhide Settings sheet for editing |
| `getStaleThresholdDays_(tier)` | helper | Reads CONFIG default + Settings override |
| `isStale_(row, today)` | helper | Returns days-stale (or 0 if not stale) |
| `formatInnovationCellRichText_(value, staleDays)` | helper | Returns rich text with red badge prefix |
| `computeOwnerStats_(rows)` | helper | Returns map of `owner → {count, avgConf}` |
| `pushChapterHeader_(output, ordinal, owner, stats)` | helper | Renders the new Ortus chapter row |
| `test_confidenceDropdownPresent`, `test_staleBadgePrepended`, `test_chapterHeaderRendersStats` | tests | New regression guards |

---

### Task 1: Apply Ortus visual tokens to CONFIG, STATUS_STYLES, and the header

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - `CONFIG.colors` (around line 19-24)
  - `CONFIG.font` (around line 26-29) — add `display`
  - `STATUS_STYLES` (around line 76-84)
  - `styleHeader_()` (around line 152-160) — verify it picks up the new tokens

**Why:** This is the visual foundation everything else lands on top of. Done as a single commit so the palette swap is atomic.

- [ ] **Step 1: Replace `CONFIG.colors` and extend `CONFIG.font`**

Find:

```js
  colors: {
    dividerBg: "#1B3A5C",
    dividerFg: "#FFFFFF",
    defaultFg: "#000000",
    criticalFg: "#CC0000"
  },

  font: {
    defaultSize: 10,
    dividerSize: 12
  }
```

Replace with:

```js
  colors: {
    canvas:       "#FAFAFA",
    ink:          "#0A0A0A",
    gray:         "#999999",
    hairline:     "#E0E0E0",
    chapterBand:  "#F3F3F3",
    chapterInk:   "#0A0A0A",
    chapterMeta:  "#666666",
    headerBg:     "#0A0A0A",
    headerFg:     "#FAFAFA",
    dividerBg:    "#F3F3F3",
    dividerFg:    "#0A0A0A",
    defaultFg:    "#0A0A0A",
    criticalFg:   "#C93B34",
    staleBadgeFg: "#C93B34",
    gold:         "#F7BE68"
  },

  font: {
    defaultSize: 10,
    dividerSize: 14,
    chapterNumberSize: 16,
    metaSize: 9,
    display: "Oswald"
  }
```

Note: `dividerBg` / `dividerFg` are kept in the same shape so existing callers in `pushDividerRow_()` and `applyRowColors()` keep compiling without changes — the new values just look different. The `gold` token is reserved for the future "Run AI triage" CTA (Phase 2) and not used yet.

- [ ] **Step 2: Replace `STATUS_STYLES` with light-theme tinted variants**

Find:

```js
var STATUS_STYLES = {};
STATUS_STYLES[STATUS.DONE] = { bg: "#C6EFCE", font: "#006100" };
STATUS_STYLES[STATUS.WORKING] = { bg: "#FFF2CC", font: "#7F6000" };
STATUS_STYLES[STATUS.FIXING] = { bg: "#F4CCCC", font: "#CC0000" };
STATUS_STYLES[STATUS.ABOUT] = { bg: "#D9E2F3", font: "#1F3864" };
STATUS_STYLES[STATUS.PAUSED] = { bg: "#E2E2E2", font: "#666666" };
STATUS_STYLES[STATUS.IDEA] = { bg: "#E8D5F5", font: "#6A1B9A" };
STATUS_STYLES[STATUS.WAITING] = { bg: "#FFE0B2", font: "#E65100" };
STATUS_STYLES[STATUS.TESTING] = { bg: "#B2DFDB", font: "#00695C" };
```

Replace with:

```js
var STATUS_STYLES = {};
STATUS_STYLES[STATUS.DONE]    = { bg: "#EAF6EC", font: "#2E8B3D" };
STATUS_STYLES[STATUS.WORKING] = { bg: "#FDF4E1", font: "#B07A1A" };
STATUS_STYLES[STATUS.FIXING]  = { bg: "#FCEBEA", font: "#C93B34" };
STATUS_STYLES[STATUS.ABOUT]   = { bg: "#EDF1F9", font: "#3B5BA5" };
STATUS_STYLES[STATUS.PAUSED]  = { bg: "#EDEDED", font: "#666666" };
STATUS_STYLES[STATUS.IDEA]    = { bg: "#FFFFFF", font: "#666666" };
STATUS_STYLES[STATUS.WAITING] = { bg: "#FCEEDC", font: "#A85A0E" };
STATUS_STYLES[STATUS.TESTING] = { bg: "#E5EFFB", font: "#2667C9" };
```

Rationale per the spec §2: status tints are the lightest possible to keep the canvas clean; ink tones match the Ortus light-theme palette and hold contrast on `#FAFAFA`.

- [ ] **Step 3: Update `styleHeader_()` to use the new token names**

Find:

```js
function styleHeader_(sheet) {
  sheet.getRange(1, 1, 1, CONFIG.numCols)
    .setValues([HEADERS])
    .setFontWeight("bold")
    .setBackground(CONFIG.colors.dividerBg)
    .setFontColor(CONFIG.colors.dividerFg)
    .setFontSize(11)
    .setHorizontalAlignment("center");
}
```

Replace with:

```js
function styleHeader_(sheet) {
  sheet.getRange(1, 1, 1, CONFIG.numCols)
    .setValues([HEADERS])
    .setFontWeight("bold")
    .setBackground(CONFIG.colors.headerBg)
    .setFontColor(CONFIG.colors.headerFg)
    .setFontFamily(CONFIG.font.display)
    .setFontSize(11)
    .setHorizontalAlignment("left");
}
```

Switching the header to `headerBg`/`headerFg` (still dark, but explicit), display-typeface (Oswald — Sheets-supported substitute for Bebas Neue per spec §6.4), and left-aligned (more editorial, matches Ortus mockup).

- [ ] **Step 4: Manual visual check**

Push to Apps Script. In a fresh sheet copy (or your real sheet — your call), run **State of Innovation → Setup dashboard**. Verify:
1. Header row is dark on light page (Ortus inversion at the top), Oswald font.
2. Existing data rows render with the new soft status tints — no dark navy left anywhere.

Owner divider rows still look unchanged (they use `dividerBg` / `dividerFg` which are now light gray instead of dark navy — that's a placeholder until Task 7 replaces the divider rendering entirely). That's expected and OK at this checkpoint.

- [ ] **Step 5: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Apply Ortus light palette to CONFIG, STATUS_STYLES, header"
```

---

### Task 2: Add the Confidence column (schema, dropdown, timestamp guard)

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - `COL` (around line 32-41)
  - `HEADERS` (around line 43-52)
  - `CONFIG` (around line 12-30) — bump `numCols`
  - Append `CONFIDENCE_OPTIONS` constant block after `STATUS_OPTIONS` (~line 75)
  - `setColumnWidths_()` (around line 162-168)
  - `applyDropdowns_()` (around line 216-221)
  - `onEdit()` (around line 271-291) — replace the timestamp-trigger inline check with a small named helper

**Why:** The Confidence column is the only new column added in the entire redesign (per spec §3.2). It's appended at column 9 so no existing data shifts.

- [ ] **Step 1: Extend `COL` with `confidence` at index 8**

Find:

```js
var COL = {
  innovation: 0,
  investigator: 1,
  tier: 2,
  priority: 3,
  status: 4,
  notes: 5,
  link: 6,
  updated: 7
};
```

Replace with:

```js
var COL = {
  innovation: 0,
  investigator: 1,
  tier: 2,
  priority: 3,
  status: 4,
  notes: 5,
  link: 6,
  updated: 7,
  confidence: 8
};
```

- [ ] **Step 2: Append "Confidence" to `HEADERS` and bump `CONFIG.numCols`**

Find `HEADERS = [...]` block (line 43-52). Add `"Confidence"` as the last entry:

```js
var HEADERS = [
  "Innovation",
  "Investigator",
  "Tier",
  "Priority",
  "Status",
  "Notes",
  "Link",
  "Last Updated",
  "Confidence"
];
```

In `CONFIG`, change `numCols: 8` to `numCols: 9`.

- [ ] **Step 3: Add the `CONFIDENCE_OPTIONS` constant**

Insert after the `STATUS_OPTIONS = [ ... ]` block (after line ~74), before `STATUS_STYLES`:

```js
var CONFIDENCE_OPTIONS = ["10%", "30%", "50%", "70%", "90%"];
```

Spec §3.2: 5-bucket scale (1-in-10, 1-in-3, coin flip, likely, near-certain). Stored as the `"NN%"` strings — keeps the dropdown human-readable, easy to round-trip from the sheet.

- [ ] **Step 4: Update `setColumnWidths_()` for the new column**

Find:

```js
function setColumnWidths_(sheet) {
  var widths = [500, 140, 130, 130, 150, 300, 200, 140];

  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}
```

Replace the widths array:

```js
function setColumnWidths_(sheet) {
  var widths = [500, 140, 130, 130, 150, 300, 200, 140, 100];

  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}
```

(100px is enough for the "70%" pill.)

- [ ] **Step 5: Apply the Confidence dropdown in `applyDropdowns_()`**

Find:

```js
function applyDropdowns_(sheet) {
  setDropdown_(sheet, COL.tier, TIER_OPTIONS, false);
  setDropdown_(sheet, COL.priority, PRIORITY_OPTIONS, false);
  setDropdown_(sheet, COL.status, STATUS_OPTIONS, false);
  setInvestigatorDropdown_(sheet);
}
```

Replace with:

```js
function applyDropdowns_(sheet) {
  setDropdown_(sheet, COL.tier, TIER_OPTIONS, false);
  setDropdown_(sheet, COL.priority, PRIORITY_OPTIONS, false);
  setDropdown_(sheet, COL.status, STATUS_OPTIONS, false);
  setDropdown_(sheet, COL.confidence, CONFIDENCE_OPTIONS, false);
  setInvestigatorDropdown_(sheet);
}
```

- [ ] **Step 6: Refactor `onEdit()` timestamp guard to handle the new column cleanly**

Find:

```js
  if (col >= 1 && col <= COL.link + 1) {
    updateTimestamp_(sheet, row);
  }
```

Replace with:

```js
  if (isUserDataColumn_(col)) {
    updateTimestamp_(sheet, row);
  }
```

Then add this helper function right after `updateTimestamp_()` (around line 301):

```js
function isUserDataColumn_(oneBasedCol) {
  return oneBasedCol >= 1 &&
    oneBasedCol <= CONFIG.numCols &&
    oneBasedCol !== COL.updated + 1;
}
```

This now correctly fires the timestamp on Confidence edits (col 9) too, while still skipping self-updates of the `Last Updated` column (col 8).

- [ ] **Step 7: Append a regression test**

Add to the bottom of the `// TESTS` section:

```js

function test_confidenceDropdownPresent() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_conf_dropdown__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, CONFIG.numCols).setValues([HEADERS]);
    applyDropdowns_(testSheet);
    var rule = testSheet.getRange(CONFIG.dataStartRow, COL.confidence + 1).getDataValidation();
    var values = rule ? rule.getCriteriaValues()[0] : [];
    passed = rule !== null &&
             values.indexOf("10%") > -1 &&
             values.indexOf("90%") > -1 &&
             values.length === CONFIDENCE_OPTIONS.length;
    Logger.log("test_confidenceDropdownPresent: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  options found = " + JSON.stringify(values));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}
```

- [ ] **Step 8: Run the test in Apps Script editor**

Push to Apps Script, save (so the editor re-scans), pick `test_confidenceDropdownPresent` from the function dropdown, **Run**, check **View → Logs**. Expect:
```
test_confidenceDropdownPresent: PASS
  options found = ["10%","30%","50%","70%","90%"]
```

- [ ] **Step 9: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add Confidence column at index 8 with 5-bucket dropdown"
```

---

### Task 3: One-shot migration for existing sheets

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - Add a `// MIGRATIONS` section just before the `// TESTS` section
  - Add `migrateToPhase1aSchema` to the `onOpen()` menu

**Why:** Fresh sheets get the new column from `setupDashboard`. Existing sheets need a one-shot migration to add the "Confidence" header and apply the dropdown to existing rows. Run-once via menu, idempotent.

- [ ] **Step 1: Add the migration function**

Insert this section just before `// TESTS` (around line ~707):

```js
// ============================================================
// MIGRATIONS — one-shot upgrades for existing sheets
// ============================================================

function migrateToPhase1aSchema() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var sheet = SpreadsheetApp.getActiveSheet();

  var headerRange = sheet.getRange(1, COL.confidence + 1);
  var alreadyMigrated = clean_(headerRange.getValue()) === "Confidence";

  if (alreadyMigrated) {
    if (ui) ui.alert("Already migrated. Confidence column header is already in place.");
    return;
  }

  if (ui) {
    var resp = ui.alert(
      "Migrate this sheet to Phase 1a schema?",
      "This adds the Confidence column header in column 9 and applies the dropdown. Existing rows get an empty Confidence cell. No data is moved or deleted.",
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) return;
  }

  styleHeader_(sheet);
  setColumnWidths_(sheet);
  applyDropdowns_(sheet);

  toast_("Phase 1a schema migration applied. Confidence column ready.");
}
```

`styleHeader_` rewrites row 1 with the full HEADERS array (now 9 entries), `setColumnWidths_` covers the new col 9 width, `applyDropdowns_` adds the Confidence dropdown to rows 2 through `dataStartRow + dropdownRows`. All three functions are idempotent — running on an already-migrated sheet is safe.

- [ ] **Step 2: Wire the migration into `onOpen()`**

In `onOpen()` (around line 122), insert the migration item under the Setup item:

Find:

```js
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("State of Innovation")
    .addItem("Setup dashboard", "setupDashboard")
    .addItem("Group by owner", "groupByOwner")
    .addItem("Move completed to Done section", "consolidateDoneSection")
    .addSeparator()
    .addItem("Reapply dropdowns", "reapplyDropdowns")
    .addItem("Show tier legend", "showTierLegend")
    .addToUi();
}
```

Replace with:

```js
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("State of Innovation")
    .addItem("Setup dashboard", "setupDashboard")
    .addItem("Group by owner", "groupByOwner")
    .addItem("Move completed to Done section", "consolidateDoneSection")
    .addSeparator()
    .addItem("Reapply dropdowns", "reapplyDropdowns")
    .addItem("Show tier legend", "showTierLegend")
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("Maintenance")
        .addItem("Migrate to Phase 1a schema", "migrateToPhase1aSchema")
    )
    .addToUi();
}
```

- [ ] **Step 3: Manual smoke**

Push, reload sheet. Verify the menu now has **Maintenance → Migrate to Phase 1a schema**. Click it. Expect a confirmation dialog → click **OK** → toast appears, header row has "Confidence" at column 9, clicking any cell in column 9 reveals the dropdown with 10/30/50/70/90 options.

Run the migration a second time — expect the "Already migrated" alert and no changes.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add migrateToPhase1aSchema for one-shot Confidence column add"
```

---

### Task 4: Settings hidden sheet + helper module

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - Add `// SETTINGS` section after the `// HELPERS` section (around line ~580)
  - Add `openSettings` to the Maintenance submenu in `onOpen()`

**Why:** Settings is a foundational hidden sheet that holds per-tier stale-threshold overrides now and AI config in Phase 2. Centralizing it once means later phases just reuse the helpers. Hidden by default so it doesn't clutter the main view.

- [ ] **Step 1: Add the Settings module**

Insert this section right after the `// HELPERS` section (after `toast_()`, around line ~580, before `// GUIDE SIDEBAR`):

```js
// ============================================================
// SETTINGS — hidden sheet with key/value config
// ============================================================

var SETTINGS_SHEET_NAME = "_Settings";

function ensureSettingsSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SETTINGS_SHEET_NAME);
    sheet.getRange(1, 1, 1, 2).setValues([["Key", "Value"]])
      .setFontWeight("bold")
      .setBackground(CONFIG.colors.headerBg)
      .setFontColor(CONFIG.colors.headerFg);
    sheet.setColumnWidth(1, 260);
    sheet.setColumnWidth(2, 200);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }

  return sheet;
}

function getSetting_(key, fallback) {
  var sheet = ensureSettingsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return fallback;

  var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  for (var i = 0; i < rows.length; i++) {
    if (clean_(rows[i][0]) === key) {
      var raw = clean_(rows[i][1]);
      return raw === "" ? fallback : raw;
    }
  }
  return fallback;
}

function setSetting_(key, value) {
  var sheet = ensureSettingsSheet_();
  var lastRow = sheet.getLastRow();

  if (lastRow >= 2) {
    var rows = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (clean_(rows[i][0]) === key) {
        sheet.getRange(i + 2, 2).setValue(value);
        return;
      }
    }
  }

  sheet.appendRow([key, value]);
}

function openSettings() {
  var sheet = ensureSettingsSheet_();
  sheet.showSheet();
  SpreadsheetApp.getActive().setActiveSheet(sheet);
  toast_("Settings sheet shown. Hide it again from the sheet tab when done.");
}
```

Settings keys are arbitrary strings, values are stored as cell values (strings or numbers). `getSetting_` returns the fallback if the key is missing or the value cell is blank. `setSetting_` upserts. `openSettings` un-hides the sheet for editing — user re-hides via right-click on the sheet tab when done.

The `_Settings` name (leading underscore) makes the intent clear at a glance and groups support sheets together when sorted.

- [ ] **Step 2: Add `openSettings` to the Maintenance submenu**

In `onOpen()`, extend the Maintenance submenu:

```js
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("Maintenance")
        .addItem("Migrate to Phase 1a schema", "migrateToPhase1aSchema")
        .addItem("Open settings sheet", "openSettings")
    )
```

- [ ] **Step 3: Append a regression test**

Add to the `// TESTS` section:

```js

function test_settingsRoundTrip() {
  var key = "__test_setting_" + Date.now();
  var initial = getSetting_(key, "fallback-value");
  setSetting_(key, "stored-value");
  var afterSet = getSetting_(key, "fallback-value");
  setSetting_(key, "");
  var afterClear = getSetting_(key, "fallback-value");

  var passed = initial === "fallback-value" &&
               afterSet === "stored-value" &&
               afterClear === "fallback-value";

  Logger.log("test_settingsRoundTrip: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  initial=" + initial + " afterSet=" + afterSet + " afterClear=" + afterClear);

  // Best-effort cleanup: remove the test row if findable.
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (clean_(rows[i][0]) === key) sheet.deleteRow(i + 2);
    }
  }

  return passed;
}
```

- [ ] **Step 4: Push, run the test**

Apps Script editor → `test_settingsRoundTrip` → **Run** → Logs.

Expected:
```
test_settingsRoundTrip: PASS
  initial=fallback-value afterSet=stored-value afterClear=fallback-value
```

- [ ] **Step 5: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add Settings hidden sheet + getSetting_/setSetting_ helpers"
```

---

### Task 5: Per-tier stale thresholds (CONFIG defaults + Settings overrides)

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - `CONFIG` (around line 12-30) — append `staleDays` block
  - Add `getStaleThresholdDays_(tier)` and `isStale_(row, today)` to the helpers section
  - Define a `STATUSES_EXEMPT_FROM_STALE` constant near the other status constants

**Why:** Defines what "stale" means per tier without rendering anything yet. Task 6 wires the visual badge in. Spec §4.3.

- [ ] **Step 1: Add `staleDays` defaults to CONFIG**

In `CONFIG`, append the new block. Find the existing `font` block:

```js
  font: {
    defaultSize: 10,
    dividerSize: 14,
    chapterNumberSize: 16,
    metaSize: 9,
    display: "Oswald"
  }
};
```

Replace with:

```js
  font: {
    defaultSize: 10,
    dividerSize: 14,
    chapterNumberSize: 16,
    metaSize: 9,
    display: "Oswald"
  },

  staleDays: {
    "🏔️ Boulder": 21,
    "🪨 Stone": 14,
    "🧱 Rock": 10,
    "🔹 Pebble": 7,
    "_default": 14
  }
};
```

The `_default` is used for rows whose Tier doesn't match any known key (corrupted dropdown, unmigrated row, etc.) — defensive fallback.

- [ ] **Step 2: Define `STATUSES_EXEMPT_FROM_STALE` next to the other status constants**

Insert immediately after the `STATUS_OPTIONS = [ ... ]` block (around line 75):

```js
var STATUSES_EXEMPT_FROM_STALE = [STATUS.DONE, STATUS.PAUSED, STATUS.IDEA];
```

Spec §4.3: Done/Paused/Idea rows are not stale by definition.

- [ ] **Step 3: Add the threshold + isStale_ helpers**

Append to the `// HELPERS` section, right after `toast_()` (around line 578, just before `// SETTINGS`):

```js
function getStaleThresholdDays_(tier) {
  var key = "staleDays:" + tier;
  var override = getSetting_(key, "");
  if (override !== "") {
    var parsed = parseInt(override, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }

  if (CONFIG.staleDays.hasOwnProperty(tier)) {
    return CONFIG.staleDays[tier];
  }
  return CONFIG.staleDays._default;
}

function isStale_(row, today) {
  if (STATUSES_EXEMPT_FROM_STALE.indexOf(row.status) !== -1) return 0;

  var rawUpdated = clean_(row.values[COL.updated]);
  if (!rawUpdated) return 0;

  var lastUpdated = new Date(rawUpdated);
  if (isNaN(lastUpdated.getTime())) return 0;

  var diffMs = today.getTime() - lastUpdated.getTime();
  var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  var threshold = getStaleThresholdDays_(row.values[COL.tier]);

  return diffDays > threshold ? diffDays : 0;
}
```

Returns `0` for not-stale (lets callers do `if (isStale_(row, today))`), or the integer days-since-update for stale rows (lets callers render `21D`).

- [ ] **Step 4: Append a regression test**

Add to the `// TESTS` section:

```js

function test_isStaleRespectsTierAndStatus() {
  var today = new Date(2026, 4, 2); // 2026-05-02

  function makeRow(tier, status, updated) {
    return {
      values: (function() {
        var arr = [];
        for (var i = 0; i < CONFIG.numCols; i++) arr.push("");
        arr[COL.tier] = tier;
        arr[COL.status] = status;
        arr[COL.updated] = updated;
        return arr;
      })(),
      status: status
    };
  }

  // Boulder threshold = 21d. 22 days old (2026-04-10) should be stale.
  var staleBoulder = isStale_(makeRow("🏔️ Boulder", STATUS.WORKING, "2026-04-10 10:00"), today);
  // Pebble threshold = 7d. 5 days old should NOT be stale.
  var freshPebble = isStale_(makeRow("🔹 Pebble", STATUS.WORKING, "2026-04-27 10:00"), today);
  // Done is exempt regardless of age.
  var oldDone = isStale_(makeRow("🪨 Stone", STATUS.DONE, "2025-01-01 10:00"), today);
  // Idea is exempt regardless.
  var oldIdea = isStale_(makeRow("🪨 Stone", STATUS.IDEA, "2025-01-01 10:00"), today);

  var passed = staleBoulder >= 22 &&
               freshPebble === 0 &&
               oldDone === 0 &&
               oldIdea === 0;

  Logger.log("test_isStaleRespectsTierAndStatus: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  boulder22d=" + staleBoulder + " pebble5d=" + freshPebble + " oldDone=" + oldDone + " oldIdea=" + oldIdea);
  return passed;
}
```

- [ ] **Step 5: Run the test**

Apps Script editor → `test_isStaleRespectsTierAndStatus` → **Run** → Logs.

Expected:
```
test_isStaleRespectsTierAndStatus: PASS
  boulder22d=22 pebble5d=0 oldDone=0 oldIdea=0
```

- [ ] **Step 6: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add per-tier stale thresholds + isStale_ helper"
```

---

### Task 6: Inline red stale badge on the Innovation cell

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - Add `formatInnovationCellRichText_(value, staleDays)` to helpers (near `emptyRichRow_`, around line 551)
  - Modify `groupByOwnerCore_()` (line 326-348) — pass a `today` Date through and have it apply badges per row
  - Modify `consolidateDoneSection_()` (added in Phase 0) — same treatment

**Why:** Visible signal that something has rotted. Per spec §4.3, applied during sort (every regroup recomputes badges).

- [ ] **Step 1: Add the rich-text formatter**

Insert this helper just before `clean_()` (around line 558), inside the existing `// HELPERS` section:

```js
function formatInnovationCellRichText_(value, staleDays) {
  var text = clean_(value);
  if (staleDays <= 0) {
    return SpreadsheetApp.newRichTextValue().setText(text).build();
  }

  var badge = "[" + staleDays + "d]  ";
  var fullText = badge + text;

  var redStyle = SpreadsheetApp.newTextStyle()
    .setForegroundColor(CONFIG.colors.staleBadgeFg)
    .setBold(true)
    .build();

  return SpreadsheetApp.newRichTextValue()
    .setText(fullText)
    .setTextStyle(0, badge.length, redStyle)
    .build();
}
```

Renders as `[21d]  Innovation Name` with the bracketed prefix in red bold. The double-space gap separates the badge from the title visually without needing a layout primitive.

- [ ] **Step 2: Wire it into `groupByOwnerCore_()` and add an Innovation rich-text track**

Update `groupByOwnerCore_()` (lines 326-348) so it computes a per-row stale value and writes the Innovation cell's rich text after the main grid write.

Find:

```js
function groupByOwnerCore_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) return;

  var rowCount = lastRow - CONFIG.dataStartRow + 1;
  var dataRange = sheet.getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols);

  var values = dataRange.getValues();
  var richText = sheet
    .getRange(CONFIG.dataStartRow, COL.notes + 1, rowCount, 2)
    .getRichTextValues();

  var rows = collectDataRows_(values, richText);
  rows.sort(compareRows_);

  var output = buildGroupedOutput_(rows);
  padOutput_(output, Math.max(rowCount, output.values.length));

  writeGroupedOutput_(sheet, output);
  applyDropdowns_(sheet);
}
```

Replace with:

```js
function groupByOwnerCore_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) return;

  var rowCount = lastRow - CONFIG.dataStartRow + 1;
  var dataRange = sheet.getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols);

  var values = dataRange.getValues();
  var richText = sheet
    .getRange(CONFIG.dataStartRow, COL.notes + 1, rowCount, 2)
    .getRichTextValues();

  var rows = collectDataRows_(values, richText);
  rows.sort(compareRows_);

  var output = buildGroupedOutput_(rows);
  padOutput_(output, Math.max(rowCount, output.values.length));

  writeGroupedOutput_(sheet, output);
  applyInnovationCellRichText_(sheet, output, new Date());
  applyDropdowns_(sheet);
}

function applyInnovationCellRichText_(sheet, output, today) {
  var totalRows = output.values.length;
  if (totalRows === 0) return;

  var richValues = [];
  for (var i = 0; i < totalRows; i++) {
    var row = output.values[i];
    var name = clean_(row[COL.innovation]);

    if (!name || isDividerValue_(name)) {
      richValues.push([SpreadsheetApp.newRichTextValue().setText(name).build()]);
      continue;
    }

    var rowAsObj = {
      values: row,
      status: clean_(row[COL.status])
    };
    var staleDays = isStale_(rowAsObj, today);
    richValues.push([formatInnovationCellRichText_(name, staleDays)]);
  }

  sheet.getRange(CONFIG.dataStartRow, COL.innovation + 1, totalRows, 1)
    .setRichTextValues(richValues);
}
```

The trailing `applyInnovationCellRichText_` call replaces the plain Innovation cell strings written by `setValues()` with rich text including the badge. Divider and blank rows pass through with their existing label/empty text untouched.

- [ ] **Step 3: Apply the same treatment in `consolidateDoneSection_()`**

In `consolidateDoneSection_()` (added in Phase 0), find the `writeGroupedOutput_(sheet, output);` line and add `applyInnovationCellRichText_(sheet, output, new Date());` immediately after it (right before the `applyDropdowns_(sheet);` call).

- [ ] **Step 4: Append a regression test**

Add to the `// TESTS` section:

```js

function test_staleBadgePrepended() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_stale_badge__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, CONFIG.numCols).setValues([HEADERS]);
    // Boulder, Working, last updated 30 days before "now"
    var today = new Date();
    var oldDate = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
    var formatted = Utilities.formatDate(oldDate, Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");

    testSheet.getRange(2, 1, 1, CONFIG.numCols).setValues([
      ["Stale Bet", "Alice", "🏔️ Boulder", PRIORITY.HIGH, STATUS.WORKING, "", "", formatted, ""]
    ]);

    ss.setActiveSheet(testSheet);
    groupByOwnerCore_();

    var rich = testSheet.getRange(3, COL.innovation + 1).getRichTextValue();
    var text = rich.getText();
    passed = text.indexOf("[") === 0 && text.indexOf("d]") > 0 && text.indexOf("Stale Bet") > 0;

    Logger.log("test_staleBadgePrepended: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  Innovation cell text = " + JSON.stringify(text));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}
```

(Row 3 in the test sheet because row 2 becomes the "👤 Alice" owner divider, and the data row for "Stale Bet" lands at row 3.)

- [ ] **Step 5: Run the test**

Apps Script editor → `test_staleBadgePrepended` → **Run** → Logs.

Expected:
```
test_staleBadgePrepended: PASS
  Innovation cell text = "[30d]  Stale Bet"
```
(or higher than 30d if a clock/timezone edge case lands)

- [ ] **Step 6: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Render inline red stale badge on Innovation cells per tier threshold"
```

---

### Task 7: Owner chapter headers — Ortus style + numbered prefix + per-owner stat trail

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js`
  - Add `computeOwnerStats_(rows)` next to `compareRows_` (around line 380)
  - Add `pushChapterHeader_(output, ordinal, owner, stats)` near `pushDividerRow_` (around line 494)
  - Modify `buildGroupedOutput_(rows)` (around line 398) to call `pushChapterHeader_` instead of `pushDividerRow_` for owner boundaries
  - Modify `applyRowColors()` (around line 438) so it preserves chapter-header styling instead of stripping it back to a generic divider style

**Why:** Visual centerpiece of the redesign per spec §4.2 / mockup `visual-direction-v3.html`. Each owner becomes a numbered chapter (`01 · ANTONIO · IN FLIGHT · 4 · AVG CONF · 68%`), distinct from generic dividers like the Done section.

- [ ] **Step 1: Add `computeOwnerStats_`**

Insert just below `compareRows_()` (around line 381):

```js
function computeOwnerStats_(rows) {
  var stats = {};

  rows.forEach(function(row) {
    var owner = row.owner;
    if (!stats[owner]) {
      stats[owner] = { count: 0, confSum: 0, confCount: 0 };
    }
    stats[owner].count += 1;

    var conf = parseConfidencePercent_(row.values[COL.confidence]);
    if (conf !== null) {
      stats[owner].confSum += conf;
      stats[owner].confCount += 1;
    }
  });

  Object.keys(stats).forEach(function(owner) {
    var s = stats[owner];
    s.avgConf = s.confCount > 0 ? Math.round(s.confSum / s.confCount) : null;
  });

  return stats;
}

function parseConfidencePercent_(raw) {
  var text = clean_(raw);
  if (!text) return null;
  var match = text.match(/^(\d+)\s*%?$/);
  if (!match) return null;
  var n = parseInt(match[1], 10);
  return isNaN(n) ? null : n;
}
```

`parseConfidencePercent_` accepts both `"70"` and `"70%"` so editing the cell directly (without picking the dropdown) still feeds the stats.

- [ ] **Step 2: Add `pushChapterHeader_`**

Insert right after `pushDividerRow_()` (around line 504):

```js
function pushChapterHeader_(output, ordinal, owner, stats) {
  var ordinalText = pad2_(ordinal);
  var meta = "IN FLIGHT  " + stats.count;
  if (stats.avgConf !== null) {
    meta += "    AVG CONF  " + stats.avgConf + "%";
  }

  var label = ordinalText + "    " + owner.toUpperCase() + "    " + meta;

  var row = fillRow_("");
  row[COL.innovation] = label;

  output.values.push(row);
  output.backgrounds.push(fillRow_(CONFIG.colors.chapterBand));
  output.fontColors.push(fillRow_(CONFIG.colors.chapterInk));
  output.fontWeights.push(fillRow_("bold"));
  output.fontSizes.push(fillRow_(CONFIG.font.dividerSize));
  output.richText.push(emptyRichRow_());
}

function pad2_(n) {
  return n < 10 ? "0" + n : "" + n;
}
```

The chapter row reuses the existing single-cell-with-spaces layout (Innovation column carries the label, the rest of the row stays blank with the band background). Spec §4.2 calls for Bebas-style display type — Sheets uses Oswald (the substitute named in `CONFIG.font.display`); we apply it via the chapter-band font family by writing the label cell with `setFontFamily` from `applyRowColors`. (Step 4 below handles that.)

- [ ] **Step 3: Update `buildGroupedOutput_` to call `pushChapterHeader_`**

Find:

```js
function buildGroupedOutput_(rows) {
  var output = newOutput_();
  var currentOwner = null;

  rows.forEach(function(row) {
    if (row.owner !== currentOwner) {
      if (currentOwner !== null) {
        pushBlankRow_(output);
      }

      currentOwner = row.owner;
      pushDividerRow_(output, CONFIG.dividerPrefix + currentOwner);
    }

    pushDataRow_(output, row.values, row.richText);
  });

  return output;
}
```

Replace with:

```js
function buildGroupedOutput_(rows) {
  var output = newOutput_();
  var stats = computeOwnerStats_(rows);
  var currentOwner = null;
  var ordinal = 0;

  rows.forEach(function(row) {
    if (row.owner !== currentOwner) {
      if (currentOwner !== null) {
        pushBlankRow_(output);
      }

      currentOwner = row.owner;
      ordinal += 1;
      pushChapterHeader_(output, ordinal, currentOwner, stats[currentOwner]);
    }

    pushDataRow_(output, row.values, row.richText);
  });

  return output;
}
```

The legacy `pushDividerRow_` is still used by `consolidateDoneSection_` for the "── ✅ COMPLETED ──" Done section, and by `applyRowColors` when re-rendering an existing divider row — keep it as-is.

- [ ] **Step 4: Update `applyRowColors()` to recognise chapter rows and re-apply their style**

`applyRowColors()` rebuilds row styling from the values it sees in the sheet. Chapter rows look like generic divider rows to it (the label starts with `01    ALICE    IN FLIGHT  ...`, not with `CONFIG.dividerPrefix` `👤 `). Need to teach it.

Find (around line 438):

```js
function applyRowColors() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) return;

  var rowCount = lastRow - CONFIG.dataStartRow + 1;
  var values = sheet
    .getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols)
    .getValues();

  var output = newOutput_();

  values.forEach(function(row) {
    var innovation = clean_(row[COL.innovation]);

    if (!innovation) {
      pushBlankRow_(output);
    } else if (isDividerValue_(innovation)) {
      pushDividerRow_(output, innovation);
    } else {
      pushDataRow_(output, row, emptyRichRow_());
    }
  });

  var range = sheet.getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols);
  range.setBackgrounds(output.backgrounds);
  range.setFontColors(output.fontColors);
  range.setFontWeights(output.fontWeights);
  range.setFontSizes(output.fontSizes);
}
```

Replace with:

```js
function applyRowColors() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) return;

  var rowCount = lastRow - CONFIG.dataStartRow + 1;
  var values = sheet
    .getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols)
    .getValues();

  var output = newOutput_();

  values.forEach(function(row) {
    var innovation = clean_(row[COL.innovation]);

    if (!innovation) {
      pushBlankRow_(output);
    } else if (isChapterHeaderValue_(innovation)) {
      pushChapterStyleOnly_(output, innovation);
    } else if (isDividerValue_(innovation)) {
      pushDividerRow_(output, innovation);
    } else {
      pushDataRow_(output, row, emptyRichRow_());
    }
  });

  var range = sheet.getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols);
  range.setBackgrounds(output.backgrounds);
  range.setFontColors(output.fontColors);
  range.setFontWeights(output.fontWeights);
  range.setFontSizes(output.fontSizes);
  applyChapterFontFamily_(sheet, values);
}

function isChapterHeaderValue_(text) {
  return /^\d{2}    /.test(clean_(text));
}

function pushChapterStyleOnly_(output, label) {
  var row = fillRow_("");
  row[COL.innovation] = label;
  output.values.push(row);
  output.backgrounds.push(fillRow_(CONFIG.colors.chapterBand));
  output.fontColors.push(fillRow_(CONFIG.colors.chapterInk));
  output.fontWeights.push(fillRow_("bold"));
  output.fontSizes.push(fillRow_(CONFIG.font.dividerSize));
  output.richText.push(emptyRichRow_());
}

function applyChapterFontFamily_(sheet, values) {
  for (var i = 0; i < values.length; i++) {
    var name = clean_(values[i][COL.innovation]);
    if (isChapterHeaderValue_(name)) {
      sheet.getRange(CONFIG.dataStartRow + i, COL.innovation + 1)
        .setFontFamily(CONFIG.font.display);
    }
  }
}
```

The recognition pattern `^\d{2}    ` (two digits + four spaces) is unique to chapter headers we wrote — won't false-positive on user data starting with a number. `applyChapterFontFamily_` runs once at the end of `applyRowColors` so chapter labels render in the Oswald display face after a regroup or re-render.

- [ ] **Step 5: Append a regression test**

Add to the `// TESTS` section:

```js

function test_chapterHeaderRendersStats() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_chapter__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, CONFIG.numCols).setValues([HEADERS]);
    testSheet.getRange(2, 1, 3, CONFIG.numCols).setValues([
      ["Bet A", "Alice", "🪨 Stone", PRIORITY.HIGH,     STATUS.WORKING, "", "", "2026-05-01 10:00", "70%"],
      ["Bet B", "Alice", "🪨 Stone", PRIORITY.CRITICAL, STATUS.DONE,    "", "", "2026-05-01 10:00", "90%"],
      ["Bet C", "Alice", "🪨 Stone", PRIORITY.MEDIUM,   STATUS.WORKING, "", "", "2026-05-01 10:00", "50%"]
    ]);
    ss.setActiveSheet(testSheet);
    groupByOwnerCore_();

    // Row 2 is now the chapter header for Alice (3 rows + 1 ordinal + 70 / 90 / 50 avg = 70).
    var label = clean_(testSheet.getRange(2, COL.innovation + 1).getValue());
    passed = label.indexOf("01") === 0 &&
             label.indexOf("ALICE") > 0 &&
             label.indexOf("IN FLIGHT  3") > 0 &&
             label.indexOf("AVG CONF  70%") > 0;

    Logger.log("test_chapterHeaderRendersStats: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  chapter label = " + JSON.stringify(label));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}
```

- [ ] **Step 6: Run the test**

Apps Script editor → `test_chapterHeaderRendersStats` → **Run** → Logs.

Expected:
```
test_chapterHeaderRendersStats: PASS
  chapter label = "01    ALICE    IN FLIGHT  3    AVG CONF  70%"
```

- [ ] **Step 7: Manual visual smoke**

Push to Apps Script. Reload the sheet. Run **State of Innovation → Group by owner**. Verify:
1. Each owner section starts with a chapter header row: `01    ANTONIO    IN FLIGHT  4    AVG CONF  68%` (or similar — depending on your real data).
2. The chapter row has a light-gray (`#F3F3F3`) band, dark ink, bold, and the Oswald display face on the label.
3. Owners are numbered 01, 02, 03 in alphabetical order, with Unassigned last.
4. Status pill colors look soft and refined — no more 90s pastels.
5. Stale rows (last updated more than the per-tier threshold) show `[Nd]` in red bold at the start of the Innovation cell.
6. Done rows still sit inside their owner chapter (Phase 0 contract is preserved).
7. The Confidence column shows the percentage value with a dropdown.

If anything looks off, stop and either fix or escalate.

- [ ] **Step 8: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Render owner chapter headers with Ortus band, ordinal, and stat trail"
```

---

### Task 8: Final integration smoke test + tag

**Files:** none (verification only).

- [ ] **Step 1: Full round-trip on a real sheet**

In the actual State of Innovation sheet:

1. Open the sheet → menu **State of Innovation → Maintenance → Migrate to Phase 1a schema** (if not already migrated).
2. Run **Setup dashboard** to refresh the header style. Verify dark-ink header bar with Oswald font.
3. Pick any active row, set **Confidence** to **70%**. Verify dropdown works, "Last Updated" timestamp updates.
4. Set Status of one row → **✅ Done**. Verify it stays in place (Phase 0 contract preserved); pill is soft mint.
5. Run **Group by owner**. Verify:
   - Numbered chapter headers appear (01, 02, 03…)
   - Stat trail shows realistic In-Flight + Avg Conf values
   - Stale rows have red `[Nd]` badges
   - Done rows sit at the bottom of their owner chapter (statusRank_ = 8)
6. Run **Move completed to Done section**. Verify it still works (Phase 0 contract): all Done rows move to a `── ✅ COMPLETED ──` block; chapter headers above remain intact.
7. Open **Maintenance → Open settings sheet**. Verify the `_Settings` sheet appears with a `Key | Value` header. Add a row: `staleDays:🪨 Stone` / `3` (overrides the 14-day default for Stone bets). Re-hide the sheet (right-click tab → Hide).
8. Run **Group by owner** again. Verify any Stone-tier rows older than 3 days now show stale badges.
9. Re-run all four regression tests in the Apps Script editor:
   - `test_doneRowsStayWithOwner` (from Phase 0)
   - `test_consolidateDoneMovesToSection` (from Phase 0)
   - `test_confidenceDropdownPresent` (Task 2)
   - `test_settingsRoundTrip` (Task 4)
   - `test_isStaleRespectsTierAndStatus` (Task 5)
   - `test_staleBadgePrepended` (Task 6)
   - `test_chapterHeaderRendersStats` (Task 7)
   All seven must report `PASS` in the Logger.

If anything fails, stop and fix.

- [ ] **Step 2: Tag the release**

```bash
git tag soi-phase-1a
git log --oneline -15
```

---

## Out of scope (deferred to Phase 1B)

- Bet Detail HTML sidebar (Hypothesis, Kill criteria, Evidence link, Decision log fields)
- BetDetail hidden sheet (the data store backing the sidebar)
- Decision log auto-prompt modal on meaningful status transitions
- Soft hypothesis-warning toast on `Idea → other status` change
- Renaming-of-Innovation rebinds BetDetail keys

## Out of scope (deferred to Phase 2)

- AI Toolkit (7 modes, Claude API client, AILog telemetry, token budget)
- Automatic AI triage proposals + decision-log auto-entry on accept

---

## Self-review notes

- **Spec coverage:** §2 visual tokens (Task 1), §3.2 Confidence column (Task 2 + Task 3 migration), §4.2 owner chapter rendering (Task 7), §4.3 stale badges (Tasks 5+6), §6.2 Settings hidden sheet (Task 4). The remaining Phase 1 sections — §3.3 BetDetail panel fields, §4.4 Decision log, §4.5 Hypothesis warning — are explicitly deferred to Phase 1B above.
- **Type / name consistency:** All references to v6 globals (`CONFIG.*`, `COL.*`, `STATUS.*`, `PRIORITY.*`, `HEADERS`, `clean_`, `toast_`, `isDividerValue_`, `emptyRichRow_`, `fillRow_`, `groupByOwnerCore_`, `consolidateDoneSection_`) match the file as it stands at `soi-phase-0`. New identifiers (`CONFIDENCE_OPTIONS`, `STATUSES_EXEMPT_FROM_STALE`, `SETTINGS_SHEET_NAME`, `getSetting_`, `setSetting_`, `ensureSettingsSheet_`, `openSettings`, `migrateToPhase1aSchema`, `getStaleThresholdDays_`, `isStale_`, `formatInnovationCellRichText_`, `applyInnovationCellRichText_`, `computeOwnerStats_`, `parseConfidencePercent_`, `pushChapterHeader_`, `pad2_`, `isChapterHeaderValue_`, `pushChapterStyleOnly_`, `applyChapterFontFamily_`) use the established conventions (private helpers end in `_`, public functions don't, test functions don't end in `_` so they appear in the picker).
- **No placeholders:** every code block is complete and runnable. No "TBD," no "similar to Task N," no "implement later."
- **Migration safety:** Task 3's `migrateToPhase1aSchema` is idempotent (checks the column 9 header before mutating), so accidental double-runs are harmless. The dropdown application via `applyDropdowns_` is also idempotent (`setDataValidation` overwrites in place).
