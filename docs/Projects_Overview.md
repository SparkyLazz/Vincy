# Console — Project Overview

> A personal, fully offline productivity workspace. Five modules under one roof, one visual language, one data store, one shell.

**Status** · Design complete · Phases 1–2 built · Phases 3–4 prompted · Phases 5–8 pending
**Stack** · HTML + CSS + vanilla JavaScript · IndexedDB · self-hosted fonts · no framework, no build step, no CDN in production
**Design language** · Claude Design — warm coral accent, Source Serif 4 + Inter + JetBrains Mono, light + dark

---

## What Console is

Console is a single workspace that unifies five productivity domains — Tasks, Schedule, Habits, Finance, Focus Sessions — plus cross-cutting analytics and insights. It's built for personal use ("top 1% productivity"), fully offline, single-user. It's a standalone app, architecturally separate from any prior productivity software.

Everything runs from a static `index.html` opened directly from disk. Data lives in IndexedDB with JSON export/import for backup and portability.

---

## Core philosophy

Six locked-in decisions that shape everything else:

| Decision | What it means |
|---|---|
| **Fully offline** | No servers, no accounts, no sync. IndexedDB for state. |
| **Universal architecture** | Project-centric, not student- or grade-specific. No academic framing anywhere. |
| **No streaks (Habits)** | Rolling 30-day consistency % only. Missing a day never resets your progress. Antifragile by design. |
| **Strict event typing (Schedule)** | Every calendar block must be one of 8 preset types. No free-text categories. |
| **YNAB-style envelopes (Finance)** | To-Be-Budgeted pool. Every dollar has a job. |
| **GTD inbox-first (Tasks)** | Capture → process → organize. NLP parser resolves dates, tags, priority, project at capture time. |

---

## Features by module

### Tasks
- Natural language parser: `call vendor tomorrow !high @phone #client-a` → parsed fields for date, priority, context, project
- GTD inbox-first flow with process metrics
- Subtasks (1 level), recurring (daily / weekly / monthly / weekday / weekend + exceptions)
- Priority `!low / !med / !high`
- Views: **Inbox · Today · This Week · Upcoming · Someday · Waiting · By Project · By Tag**
- Keyboard-first: N/J/K/X/S/T/⌘E/⌘Z

### Schedule
- Strict event types: `deep_work / meeting / admin / exercise / break / social / errand / sleep`
- Theme days as first-class entities ("Maker Monday", "Touch Base", "Wrap & Ship")
- Mandatory planned-vs-actual logging on every past event (with skip option)
- Recurring events with three exception modes (edit one, edit future, skip one)
- Drag-to-reschedule with 15-min snap
- Views: **Day · Week · Month · Agenda · Theme days editor**

### Habits
- Atomic Habits framework as first-class UI: cue / craving / response / reward + identity + habit stacking + environment
- Multi-state logging: `done / partial / skip / miss`
- Quantitative habits (units + targets: pages, minutes, reps, ml)
- Rolling 30-day consistency (no streaks anywhere)
- Cross-domain: focus sessions with matching tags auto-log the habit
- Views: **Today · All habits · Correlations · Archive**

### Finance
- Multi-currency with per-transaction FX rates
- YNAB-style envelope budgeting: To-Be-Budgeted pool, roll-over rules, savings envelopes
- Subscription audit with usage tracking ("Netflix · 0 uses this month")
- Cost-per-focus-hour analytics (cross-domain: Finance ↔ Focus)
- Hourly equivalent toggle
- Views: **Overview · Transactions · Envelopes · Subscriptions · Reports**

### Focus Sessions
- Three timer modes: Pomodoro / Freeform / Stopwatch-with-target
- Soft strict mode (dim other UI, still allow navigation)
- Mandatory session type tagging (preset list)
- Triggers: from a task, from a scheduled event, from a habit, standalone
- Floating active-session indicator visible from every screen
- Cross-domain: sessions auto-link to habits and tasks

### Cross-cutting

**Today dashboard** — fixed layout, no customization. Insight card → hero stats strip → today's calendar + tasks → habits + quick capture → upcoming week + money snapshot → waiting-for + suggested focus blocks.

**Analytics** — 11 views: Project Investment Matrix, Planned vs Executed, Productive Hours Heatmap, Subscription-vs-Usage Matrix, Habit ↔ Output Correlation, Calendar Load vs Todo Backlog, Decay Analysis, Theme Day Output, Time-Money Rate, Cost per Focus Hour, Energy Index.

**Insights** — ~10 detectors run daily at 06:00:
1. `estimate_accuracy_drift`
2. `procrastination_rising`
3. `commitment_overload`
4. `stale_waiting_items`
5. `subscription_low_use`
6. `envelope_overspend_pattern`
7. `habit_consistency_drop`
8. `unscheduled_obligations`
9. `starving_project`
10. `productive_hour_misalignment`

**Command palette** — `⌘K` — fuzzy across nav + actions + entity search + recent commands.

**Universal filters** — every analytics view has 7d / 30d / 90d / all / custom range.

---

## Screen inventory

