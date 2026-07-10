// ============================================================
// STATE OF INNOVATION — DASHBOARD SCRIPT v6
// ============================================================
// Core behavior:
// - Groups rows by Investigator.
// - Keeps Done rows inside their Investigator group.
// - Never creates a separate Done / Completed section.
// - Preserves dropdowns and rich text chips during regrouping.
// - Avoids clear(), merge(), and clearDataValidations().
// ============================================================

var CONFIG = {
  dataStartRow: 2,
  dropdownRows: 200,
  numCols: 9,
  dividerPrefix: "👤 ",
  oldDoneLabel: "── ✅ COMPLETED ──",

  colors: {
    canvas:       "#FAFAFA",
    ink:          "#0A0A0A",
    gray:         "#999999",
    hairline:     "#E0E0E0",
    chapterBand:  "#0A0A0A",
    chapterInk:   "#F7BE68",
    chapterMeta:  "#FAFAFA",
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
    display: "Inter",
    body: "Inter"
  },

  staleDays: {
    "🏔️ Boulder": 21,
    "🪨 Stone": 14,
    "🧱 Rock": 10,
    "🔹 Pebble": 7,
    "_default": 14
  }
};

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

var STATUS = {
  ABOUT: "About to start",
  WORKING: "Working",
  FIXING: "Fixing",
  DONE: "Done",
  PAUSED: "Paused",
  IDEA: "Idea",
  WAITING: "Waiting for feedback",
  TESTING: "Testing"
};

var STATUS_MIGRATION_MAP = {
  "🚀 About to start": STATUS.ABOUT,
  "🔨 Working": STATUS.WORKING,
  "🔧 Fixing": STATUS.FIXING,
  "✅ Done": STATUS.DONE,
  "⏸️ Paused": STATUS.PAUSED,
  "💡 IDEA": STATUS.IDEA,
  "⏳ Waiting for feedback": STATUS.WAITING,
  "🧪 Testing": STATUS.TESTING
};

var STATUS_OPTIONS = [
  STATUS.ABOUT,
  STATUS.WORKING,
  STATUS.FIXING,
  STATUS.DONE,
  STATUS.PAUSED,
  STATUS.IDEA,
  STATUS.WAITING,
  STATUS.TESTING
];

var CONFIDENCE_OPTIONS = ["10%", "30%", "50%", "70%", "90%"];

var STATUSES_EXEMPT_FROM_STALE = [STATUS.DONE, STATUS.PAUSED, STATUS.IDEA];

var MEANINGFUL_TRANSITIONS_TO = [STATUS.DONE, STATUS.PAUSED, STATUS.FIXING, STATUS.WAITING];

// bg = whisper-tint applied to the whole row
// font = colored text used inside the outlined Status badge
// border = badge outline color (Status cell only, white bg + this border)
var STATUS_STYLES = {};
STATUS_STYLES[STATUS.DONE]    = { bg: "#F4FBF5", font: "#006100", border: "#2E8B3D" };
STATUS_STYLES[STATUS.WORKING] = { bg: "#FFFCF2", font: "#7F6000", border: "#B07A1A" };
STATUS_STYLES[STATUS.FIXING]  = { bg: "#FDF6F6", font: "#CC0000", border: "#C93B34" };
STATUS_STYLES[STATUS.ABOUT]   = { bg: "#F4F7FB", font: "#1F3864", border: "#3B5BA5" };
STATUS_STYLES[STATUS.PAUSED]  = { bg: "#F5F5F5", font: "#666666", border: "#999999" };
STATUS_STYLES[STATUS.IDEA]    = { bg: "#FAF5FE", font: "#6A1B9A", border: "#6A1B9A" };
STATUS_STYLES[STATUS.WAITING] = { bg: "#FFF8EE", font: "#E65100", border: "#E65100" };
STATUS_STYLES[STATUS.TESTING] = { bg: "#F0F8F7", font: "#00695C", border: "#00695C" };

var TIER_INFO = {
  "🏔️ Boulder": "High-impact, complex initiative — major effort, major payoff",
  "🪨 Stone": "Medium-impact project — meaningful but manageable scope",
  "🧱 Rock": "Quick win or small task — low effort, still valuable",
  "🔹 Pebble": "Micro-task or idea backlog — minimal effort, exploratory"
};

var TIER_OPTIONS = Object.keys(TIER_INFO);

var PRIORITY = {
  CRITICAL: "🔴 Critical",
  HIGH: "🟠 High",
  MEDIUM: "🟡 Medium",
  LOW: "🔵 Low",
  NOT_CRITICAL: "⚪ Not Critical"
};

var PRIORITY_OPTIONS = [
  PRIORITY.CRITICAL,
  PRIORITY.HIGH,
  PRIORITY.MEDIUM,
  PRIORITY.LOW,
  PRIORITY.NOT_CRITICAL
];

var PRIORITY_ORDER = {};
PRIORITY_ORDER[PRIORITY.CRITICAL] = 1;
PRIORITY_ORDER[PRIORITY.HIGH] = 2;
PRIORITY_ORDER[PRIORITY.MEDIUM] = 3;
PRIORITY_ORDER[PRIORITY.LOW] = 4;
PRIORITY_ORDER[PRIORITY.NOT_CRITICAL] = 5;
PRIORITY_ORDER[""] = 6;

