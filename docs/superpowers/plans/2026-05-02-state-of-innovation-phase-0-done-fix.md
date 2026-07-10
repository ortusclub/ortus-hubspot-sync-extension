# State of Innovation — Phase 0 (Done Fix) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-moving rows when status changes to "Done." Done rows stay in place under their owner. Add a manual menu item — "Move completed to Done section" — that preserves the old archive-everything behavior on demand.

**Architecture:** All changes in the single file `Projects/HS Extension/StateOfInnovationDashboard.js`. Refactor `groupByOwnerCore_` to merge Done rows back into the active sort. Extract the old split-and-archive logic into a new `consolidateDoneSection_()` invoked only from a menu item. Add an `onOpen()` so the new menu item is discoverable.

**Tech Stack:** Google Apps Script (V8 runtime). Tests are runnable Apps Script functions whose results land in the editor's Logger pane (no external test runner needed). UX-shaped changes are verified by running on a real sheet.

**Reference spec:** `docs/superpowers/specs/2026-05-02-state-of-innovation-redesign-design.md` §4.1, §7 (Phase 0 only).

**Working file** (relative to repo root): `Projects/HS Extension/StateOfInnovationDashboard.js`

---

### Task 1: Add a custom menu via `onOpen()`

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` (append at end of file)

**Why:** The script currently has no menu — users have to invoke functions from the Apps Script editor. Adding `onOpen()` makes the existing functions discoverable and is required for the new "Move completed to Done section" item we add in Task 4.

- [ ] **Step 1: Append `onOpen()` to the bottom of `StateOfInnovationDashboard.js`**

```js
// ============================================================
// MENU — runs automatically when the spreadsheet opens
// ============================================================
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

- [ ] **Step 2: Push to the Apps Script editor and reload the sheet**

Copy the file contents into the bound Apps Script project (or `clasp push`). In the spreadsheet, choose **File → Reload** (or close and reopen the tab). Verify the new top-level menu **State of Innovation** appears with all five items.

> The "Move completed to Done section" item will throw `ReferenceError: consolidateDoneSection is not defined` if you click it now — that's expected; we add the function in Task 4.

- [ ] **Step 3: Commit**

```bash
git add "Projects/HS Extension/StateOfInnovationDashboard.js"
git commit -m "Add onOpen menu to State of Innovation script"
```

---

### Task 2: Write the failing test for "Done stays with owner"

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` (add a `// TESTS` section at the bottom, after `onOpen`)

**Why:** TDD — codify the new behavior as a runnable test before changing `groupByOwnerCore_`. The test creates an isolated sheet, runs the sort, and asserts that a Critical-priority Done row sorts above a High-priority active row under the same owner (which only happens if Done rows are no longer being shoved to a separate section).

- [ ] **Step 1: Append the test function**

```js
// ============================================================
// TESTS — run from the Apps Script editor; results in Logger
// ============================================================
function test_doneRowsStayWithOwner_() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_done_stays__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]);
    testSheet.getRange(2, 1, 3, NUM_COLS).setValues([
      ["Bet A", "Alice", "🪨 Stone", "🟠 High",     "🔨 Working", "", "", "2026-05-01 10:00"],
      ["Bet B", "Alice", "🪨 Stone", "🔴 Critical", "✅ Done",          "", "", "2026-05-01 10:00"],
      ["Bet C", "Alice", "🪨 Stone", "🟡 Medium",   "🔨 Working", "", "", "2026-05-01 10:00"]
    ]);
    ss.setActiveSheet(testSheet);
    groupByOwnerCore_();
    var lastRow = testSheet.getLastRow();
    var rowsAfter = testSheet.getRange(2, 1, lastRow - 1, COL_INNOVATION + 1).getValues();
    var positions = {};
    for (var i = 0; i < rowsAfter.length; i++) {
      var name = rowsAfter[i][COL_INNOVATION];
      if (name && !isDividerValue_(name)) positions[name] = i;
    }
    // Bet B is Done + Critical. Under the new behavior it should land FIRST
    // within Alice's chapter (Critical > High > Medium). Old behavior shoved
    // it below a "── ✅ COMPLETED ──" divider.
    passed = positions["Bet B"] !== undefined &&
             positions["Bet A"] !== undefined &&
             positions["Bet C"] !== undefined &&
             positions["Bet B"] < positions["Bet A"] &&
             positions["Bet A"] < positions["Bet C"];
    Logger.log("test_doneRowsStayWithOwner_: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  positions = " + JSON.stringify(positions));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}
```

