# State of Innovation — Phase 2A (Gemini Foundation + Explain Row) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the AI integration foundation for the State of Innovation sheet — Google Gemini Flash 2.0 client (free tier), API key configuration via Script Properties, daily token budget guardrail, AILog telemetry sheet, and the first AI mode end-to-end: "Explain this row." This proves the whole pipeline works before expanding to the other 6 modes in Phase 2B.

**Architecture:** All changes in `StateOfInnovationDashboard.js`. Gemini API client is one isolated function (`callGemini_`) that the rest of the script calls — easy to swap to a different vendor (Claude, OpenAI, local model) later. API key lives in `PropertiesService.getScriptProperties()` (never visible in any sheet). Daily budget tracked in a new `_AILog` hidden sheet that records every API call. "Explain this row" is a Report-shape mode: gathers row context + BetDetail → builds prompt → calls Gemini → renders markdown in a modal with a copy button.

**Tech Stack:** Google Apps Script (V8 runtime), `UrlFetchApp.fetch()` for HTTP, `PropertiesService` for the API key, Gemini API at `https://generativelanguage.googleapis.com/v1beta/`. Tests are runnable Apps Script functions (no trailing `_`) whose results land in `Logger`.

**Reference spec:** `docs/superpowers/specs/2026-05-02-state-of-innovation-redesign-design.md` §5 (specifically §5.3 API integration, §5.2 Mode 5 "Explain this row to me"). Spec assumed Claude Sonnet; Phase 2A swaps to Gemini Flash 2.0 (free tier) — same prompt structure, different vendor.

**Working file** (relative to repo root): `StateOfInnovationDashboard.js`

**Starting state:** the script as it stands after `7b42ac2` (Move-Done removed) at `/Users/antoniovarlese/Desktop/Projects/HS Extension/`.

---

## Prerequisites

Before running this plan, the user needs:

1. **A free Gemini API key** from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey). Sign in with a Google account → click "Create API key" → copy the resulting key (starts with `AIza...`). Free tier is plenty for personal-sheet use (15 requests/min, 1500/day).

The plan does NOT require the user to install anything. The Gemini key is set via the script's menu after Task 1 ships.

---

## File map

All changes land in `StateOfInnovationDashboard.js`. New top-level identifiers introduced in this phase:

| New | Kind | Purpose |
|---|---|---|
| `AI_LOG_SHEET_NAME` (`"_AILog"`) | constant | Hidden telemetry sheet |
| `AI_LOG_HEADERS` | constant | `[when, mode, inputTokens, outputTokens, totalTokens, success, errorMessage]` |
| `AI_DEFAULTS` | constant | Default model + daily token budget |
| `ensureAILogSheet_()` | helper | Creates the hidden _AILog sheet on first use |
| `appendAILogEntry_(entry)` | helper | Pushes one row onto _AILog |
| `tokensSpentToday_()` | helper | Sums today's `totalTokens` from _AILog |
| `getGeminiApiKey_()` | helper | Reads `GEMINI_API_KEY` from Script Properties |
| `getAiModel_()` / `getAiDailyBudget_()` | helpers | Read settings with defaults |
| `configureGeminiApiKey()` (menu) | UI | Prompts user for key + tests it |
| `setAiDailyBudget()` (menu) | UI | Prompts user for new budget |
| `setAiModel()` (menu) | UI | Prompts user for model name |
| `callGemini_(prompt, options)` | core | Single-function Gemini client with budget enforcement + AILog write |
| `explainRowWithAi()` (menu) | UI | Mode 5 entry point — Report shape |
| `aiResultModalHtml_(title, markdown)` | helper | Modal HTML template |
| `test_callGeminiBudgetEnforcement` / `test_aiLogRoundTrip` | tests | New regression guards |

---

### Task 1: AI configuration — Script Properties storage + menu items

**Files:**
- Modify: `StateOfInnovationDashboard.js`
  - Add `// AI CONFIG` section after the SETTINGS section (around line ~830)
  - Add three new menu items in `onOpen()` under a new "AI" submenu