// ============================================================
// MENU — runs automatically when the spreadsheet opens
// ============================================================
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("State of Innovation")
    .addItem("Setup dashboard", "setupDashboard")
    .addItem("Group by owner", "groupByOwner")
    .addSeparator()
    .addItem("Open Bet Detail for selected row", "openBetDetailSidebar")
    .addSeparator()
    .addItem("Reapply dropdowns", "reapplyDropdowns")
    .addItem("Show tier legend", "showTierLegend")
    .addSeparator()
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("AI")
        .addItem("Explain this row", "explainRowWithAi")
        .addItem("What should I work on next?", "whatToWorkOnAi")
        .addItem("Draft this week's standup", "draftStandupAi")
        .addSeparator()
        .addItem("Suggest tier / priority / status from Notes", "suggestTierPriorityStatusAi")
        .addItem("Flag risks & stale work", "flagRisksAi")
        .addItem("Draft missing hypotheses", "draftHypothesesAi")
        .addItem("Propose new Pebble experiments", "proposeNewPebblesAi")
    )
    .addSubMenu(
      SpreadsheetApp.getUi().createMenu("Maintenance")
        .addItem("Migrate to Phase 1a schema", "migrateToPhase1aSchema")
        .addItem("Migrate Last Updated to Date format", "migrateLastUpdatedToDate")
        .addItem("Migrate Status to plain text (no emoji)", "migrateStatusToPlain")
        .addItem("Open settings sheet", "openSettings")
    )
    .addToUi();
}

// ============================================================
// SETUP
// ============================================================

function setupDashboard() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  styleHeader_(sheet);
  sheet.setFrozenRows(1);
  setColumnWidths_(sheet);
  removeOldMergedCells_(sheet);
  applyDropdowns_(sheet);
  addHeaderNotes_(sheet);
  applyRowColors();
  applySheetAesthetics_(sheet);

  toast_("Dashboard setup complete. Dropdowns applied to " + CONFIG.dropdownRows + " rows.");
}

function applySheetAesthetics_(sheet) {
  sheet.setHiddenGridlines(true);

  var lastRow = Math.max(sheet.getLastRow(), CONFIG.dataStartRow + CONFIG.dropdownRows);
  var rowCount = lastRow - CONFIG.dataStartRow + 1;

  sheet.setRowHeight(1, 36);
  sheet.setRowHeights(CONFIG.dataStartRow, rowCount, 30);

  var dataRange = sheet.getRange(CONFIG.dataStartRow, 1, rowCount, CONFIG.numCols);
  dataRange.setVerticalAlignment("middle");
  dataRange.setBorder(
    false, false, false, false, false, true,
    CONFIG.colors.hairline,
    SpreadsheetApp.BorderStyle.SOLID
  );
}

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

function setColumnWidths_(sheet) {
  var widths = [500, 140, 130, 130, 150, 300, 200, 140, 100];

  for (var i = 0; i < widths.length; i++) {
    sheet.setColumnWidth(i + 1, widths[i]);
  }
}

function removeOldMergedCells_(sheet) {
  var lastRow = Math.max(sheet.getLastRow(), CONFIG.dataStartRow + CONFIG.dropdownRows);
  sheet
    .getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, CONFIG.numCols)
    .breakApart();
}

function addHeaderNotes_(sheet) {
  sheet.getRange(1, COL.tier + 1).setNote("TIER GUIDE\n\n" + buildTierGuide_());

  sheet.getRange(1, COL.priority + 1).setNote(
    "PRIORITY GUIDE\n\n" +
    "🔴 Critical: Blocking other work or revenue\n" +
    "🟠 High: Needs attention this week\n" +
    "🟡 Medium: Standard priority\n" +
    "🔵 Low: Nice to have\n" +
    "⚪ Not Critical: Backlog"
  );

  sheet.getRange(1, COL.status + 1).setNote(
    "STATUS GUIDE\n\n" +
    "About to start: Queued up\n" +
    "Working: In progress\n" +
    "Fixing: Debugging\n" +
    "Done: Delivered, stays under owner\n" +
    "Paused: On hold\n" +
    "Idea: Concept\n" +
    "Waiting for feedback: Awaiting response\n" +
    "Testing: Being tested"
  );
}

function buildTierGuide_() {
  var guide = "";

  TIER_OPTIONS.forEach(function(tier) {
    guide += tier + ": " + TIER_INFO[tier] + "\n";
  });

  return guide;
}

// ============================================================
// DROPDOWNS
// ============================================================

function applyDropdowns_(sheet) {
  setDropdown_(sheet, COL.tier, TIER_OPTIONS, false);
  setDropdown_(sheet, COL.priority, PRIORITY_OPTIONS, false);
  setDropdown_(sheet, COL.status, STATUS_OPTIONS, false);
  setDropdown_(sheet, COL.confidence, CONFIDENCE_OPTIONS, false);
  setInvestigatorDropdown_(sheet);
}

function setDropdown_(sheet, zeroBasedCol, options, allowInvalid) {
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(options, true)
    .setAllowInvalid(allowInvalid)
    .build();

  sheet
    .getRange(CONFIG.dataStartRow, zeroBasedCol + 1, CONFIG.dropdownRows)
    .setDataValidation(rule);
}

function setInvestigatorDropdown_(sheet) {
  var names = getInvestigatorNames_(sheet);

  if (names.length === 0) return;

  setDropdown_(sheet, COL.investigator, names, true);
}

function getInvestigatorNames_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.dataStartRow) return [];

  var values = sheet
    .getRange(CONFIG.dataStartRow, COL.investigator + 1, lastRow - CONFIG.dataStartRow + 1)
    .getValues();

  var seen = {};

  values.forEach(function(row) {
    var name = clean_(row[0]);
    if (name && !isDividerValue_(name)) {
      seen[name] = true;
    }
  });

  return Object.keys(seen).sort();
}

