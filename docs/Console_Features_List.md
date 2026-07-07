# Console — Features List (Rebuild Baseline)

> Extracted from `Projects_Overview.md`. This is the full feature scope for rebuilding Console from scratch. Use as the checklist for phase planning and acceptance criteria.

Status legend: ☐ not built · counts reflect the fresh restart (all modules start at ☐).

---

## 1. Foundation (shell, shared across all modules)

- ☐ Static `index.html`, no build step, opens from `file://`
- ☐ IndexedDB database `console-db` with all 13 stores defined upfront (no migrations)
- ☐ Hash-based routing (`#/today`, `#/tasks/inbox`, etc.)
- ☐ Light/dark theme via CSS variables + `data-theme` attribute
- ☐ Command palette (`⌘K`) — fuzzy search across nav, actions, entities, recent commands
- ☐ Module loader pattern: each module exposes `init(container)` / `destroy()`
- ☐ Self-hosted fonts (Source Serif 4, Inter, JetBrains Mono)
- ☐ JSON export/import for backup and portability

## 2. Tasks

- ☐ NLP capture parser: `call vendor tomorrow !high @phone #client-a` → date, priority, context, project
- ☐ GTD inbox-first flow with process metrics
- ☐ Subtasks (1 level deep)
- ☐ Recurring tasks: daily / weekly / monthly / weekday / weekend + exceptions
- ☐ Priority levels: `!low / !med / !high`
- ☐ Views (8): Inbox · Today · This Week · Upcoming · Someday · Waiting · By Project · By Tag
- ☐ Keyboard-first controls: N / J / K / X / S / T / ⌘E / ⌘Z

## 3. Schedule

- ☐ Strict event types only (8): `deep_work / meeting / admin / exercise / break / social / errand / sleep`
- ☐ Theme days as first-class entities (e.g. "Maker Monday")
- ☐ Mandatory planned-vs-actual logging on every past event, with skip option
- ☐ Recurring events with 3 exception modes: edit one / edit future / skip one
- ☐ Drag-to-reschedule with 15-minute snap
- ☐ Views (5): Day · Week · Month · Agenda · Theme days editor

## 4. Habits

- ☐ Atomic Habits framework fields: cue / craving / response / reward + identity + habit stacking + environment
- ☐ Multi-state logging: `done / partial / skip / miss`
- ☐ Quantitative habits (units + targets: pages, minutes, reps, ml)
- ☐ Rolling 30-day consistency % — **no streaks anywhere**
- ☐ Cross-domain auto-log: matching-tag focus sessions auto-log the habit
- ☐ Views (4): Today · All habits · Correlations · Archive

## 5. Finance

- ☐ Multi-currency support with per-transaction FX rates
- ☐ YNAB-style envelope budgeting: To-Be-Budgeted pool, roll-over rules, savings envelopes
- ☐ Subscription audit with usage tracking (e.g. "Netflix · 0 uses this month")
- ☐ Cost-per-focus-hour analytics (cross-domain: Finance ↔ Focus)
- ☐ Hourly-equivalent toggle
- ☐ Views (5): Overview · Transactions · Envelopes · Subscriptions · Reports

## 6. Focus Sessions

- ☐ Three timer modes: Pomodoro / Freeform / Stopwatch-with-target
- ☐ Soft strict mode (dims other UI, navigation still allowed)
- ☐ Mandatory session-type tagging (preset list)
- ☐ Triggers: from a task, from a scheduled event, from a habit, or standalone
- ☐ Floating active-session indicator visible from every screen
- ☐ Cross-domain auto-linking to habits and tasks
- ☐ Views (~3): not yet prototyped

## 7. Cross-cutting

**Today dashboard** (fixed layout, no customization)
- ☐ Insight card → hero stats strip → today's calendar + tasks → habits + quick capture → upcoming week + money snapshot → waiting-for + suggested focus blocks

**Analytics** — 11 views
- ☐ Project Investment Matrix
- ☐ Planned vs Executed
- ☐ Productive Hours Heatmap
- ☐ Subscription-vs-Usage Matrix
- ☐ Habit ↔ Output Correlation
- ☐ Calendar Load vs Todo Backlog
- ☐ Decay Analysis
- ☐ Theme Day Output
- ☐ Time-Money Rate
- ☐ Cost per Focus Hour
- ☐ Energy Index
- ☐ Universal filters on every view: 7d / 30d / 90d / all / custom range

**Insights** — 10 detectors, run daily at 06:00
- ☐ `estimate_accuracy_drift`
- ☐ `procrastination_rising`
- ☐ `commitment_overload`
- ☐ `stale_waiting_items`
- ☐ `subscription_low_use`
- ☐ `envelope_overspend_pattern`
- ☐ `habit_consistency_drop`
- ☐ `unscheduled_obligations`
- ☐ `starving_project`
- ☐ `productive_hour_misalignment`

**Settings** (~5 sections, not yet prototyped)
- ☐ Preferences, backup/restore history, shortcuts reference, theme, data management

---

## Screen inventory (target: ~40 views)

| # | Screen | Views | Rebuild status |
|---|---|---:|---|
| 1 | Today dashboard | 1 | ☐ |
| 2 | Tasks | 8 | ☐ |
| 3 | Schedule | 5 | ☐ |
| 4 | Habits | 4 | ☐ |
| 5 | Finance | 5 | ☐ |
| 6 | Focus Sessions | ~3 | ☐ |
| 7 | Analytics | 11 | ☐ |
| 8 | Insights feed | 1 | ☐ |
| 9 | Settings | ~5 sections | ☐ |

---

## Data model — 13 IndexedDB stores

| Store | Purpose | Key indexes |
|---|---|---|
| `tasks` | Task entities | status, project_id, due_date, tags |
| `projects` | Cross-cutting join key | status, archived_at |
| `events` | Calendar events | start_date, type, project_id |
| `event_logs` | Planned-vs-actual logging | event_id, date, `[event_id+date]` |
| `event_recur_definitions` | Recurring event templates | next_run_date |
| `theme_days` | Weekly theme templates | day_of_week |
| `habits` | Habit definitions | status, cadence |
| `habit_logs` | Daily habit logs | habit_id, date, `[habit_id+date]` |
| `transactions` | Multi-currency transactions | date, envelope_id, project_id, currency |
| `envelopes` | Budget envelopes | period, category_id |
| `categories` | Income/expense taxonomy | type, parent_id |
| `focus_sessions` | Timer sessions | start_at, type, task_id, habit_id |
| `insights` | Cached detector runs | detector, created_at, score |
| `preferences` | App settings | key |
| `backups` | Import/export history | created_at |

---

## Locked design decisions (do not erode on rebuild)

1. Fully offline — no servers, accounts, or sync
2. Universal architecture — no student/grade/academic framing
3. No streaks in Habits — rolling 30-day % only
4. Strict event typing in Schedule — 8 presets, no free text
5. YNAB-style envelopes in Finance
6. GTD inbox-first in Tasks
7. Two-voice stat rule: hero stats for headlines, annotated stats everywhere else
8. Three fonts only: Source Serif 4, Inter, JetBrains Mono — no exceptions
9. No framework, no build step, no CDN in production

---

## Existing assets to reuse (already in the project folder)

- `console_design_library_final.html` — 21-section design system reference, both themes
- `console_today_prototype.html`
- `console_tasks_prototype.html`
- `console_schedule_prototype.html`
- `console_habits_prototype.html`
- `console_finance_prototype.html`

Not yet prototyped: Focus Sessions, Analytics, Insights feed, Settings — these need prototyping before their build phase.