**Why:** Configuration first. The user needs a way to set the API key, model, and daily budget before the client can call anything. API key in Script Properties (per spec §5.3), other settings in the existing `_Settings` sheet via `getSetting_`/`setSetting_`.

- [ ] **Step 1: Insert the AI CONFIG section**

Find the `// BET DETAIL` section header (around line ~1000):

```js
// ============================================================
// BET DETAIL — hidden sheet for narrative fields
// ============================================================
```

Insert this entire block IMMEDIATELY BEFORE that header:

```js
// ============================================================
// AI CONFIG — Gemini API key + model + budget
// ============================================================

var AI_DEFAULTS = {
  model: "gemini-2.0-flash-exp",
  dailyTokenBudget: 200000
};

function getGeminiApiKey_() {
  return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
}

function setGeminiApiKey_(key) {
  PropertiesService.getScriptProperties().setProperty("GEMINI_API_KEY", clean_(key));
}

function getAiModel_() {
  var stored = getSetting_("ai:model", "");
  return stored || AI_DEFAULTS.model;
}

function getAiDailyBudget_() {
  var stored = getSetting_("ai:dailyTokenBudget", "");
  if (!stored) return AI_DEFAULTS.dailyTokenBudget;
  var parsed = parseInt(stored, 10);
  return (!isNaN(parsed) && parsed > 0) ? parsed : AI_DEFAULTS.dailyTokenBudget;
}

function configureGeminiApiKey() {
  var ui = SpreadsheetApp.getUi();
  var current = getGeminiApiKey_();
  var resp = ui.prompt(
    "Configure Gemini API key",
    "Paste your free Gemini API key from aistudio.google.com/app/apikey." +
    (current ? " (Current key starts with: " + current.substring(0, 8) + "…)" : ""),
    ui.ButtonSet.OK_CANCEL
  );

  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = clean_(resp.getResponseText());
  if (!key) {
    ui.alert("No key provided. Nothing changed.");
    return;
  }
  if (key.indexOf("AIza") !== 0) {
    ui.alert("That doesn't look like a Gemini API key (expected to start with 'AIza'). Nothing saved.");
    return;
  }

  setGeminiApiKey_(key);
  toast_("Gemini API key saved. Test it with any AI menu action.");
}

function setAiModel() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "Set AI model",
    "Default: " + AI_DEFAULTS.model + ". Other options: gemini-1.5-flash, gemini-1.5-pro. Leave blank to use default.",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  setSetting_("ai:model", clean_(resp.getResponseText()));
  toast_("AI model set to: " + getAiModel_());
}

function setAiDailyBudget() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    "Set daily token budget",
    "Default: " + AI_DEFAULTS.dailyTokenBudget + " tokens/day. Each Gemini call typically uses 200-2000 tokens. Leave blank to use default.",
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  setSetting_("ai:dailyTokenBudget", clean_(resp.getResponseText()));
  toast_("Daily token budget set to: " + getAiDailyBudget_());
}

```

(Trailing blank line so it spaces from BET DETAIL section.)

- [ ] **Step 2: Add the AI submenu in `onOpen`**

Find the existing Maintenance submenu in `onOpen`:

```js
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("Maintenance")
        .addItem("Migrate to Phase 1a schema", "migrateToPhase1aSchema")
        .addItem("Migrate Last Updated to Date format", "migrateLastUpdatedToDate")
        .addItem("Migrate Status to plain text (no emoji)", "migrateStatusToPlain")
        .addItem("Open settings sheet", "openSettings")
    )
    .addToUi();
```

Replace with:

```js
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("Maintenance")
        .addItem("Migrate to Phase 1a schema", "migrateToPhase1aSchema")
        .addItem("Migrate Last Updated to Date format", "migrateLastUpdatedToDate")
        .addItem("Migrate Status to plain text (no emoji)", "migrateStatusToPlain")
        .addItem("Open settings sheet", "openSettings")
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("AI")
        .addItem("Configure Gemini API key", "configureGeminiApiKey")
        .addItem("Set AI model", "setAiModel")
        .addItem("Set daily token budget", "setAiDailyBudget")
    )
    .addToUi();
```

- [ ] **Step 3: Manual test**