function reapplyDropdowns() {
  applyDropdowns_(SpreadsheetApp.getActiveSheet());
  toast_("Dropdowns reapplied to " + CONFIG.dropdownRows + " rows.");
}

// ============================================================
// EDIT TRIGGER
// ============================================================

function onEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.source.getActiveSheet();
  var row = e.range.getRow();
  var col = e.range.getColumn();

  if (row < CONFIG.dataStartRow) return;

  var innovation = clean_(sheet.getRange(row, COL.innovation + 1).getValue());
  if (!innovation || isDividerValue_(innovation)) return;

  if (col === COL.innovation + 1 && e.oldValue) {
    if (!e.value || clean_(e.value) === "") {
      deleteBetDetail_(e.oldValue);
    } else {
      renameBetDetailKey_(e.oldValue, e.value);
    }
  }

  if (col === COL.status + 1 && e.oldValue !== undefined && e.value !== undefined) {
    if (clean_(e.oldValue) === STATUS.IDEA && clean_(e.value) !== STATUS.IDEA) {
      warnHypothesisMissing_(innovation);
    }
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
}

function updateTimestamp_(sheet, row) {
  sheet.getRange(row, COL.updated + 1).setValue(new Date());
}

function isUserDataColumn_(oneBasedCol) {
  return oneBasedCol >= 1 &&
    oneBasedCol <= CONFIG.numCols &&
    oneBasedCol !== COL.updated + 1;
}

// ============================================================
// GROUPING
// ============================================================

function groupByOwner() {
  groupByOwnerCore_();
  toast_("Grouped by investigator. Done rows stayed with their owner.");
}

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
  applyStatusBadges_(sheet, output);
  applyColumnStyling_(sheet, output.values.length);
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

function applyStatusBadges_(sheet, output) {
  var totalRows = output.values.length;
  if (totalRows === 0) return;

  var byBorder = {};
  var allStatusA1s = [];

  for (var i = 0; i < totalRows; i++) {
    var row = output.values[i];
    var name = clean_(row[COL.innovation]);
    if (!name || isDividerValue_(name)) continue;

    var status = clean_(row[COL.status]);
    var style = STATUS_STYLES[status];
    if (!style || !style.border) continue;

    var a1 = sheet.getRange(CONFIG.dataStartRow + i, COL.status + 1).getA1Notation();
    allStatusA1s.push(a1);

    if (!byBorder[style.border]) byBorder[style.border] = [];
    byBorder[style.border].push(a1);
  }

  if (allStatusA1s.length > 0) {
    sheet.getRangeList(allStatusA1s)
      .setBackground("#FFFFFF")
      .setHorizontalAlignment("center");
  }

  Object.keys(byBorder).forEach(function(borderColor) {
    sheet.getRangeList(byBorder[borderColor]).setBorder(
      true, true, true, true, false, false,
      borderColor, SpreadsheetApp.BorderStyle.SOLID
    );
  });
}

function applyColumnStyling_(sheet, totalRows) {
  if (totalRows === 0) return;

  sheet.getRange(CONFIG.dataStartRow, 1, totalRows, CONFIG.numCols)
    .setFontFamily(CONFIG.font.body);

  sheet.getRange(CONFIG.dataStartRow, COL.updated + 1, totalRows, 1)
    .setNumberFormat("d mmm")
    .setHorizontalAlignment("right");

  sheet.getRange(CONFIG.dataStartRow, COL.confidence + 1, totalRows, 1)
    .setHorizontalAlignment("center");
}

function collectDataRows_(values, richText) {
  var rows = [];

  for (var i = 0; i < values.length; i++) {
    var rawInnovation = clean_(values[i][COL.innovation]);

    if (!rawInnovation || isDividerValue_(rawInnovation)) continue;

    var cleanedInnovation = rawInnovation.replace(/^(\[\d+d\]\s+)+/, "");
    var rowValues = values[i].slice();
    rowValues[COL.innovation] = cleanedInnovation;

    rows.push({
      values: rowValues,
      richText: richText[i],
      owner: clean_(values[i][COL.investigator]) || "Unassigned",
      priority: clean_(values[i][COL.priority]),
      status: clean_(values[i][COL.status])
    });
  }

  return rows;
}

function compareRows_(a, b) {
  var ownerCompare = a.owner.toLowerCase().localeCompare(b.owner.toLowerCase());
  if (a.owner === "Unassigned" && b.owner !== "Unassigned") return 1;
  if (a.owner !== "Unassigned" && b.owner === "Unassigned") return -1;
  if (ownerCompare !== 0) return ownerCompare;

  var priorityCompare = priorityRank_(a.priority) - priorityRank_(b.priority);
  if (priorityCompare !== 0) return priorityCompare;

  return statusRank_(a.status) - statusRank_(b.status);
}

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

  var intMatch = text.match(/^(\d+)\s*%?$/);
  if (intMatch) {
    var n = parseInt(intMatch[1], 10);
    return isNaN(n) ? null : n;
  }

  var floatMatch = text.match(/^0?\.\d+$/);
  if (floatMatch) {
    var f = parseFloat(text);
    return isNaN(f) ? null : Math.round(f * 100);
  }

  return null;
}

function priorityRank_(priority) {
  return PRIORITY_ORDER[priority] || PRIORITY_ORDER[""];
}

