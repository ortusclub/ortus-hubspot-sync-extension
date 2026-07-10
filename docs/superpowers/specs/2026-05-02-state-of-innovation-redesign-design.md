# State of Innovation — Redesign Spec

**Date:** 2026-05-02
**Owner:** Antonio Varlese
**Subject of redesign:** the `StateOfInnovationDashboard.js` Google Apps Script and the Google Sheet it powers (the Ortus "State of Innovation" portfolio tracker)
**Status:** approved for planning

---

## 1. Why this redesign

The current sheet works but has three shortcomings:

1. **Auto-move-to-Done is intrusive.** Marking a row "Done" instantly relocates it to a separate Done section, breaking the user's mental model of where their work is.
2. **No portfolio-level intelligence.** The sheet captures *what* happened but not *why*, and gives no signal when something is rotting (stale, low-confidence, kill-criteria met).
3. **No Anthropic-flavored discipline.** A research-y org running a project tracker should have explicit hypotheses, kill criteria, confidence intervals, and a decision log — not just a status pill.

This redesign keeps the sheet's existing strengths (color-coded statuses, owner grouping, smart-chip preservation) and adds:
- A behavior fix for the Done auto-move
- A Bet Detail side-panel for narrative fields
- An AI Toolkit powered by Claude (7 modes)
- Visible owner separation, stale badges, and per-tier thresholds
- A complete visual refresh in the **Ortus Outreach Command Deck** style (light theme)

---

## 2. Visual direction (locked)

**Style:** Light-theme Ortus Outreach Command Deck — the same Bugatti-inspired design system used in `~/ortus-gologin-clone/public/css/style.css`.

**Tokens:**
| Token | Value | Use |
|---|---|---|
| `--bg` | `#fafafa` | Canvas |
| `--ink` | `#0a0a0a` | All text and borders |
| `--gray` | `#999999` | Eyebrows, secondary labels, disabled |
| `--hairline` | `rgba(0,0,0,0.15)` | Block dividers |
| `--hairline-soft` | `rgba(0,0,0,0.06)` | Row dividers |
| `--gold` | `#F7BE68` | **Primary CTA only** ("Run AI triage") |
| `--green` | `#3fb950` (dark `#2e8b3d` on light bg) | Done status only |
| `--red` | `#f85149` (dark `#c93b34` on light bg) | Stale badges, kill-criteria, alert states |
| `--blue` | `#2667c9` | Testing status only (functional) |

**Type:**
- Display: `Bebas Neue` (weight 400) — sculptural, ALL CAPS, used at 18px+ for owner names, big numbers, headings
- Body / UI labels: `Hanken Grotesk` — UI labels run UPPERCASE with `0.14–0.18em` tracking
- Inside the Sheet itself, the closest available substitutes are used (Sheets has limited font support — see §6)

**Rules:**
- Border radius: `0` for blocks/tiles, `9999px` for pills only
- No shadows. No gradients.
- Hairlines only — never thick borders.
- Hover = opacity shift (no transforms, no glows).
- One gold moment per screen.

---

## 3. Sheet schema

### 3.1 Existing columns (kept)

| # | Column | Type | Notes |
|---|---|---|---|
| 1 | Innovation | text | The bet name |
| 2 | Investigator | text + dropdown | Owner; powers chapter grouping |
| 3 | Tier | dropdown (Boulder/Stone/Rock/Pebble) | |
| 4 | Priority | dropdown (5 levels) | |
| 5 | Status | dropdown (8 statuses) | |
| 6 | Notes | rich text + smart chips | Smart chips must be preserved through sort |
| 7 | Link | rich text + smart chips | Same |
| 8 | Last Updated | timestamp | Auto-set on any data column edit |

### 3.2 New columns (1 added)

| # | Column | Type | Notes |
|---|---|---|---|
| 9 | Confidence | dropdown (10/30/50/70/90 %) | 5-bucket scale: 1-in-10, 1-in-3, coin flip, likely, near-certain |

### 3.3 Bet Detail panel fields (NOT columns — live in sidebar)

These fields are stored per-row in a hidden "Bet Detail" sheet (rationale: avoids polluting the main sheet width while remaining native Sheets data, queryable and exportable).

| Field | Type | Notes |
|---|---|---|
| Hypothesis | long text | "If X then Y because Z" — required (soft warning) before leaving Idea status |
| Kill criteria | long text | Conditions under which the bet should be killed |
| Evidence link | URL + smart chip | Pointer to the eval doc / dashboard / metric |
| Decision log | append-only journal | Auto-prompted on meaningful transitions (see §4.4) |

**Lookup:** the hidden `BetDetail` sheet has columns `[innovationKey, hypothesis, killCriteria, evidenceLink, decisionLogJson]`. `innovationKey` = the Innovation cell value at write time (with collision handling — see §6).

### 3.4 Inline visual additions (computed, not stored)