Push to Apps Script, reload sheet. Verify the new **AI** submenu appears with three items. Click **Configure Gemini API key** → prompt appears → paste a fake key like `notreal` → "That doesn't look like a Gemini API key" alert. Try again with a real key (`AIza...`) → toast "Gemini API key saved." Then click **Set AI model** and **Set daily token budget** → both prompts appear and accept input.

- [ ] **Step 4: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add AI config section: Gemini API key (Script Properties) + model/budget settings"
```

---

### Task 2: Gemini API client + AILog telemetry + budget enforcement

**Files:**
- Modify: `StateOfInnovationDashboard.js`
  - Add `// AI LOG` section + `// GEMINI CLIENT` section after the AI CONFIG block (around line ~895)
  - Append two regression tests to `// TESTS`

**Why:** The single function the rest of the script calls. Wraps the HTTP call to Gemini, enforces the daily budget, and logs every call to `_AILog` for telemetry + audit. Any later AI mode (this phase or Phase 2B) just calls `callGemini_(prompt)` — they don't touch HTTP/auth/logging directly.

- [ ] **Step 1: Insert the AI LOG section**

Find the `// BET DETAIL` section header (just below the AI CONFIG block from Task 1):

```js
// ============================================================
// BET DETAIL — hidden sheet for narrative fields
// ============================================================
```

Insert this entire AI LOG block IMMEDIATELY BEFORE that header:

```js
// ============================================================
// AI LOG — hidden sheet for Gemini call telemetry
// ============================================================

var AI_LOG_SHEET_NAME = "_AILog";
var AI_LOG_HEADERS = ["when", "mode", "inputTokens", "outputTokens", "totalTokens", "success", "errorMessage"];
var AILOG_COL = {
  when: 0,
  mode: 1,
  inputTokens: 2,
  outputTokens: 3,
  totalTokens: 4,
  success: 5,
  errorMessage: 6
};

function ensureAILogSheet_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(AI_LOG_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(AI_LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, AI_LOG_HEADERS.length).setValues([AI_LOG_HEADERS])
      .setFontWeight("bold")
      .setBackground(CONFIG.colors.headerBg)
      .setFontColor(CONFIG.colors.headerFg);
    sheet.setColumnWidths(1, AI_LOG_HEADERS.length, 140);
    sheet.setColumnWidth(AILOG_COL.errorMessage + 1, 320);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }

  return sheet;
}

function appendAILogEntry_(entry) {
  var sheet = ensureAILogSheet_();
  sheet.appendRow([
    entry.when || new Date(),
    entry.mode || "",
    entry.inputTokens || 0,
    entry.outputTokens || 0,
    entry.totalTokens || 0,
    entry.success === true,
    entry.errorMessage || ""
  ]);
}

function tokensSpentToday_() {
  var sheet = ensureAILogSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;

  var today = new Date();
  var todayKey = Utilities.formatDate(today, Session.getScriptTimeZone(), "yyyy-MM-dd");

  var rows = sheet.getRange(2, 1, lastRow - 1, AI_LOG_HEADERS.length).getValues();
  var sum = 0;
  for (var i = 0; i < rows.length; i++) {
    var when = rows[i][AILOG_COL.when];
    if (when instanceof Date) {
      var rowKey = Utilities.formatDate(when, Session.getScriptTimeZone(), "yyyy-MM-dd");
      if (rowKey === todayKey) sum += parseInt(rows[i][AILOG_COL.totalTokens], 10) || 0;
    }
  }
  return sum;
}

```

- [ ] **Step 2: Insert the GEMINI CLIENT section**

IMMEDIATELY AFTER the AI LOG section you just added, insert:

```js
// ============================================================
// GEMINI CLIENT — single function, all HTTP / budget / logging
// ============================================================

function callGemini_(prompt, options) {
  options = options || {};
  var mode = options.mode || "generic";

  var apiKey = getGeminiApiKey_();
  if (!apiKey) {
    appendAILogEntry_({ mode: mode, success: false, errorMessage: "No API key configured" });
    throw new Error("No Gemini API key. Set one via menu → AI → Configure Gemini API key.");
  }

  var spent = tokensSpentToday_();
  var budget = getAiDailyBudget_();
  if (spent >= budget) {
    appendAILogEntry_({ mode: mode, success: false, errorMessage: "Daily budget exhausted (" + spent + "/" + budget + ")" });
    throw new Error("Daily token budget exhausted (" + spent + " / " + budget + "). Raise the limit via AI → Set daily token budget, or wait for tomorrow.");
  }

  var model = options.model || getAiModel_();
  var url = "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + encodeURIComponent(apiKey);

  var body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: options.temperature != null ? options.temperature : 0.4,
      maxOutputTokens: options.maxOutputTokens || 1024
    }
  };

  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
  } catch (e) {
    appendAILogEntry_({ mode: mode, success: false, errorMessage: "Network error: " + e.message });
    throw e;
  }

  var code = response.getResponseCode();
  var raw = response.getContentText();

  if (code !== 200) {
    appendAILogEntry_({ mode: mode, success: false, errorMessage: "HTTP " + code + ": " + raw.substring(0, 200) });
    throw new Error("Gemini returned HTTP " + code + ". " + raw.substring(0, 300));
  }

  var data;
  try { data = JSON.parse(raw); } catch (e) {
    appendAILogEntry_({ mode: mode, success: false, errorMessage: "Bad JSON: " + raw.substring(0, 200) });
    throw new Error("Gemini returned non-JSON response: " + raw.substring(0, 300));
  }

  var text = "";
  if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
    text = data.candidates[0].content.parts.map(function(p) { return p.text || ""; }).join("");
  }

  var usage = data.usageMetadata || {};
  var inTokens = usage.promptTokenCount || 0;
  var outTokens = usage.candidatesTokenCount || 0;
  var totalTokens = usage.totalTokenCount || (inTokens + outTokens);

  appendAILogEntry_({
    mode: mode,
    inputTokens: inTokens,
    outputTokens: outTokens,
    totalTokens: totalTokens,
    success: true
  });

  return { text: text, inputTokens: inTokens, outputTokens: outTokens, totalTokens: totalTokens };
}

```

- [ ] **Step 3: Append regression tests**

Add to TESTS section:

```js

function test_aiLogRoundTrip() {
  appendAILogEntry_({ mode: "__test_mode__", inputTokens: 100, outputTokens: 50, totalTokens: 150, success: true });
  var spent = tokensSpentToday_();

  var passed = spent >= 150;
  Logger.log("test_aiLogRoundTrip: " + (passed ? "PASS" : "FAIL"));
  Logger.log("  spent=" + spent);

  // Cleanup the test row
  var sheet = SpreadsheetApp.getActive().getSheetByName(AI_LOG_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, AI_LOG_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      if (clean_(rows[i][AILOG_COL.mode]) === "__test_mode__") sheet.deleteRow(i + 2);
    }
  }
  return passed;
}

function test_callGeminiBudgetEnforcement() {
  // Seed AILog with a row that exhausts today's budget.
  var budget = getAiDailyBudget_();
  appendAILogEntry_({ mode: "__test_budget__", totalTokens: budget + 1, success: true });

  var threwExpected = false;
  try {
    callGemini_("hello", { mode: "__test_call__" });
  } catch (e) {
    if (e.message.indexOf("budget exhausted") !== -1) threwExpected = true;
  }

  Logger.log("test_callGeminiBudgetEnforcement: " + (threwExpected ? "PASS" : "FAIL"));

  // Cleanup
  var sheet = SpreadsheetApp.getActive().getSheetByName(AI_LOG_SHEET_NAME);
  if (sheet && sheet.getLastRow() >= 2) {
    var rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, AI_LOG_HEADERS.length).getValues();
    for (var i = rows.length - 1; i >= 0; i--) {
      var m = clean_(rows[i][AILOG_COL.mode]);
      if (m === "__test_budget__" || m === "__test_call__") sheet.deleteRow(i + 2);
    }
  }
  return threwExpected;
}
```