function statusRank_(status) {
  if (status === STATUS.WORKING) return 1;
  if (status === STATUS.FIXING) return 2;
  if (status === STATUS.TESTING) return 3;
  if (status === STATUS.WAITING) return 4;
  if (status === STATUS.ABOUT) return 5;
  if (status === STATUS.PAUSED) return 6;
  if (status === STATUS.IDEA) return 7;
  if (status === STATUS.DONE) return 8;
  return 9;
}

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

function writeGroupedOutput_(sheet, output) {
  var totalRows = output.values.length;
  var range = sheet.getRange(CONFIG.dataStartRow, 1, totalRows, CONFIG.numCols);

  range.breakApart();
  range.setValues(output.values);
  range.setBackgrounds(output.backgrounds);
  range.setFontColors(output.fontColors);
  range.setFontWeights(output.fontWeights);
  range.setFontSizes(output.fontSizes);

  sheet
    .getRange(CONFIG.dataStartRow, COL.notes + 1, totalRows, 2)
    .setRichTextValues(output.richText);
}

// ============================================================
// ROW STYLING
// ============================================================

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
  return /^\d{2}\s/.test(clean_(text));
}

function pushChapterStyleOnly_(output, label) {
  var row = fillRow_("");
  row[COL.innovation] = label;
  output.values.push(row);
  output.backgrounds.push(fillRow_(CONFIG.colors.chapterBand));
  output.fontColors.push(fillRow_(CONFIG.colors.chapterInk));
  output.fontWeights.push(fillRow_("bold"));
  output.fontSizes.push(fillRow_(CONFIG.font.chapterNumberSize));
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

function newOutput_() {
  return {
    values: [],
    backgrounds: [],
    fontColors: [],
    fontWeights: [],
    fontSizes: [],
    richText: []
  };
}

function pushDataRow_(output, rowValues, richTextRow) {
  var status = clean_(rowValues[COL.status]);
  var priority = clean_(rowValues[COL.priority]);
  var style = STATUS_STYLES[status];

  output.values.push(rowValues);
  output.backgrounds.push(fillRow_(style ? style.bg : null));
  output.fontColors.push(dataFontColors_(style, priority));
  output.fontWeights.push(dataFontWeights_(priority));
  output.fontSizes.push(dataFontSizes_());
  output.richText.push(richTextRow || emptyRichRow_());
}

function dataFontSizes_() {
  var sizes = fillRow_(CONFIG.font.defaultSize);
  sizes[COL.innovation] = 11;
  sizes[COL.status] = 9;
  sizes[COL.tier] = 10;
  sizes[COL.priority] = 10;
  return sizes;
}

function pushDividerRow_(output, label) {
  var row = fillRow_("");
  row[COL.innovation] = label;

  output.values.push(row);
  output.backgrounds.push(fillRow_(CONFIG.colors.dividerBg));
  output.fontColors.push(fillRow_(CONFIG.colors.dividerFg));
  output.fontWeights.push(fillRow_("bold"));
  output.fontSizes.push(fillRow_(CONFIG.font.dividerSize));
  output.richText.push(emptyRichRow_());
}

function pushChapterHeader_(output, ordinal, owner, stats) {
  var label = pad2_(ordinal) + "   " + owner.toUpperCase() + "   —   " + stats.count;

  var row = fillRow_("");
  row[COL.innovation] = label;

  output.values.push(row);
  output.backgrounds.push(fillRow_(CONFIG.colors.chapterBand));
  output.fontColors.push(fillRow_(CONFIG.colors.chapterInk));
  output.fontWeights.push(fillRow_("bold"));
  output.fontSizes.push(fillRow_(CONFIG.font.chapterNumberSize));
  output.richText.push(emptyRichRow_());
}

function pad2_(n) {
  return n < 10 ? "0" + n : "" + n;
}

function pushBlankRow_(output) {
  output.values.push(fillRow_(""));
  output.backgrounds.push(fillRow_(null));
  output.fontColors.push(fillRow_(CONFIG.colors.defaultFg));
  output.fontWeights.push(fillRow_("normal"));
  output.fontSizes.push(fillRow_(CONFIG.font.defaultSize));
  output.richText.push(emptyRichRow_());
}

function dataFontColors_(statusStyle, priority) {
  var colors = fillRow_(CONFIG.colors.defaultFg);

  colors[COL.tier] = "#666666";
  colors[COL.investigator] = "#444444";
  colors[COL.notes] = "#555555";
  colors[COL.updated] = "#666666";

  if (statusStyle) {
    colors[COL.status] = statusStyle.font;
  }

  if (priority === PRIORITY.CRITICAL) {
    colors[COL.priority] = CONFIG.colors.criticalFg;
  }

  return colors;
}

function dataFontWeights_(priority) {
  var weights = fillRow_("normal");

  weights[COL.status] = "bold";
  weights[COL.innovation] = "bold";

  if (priority === PRIORITY.CRITICAL) {
    weights[COL.priority] = "bold";
  }

  return weights;
}

function padOutput_(output, targetRows) {
  while (output.values.length < targetRows) {
    pushBlankRow_(output);
  }
}

function fillRow_(value) {
  var row = [];

  for (var i = 0; i < CONFIG.numCols; i++) {
    row.push(value);
  }

  return row;
}

function emptyRichRow_() {
  var empty = SpreadsheetApp.newRichTextValue().setText("").build();
  return [empty, empty];
}

// ============================================================
// HELPERS
// ============================================================

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

function clean_(value) {
  return value === null || value === undefined ? "" : value.toString().trim();
}

function isDividerValue_(value) {
  var text = clean_(value);

  return text.indexOf(CONFIG.dividerPrefix) === 0 ||
    text.indexOf("──") === 0 ||
    text === CONFIG.oldDoneLabel ||
    /^\d{2}\s/.test(text);
}

function toast_(message) {
  try {
    SpreadsheetApp.getActiveSpreadsheet().toast(message, "State of Innovation", 5);
  } catch (e) {
    Logger.log(message);
  }
}

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

  var raw = row.values[COL.updated];
  if (!raw && raw !== 0) return 0;

  var lastUpdated = raw instanceof Date ? raw : new Date(raw);
  if (isNaN(lastUpdated.getTime())) return 0;

  var diffMs = today.getTime() - lastUpdated.getTime();
  var diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  var threshold = getStaleThresholdDays_(row.values[COL.tier]);

  return diffDays > threshold ? diffDays : 0;
}

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