- [ ] **Step 2: Run the test in the Apps Script editor**

In the editor toolbar, pick `test_doneRowsStayWithOwner_` from the function dropdown → click **Run** → open **View → Logs** (or **Execution log**).

Expected output:
```
test_doneRowsStayWithOwner_: FAIL
  positions = {"Bet A":0,"Bet C":1,"Bet B":3}
```
(or similar — the key signal is `FAIL` plus Bet B being last, after a divider)

- [ ] **Step 3: Commit the failing test**

```bash
git add "Projects/HS Extension/StateOfInnovationDashboard.js"
git commit -m "Add failing test: Done rows should stay with owner"
```

---

### Task 3: Make `groupByOwnerCore_` keep Done rows with owner

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — function `groupByOwnerCore_()`

- [ ] **Step 1: Replace the active-vs-done split with a single collection pass**

In `groupByOwnerCore_()`, locate this block:

```js
  // --- SEPARATE active vs done, storing original row index ---
  var activeRows = [];
  var doneRows = [];
  for (var i = 0; i < allData.length; i++) {
    var innov = allData[i][COL_INNOVATION].toString().trim();
    if (innov === "" || isDividerValue_(innov)) continue;
    var st = allData[i][COL_STATUS].toString().trim();
    var item = {idx: i, vals: allData[i]};
    if (st === "✅ Done") {
      doneRows.push(item);
    } else {
      activeRows.push(item);
    }
  }
```

Replace it with:

```js
  // --- COLLECT all data rows (Done is no longer separated; sorts with owner) ---
  var activeRows = [];
  for (var i = 0; i < allData.length; i++) {
    var innov = allData[i][COL_INNOVATION].toString().trim();
    if (innov === "" || isDividerValue_(innov)) continue;
    activeRows.push({idx: i, vals: allData[i]});
  }
```

- [ ] **Step 2: Delete the now-unused Done sort block**

Find and delete:

```js
  // --- SORT done: most recent first ---
  doneRows.sort(function(a, b) {
    var dA = a.vals[COL_UPDATED] || "";
    var dB = b.vals[COL_UPDATED] || "";
    return dB.toString().localeCompare(dA.toString());
  });
```

- [ ] **Step 3: Delete the Done section build block**

Further down in the same function, find and delete:

```js
  // Blank row before Done section
  if (activeRows.length > 0) {
    pushBlankRow_(outVals, outBg, outFc, outFw, outFs);
    outRich.push(emptyRichRow);
  }

  // Done section
  if (doneRows.length > 0) {
    pushDividerRow_(outVals, outBg, outFc, outFw, outFs, DONE_LABEL);
    outRich.push(emptyRichRow);
    for (var j = 0; j < doneRows.length; j++) {
      var dItem = doneRows[j];
      pushDataRow_(outVals, outBg, outFc, outFw, outFs, dItem.vals);
      outRich.push(richCols[dItem.idx]); // preserve original smart chips
    }
  }
```

- [ ] **Step 4: Re-run the test — it should now pass**

Apps Script editor → `test_doneRowsStayWithOwner_` → **Run** → Logs.

Expected output:
```
test_doneRowsStayWithOwner_: PASS
  positions = {"Bet B":1,"Bet A":2,"Bet C":3}
```
(positions are 0-indexed; index 0 is the owner divider row "👤 Alice", so data starts at index 1)

- [ ] **Step 5: Manual smoke test on real data**

Open the actual State of Innovation sheet → click **State of Innovation → Group by owner** in the menu. Verify:

1. Done rows are now interleaved with active rows under each owner, sorted by priority within the chapter.
2. No `── ✅ COMPLETED ──` divider appears anywhere.
3. Existing data integrity intact: notes content, link content, smart chips in Notes/Link columns all preserved (click into a Notes cell — chips should still render as chips, not plain text).

If any of those check items fail, stop and investigate before committing.

- [ ] **Step 6: Commit**

```bash
git add "Projects/HS Extension/StateOfInnovationDashboard.js"
git commit -m "Stop auto-moving Done rows; keep them with owner during sort"
```

---

### Task 4: Add `consolidateDoneSection()` for manual archive

**Files:**
- Modify: `Projects/HS Extension/StateOfInnovationDashboard.js` — append two new functions plus a helper, just before the `// DIVIDER DETECTION` section. Append a second test function to the `// TESTS` section.

**Why:** The "archive all Done rows into a Done section at the bottom" behavior is still useful, just not as an automatic trigger. This task extracts that logic into an explicitly invoked function and wires it to the menu item we declared in Task 1.

- [ ] **Step 1: Write the failing test**

Append to the `// TESTS` section:

```js
function test_consolidateDoneMovesToSection_() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_consolidate__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, NUM_COLS).setValues([HEADERS]);
    testSheet.getRange(2, 1, 3, NUM_COLS).setValues([
      ["Bet A", "Alice", "🪨 Stone", "🟠 High",     "🔨 Working", "", "", "2026-05-01 10:00"],
      ["Bet B", "Alice", "🪨 Stone", "🔴 Critical", "✅ Done",          "", "", "2026-05-01 10:00"],
      ["Bet C", "Alice", "🪨 Stone", "🟡 Medium",   "🔨 Working", "", "", "2026-05-01 10:00"]
    ]);
    ss.setActiveSheet(testSheet);
    consolidateDoneSection_();
    var lastRow = testSheet.getLastRow();
    var rowsAfter = testSheet.getRange(2, 1, lastRow - 1, COL_INNOVATION + 1).getValues();
    var doneDividerIdx = -1, betAidx = -1, betBidx = -1;
    for (var i = 0; i < rowsAfter.length; i++) {
      var name = rowsAfter[i][COL_INNOVATION];
      if (name === DONE_LABEL) doneDividerIdx = i;
      if (name === "Bet A") betAidx = i;
      if (name === "Bet B") betBidx = i;
    }
    passed = doneDividerIdx > -1 && betAidx > -1 && betBidx > -1 &&
             betAidx < doneDividerIdx && betBidx > doneDividerIdx;
    Logger.log("test_consolidateDoneMovesToSection_: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  doneDivider@" + doneDividerIdx + ", BetA@" + betAidx + ", BetB@" + betBidx);
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}
```

- [ ] **Step 2: Run the test, verify it fails**

Apps Script editor → `test_consolidateDoneMovesToSection_` → **Run**.

Expected: `ReferenceError: consolidateDoneSection_ is not defined` (or a similar "function not defined" error).

- [ ] **Step 3: Implement the function pair plus a row-count helper**

Append, just before the `// ============== DIVIDER DETECTION ==============` section comment:

```js
// ============================================================
// CONSOLIDATE DONE — public wrapper with confirmation alert
// ============================================================
function consolidateDoneSection() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  if (ui) {
    var resp = ui.alert(
      "Move all Done rows to the Done section?",
      "This will sort active rows by owner+priority, then place all Done rows in a single Done section at the bottom (most recent first). You can keep working on Done rows after — they'll stay archived until you change their status.",
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) return;
  }
  var moved = countDoneRows_();
  consolidateDoneSection_();
  if (ui) ui.alert("Done. " + moved + " Done row(s) consolidated.");
}

function countDoneRows_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return 0;
  var vals = sheet.getRange(DATA_START_ROW, COL_STATUS + 1, lastRow - DATA_START_ROW + 1).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if ((vals[i][0] || "").toString().trim() === "✅ Done") n++;
  }
  return n;
}

// ============================================================
// CORE consolidation — same write path as groupByOwnerCore_
// but explicitly splits Done rows into a section at the bottom
// ============================================================
function consolidateDoneSection_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return;
  var oldRowCount = lastRow - DATA_START_ROW + 1;

  var dataRange = sheet.getRange(DATA_START_ROW, 1, oldRowCount, NUM_COLS);
  var allData = dataRange.getValues();
  var richCols = sheet.getRange(DATA_START_ROW, COL_NOTES + 1, oldRowCount, 2).getRichTextValues();

  var activeRows = [], doneRows = [];
  for (var i = 0; i < allData.length; i++) {
    var innov = allData[i][COL_INNOVATION].toString().trim();
    if (innov === "" || isDividerValue_(innov)) continue;
    var st = allData[i][COL_STATUS].toString().trim();
    var item = {idx: i, vals: allData[i]};
    if (st === "✅ Done") doneRows.push(item);
    else activeRows.push(item);
  }

  activeRows.sort(function(a, b) {
    var oA = (a.vals[COL_INVESTIGATOR] || "").toString().trim().toLowerCase();
    var oB = (b.vals[COL_INVESTIGATOR] || "").toString().trim().toLowerCase();
    if (oA === "" && oB !== "") return 1;
    if (oA !== "" && oB === "") return -1;
    if (oA !== oB) return oA.localeCompare(oB);
    var pA = PRIORITY_ORDER[a.vals[COL_PRIORITY] ? a.vals[COL_PRIORITY].toString().trim() : ""] || 6;
    var pB = PRIORITY_ORDER[b.vals[COL_PRIORITY] ? b.vals[COL_PRIORITY].toString().trim() : ""] || 6;
    return pA - pB;
  });

  doneRows.sort(function(a, b) {
    var dA = a.vals[COL_UPDATED] || "";
    var dB = b.vals[COL_UPDATED] || "";
    return dB.toString().localeCompare(dA.toString());
  });

  var outVals = [], outBg = [], outFc = [], outFw = [], outFs = [], outRich = [];
  var emptyRt = SpreadsheetApp.newRichTextValue().setText("").build();
  var emptyRichRow = [emptyRt, emptyRt];
  var currentOwner = null;

  for (var i = 0; i < activeRows.length; i++) {
    var item = activeRows[i];
    var owner = (item.vals[COL_INVESTIGATOR] || "").toString().trim();
    if (owner === "") owner = "Unassigned";
    if (owner !== currentOwner) {
      if (currentOwner !== null) {
        pushBlankRow_(outVals, outBg, outFc, outFw, outFs);
        outRich.push(emptyRichRow);
      }
      currentOwner = owner;
      pushDividerRow_(outVals, outBg, outFc, outFw, outFs, DIVIDER_PREFIX + owner);
      outRich.push(emptyRichRow);
    }
    pushDataRow_(outVals, outBg, outFc, outFw, outFs, item.vals);
    outRich.push(richCols[item.idx]);
  }

  if (activeRows.length > 0 && doneRows.length > 0) {
    pushBlankRow_(outVals, outBg, outFc, outFw, outFs);
    outRich.push(emptyRichRow);
  }

  if (doneRows.length > 0) {
    pushDividerRow_(outVals, outBg, outFc, outFw, outFs, DONE_LABEL);
    outRich.push(emptyRichRow);
    for (var j = 0; j < doneRows.length; j++) {
      var dItem = doneRows[j];
      pushDataRow_(outVals, outBg, outFc, outFw, outFs, dItem.vals);
      outRich.push(richCols[dItem.idx]);
    }
  }

  var totalRows = Math.max(oldRowCount, outVals.length);
  while (outVals.length < totalRows) {
    pushBlankRow_(outVals, outBg, outFc, outFw, outFs);
    outRich.push(emptyRichRow);
  }

  var range = sheet.getRange(DATA_START_ROW, 1, totalRows, NUM_COLS);
  range.breakApart();
  range.setValues(outVals);
  range.setBackgrounds(outBg);
  range.setFontColors(outFc);
  range.setFontWeights(outFw);
  range.setFontSizes(outFs);
  sheet.getRange(DATA_START_ROW, COL_NOTES + 1, totalRows, 2).setRichTextValues(outRich);
  applyDropdowns_(sheet);
}
```