| # | Screen | Views | Status |
|---|---|---:|---|
| 1 | Today dashboard | 1 | ✓ Prototyped |
| 2 | Tasks | 8 | ✓ Prototyped (Upcoming shown) |
| 3 | Schedule | 5 | ✓ Prototyped (Week shown) |
| 4 | Habits | 4 | ✓ Prototyped (All shown) |
| 5 | Finance | 5 | ✓ Prototyped (Overview shown) |
| 6 | Focus Sessions | ~3 | ⏳ Not yet prototyped |
| 7 | Analytics | 11 | ⏳ Not yet prototyped |
| 8 | Insights feed | 1 | ⏳ Not yet prototyped |
| 9 | Settings | ~5 sections | ⏳ Not yet prototyped |

**Total unique views across the app: ~40**

Each prototype represents the *default* view for that module. Other views for the same module are specified in the phase prompt but not visually prototyped (the design language is consistent enough that non-default views derive from the shown one).

---

## Design system summary

### Typography (three fonts, zero exceptions)
- **Source Serif 4** — page titles, section titles, annotated stat values, italic annotations, brand mark, "the app speaking about the data"
- **Inter** — body copy, buttons, page-hero numbers (weight **800**, letter-spacing -0.035em)
- **JetBrains Mono** — chrome only: eyebrows, meta rows, pill labels, keyboard hints, timestamps, tabular data

### The two-voice stat rule
- **Hero stat**: Inter 800 huge number + mono uppercase caption + optional accent delta. The single biggest number on the screen.
- **Annotated stat**: serif 700 number + italic serif annotation below ("22.4 hrs — *your highest in six weeks*"). Everywhere else.

### Color
| Category | Light | Dark |
|---|---|---|
| Paper (canvas) | `#FAF9F5` | `#1A1714` |
| Ink-1 (text) | `#1F1E1B` | `#F2EDE3` |
| Accent (warm coral) | `#C96442` | `#E8825E` |

Module colors: teal (habits) · blue (tasks) · amber (schedule) · plum (focus) · rose (finance)

### Signature visual moves
- Annotated stat cards where italic serif "speaks" about the data below the number
- Smooth line curves with full-height gradient fills + solid dot markers
- End-anchored series pills on line charts (`2026` / `2025`)
- GitHub-style heatmaps with 5 intensity levels of the accent color
- Pill segmented controls (outlined inactive, accent-bordered active)
- Bubble charts with three variants: standard / quadrant zones / annotated callouts

---

## Tech stack

| Layer | Choice |
|---|---|
| Language | HTML5 · CSS3 · vanilla ES2020+ JS |
| Framework | **None** — no React, Vue, Svelte, or anything else |
| Build | **None** — no bundler, no transpiler, no PostCSS |
| Fonts | Self-hosted `.woff2` in `/fonts/` (Google Fonts CSS in dev only) |
| Persistence | IndexedDB (one database `console-db`, ~13 stores) |
| Routing | Hash-based (`#/today`, `#/tasks/inbox`, etc) — works from `file://` |
| Charts | Hand-rolled SVG (sparklines, bars, bubbles, heatmaps) + Chart.js for one line chart |
| Icons | Hand-rolled inline SVG, 1.7 stroke, Lucide grammar |
| Modules | Per-module folders with `init(container)` / `destroy()` pattern |
| Theming | CSS variables + `data-theme="light|dark"` on `<html>` |

---

## Data model overview

Thirteen IndexedDB stores. All defined at Phase 1 to avoid migrations:

| Store | Purpose | Key indexes |
|---|---|---|
| `tasks` | Task entities (inbox / active / waiting / someday / done) | status, project_id, due_date, tags |
| `projects` | Cross-cutting project entity — the join key | status, archived_at |
| `events` | Calendar events | start_date, type, project_id |
| `event_logs` | Planned-vs-actual event logging | event_id, date, `[event_id+date]` |
| `event_recur_definitions` | Recurring event templates | next_run_date |
| `theme_days` | Weekly theme templates | day_of_week |
| `habits` | Habit definitions with full Atomic Habits framework fields | status, cadence |
| `habit_logs` | Daily habit logs (done / partial / skip / miss) | habit_id, date, `[habit_id+date]` |
| `transactions` | Multi-currency income + expense | date, envelope_id, project_id, currency |
| `envelopes` | Budget envelopes (YNAB-style) | period, category_id |
| `categories` | Income/expense taxonomy | type, parent_id |
| `focus_sessions` | Timer sessions with type + cross-domain links | start_at, type, task_id, habit_id |
| `insights` | Cached detector runs | detector, created_at, score |
| `preferences` | App settings | key |
| `backups` | Import/export history | created_at |

---

## Build phases