(Note: `test_callGeminiBudgetEnforcement` doesn't need a real API key — the budget check fires before the HTTP call.)

- [ ] **Step 4: Run both tests in Apps Script editor → expect PASS**

- [ ] **Step 5: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add Gemini API client + _AILog telemetry sheet + daily budget guardrail"
```

---

### Task 3: Mode 5 — "Explain this row" with markdown modal

**Files:**
- Modify: `StateOfInnovationDashboard.js`
  - Add `// AI MODES` section after the GEMINI CLIENT section (around line ~1000)
  - Add `explainRowWithAi` to the AI submenu in `onOpen`

**Why:** First end-to-end mode — proves the whole pipeline works. Picks the currently-selected row, gathers its sheet values + BetDetail narrative, builds a "explain this bet" prompt, calls Gemini, renders the markdown response in a modal with a copy button.

- [ ] **Step 1: Insert the AI MODES section**

Find the `// BET DETAIL` section header (still just below the GEMINI CLIENT block from Task 2). Insert this AI MODES block IMMEDIATELY BEFORE it:

```js
// ============================================================
// AI MODES — entry points for individual Gemini-powered features
// ============================================================

function explainRowWithAi() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSheet();
  var range = sheet.getActiveRange();
  if (!range) { ui.alert("Pick a row first."); return; }

  var row = range.getRow();
  if (row < CONFIG.dataStartRow) { ui.alert("Click a data row (not the header)."); return; }

  var rowValues = sheet.getRange(row, 1, 1, CONFIG.numCols).getValues()[0];
  var innovation = clean_(rowValues[COL.innovation]);
  if (!innovation || isDividerValue_(innovation)) {
    ui.alert("Pick a real bet row (not a divider).");
    return;
  }

  var detail = getBetDetail_(innovation);
  var prompt = buildExplainRowPrompt_(rowValues, detail);

  var result;
  try {
    result = callGemini_(prompt, { mode: "explainRow", maxOutputTokens: 800 });
  } catch (e) {
    ui.alert("AI call failed: " + e.message);
    return;
  }

  var html = HtmlService.createHtmlOutput(aiResultModalHtml_("Explain · " + innovation, result.text, result.totalTokens))
    .setWidth(560).setHeight(560);
  ui.showModalDialog(html, "AI Explanation");
}

function buildExplainRowPrompt_(rowValues, detail) {
  var lines = [];
  lines.push("Explain this bet to me in plain English. Cover what it is, where it stands, what's at risk, and what's next.");
  lines.push("Keep it tight — 4–6 short markdown sections, no fluff.");
  lines.push("");
  lines.push("Bet data:");
  lines.push("- Innovation: " + clean_(rowValues[COL.innovation]).replace(/^(\[\d+d\]\s+)+/, ""));
  lines.push("- Investigator: " + clean_(rowValues[COL.investigator]));
  lines.push("- Tier: " + clean_(rowValues[COL.tier]));
  lines.push("- Priority: " + clean_(rowValues[COL.priority]));
  lines.push("- Status: " + clean_(rowValues[COL.status]));
  lines.push("- Confidence: " + clean_(rowValues[COL.confidence]));
  lines.push("- Last updated: " + clean_(rowValues[COL.updated]));
  lines.push("- Notes: " + clean_(rowValues[COL.notes]));
  lines.push("- Link: " + clean_(rowValues[COL.link]));
  lines.push("");
  lines.push("Narrative fields:");
  lines.push("- Hypothesis: " + (detail.hypothesis || "(not set)"));
  lines.push("- Kill criteria: " + (detail.killCriteria || "(not set)"));
  lines.push("- Evidence link: " + (detail.evidenceLink || "(not set)"));
  if (detail.decisionLog && detail.decisionLog.length > 0) {
    lines.push("- Decision log:");
    detail.decisionLog.forEach(function(e) {
      lines.push("  - " + (e.when || "") + " " + (e.transition || "") + ": " + (e.what || ""));
    });
  } else {
    lines.push("- Decision log: (no entries yet)");
  }
  return lines.join("\n");
}

function aiResultModalHtml_(title, markdown, totalTokens) {
  var safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var safeMarkdown = JSON.stringify(markdown);
  return '' +
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    '  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0a0a0a;background:#fafafa;margin:0;padding:20px;}' +
    '  .eyebrow{font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999;margin-bottom:4px;}' +
    '  h1{font-size:18px;margin:0 0 14px;line-height:1.3;}' +
    '  .body{background:#fff;border:1px solid rgba(0,0,0,0.1);padding:16px 20px;font-size:13px;line-height:1.55;color:#0a0a0a;white-space:pre-wrap;word-wrap:break-word;max-height:380px;overflow-y:auto;}' +
    '  .body h1,.body h2,.body h3{font-size:14px;margin:14px 0 6px;}' +
    '  .body ul{margin:6px 0 6px 20px;padding:0;}' +
    '  .body li{margin-bottom:3px;}' +
    '  .actions{display:flex;gap:8px;margin-top:14px;align-items:center;}' +
    '  button{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:9px 18px;cursor:pointer;border:1px solid #0a0a0a;background:#0a0a0a;color:#F7BE68;}' +
    '  button.secondary{background:#fff;color:#0a0a0a;}' +
    '  .meta{font-size:10px;color:#999;margin-left:auto;}' +
    '  .copied{color:#2E8B3D;font-weight:700;}' +
    '</style></head><body>' +
    '<div class="eyebrow">AI Result · Gemini</div>' +
    '<h1>' + safeTitle + '</h1>' +
    '<div class="body" id="body"></div>' +
    '<div class="actions"><button id="copy">Copy as markdown</button><button class="secondary" id="close">Close</button><span class="meta">' + totalTokens + ' tokens</span></div>' +
    '<script>' +
    '  var MD = ' + safeMarkdown + ';' +
    '  document.getElementById("body").textContent = MD;' +
    '  document.getElementById("copy").addEventListener("click", function(){' +
    '    var ta = document.createElement("textarea"); ta.value = MD; document.body.appendChild(ta);' +
    '    ta.select(); document.execCommand("copy"); document.body.removeChild(ta);' +
    '    this.textContent = "Copied"; this.classList.add("copied");' +
    '  });' +
    '  document.getElementById("close").addEventListener("click", function(){ google.script.host.close(); });' +
    '</script></body></html>';
}

```

- [ ] **Step 2: Add "Explain this row" to the AI submenu**

Find the AI submenu in `onOpen` (added in Task 1):

```js
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("AI")
        .addItem("Configure Gemini API key", "configureGeminiApiKey")
        .addItem("Set AI model", "setAiModel")
        .addItem("Set daily token budget", "setAiDailyBudget")
    )
```

Replace with:

```js
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("AI")
        .addItem("Explain this row", "explainRowWithAi")
        .addSeparator()
        .addItem("Configure Gemini API key", "configureGeminiApiKey")
        .addItem("Set AI model", "setAiModel")
        .addItem("Set daily token budget", "setAiDailyBudget")
    )
```

- [ ] **Step 3: Manual end-to-end smoke test**

This is THE proof-the-pipeline-works moment.

1. Push to Apps Script.
2. Configure your Gemini API key via **AI → Configure Gemini API key** (paste your `AIza…` key).
3. Reload sheet. Click any data row that has some context (e.g. "Ortus APP (GoLogIn)" with notes filled).
4. Click **AI → Explain this row**.
5. Wait ~5–10 seconds. A modal appears titled "AI Explanation" with a markdown explanation of the bet, plus a "Copy as markdown" button and a token count at the bottom.
6. Click **Copy as markdown** → button changes to "Copied" in green.
7. Paste somewhere external → confirm the markdown text matches the modal.

If any step fails:
- "No API key configured" → re-run **AI → Configure Gemini API key**, paste key correctly
- "HTTP 400/403" → key is wrong/revoked. Generate a fresh one at aistudio.google.com.
- "Daily budget exhausted" → bump it via **AI → Set daily token budget** (default is 200K, more than enough).
- "Network error" → check internet. Apps Script can also be slow occasionally; retry after a minute.

- [ ] **Step 4: Inspect the AILog**

Right-click any sheet tab → **Show hidden sheets** → check if `_AILog` shows up. If yes, click it. You should see one row from the explain call you just ran (and any test runs from Task 2). Re-hide when done.

- [ ] **Step 5: Commit**

```bash
git add StateOfInnovationDashboard.js
git commit -m "Add Mode 5: 'Explain this row' — first end-to-end Gemini AI feature"
```

---

### Task 4: Final smoke test + tag soi-phase-2a

**Files:** none (verification only).

- [ ] **Step 1: Real-sheet round trip**

1. Pick a row whose notes are sparse → **AI → Explain this row** → expect a short, useful explanation that highlights the missing context.
2. Pick a row with rich BetDetail (Hypothesis + Kill criteria + Decision log) → **AI → Explain this row** → expect a longer explanation that cites the hypothesis and decision log entries.
3. Pick a divider row (chapter header) → **AI → Explain this row** → expect "Pick a real bet row" alert.
4. Open `_AILog` (right-click → Show hidden sheets) → verify all the calls landed with their token counts.

- [ ] **Step 2: Run all 3 new regression tests** in Apps Script editor

`test_aiLogRoundTrip` and `test_callGeminiBudgetEnforcement` (from Task 2). Plus all existing 11 tests from prior phases. All 13 must report PASS.

- [ ] **Step 3: Tag the release**

```bash
git tag soi-phase-2a
git log --oneline -8
```

---

## Out of scope (deferred to Phase 2B and later)

- The other 6 modes from the spec: Suggest tier/priority/status (Diff), Flag risks (Diff), Draft missing hypotheses (Diff), Propose new Pebbles (Diff), What should I work on next (Report), Draft standup (Report)
- The unified "AI Toolkit" modal that lists all 7 modes in one bento grid (per spec §5.1)
- Diff-shape accept/reject UI for the Diff modes
- Auto-write decision-log entries when a Diff is accepted
- TriageRejected quarantine (per spec §5.3)
- Switching to Claude or other vendors (one-line change in `callGemini_` only — easy to do later)

## Out of scope (intentionally not in 2A or 2B)

- Multi-turn conversations (single-shot prompts only)
- Streaming responses (single-call, batch result)
- Function calling / tool use (text in, text out only)
- Image inputs

---

## Self-review notes

- **Spec coverage:** §5.3 API integration → Tasks 1+2. §5.2 Mode 5 "Explain this row to me" → Task 3. §5.4 Prompt structure → Task 3 (`buildExplainRowPrompt_`). Token budget guardrail (spec mentions default 200K) → Task 1+2. AILog telemetry → Task 2. The other 6 modes (§5.2) are explicitly deferred to Phase 2B.
- **Vendor swap:** Spec said Claude Sonnet, plan uses Gemini Flash 2.0 (free tier). Same prompt/response shape from the script's perspective — `callGemini_` is the only function that knows which vendor is in use. Trivial to swap to Claude later by replacing that function only.
- **Type / name consistency:** All references to existing globals (`CONFIG.*`, `COL.*`, `STATUS.*`, `PRIORITY.*`, `HEADERS`, `clean_`, `toast_`, `isDividerValue_`, `getSetting_`, `setSetting_`, `getBetDetail_`) match the file as it stands at `7b42ac2`. New identifiers (`AI_DEFAULTS`, `AI_LOG_SHEET_NAME`, `AI_LOG_HEADERS`, `AILOG_COL`, `getGeminiApiKey_`, `setGeminiApiKey_`, `getAiModel_`, `getAiDailyBudget_`, `configureGeminiApiKey`, `setAiModel`, `setAiDailyBudget`, `ensureAILogSheet_`, `appendAILogEntry_`, `tokensSpentToday_`, `callGemini_`, `explainRowWithAi`, `buildExplainRowPrompt_`, `aiResultModalHtml_`) follow conventions: private helpers end in `_`, menu functions and server-callable ones don't, test functions don't.
- **No placeholders:** every code block is complete and runnable. No "TBD," no "implement later."
- **API key safety:** key never lives in any sheet — only in `PropertiesService.getScriptProperties()`. Even unhiding `_Settings` won't expose it.