- **Stale badge** — a red `21D` badge next to the Innovation name when `now - lastUpdated > tierThreshold`. Rendered as part of the Innovation cell via rich text.
- **Owner chapter headers** — divider rows (existing pattern) restyled with Bebas Neue + numbered prefix + right-aligned stat trail (count, avg confidence).

---

## 4. Behavior changes

### 4.1 Done fix (Phase 0 — ships first, standalone)

- Marking a row Done **does not move it.** The row stays where it is, gets the green Done pill styling, and stops being counted in "in flight" stats.
- A new menu item **"Move completed to Done section"** runs the consolidation manually. This preserves the user's ability to archive in one click without surprising them on every status change.
- Inside `groupByOwnerCore_`, the `doneRows` separation is removed from the auto-sort path. Done rows sort with their owner by priority like everything else.

### 4.2 Owner chapter rendering

Each owner becomes a visible "chapter":
- Divider row at top with format: `01 · ANTONIO · IN FLIGHT · 4 · AVG CONF · 68%`
- Bebas-style heavy header (or closest Sheets substitute), `#f3f3f3` row background
- Done section is the last chapter, prefixed `✓` instead of a number, dimmed (60% opacity via lighter foreground colors)
- Numbering reflects display order (alphabetical with Unassigned last), not a stored ID

### 4.3 Stale detection

- Per-tier thresholds (configurable in a `Settings` sheet):
  - Boulder: 21d
  - Stone: 14d
  - Rock: 10d
  - Pebble: 7d
- Statuses excluded from staleness: `Done`, `Paused`, `IDEA`
- Stale rows get a red `[Nd]` badge inline before the Innovation name, applied via rich text on every recompute (recomputed on sort and on time-driven trigger once per day)
- Stale rows surface in the sidebar's "Stale > 14d" tile

### 4.4 Decision log prompt

A modal fires asking "Why?" when:
- Status changes to `Done`, `Paused`, `Fixing`, or `Waiting for feedback`
- Status changes from `Idea` to `Working`
- Confidence drops by ≥ 20 percentage points

The modal:
- Has a free-text field
- Pre-fills the transition (e.g., `Working → Fixing`)
- Cannot be skipped silently — but has an explicit "skip this one" button that records `(no reason given)`
- Writes the entry to `BetDetail.decisionLogJson` with `{when, transition, what, who}`
- Does NOT fire on quick edits (notes, link, priority, tier) — only on the trigger transitions above

### 4.5 Hypothesis enforcement

- Soft only. When a user changes Status from `Idea` to anything else, if `BetDetail.hypothesis` is empty, a yellow toast appears: "Add a hypothesis before this leaves Idea?" with two buttons: "Add now" (opens Bet Detail panel) and "Continue without."
- Never blocks the change.

---

## 5. AI Toolkit (powered by Claude)

### 5.1 Entry point

- Single menu item: **"AI Toolkit"** opens a modal dialog (not a sidebar — needs more horizontal space for diff review)
- The modal shows 7 modes in a 2-column bento grid

### 5.2 The 7 modes

| # | Mode | Shape | Reads |
|---|---|---|---|
| 1 | Suggest tier · priority · status from Notes | Diff | All rows |
| 2 | Flag risks & stale work | Diff | All rows |
| 3 | Draft missing hypotheses | Diff | Idea rows only |
| 4 | Propose new Pebble experiments | Diff | All rows |
| 5 | Explain this row to me | Report | Selected row only |
| 6 | What should I work on next? | Report | Caller's assigned rows |
| 7 | Draft this week's standup update | Report | Last 7 days of changes |

**Diff modes** produce a list of proposed cell changes. Each goes through the 3-step flow: pick modes → review per-row Accept/Reject → applied (with auto-generated decision log entries). **Auto-apply is OFF by default.**

**Report modes** produce a markdown text block rendered in the modal. A "Copy as markdown" button. Auto-send to channels stays OFF (per standing rule).

### 5.3 API integration

- Model: `claude-sonnet-4-6` (default — balanced cost/quality for triage). Configurable in Settings.
- API key stored in **Script Properties** (`PropertiesService.getScriptProperties()`).
- Menu item **"Configure API key…"** opens a prompt to set/test the key. Test sends a 1-token completion to validate.
- Each call is logged to a hidden `AILog` sheet: `[when, mode, inputTokens, outputTokens, cost, success]`.
- Daily token budget guardrail: default 200K, alert toast at 80%. Configurable in Settings.
- Rejected proposals are quarantined for 14d in a hidden `TriageRejected` range so re-runs don't re-suggest them.

### 5.4 Prompt structure