| # | Phase | Focus | Status |
|---|---|---|---|
| 1 | Foundation | App shell, IndexedDB, theme, routing, cmd palette, Today dashboard | ✓ Built |
| 2 | Tasks | NLP parser, 8 views, subtasks, recurring, keyboard nav | ✓ Built |
| 3 | Schedule | Week/day/month/agenda/themes, strict typing, planned-vs-actual, drag | ✓ Prompt ready |
| 4 | Habits | Atomic framework UI, no-streaks consistency, 4-state logging, auto-linking | ✓ Prompt ready |
| 5 | Finance | Multi-currency, YNAB envelopes, subscription audit, cost-per-focus-hour | ✓ Prototype done, no prompt yet |
| 6 | Focus Sessions | Three timer modes, session typing, cross-module triggers | ⏳ Pending |
| 7 | Analytics + Insights | 11 chart views, 10 detector functions, insight card surface | ⏳ Pending |
| 8 | Settings + polish | Command palette full search, import/export, backup history, all shortcuts | ⏳ Pending |

---

## File inventory

All in `/mnt/user-data/outputs/`.

### Design system
| File | What it is |
|---|---|
| `console_design_library_final.html` | 21-section design library, both themes, all chart variants |

### Fidelity bundle (attach to every phase)
| File | What it is |
|---|---|
| `tokens.css` | CSS variables (both themes), font imports, reset |
| `base.css` | App shell (sidebar, topbar, floating timer, kbd hints), typography classes, layout primitives |
| `components.css` | Every reusable component from the design library |
| `visual_contract.md` | 10-rule fidelity checklist Sonnet self-verifies against |
| `workflow_fidelity_bundle.md` | Process update: how to use the bundle |

### Screen prototypes
| File | Screen |
|---|---|
| `console_today_prototype.html` | Today dashboard |
| `console_tasks_prototype.html` | Tasks → Upcoming view |
| `console_schedule_prototype.html` | Schedule → Week view |
| `console_habits_prototype.html` | Habits → All habits view (with detail panel) |
| `console_finance_prototype.html` | Finance → Overview view |

### Phase build prompts (send to Claude Code)
| File | Phase |
|---|---|
| `console_phase_1_prompt.md` | Foundation |
| `console_phase_2_prompt.md` | Tasks module |
| `console_phase_3_prompt.md` | Schedule module |
| `console_phase_4_prompt.md` | Habits module |

**Not yet written:** Phase 5 (Finance), Phase 6 (Focus), Phase 7 (Analytics + Insights), Phase 8 (Settings + polish).

**Not yet prototyped:** Focus Sessions, Analytics, Insights feed, Settings.

---

## Workflow (Opus + Sonnet)

**Two-instance handoff:**

1. **Opus** (this chat) — designs, specifies, writes phase prompts
2. **Claude Code / Sonnet** — implements per phase

**Fidelity bundle rule:** every Claude Code session receives the same four bundle files (tokens.css, base.css, components.css, visual_contract.md) plus that phase's prompt and prototype. Sonnet uses the CSS files as source of truth — never reinvents styling. The visual contract is a self-verification checklist.

**Standard attachment set per phase:**

```
tokens.css
base.css
components.css
visual_contract.md
console_phase_N_prompt.md
console_<module>_prototype.html
console_design_library_final.html
+ any earlier prototypes for cross-reference
```

**Top of every phase prompt gets:**

```
IMPORTANT — this session ships with a fidelity bundle:
- tokens.css, base.css, components.css are the source of truth for styling.
  Copy verbatim to css/ folder. Load in <head> as tokens → base → components.
- visual_contract.md is the self-verify checklist.
- The prototype .html is the visual reference — match spacing, but pull
  styling from the shared CSS.
- Missing component? Add it to components.css. Don't inline.
- Contract wins over prototype if they disagree.
```

**Review loop:** after Sonnet ships, Rui pastes result back to Opus. Opus reviews against acceptance criteria and prototype, then writes the next phase prompt. Any drift → either add a component to `components.css` or note the pattern to avoid in the next prompt.

---

## To resume from cold start

1. Read this file end-to-end
2. Skim `console_design_library_final.html` visually (both themes)
3. Skim each prototype in order: Today → Tasks → Schedule → Habits → Finance
4. Confirm current phase (check "Status" column above)
5. If a prompt is ready for the next phase, ship it with the bundle attached
6. If not, write it — pattern is: brief context → files added → data model → views + behavior → acceptance criteria → what to skip

---

## Key philosophical anchors (don't erode)

- **No streaks** (Habits) — not a UI preference, a research-backed philosophy
- **Strict typing** (Schedule + Focus) — freedom via constraint
- **Universal architecture** — no student/grade/semester framing anywhere
- **Fully offline** — no cloud, no accounts, no sync, ever
- **Fidelity via extraction** — Opus prototypes the vision, Sonnet builds against extracted CSS. Never let Sonnet interpret prototypes visually.
- **Two-voice stats** — hero for headlines, annotated for everywhere else. Never mix.

---

## What's next

**Immediate options:**

1. Write Phase 5 prompt (Finance) so it's ready to ship — prototype already exists
2. Prototype Focus Sessions module and write Phase 6 prompt
3. Prototype Analytics module (11 chart views is a lot — could split into two prototypes)
4. Prototype Insights feed
5. Prototype Settings
6. Kick off any built phase to Claude Code and review the output

**Recommended order:** finish all prototypes first (Focus → Analytics → Insights → Settings), *then* start shipping phases to Claude Code in sequence. That way the design language is fully locked before implementation drift becomes a risk.
