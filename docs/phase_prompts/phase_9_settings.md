# Phase 9 — Settings

A real prototype exists for this phase too: the user commissioned an external design pass (handed the project's own `Settings_Design_Brief.md` to an outside design tool) and uploaded the result, `Console Settings - Design Brief.html` (same bundled/templated export format as Analytics' and Insights' prototypes). Extracted to `settings_extracted.html`. Same extraction-not-recreation discipline: markup/CSS/copy below is taken from that file.

A bare Phase-1 stub already exists (`js/modules/settings/index.js` — just Export/Import buttons + an "not fully built yet" empty state) so the app always had *something* working. This phase replaces it entirely with the real 5-section design.

**Touches no new store.** `preferences` (generic key/value, already exists) and `backups` (already exists, already populated by the Phase-1 export/import stub) cover every section below. `db.js` needs zero changes.

## Design decisions

1. **Preferences are real, persisted, generic key/value rows** — `default_landing_view`, `week_start`, `default_task_priority`, `default_focus_mode`, `default_focus_duration_min`, `insights_detectors` (an object of 10 booleans). No new store or schema — all via `Console.db.getPref`/`setPref`, same as `theme` and `analytics_range` already do.

2. **Not every preference gets wired into live consumption this phase — and that's stated up front, not discovered later.** Following the exact precedent Phase 1 set for the topbar range control (persisted and visible from Phase 1, but explicitly "visual-only... real range-filtering lands with Analytics" until Phase 7 actually wired it): 
   - **Wired for real this phase** (cheap, single-point, additive reads into already-verified modules): `default_landing_view` (router's boot fallback), `default_task_priority` (the one shared `captureTask()` function in `js/lib/capture.js`), `default_focus_mode`/`default_focus_duration_min` (Focus's `draft` initialization, two literal replacements), `insights_detectors` (Insights' own `enabledDetectorKeys()` — already reads `Console.insightsDetectorPrefs`, built with this exact hook in Phase 8).
   - **Persisted and shown in the UI, but deliberately NOT wired into consumption this phase**: `week_start`. Actually applying it would mean changing `js/lib/format.js`'s shared `weekOf()` (used by Schedule's week view, Today, and now Insights' Commitment Overload detector) and Analytics' heatmap day-ordering — real, non-trivial changes to several already-verified modules' date math that deserve their own careful pass, not something to squeeze in as a Settings side-effect. Logged here explicitly, not silently shipped as if it worked — same "documented gap, not a silent one" precedent as Analytics' due-or-overdue backlog proxy.

3. **`Console.taskDefaultPriority` / `Console.focusDefaults` are boot-time in-memory caches**, same pattern as `Console.analyticsRange` and `Console.insightsDetectorPrefs` — read once from `preferences` at boot, updated live whenever Settings changes them, read synchronously by the modules that need them (capture.js's `captureTask()` is called synchronously from user keystrokes; it cannot await a `getPref` call mid-capture).

4. **Theme section is a second access point to the existing toggle, not a new mechanism.** Calls `Console.theme.set(k)` (already public) exactly like the topbar toggle does; Settings' own buttons track active-state locally (re-read `Console.db.getPref('theme', 'light')` on render) since `theme.js`'s own `apply()` only updates the topbar's `#ttoggle` buttons.

5. **Backup & Restore History reuses `Console.db.downloadExport()`/`uploadImport()` verbatim** (both already exist, both already log to `backups` — the Phase-1 stub already wires these buttons). The only new work is *displaying* the `backups` log, which nothing has ever rendered before.

6. **Data Management's "Clear all data"** loops `Console.db.clearStore()` (already exists, generic) over every `STORE_NAMES` entry — a real destructive action, gated behind typing `DELETE` to confirm (matching the prototype exactly), separate and visually distinct (`.set-danger-zone`) from the safe actions above it. Per the app's own safety norms (same weight as Tasks' permanent-delete confirmation), this is real and irreversible — not a placeholder.

7. **Shortcuts Reference is fully static** — no data reads. Just the real, already-implemented shortcuts from each module's own `.kbd-hints` footer, listed in one place.

## The 5 sections, precisely defined

1. **Preferences** — one card, 5 rows: Default landing view (`<select>` of the 6 workspace modules), Week starts on (Sun/Mon segmented, persisted but not yet consumed — decision #2), Default task priority (!low/!med/!high segmented), Default Focus session (mode `<select>` + duration `<select>` — 25/50/90 min matching Focus's own Pomodoro/Freeform/Stopwatch options), Insights detectors (a 2-column grid of the 10 detector names each with a toggle switch, reusing the prototype's exact switch-track/switch-thumb inline-style pattern since this is the one genuinely new interactive atom this phase needs).
2. **Theme** — one row, light/dark segmented control (decision #4).
3. **Backup & Restore History** — Export/Import buttons (unchanged from the Phase-1 stub) + a reverse-chronological list read from `db.getAll('backups')`.
4. **Shortcuts Reference** — grouped list (Global/Tasks/Schedule/Habits/Focus/Finance), static content matching each module's real `.kbd-hints` footer.
5. **Data Management** — a small grid of real per-store counts (`db.count()` on Tasks/Projects/Events/Habits/Transactions/Focus sessions/Cached insights — 7 stores, matching the prototype's own selection) + a danger-zone row with "Clear all data," gated behind a type-`DELETE` confirmation input (decision #6).

## Scope

1. `js/modules/settings/index.js` — full rebuild, replaces the Phase-1 stub entirely.
2. New dedicated CSS (`.set-*` family) in `components.css` matching the prototype's preference-row/toggle-switch/segmented/backup-list/shortcut-group/stat-grid/danger-zone treatment exactly.
3. `js/app.js` (or a small new boot step): read `default_task_priority`/`default_focus_mode`/`default_focus_duration_min`/`insights_detectors` into their respective `Console.*` globals at boot, same pattern as `Console.analyticsRange`.
4. `js/lib/capture.js`: `captureTask()`'s `priority: parsed.priority` becomes `priority: parsed.priority || Console.taskDefaultPriority || null`.
5. `js/modules/focus/index.js`: `draft`'s two hardcoded literals (`mode: 'pomodoro'`, `targetMin: 25`) read `Console.focusDefaults` if set, falling back to the same values as today so behavior is identical until someone actually changes the preference.
6. `js/router.js`: `if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;` becomes a read of `default_landing_view` first, falling back to `today` — the one boot-order-sensitive change, needs care (router.js runs before modules are guaranteed initialized; `Console.db` is available by then since `db.js` loads first, so an async `getPref` before setting the initial hash is safe).

## Acceptance criteria

- [ ] All 5 sections render with real data (backup history, store counts) or a real empty state, no mock/demo content shipped.
- [ ] Default landing view, default task priority, default Focus mode/duration, and per-detector Insights toggles all take real, verifiable effect (spot-checked: change the pref, confirm the next relevant action reflects it).
- [ ] Week start is persisted and its control works, but is explicitly documented (here and in `PROJECT_STATE.md`) as not yet consumed by Schedule/Analytics — not silently pretended to work.
- [ ] Clear-all-data requires typing `DELETE` and is irreversible; a partial/mistyped confirmation does nothing.
- [ ] No invented CSS class ships without a matching rule — grepped before calling this code-verified.

## Explicitly out of scope

- Week-start actually changing Schedule's week view or Analytics' heatmap day order (decision #2).
- Any account/sync/notification settings — this app has none of those concepts (per the original design brief).
- A new date-picker or toggle-switch *library* — the one new atom (toggle switch) is hand-rolled inline style, matching the prototype exactly, same as every other phase's from-scratch components.