- [ ] **Step 4: Re-run the test, verify it passes**

Apps Script editor → `test_consolidateDoneMovesToSection_` → **Run** → Logs.

Expected output:
```
test_consolidateDoneMovesToSection_: PASS
  doneDivider@2, BetA@1, BetB@3
```
(exact indexes vary depending on owner-divider placement; the assertion only checks ordering: `BetA < doneDivider < BetB`)

- [ ] **Step 5: Manual smoke test of the menu item**

In the actual sheet, reload to pick up the new code. Click **State of Innovation → Move completed to Done section**. Verify:

1. A confirmation dialog appears with the title and explanation from `consolidateDoneSection()`.
2. Click **OK**. All Done rows move to a section at the bottom labeled `── ✅ COMPLETED ──`.
3. Active rows above the divider remain owner-grouped + priority-sorted.
4. Smart chips in Notes/Link columns are preserved (click into a Notes cell to verify chips render).
5. A second alert reports the correct count of moved rows.
6. Click **Cancel** on a fresh run — verify nothing changes.

- [ ] **Step 6: Commit**

```bash
git add "Projects/HS Extension/StateOfInnovationDashboard.js"
git commit -m "Add consolidateDoneSection menu item for manual archive"
```

---

### Task 5: Final integration smoke test

**Files:** none (verification only — no commit if passing).

- [ ] **Step 1: Round-trip test on the real sheet**

In the actual State of Innovation sheet:

1. Pick any active row → set its **Status** dropdown to **✅ Done**. Verify: row stays exactly where it is, just gets the green Done styling. No automatic reshuffle.
2. Pick a second active row in a different owner section → also set to **✅ Done**. Verify: stays in place.
3. Click **State of Innovation → Group by owner**. Verify: both Done rows now sort within their owners by priority — no separate Done section appears.
4. Click **State of Innovation → Move completed to Done section** → confirm. Verify: both Done rows move to a single `── ✅ COMPLETED ──` section at the bottom, sorted most-recently-updated first.
5. Pick one of the rows now in the Done section → change its **Status** back to **🔨 Working**. Verify: row stays visually where it is (still under the Done divider) — it's no longer Done but the layout doesn't auto-reshuffle.
6. Click **State of Innovation → Group by owner**. Verify: the row-formerly-Done (now Working) re-integrates with its owner.

If all six steps pass, Phase 0 is shipped.

- [ ] **Step 2: Tag the release**

```bash
git tag soi-phase-0
git log --oneline -10
```

---

## Out of scope (intentionally deferred to later phases)

- Visual refresh (Ortus light theme tokens, Bebas Neue, owner chapter restyle) → Phase 1
- New Confidence column, Bet Detail panel, Decision Log, Stale badges → Phase 1
- AI Toolkit (7 modes), Settings sheet, API key management → Phase 2
- Repository home for the script (still untracked across two near-named worktree dirs) → out-of-band cleanup

---

## Self-review notes

- **Spec coverage:** Spec §4.1 + §7 Phase 0 lists three items: Done rows don't auto-move (Task 3), `consolidateDoneSection()` exists and is menu-accessible (Tasks 1 + 4), `groupByOwnerCore_` no longer splits Done (Task 3). All three covered.
- **Type / name consistency:** `consolidateDoneSection` (public) + `consolidateDoneSection_` (private, trailing-underscore convention from existing codebase) + `countDoneRows_` (helper) + `test_doneRowsStayWithOwner_` / `test_consolidateDoneMovesToSection_` (test functions). All use of existing constants (`COL_INNOVATION`, `COL_STATUS`, `COL_INVESTIGATOR`, `COL_PRIORITY`, `COL_UPDATED`, `COL_NOTES`, `NUM_COLS`, `HEADERS`, `DATA_START_ROW`, `DIVIDER_PREFIX`, `DONE_LABEL`, `PRIORITY_ORDER`) matches the existing script.
- **No placeholders:** every code block is complete and runnable. No "TBD," no "similar to," no "implement later."