// ============================================================
// AI — prompt generators (you paste into Claude.ai / ChatGPT / Gemini)
// ============================================================
// No API calls. Each mode builds a prompt + your sheet's data context
// and shows it in a modal with a Copy button. Paste into any AI tool,
// read the response there, manually act on it.
// ============================================================

function gatherInFlightRows_() {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.dataStartRow) return [];

  var values = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, CONFIG.numCols).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var name = clean_(r[COL.innovation]).replace(/^(\[\d+d\]\s+)+/, "");
    if (!name || isDividerValue_(name)) continue;
    var status = clean_(r[COL.status]);
    if (status === STATUS.DONE || status === STATUS.PAUSED) continue;

    out.push({
      innovation: name,
      investigator: clean_(r[COL.investigator]),
      tier: clean_(r[COL.tier]),
      priority: clean_(r[COL.priority]),
      status: status,
      confidence: clean_(r[COL.confidence]),
      lastUpdated: r[COL.updated] instanceof Date
        ? Utilities.formatDate(r[COL.updated], Session.getScriptTimeZone(), "yyyy-MM-dd")
        : clean_(r[COL.updated]),
      notes: clean_(r[COL.notes])
    });
  }
  return out;
}

function gatherRecentlyUpdatedRows_(daysAgo) {
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.dataStartRow) return [];

  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysAgo);

  var values = sheet.getRange(CONFIG.dataStartRow, 1, lastRow - CONFIG.dataStartRow + 1, CONFIG.numCols).getValues();
  var out = [];

  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var name = clean_(r[COL.innovation]).replace(/^(\[\d+d\]\s+)+/, "");
    if (!name || isDividerValue_(name)) continue;

    var raw = r[COL.updated];
    var when = raw instanceof Date ? raw : (raw ? new Date(raw) : null);
    if (!when || isNaN(when.getTime()) || when < cutoff) continue;

    out.push({
      innovation: name,
      investigator: clean_(r[COL.investigator]),
      tier: clean_(r[COL.tier]),
      priority: clean_(r[COL.priority]),
      status: clean_(r[COL.status]),
      confidence: clean_(r[COL.confidence]),
      lastUpdated: Utilities.formatDate(when, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      notes: clean_(r[COL.notes])
    });
  }
  return out;
}

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
  showAiPrompt_("Explain · " + innovation, prompt,
    "Paste into Claude.ai / ChatGPT / Gemini chat. Read the explanation there.");
}

function whatToWorkOnAi() {
  var rows = gatherInFlightRows_();
  if (rows.length === 0) { SpreadsheetApp.getUi().alert("No in-flight rows to analyze."); return; }
  var prompt = buildWhatToWorkOnPrompt_(rows);
  showAiPrompt_("What should I work on next?", prompt,
    "Paste into your AI tool. It'll rank your top 3 bets to work on today.");
}

function draftStandupAi() {
  var recent = gatherRecentlyUpdatedRows_(7);
  if (recent.length === 0) { SpreadsheetApp.getUi().alert("No rows updated in the last 7 days."); return; }
  var prompt = buildStandupPrompt_(recent);
  showAiPrompt_("Standup · last 7 days", prompt,
    "Paste into your AI tool. The reply is markdown — paste it into Slack/Notion.");
}

function suggestTierPriorityStatusAi() {
  var rows = gatherInFlightRows_();
  if (rows.length === 0) { SpreadsheetApp.getUi().alert("No in-flight rows."); return; }
  var prompt = buildSuggestDropdownsPrompt_(rows);
  showAiPrompt_("Suggest tier / priority / status", prompt,
    "The AI returns a markdown checklist of suggested dropdown changes. Manually edit the cells you want to apply.");
}

function flagRisksAi() {
  var rows = gatherInFlightRows_();
  if (rows.length === 0) { SpreadsheetApp.getUi().alert("No in-flight rows."); return; }
  var prompt = buildFlagRisksPrompt_(rows);
  showAiPrompt_("Flag risks & stale work", prompt,
    "The AI returns a list of risk signals + suggested actions. Manually act on the ones that look right.");
}

