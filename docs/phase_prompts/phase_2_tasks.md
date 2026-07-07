# Console — Phase 2: Tasks

> Ships against the fidelity bundle plus this phase's own extraction pass: `css/tokens.css`, `css/base.css`, `css/components.css`, `docs/visual_contract.md`, this brief, and `prototypes/console_tasks_prototype.html` as the visual reference (single view shown — "Upcoming" — but its shell markup/CSS is shared across all 8 view tabs). tokens → base → components stay the source of truth for styling. The prototype's structure (page-head-row, view-tabs-row, metrics-row, capture-row, twopane-row, kbd-hints) is the structural reference — reuse it, don't redraw it from description. New shared patterns get extracted into `base.css`/`components.css` with a diff/conflict-resolution comment, same discipline as the Phase 1 bundle. Contract wins over prototype if they disagree. Follow `docs/Console_Workflow.md` — no rushing, fully verified before Schedule/Habits/Finance/Focus.

## Scope

Tasks = the GTD inbox-first capture/processing flow, replacing the Phase 1 stub (`js/modules/tasks/index.js`) with a real module. This is the single screen the prototype fully shows (list+detail, tab-filtered), not 8 separate screen designs — the 8 "views" are the same shell filtering the same `tasks` data differently.

1. **NLP-ish capture parser** (regex/heuristic, no external library — stays offline): from a single input line like `call vendor about renewal tomorrow !high @phone #client-a`, extract:
   - Due date: `today`, `tomorrow`, weekday names (`mon`/`monday`, etc. — next occurrence), or an explicit `YYYY-MM-DD`. No due date if none matched.
   - Priority: `!low` / `!med` / `!high` (defaults to `med` if omitted — confirm against prototype's own default before locking this in; prototype's parsed-chip example always shows an explicit priority).
   - Context: one or more `@word` tokens.
   - Project: one or more `#word` tokens — if the referenced project doesn't exist yet in the `projects` store, create it inline (matches "GTD inbox-first" — capture must never be blocked on picking an existing project).
   - Remaining text (with the above tokens stripped) becomes the task title.
   - Live-parsed preview chips in the capture bar, matching `.parsed-chip` styling in the prototype.