Each mode has a fixed system prompt + a runtime payload of relevant rows (CSV-formatted with column headers + the row's BetDetail fields). Diff modes return JSON matching a schema; the script validates before showing diffs. Report modes return markdown.

---

## 6. Architecture

### 6.1 Files

The script stays as a single Apps Script file (`StateOfInnovationDashboard.js`) but grows in size. Internal organization:

```
// CONFIG               (current — extended with new tokens/columns)
// SETUP & DROPDOWNS    (current — extended for Confidence column)
// onEdit + auto-sort   (modified — Done fix, decision log trigger, stale recompute)
// applyRowColors       (current — extended for stale badges, owner chapter style)
// groupByOwner         (modified — no Done split)
// consolidateDone      (NEW — manual Done section consolidation)
// betDetail            (NEW — read/write hidden BetDetail sheet)
// betDetailSidebar     (NEW — HTML sidebar for narrative fields)
// staleDetector        (NEW — per-tier threshold computation, badge rendering)
// decisionLog          (NEW — modal prompt, journal append)
// aiToolkit            (NEW — modal, 7 modes, Claude API client)
// settings             (NEW — Settings sheet read/write, API key UI)
// menu                 (extended)
```

If any of these grow past ~300 LOC they get extracted to separate `.gs` files.

### 6.2 Hidden support sheets

- `BetDetail` — narrative fields per row, keyed by Innovation name
- `Settings` — API key reference, model choice, stale thresholds per tier, token budget
- `AILog` — every Claude API call (telemetry)
- `TriageRejected` — 14-day quarantine of rejected proposals

Hidden via `sheet.hideSheet()`.

### 6.3 Innovation key collisions

Two rows with the same Innovation name would collide in the BetDetail lookup. Mitigation: when writing, append a `-2`, `-3` suffix if the key already exists. When the user renames an Innovation, the BetDetail row is renamed in tandem (via onEdit hook on column 1).

### 6.4 Sheets font constraints

Google Sheets supports a limited font set. Mapping:
- `Bebas Neue` → fallback to `Oswald` (available in Sheets) for owner chapter headers and big numbers
- `Hanken Grotesk` → fallback to `Inter` (available in Sheets), or `Roboto` if Inter rejected

The HTML sidebar/modal uses the real Bebas Neue + Hanken Grotesk loaded via Google Fonts.

---

## 7. Phasing (for the implementation plan)

### Phase 0 — Done fix (standalone, ~30 min)
- Modify `groupByOwnerCore_` to keep Done rows with owner
- Add `consolidateDoneSection()` and menu item
- Done rows display as 60% opacity in chapter

### Phase 1 — Schema + visual refresh (~3-4 hr)
- New tokens applied (light Ortus palette)
- Confidence column + dropdown
- BetDetail hidden sheet + sidebar
- Owner chapter rendering with Bebas-substitute headers + stat trail
- Stale badges per tier
- Soft hypothesis warning
- Decision log prompt + journal
- Settings sheet

### Phase 2 — AI Toolkit (~4-6 hr)
- API key config UI + Script Properties storage
- AILog telemetry + token budget guardrail
- Diff flow (modes 1-4) with accept/reject UI
- Report flow (modes 5-7) with markdown render + copy
- TriageRejected quarantine

Each phase ships as its own commit. Phase 0 is risk-free; Phase 1 changes the sheet's appearance; Phase 2 introduces external API dependency.

---

## 8. Non-goals

- No external dashboard / web app — everything stays inside the Sheet
- No team-wide notifications (Slack/email/Discord) — this is single-user-with-collaborators, not a broadcast tool. Auto-send stays OFF.
- No Linear / Notion / Jira sync — out of scope
- No mobile-specific design — Sheets mobile is read-only for this use case
- No multiplayer "presence" indicators — Sheets handles cell-level collaboration natively
- No retroactive backfill of decision log entries for existing rows — log starts from Phase 1 ship date

---

## 9. Open questions (resolve before/during planning)

1. **Repository home for the script.** The script currently lives untracked in the HS Extension worktree. Should it move to its own repo (`state-of-innovation-script` or similar)? Recommended yes, but not blocking the work itself — can defer.
2. **Test plan.** Apps Script has limited testing infrastructure. We can build smoke tests in a separate sheet copy. Will define in the implementation plan.
3. **Migration of existing rows.** When Phase 1 ships, existing rows have no Confidence value, no Hypothesis, no Decision Log. Plan: blank Confidence is treated as "—", soft warning surfaces on next edit. No backfill required.

---

## 10. Reference mockups

All mockups live in:
`.superpowers/brainstorm/43568-1777734685/content/`
and (earlier session) `.superpowers/brainstorm/38193-1777717595/content/`

- `visual-direction.html` — initial 3-direction options (A/B/C)
- `visual-direction-v2.html` — Bento Brutalism × Ortus, dark theme
- `visual-direction-v3.html` — light theme, owner chapters (LOCKED)
- `schema-strategy.html` — narrow sheet + Bet Detail panel (LOCKED)
- `ai-triage-flow.html` — 3-step AI triage modal (LOCKED)
- `final-decisions.html` — AI Toolkit menu + closing decisions ledger (LOCKED)