function draftHypothesesAi() {
  var ideaRows = gatherInFlightRows_().filter(function(r) { return r.status === STATUS.IDEA; });
  if (ideaRows.length === 0) { SpreadsheetApp.getUi().alert("No Idea rows."); return; }

  var enriched = ideaRows.map(function(r) {
    var d = getBetDetail_(r.innovation);
    return {
      innovation: r.innovation,
      investigator: r.investigator,
      tier: r.tier,
      notes: r.notes,
      currentHypothesis: d.hypothesis || ""
    };
  }).filter(function(r) { return r.currentHypothesis === ""; });

  if (enriched.length === 0) { SpreadsheetApp.getUi().alert("All Idea rows already have hypotheses."); return; }

  var prompt = buildDraftHypothesesPrompt_(enriched);
  showAiPrompt_("Draft missing hypotheses", prompt,
    "The AI drafts a hypothesis per Idea row. Open the Bet Detail sidebar to paste the ones you like into the Hypothesis field.");
}

function proposeNewPebblesAi() {
  var rows = gatherInFlightRows_();
  if (rows.length === 0) { SpreadsheetApp.getUi().alert("No in-flight rows for context."); return; }
  var prompt = buildProposePebblesPrompt_(rows);
  showAiPrompt_("Propose new Pebble experiments", prompt,
    "The AI proposes 3-5 new bets. Add the ones you like as new rows in the sheet.");
}