2. **GTD inbox-first flow**: every captured task starts with `status: 'inbox'`. Process metrics row (`.metrics-row`) computed from real data: inbox depth, captured this week, processed today (count of tasks whose status left `inbox` today), avg processing time (avg seconds between `created_at` and the timestamp status left `inbox`, for items processed today).
3. **Subtasks, 1 level deep**: embedded on the parent task as `task.subtasks: [{ id, title, done }]` — no separate IndexedDB store exists for these (checked `Console_Features_List.md`'s 15-store table), so they live on the task record itself. Add/toggle from the detail pane, progress bar recalculates (`.subtask-progress`).
4. **Priority levels**: `task.priority` in `low`/`med`/`high`, rendered via the existing `.priority` component (already in `components.css` from the Phase 1 bundle — verify it still matches this prototype's 3-bar rendering, don't assume).
5. **8 views via `.view-tabs-row`** — same shell, different filter/group over `Console.db.getAll('tasks')` + `getAll('projects')`:
   - Inbox: `status === 'inbox'`
   - Today: `due_date === todayISO && status !== 'done'`
   - This week: `due_date` within the next 7 days
   - Upcoming: `due_date` within the next 14 days, grouped by date bucket (today/tomorrow/weekday/next week) — matches the prototype's shown grouping exactly
   - Someday: `status === 'someday'` (no due date, explicit backlog status — not just "no due_date", since a processed task might legitimately have no due date yet still be active)
   - Waiting: `status === 'waiting'`
   - By project: grouped by `project_id` (join against `projects` for names)
   - By tag: grouped by each tag in `task.tags` (a task with 2 tags appears in both groups)
   - Tab counts (`.vcount`) reflect real counts per view, not the prototype's mock numbers.
6. **Two-pane layout**: list pane (grouped rows, `.task-row`, click or `J`/`K` to navigate, `Enter` to select) + detail pane (`.detail-head` meta grid, subtasks section, notes `textarea` — plain text, no markdown rendering — activity log, action buttons: Complete / Schedule / Snooze / Move / Delete).
7. **Activity log**: embedded on the task as `task.activity: [{ type, text, at }]` (no dedicated store, same reasoning as subtasks) — auto-append an entry on capture, complete, subtask toggle, notes edit, snooze, move.
8. **Keyboard shortcuts** (scoped to when the Tasks module is active and the command palette is closed, so they don't collide with `⌘K`'s own bindings from Phase 1):
   - `N` — focus the capture input
   - `J` / `K` — move selection down/up in the list pane
   - `Enter` — open/select the focused row (already effectively true via click; wire the keyboard path too)
   - `X` — toggle complete on the selected task
   - `S` — Schedule: since the Schedule module doesn't exist until Phase 3, this sets `due_date` via a minimal inline date input for now — not a calendar picker. Log this as a deliberate placeholder, not a silent gap.
   - `T` — add a tag to the selected task (inline prompt-style input, appends to `task.tags`)
   - `⌘E` — focus the notes textarea in the detail pane for editing
   - `?` shown in the kbd-hints bar can stay inert this phase (a full shortcuts-reference overlay is Settings' job, Phase 8)
9. **Sidebar Tasks count**: already wired in Phase 1's `app.js` (`refreshNavCounts` counts non-done tasks) — no change needed, but re-verify it reflects real data once Tasks has real rows.
10. **Today dashboard cross-check**: `js/modules/today/index.js` already queries `tasks` and `waitingTasks` live (built in Phase 1 against an always-empty store) — once real tasks exist, re-verify "Today's tasks" and "Waiting for" cards on the Today screen render real rows correctly, not just empty states. No code change expected, but must be re-checked.

## Data model touched

- `tasks` (real reads/writes now): fields beyond the Phase 1 schema's indexes — `title`, `status` (`inbox`/`active`/`someday`/`waiting`/`done`), `priority`, `context` (array of strings), `due_date`, `created_at`, `processed_at` (timestamp status left `inbox`, null until then), `subtasks` (embedded array), `activity` (embedded array), `notes`.
- `projects` (real reads/writes now): `id`, `name`, `status`, `archived_at`. Created inline from `#tag` capture when new.

No schema/index changes to `db.js` — the Phase 1 stores already have the right indexes (`status`, `project_id`, `due_date`, `tags`) for every view above.

## Acceptance criteria

- [ ] Capture bar creates a real `tasks` row with correctly parsed due date / priority / context / project (auto-creating the project if new) and clears/refocuses after `Enter`.
- [ ] All 8 view tabs filter to the correct real subset, and each tab's count matches what's actually rendered.
- [ ] Upcoming view's date-bucket grouping (today / tomorrow / weekday / next week) matches the prototype's grouping logic.
- [ ] Selecting a task (click or `J`/`K` + `Enter`) shows it in the detail pane with real fields, not mock content.
- [ ] Subtask add/toggle updates `task.subtasks` in IndexedDB and the progress bar recalculates immediately.
- [ ] Complete / Snooze / Move / Delete perform real state changes and append an `activity` entry.
- [ ] `N` / `J` / `K` / `X` / `S` / `T` / `⌘E` all work while Tasks is the active route, and none of them fire while the `⌘K` palette is open.
- [ ] Every view's empty state (e.g. Inbox with nothing captured yet) renders `.empty`, not leftover mock content.
- [ ] Today dashboard's "Today's tasks" and "Waiting for" cards, re-checked with real data present, render correctly (not just their Phase 1 empty states).
- [ ] Sidebar's Tasks nav count reflects real open-task count.
- [ ] Full `docs/visual_contract.md` checklist passes for every Tasks view, both themes.
- [ ] No inline styles beyond genuinely dynamic values (subtask progress bar width, priority bar fill) — learned the hard way in Phase 1 verification.

## Explicitly out of scope for this phase

- **Recurring tasks + exceptions** (daily/weekly/monthly/weekday/weekend + edit-one/edit-future/skip-one). The prototype shows a `recur-icon` and "recurring · weekly" as static display text only — no recurrence *generation* logic exists to extract yet. Deferred; likely wants to share date-math with Schedule's own recurring events (Phase 3), so building it twice independently risks drift. Flag to the user before starting it standalone.
- **Real Schedule integration for the "S" shortcut** — Schedule module is still a Phase 1 stub. "S" just sets `due_date` via a plain input for now.
- **Markdown rendering in notes** — plain `textarea`, matching what the prototype actually shows (the "⌘K markdown" hint is a label, not built behavior).
- **Drag-to-reorder, multi-select, bulk actions** — not shown in the prototype.
- **Command-palette additions** (e.g. "New task" as a palette command) — Phase 1's palette scope was nav + 2 data actions; extending it is optional polish, not required for Tasks to ship.
- **NLP capture parser sophistication beyond the prototype's own example** — no fuzzy dates ("next Tuesday", "in 3 days"), no multi-language support. Match exactly what the prototype's parsed-chip example demonstrates, extend minimally (weekday names) since the acceptance criteria need it for the Upcoming grouping to make sense.
