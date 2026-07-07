# Console — Phase 3: Schedule

> Ships against the fidelity bundle plus this phase's own extraction pass: `css/tokens.css`, `css/base.css`, `css/components.css`, `docs/visual_contract.md`, this brief, and `prototypes/console_schedule_prototype.html` as the visual reference (single view shown — "Week" — but its shell markup/CSS is shared across all 5 view tabs, same pattern as Phase 2). tokens → base → components stay the source of truth for styling. New shared patterns get extracted with a diff/conflict-resolution comment, same discipline as Phases 1–2. Contract wins over prototype if they disagree. Follow `docs/Console_Workflow.md` — no rushing, fully verified (code + browser, both themes) before Habits starts.

## Resolved conflict — read before writing any event-type code

The prototype and the locked spec disagree on the 8 event types:

- `docs/Console_Features_List.md` / `docs/Projects_Overview.md` (the locked contract): `deep_work / meeting / admin / exercise / break / social / errand / sleep`.
- `prototypes/console_schedule_prototype.html`: styles 8 classes but one of them is `.event.personal` (teal-soft, opacity 0.85, reusing exercise's teal) instead of `.event.sleep` — and its own `.grid-legend` only lists 7 dots, omitting the 8th type entirely.

**Decision (contract wins): the 8th type is `sleep`, not `personal`.** Reuse the prototype's exact CSS values for `.event.personal` under a renamed `.event.sleep` selector (same teal-soft background/opacity — it's the only unused-looking treatment in the prototype, and reusing it avoids inventing a new color the design library never specified). Add the missing 8th `<span class="leg-item">` to `.grid-legend` for `sleep`. Write this resolution as a comment in `components.css` next to the `.event.*` rules, same as the `.card`/`.pill`/etc. conflict log from the Phase 1 bundle extraction.

## Scope