function buildExplainRowPrompt_(rowValues, detail) {
  var lines = [];
  lines.push("Explain this bet to me in plain English. Cover what it is, where it stands, what's at risk, and what's next.");
  lines.push("Keep it tight — 4-6 short markdown sections, no fluff.");
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

function buildWhatToWorkOnPrompt_(rows) {
  return "Look at this portfolio of in-flight bets. Recommend the TOP 3 to work on today, ranked by a mix of priority, confidence, staleness (older Last Updated = staler), and signal in the notes.\n\n" +
    "For each pick, give: (1) the bet name, (2) why it's #1/#2/#3, (3) one concrete next action. Use markdown.\n\n" +
    "Portfolio:\n" + JSON.stringify(rows, null, 2);
}

function buildStandupPrompt_(recent) {
  return "Generate a weekly standup update in markdown for these bets that moved in the last 7 days.\n\n" +
    "Format with these sections (omit any that are empty):\n" +
    "## Shipped\n## In flight\n## Blocked / Waiting\n## Next up\n\n" +
    "Keep each item to one line. Use the Status field to bucket. Use the Investigator field to attribute. Don't invent details — only use what's in the data.\n\n" +
    "Recent activity:\n" + JSON.stringify(recent, null, 2);
}

function buildSuggestDropdownsPrompt_(rows) {
  return "Review this portfolio of bets. For each row where Notes / context contradicts the current Tier / Priority / Status dropdown values, suggest a change.\n\n" +
    "Output format — markdown checklist, one bullet per suggestion:\n" +
    "- **<Innovation name>** — <column>: `<current value>` → `<suggested value>`. <one-line reason>\n\n" +
    "Only propose changes when there's STRONG signal in the notes — don't propose routine adjustments. Limit to 5 suggestions max.\n\n" +
    "Valid tier values: " + TIER_OPTIONS.join(" | ") + "\n" +
    "Valid priority values: " + PRIORITY_OPTIONS.join(" | ") + "\n" +
    "Valid status values: " + STATUS_OPTIONS.join(" | ") + "\n\n" +
    "Portfolio:\n" + JSON.stringify(rows, null, 2);
}

function buildFlagRisksPrompt_(rows) {
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  return "Audit this portfolio for risk signals. Surface bets where:\n" +
    "- Last Updated is more than 14 days ago and not Done/Paused/Idea (stale work)\n" +
    "- Notes mention blockers, delays, performance issues, or kill criteria conditions\n" +
    "- A row should probably move to Paused / Fixing / Waiting based on signal\n\n" +
    "Today's date: " + today + "\n\n" +
    "Output as markdown checklist:\n" +
    "- **<Innovation name>** — <risk signal>. Suggested action: <action>\n\n" +
    "Limit to 5. Be specific.\n\n" +
    "Portfolio:\n" + JSON.stringify(rows, null, 2);
}

function buildDraftHypothesesPrompt_(enriched) {
  return "For each Idea row missing a Hypothesis, draft a one-line hypothesis grounded in the Innovation name + Notes.\n\n" +
    "Format: \"If [we do X], [Y will happen] because [Z].\"\n\n" +
    "Output as markdown:\n" +
    "- **<Innovation name>** — <drafted hypothesis>\n\n" +
    "Don't invent details — only use what's in the data. Skip rows where notes give no signal.\n\n" +
    "Idea rows missing hypothesis:\n" + JSON.stringify(enriched, null, 2);
}

function buildProposePebblesPrompt_(rows) {
  return "Based on this portfolio of bets, propose 3-5 NEW Pebble-tier experiments that would unblock or de-risk current work.\n\n" +
    "A good Pebble:\n" +
    "- Small (1-3 hours of work)\n" +
    "- Generates evidence for a bigger bet in the portfolio\n" +
    "- Specific and actionable (e.g. 'Spike Claude API for X' not 'Try AI')\n\n" +
    "Output as markdown:\n" +
    "- **<bet name>** — owner: <name>. <which bigger bet this unblocks>\n\n" +
    "Use existing Investigator names as owners.\n\n" +
    "Portfolio:\n" + JSON.stringify(rows, null, 2);
}

function showAiPrompt_(title, prompt, instructions) {
  var html = HtmlService.createHtmlOutput(aiPromptModalHtml_(title, prompt, instructions))
    .setWidth(640).setHeight(620);
  SpreadsheetApp.getUi().showModalDialog(html, "AI Prompt Ready");
}

function aiPromptModalHtml_(title, prompt, instructions) {
  var safeTitle = title.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var safeInstr = (instructions || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  var safePrompt = JSON.stringify(prompt);
  return '' +
    '<!DOCTYPE html><html><head><base target="_top">' +
    '<style>' +
    '  body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0a0a0a;background:#fafafa;margin:0;padding:20px;}' +
    '  .eyebrow{font-size:9px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#999;margin-bottom:4px;}' +
    '  h1{font-size:18px;margin:0 0 6px;line-height:1.3;}' +
    '  .instr{font-size:11px;color:#555;margin-bottom:14px;line-height:1.5;}' +
    '  .prompt{background:#fff;border:1px solid rgba(0,0,0,0.1);padding:14px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;line-height:1.55;color:#0a0a0a;white-space:pre-wrap;word-wrap:break-word;max-height:380px;overflow-y:auto;}' +
    '  .actions{display:flex;gap:8px;margin-top:14px;align-items:center;}' +
    '  button{font-family:inherit;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;padding:11px 22px;cursor:pointer;border:1px solid #0a0a0a;background:#0a0a0a;color:#F7BE68;}' +
    '  button.secondary{background:#fff;color:#0a0a0a;}' +
    '  .meta{font-size:10px;color:#999;margin-left:auto;}' +
    '  .copied{color:#2E8B3D;font-weight:700;}' +
    '</style></head><body>' +
    '<div class="eyebrow">AI Prompt · Ready to paste</div>' +
    '<h1>' + safeTitle + '</h1>' +
    '<div class="instr">' + safeInstr + '</div>' +
    '<div class="prompt" id="prompt"></div>' +
    '<div class="actions"><button id="copy">Copy prompt</button><button class="secondary" id="close">Close</button><span class="meta" id="len"></span></div>' +
    '<script>' +
    '  var P = ' + safePrompt + ';' +
    '  document.getElementById("prompt").textContent = P;' +
    '  document.getElementById("len").textContent = P.length + " chars";' +
    '  document.getElementById("copy").addEventListener("click", function(){' +
    '    var ta = document.createElement("textarea"); ta.value = P; document.body.appendChild(ta);' +
    '    ta.select(); document.execCommand("copy"); document.body.removeChild(ta);' +
    '    this.textContent = "Copied — go paste it"; this.classList.add("copied");' +
    '  });' +
    '  document.getElementById("close").addEventListener("click", function(){ google.script.host.close(); });' +
    '</script></body></html>';
}

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

function saveBetDetailFor(innovationKey, fields) {
  setBetDetail_(innovationKey, {
    hypothesis:   fields.hypothesis,
    killCriteria: fields.killCriteria,
    evidenceLink: fields.evidenceLink
  });
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

function warnHypothesisMissing_(innovationKey) {
  var detail = getBetDetail_(innovationKey);
  if (clean_(detail.hypothesis) !== "") return;
  var msg = "Heads up: \"" + innovationKey + "\" doesn't have a hypothesis yet. Open Bet Detail to add one.";
  toast_(msg);
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

// ============================================================
// GUIDE SIDEBAR
// ============================================================

function showTierLegend() {
  var html = ''
    + '<style>'
    + 'body{font-family:Google Sans,Arial,sans-serif;padding:16px;background:#f8f9fa}'
    + 'h2{color:#1B3A5C;border-bottom:2px solid #1B3A5C;padding-bottom:8px}'
    + 'h3{color:#1B3A5C;margin:18px 0 8px}'
    + '.tier{padding:14px;margin:10px 0;border-radius:8px;border-left:5px solid;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.1)}'
    + '.tier h3{margin:0 0 4px;font-size:15px;color:#222}'
    + '.tier p{margin:0;font-size:13px;color:#555}'
    + '.item{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px}'
    + '.dot{width:12px;height:12px;border-radius:50%;display:inline-block}'
    + '</style>'
    + '<h2>📊 Dashboard Guide</h2>'
    + '<h3>Tiers</h3>';

  TIER_OPTIONS.forEach(function(tier) {
    html += '<div class="tier"><h3>' + tier + '</h3><p>' + TIER_INFO[tier] + '</p></div>';
  });

  html += '<h3>Statuses</h3>';

  STATUS_OPTIONS.forEach(function(status) {
    var style = STATUS_STYLES[status] || { bg: "#ffffff" };
    html += '<div class="item"><span class="dot" style="background:' + style.bg + '"></span>' + status + '</div>';
  });

  html += '<h3>Priorities</h3>';

  PRIORITY_OPTIONS.forEach(function(priority) {
    html += '<div class="item">' + priority + '</div>';
  });

  SpreadsheetApp.getUi().showSidebar(
    HtmlService.createHtmlOutput(html)
      .setTitle("Dashboard Guide")
      .setWidth(300)
  );
}

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
    if (ui) {
      var aestheticOnly = ui.alert(
        "Already migrated.",
        "The Confidence column is already in place. Reapply aesthetic polish (hide gridlines, taller rows, hairlines)?",
        ui.ButtonSet.OK_CANCEL
      );
      if (aestheticOnly === ui.Button.OK) {
        applySheetAesthetics_(sheet);
        toast_("Aesthetic polish reapplied.");
      }
    }
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
  applySheetAesthetics_(sheet);

  toast_("Phase 1a schema migration applied. Confidence column ready.");
}

function migrateStatusToPlain() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) {
    if (ui) ui.alert("Nothing to migrate (sheet has no data rows).");
    return;
  }

  if (ui) {
    var resp = ui.alert(
      "Strip emoji prefixes from Status column?",
      "Existing values like \"✅ Done\" become \"Done\", \"🔨 Working\" becomes \"Working\", etc. The Status dropdown is updated to the new plain options. Idempotent — safe to re-run.",
      ui.ButtonSet.OK_CANCEL
    );
    if (resp !== ui.Button.OK) return;
  }

  var range = sheet.getRange(CONFIG.dataStartRow, COL.status + 1, lastRow - CONFIG.dataStartRow + 1, 1);
  var values = range.getValues();
  var converted = 0;

  var out = values.map(function(row) {
    var raw = clean_(row[0]);
    if (STATUS_MIGRATION_MAP.hasOwnProperty(raw)) {
      converted += 1;
      return [STATUS_MIGRATION_MAP[raw]];
    }
    return [raw];
  });

  range.setValues(out);
  applyDropdowns_(sheet);

  toast_("Status emoji-stripped: " + converted + " row(s) updated. Dropdown refreshed.");
}

function migrateLastUpdatedToDate() {
  var ui = null;
  try { ui = SpreadsheetApp.getUi(); } catch (e) { ui = null; }
  var sheet = SpreadsheetApp.getActiveSheet();
  var lastRow = sheet.getLastRow();

  if (lastRow < CONFIG.dataStartRow) {
    if (ui) ui.alert("Nothing to migrate (sheet has no data rows).");
    return;
  }

  var range = sheet.getRange(CONFIG.dataStartRow, COL.updated + 1, lastRow - CONFIG.dataStartRow + 1, 1);
  var values = range.getValues();
  var converted = 0;

  var out = values.map(function(row) {
    var raw = row[0];
    if (raw instanceof Date) return [raw];
    if (typeof raw === "string" && raw.trim()) {
      var parsed = new Date(raw);
      if (!isNaN(parsed.getTime())) {
        converted += 1;
        return [parsed];
      }
    }
    return [raw];
  });

  range.setValues(out);
  range.setNumberFormat("d mmm");
  range.setHorizontalAlignment("right");

  toast_("Converted " + converted + " timestamp(s) to Date + 'd mmm' display format.");
}

// ============================================================
// TESTS — run from the Apps Script editor; results in Logger
// ============================================================

function test_doneRowsStayWithOwner() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_done_stays__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, CONFIG.numCols).setValues([HEADERS]);
    testSheet.getRange(2, 1, 3, CONFIG.numCols).setValues([
      ["Bet A", "Alice", "🪨 Stone", PRIORITY.HIGH,     STATUS.WORKING, "", "", "2026-05-01 10:00"],
      ["Bet B", "Alice", "🪨 Stone", PRIORITY.CRITICAL, STATUS.DONE,    "", "", "2026-05-01 10:00"],
      ["Bet C", "Alice", "🪨 Stone", PRIORITY.MEDIUM,   STATUS.WORKING, "", "", "2026-05-01 10:00"]
    ]);
    ss.setActiveSheet(testSheet);
    groupByOwnerCore_();
    var lastRow = testSheet.getLastRow();
    var rowsAfter = testSheet.getRange(2, 1, lastRow - 1, COL.innovation + 1).getValues();
    var positions = {};
    for (var i = 0; i < rowsAfter.length; i++) {
      var name = rowsAfter[i][COL.innovation];
      if (name && !isDividerValue_(name)) positions[name] = i;
    }
    // v6 sorts by owner (Alice), then priority (Critical < High < Medium), then status.
    // So Bet B (Critical, Done) sorts FIRST within Alice's chapter — proving Done is
    // not being shoved into a separate section.
    passed = positions["Bet B"] !== undefined &&
             positions["Bet A"] !== undefined &&
             positions["Bet C"] !== undefined &&
             positions["Bet B"] < positions["Bet A"] &&
             positions["Bet A"] < positions["Bet C"];
    Logger.log("test_doneRowsStayWithOwner: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  positions = " + JSON.stringify(positions));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}

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

function test_staleBadgePrepended() {
  var ss = SpreadsheetApp.getActive();
  var prevSheet = ss.getActiveSheet();
  var testSheet = ss.insertSheet("__test_stale_badge__");
  var passed = false;
  try {
    testSheet.getRange(1, 1, 1, CONFIG.numCols).setValues([HEADERS]);
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

    var label = clean_(testSheet.getRange(2, COL.innovation + 1).getValue());
    passed = /^01\s+ALICE\s+—\s+3$/.test(label);

    Logger.log("test_chapterHeaderRendersStats: " + (passed ? "PASS" : "FAIL"));
    Logger.log("  chapter label = " + JSON.stringify(label));
  } finally {
    ss.setActiveSheet(prevSheet);
    ss.deleteSheet(testSheet);
  }
  return passed;
}

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

  var confDrop = shouldPromptDecisionLog_("", "", 70, 50);
  var confSmallDrop = shouldPromptDecisionLog_("", "", 70, 60);
  var confRise = shouldPromptDecisionLog_("", "", 30, 70);
  if (!confDrop) { Logger.log("  FAIL: 70→50 conf drop should prompt"); allPass = false; }
  if (confSmallDrop) { Logger.log("  FAIL: 70→60 conf small drop should NOT prompt"); allPass = false; }
  if (confRise) { Logger.log("  FAIL: 30→70 conf rise should NOT prompt"); allPass = false; }

  Logger.log("test_shouldPromptOnMeaningfulTransitionsOnly: " + (allPass ? "PASS" : "FAIL"));
  return allPass;
}