Schedule = calendar events with strict typing, theme days, and mandatory planned-vs-actual logging. The prototype fully shows the Week view (day grid, 7 columns); Day/Month/Agenda/Theme-days-editor are new layouts within the same shell (page-head-row/view-tabs-row/metrics-row already extracted into `base.css` during Phase 2 — reuse verbatim, don't re-extract).

1. **Event CRUD**: `events` store — `id`, `title`, `type` (one of the 8, strict enum, no free text — enforced in the create/edit form, not just by convention), `start_date`, `start_time`, `end_time` (or `duration_min`), `project_id` (optional, joins `projects`), `notes`. "New event" button + `N` shortcut open a minimal inline form (reuse `.btn-mini`/form patterns from Tasks' capture bar where shape matches — don't invent new input styling).
2. **Theme days**: `theme_days` store — `id`, `day_of_week` (0–6), `label` (e.g. "Maker Monday", free text is fine here — it's a label, not an event type). Rendered in the Week/Day view's `.day-theme` (already in the prototype's `.day-header`). Theme days editor is the 5th view tab — a simple 7-row list (one per weekday) with an editable label field, no calendar grid needed for this view.
3. **Recurring events + 3 exception modes**: `event_recur_definitions` store — template fields (`title`, `type`, `day_of_week` or `days_of_week[]`, `start_time`, `end_time`, `project_id`, `next_run_date`) plus a materialization step that writes concrete `events` rows going forward (mirrors how the Phase 2 brief flagged recurring tasks as wanting to share date-math with Schedule — reuse `js/lib/format.js`'s date helpers, don't re-derive). Exception modes on an already-materialized recurring event's detail view: **edit one** (detach this occurrence from the recur definition, edit independently), **edit future** (split the recur definition at this date, apply new fields going forward), **skip one** (mark this occurrence's `events` row deleted/skipped without touching the definition or other occurrences).
4. **Mandatory planned-vs-actual logging**: `event_logs` store — `id`, `event_id`, `date`, `planned_start`/`planned_end` (copied from the event at log time), `actual_start`/`actual_end` (user-entered or "same as planned" one-click), `skipped` (bool, with the "skip option" the spec calls out — a past event can be explicitly logged as skipped rather than forcing a fabricated actual time). Any past event without a corresponding log row on the day it occurred renders with `.needs-log` (prototype already styles this — dashed border + "LOG" badge) — `L` shortcut opens the log form for the selected/focused past event.
5. **Drag-to-reschedule with 15-minute snap**: dragging an event in Day/Week view updates `start_date`/`start_time`/duration, snapped to the nearest 15-minute gridline. The prototype's `.hour-line`/`.half-hour-line` absolute-positioned grid (50px per hour, so 12.5px per 15 min) gives you the snap unit directly from existing CSS — don't invent a different pixel-to-time ratio.
6. **Live event + now-line**: prototype's `.now-line` (current time indicator, updates as time passes) and `.event.live` (currently-in-progress event, pulsing accent ring) — wire both to real wall-clock time against real event data, not the prototype's hardcoded `10:32`/`top: 177px`.
7. **5 views via `.view-tabs-row`**: Day (single column, same grid mechanics as Week), Week (prototype's shown view — 7 columns), Month (compact multi-week grid, no hour axis — new layout, extract nothing from Week's hour-grid CSS for this one), Agenda (flat chronological list, closer to Tasks' `.task-row` list pattern than the grid), Theme days editor (see #2).
8. **Metrics row** (`.metrics-row`, real data): scheduled hours this period, executed hours so far (sum of `event_logs` actual durations), deep-work hours scheduled (+ % of total), theme-day adherence % (days where actual event types match the day's theme-implied pattern — if this needs a heuristic beyond "did events happen," keep it simple and log the heuristic choice in `Console_Workflow.md` rather than over-building).
9. **Keyboard shortcuts** (scoped to Schedule active, palette closed, same collision-avoidance discipline as Phase 2):
   - `N` — new event
   - `D` / `W` / `M` — switch to Day / Week / Month view
   - `J` / `K` — navigate selection (between events in Agenda, or between days in Day/Week)
   - `T` — jump to today
   - `L` — log planned-vs-actual for the selected/focused event
   - `Enter` — open the selected event
   - `⌘E` — edit the selected event
   - `?` stays inert this phase (Settings' job, Phase 8) — matches Phase 2's own deferral
10. **Sidebar Schedule count**: wire into `app.js`'s `refreshNavCounts` (pattern already established for Tasks in Phase 1/2) — likely "events today" or "events this week," pick one and note the choice.
11. **Today dashboard cross-check**: `js/modules/today/index.js`'s "today's calendar" section (built in Phase 1 against an always-empty store) — re-verify it renders real `events` rows once Schedule has real data, same re-check discipline Phase 2 applied to Tasks.

## Data model touched

- `events` (real reads/writes now): schema per #1 above. Indexes already correct in `db.js` (`start_date`, `type`, `project_id`) — no schema change needed.
- `event_logs` (real reads/writes now): schema per #4. Indexes already correct (`event_id`, `date`, `[event_id+date]`).
- `event_recur_definitions` (real reads/writes now): schema per #3. Index already correct (`next_run_date`).
- `theme_days` (real reads/writes now): schema per #2. Index already correct (`day_of_week`).
- `projects` (read-only join, no writes from this phase): for the optional `project_id` link on events.

No schema/index changes to `db.js` — all four stores already have the right indexes from Phase 1.

## Acceptance criteria

- [ ] New event form creates a real `events` row with strict-enum `type` (8 values only, including `sleep` per the resolved conflict above) — no free-text type possible through the UI.
- [ ] All 5 view tabs render real data: Day/Week (hour grid + drag-reschedule + snap), Month (compact grid), Agenda (flat list), Theme days editor (7-row list, editable labels persist to `theme_days`).
- [ ] Recurring events materialize real `events` rows from `event_recur_definitions`, and all 3 exception modes (edit one / edit future / skip one) behave correctly and don't corrupt sibling occurrences.
- [ ] Every past event without a same-day `event_logs` row renders `.needs-log`; `L` opens a working log form (including the skip option) that clears the badge on save.
- [ ] Drag-to-reschedule snaps to 15-minute increments and persists the new time to `events`.
- [ ] `.now-line` and `.event.live` reflect actual wall-clock time against real event data.
- [ ] `N` / `D` / `W` / `M` / `J` / `K` / `T` / `L` / `⌘E` all work while Schedule is active, none fire while `⌘K` is open.
- [ ] Metrics row shows real computed values, not mock numbers.
- [ ] Theme day labels render in Day/Week's `.day-theme` slots with real data.
- [ ] Today dashboard's calendar section, re-checked with real data present, renders correctly.
- [ ] Sidebar's Schedule nav count reflects real data.
- [ ] Full `docs/visual_contract.md` checklist passes for every Schedule view, both themes — including the renamed `.event.sleep` legend fix.
- [ ] No inline styles beyond genuinely dynamic per-instance values (event position/height on the grid, drag-preview position) — every other Phase has hit this exact gap in first-pass code, check for it explicitly this time.

## Explicitly out of scope for this phase

- **Month view's own distinct interactions** (e.g. click-to-create on a month cell) beyond basic rendering — Month is read/navigate only if time-boxing requires a cut; flag to the user before deferring rather than silently shipping a read-only Month view.
- **Cross-domain links** (Focus session auto-linking to a scheduled event, Habit correlation to theme-day adherence) — those are Focus's (Phase 6) and Analytics' jobs, not Schedule's.
- **Theme-day adherence heuristic sophistication** — keep it simple per #8; don't build a scoring model beyond what the metric needs.
- **Full recurring-exception UI polish** (e.g. a rich "this and following" picker) — functional 3-mode support is the bar, not prototype-quality interaction design (no prototype exists for this interaction anyway).
