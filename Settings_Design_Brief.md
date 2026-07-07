# Console — Settings: Design Brief

For handoff to a design tool. Settings has no prototype and almost no spec — `Console_Features_List.md` only says "~5 sections: Preferences, backup/restore history, shortcuts reference, theme, data management." A bare Phase-1 stub exists today (just two buttons: Export all data / Import from file) so the app has *something* working — everything below is what the real 5-section version needs to grow into. This brief defines each section from what the rest of the app already does; the visual treatment is open.

## Keep consistent with the rest of the app

- **Fonts**: Source Serif 4 (headings/display), Inter (body/UI), JetBrains Mono (labels, numbers, metadata) — no other fonts.
- **Palette**: warm off-white background, ink-black text, warm terracotta/rust accent, soft muted secondary accents. Light and dark theme both exist.
- **Feel**: plain and utilitarian — this is the one screen in the app that's about configuration, not data. Card-based sections like everywhere else, but quieter: no charts, no big numbers, mostly labels/toggles/buttons and a couple of small lists.
- **Nothing here is new mechanics.** Every section below either surfaces something the app already does in one place (theme, backup/import), or exposes something the app already stores but never displays (backup history, per-store record counts), or adds a small number of low-risk preferences using the app's existing generic key/value `preferences` store — no new IndexedDB schema needed anywhere in this module.

## Layout

Five sections on one page (or five tabs — designer's call, this app uses both patterns elsewhere: Today is one continuous page, Tasks/Schedule/Habits/Finance/Focus/Analytics all use some form of tabs or one-long-scroll). Order: Preferences → Theme → Backup & Restore History → Shortcuts Reference → Data Management.

## The 5 sections

1. **Preferences** — a short list of small, low-risk toggles, each just a new key in the existing `preferences` store:
   - Default landing view on launch (today it's always Today — let the person pick any module as their home screen)
   - Week starts on Sunday or Monday (affects Schedule's Week view and Analytics' Productive Hours Heatmap day ordering)
   - Default priority for new tasks created without one specified (`!low` / `!med` / `!high`)
   - Default Focus session mode + duration (Pomodoro/Freeform/Stopwatch, and a default minute count) — saves re-picking the same mode every session
   - Insights: on/off per detector (all 10 default on), and the daily run time (currently a fixed 6:00am) — lets someone silence one detector they don't find useful without losing the other nine

2. **Theme** — light/dark, already fully implemented (topbar toggle, persisted via `theme.js`/`preferences`). This section is just a second, more discoverable place to find the same control — not a new toggle mechanism, the same one.

3. **Backup & Restore History** — Export/Import already work (Phase 1). What's missing: every export and import already gets logged to a `backups` store (id, timestamp, kind) that nothing currently displays. This section shows that log as a plain reverse-chronological list — "Exported · Jul 4, 2026, 9:14am" / "Imported · Jul 5, 2026, 8:02am" — plus the existing Export/Import buttons at the top. Nothing to invent here, just a history list the data already supports.

4. **Shortcuts Reference** — a static, read-only reference page listing every keyboard shortcut already implemented, grouped by module, since each module currently only shows its own shortcuts in a small footer bar while you're on that screen:
   - Global: `⌘K` / `Ctrl+K` — command palette
   - Tasks: `N` new task · `J`/`K` navigate · `X` complete · `S` snooze · `T` today · `⌘E` edit · `⌘Z` undo
   - Schedule: `N` new event · `D`/`W`/`M` switch view · `J`/`K` navigate · `T` jump to today
   - Habits: `N` new habit · `J`/`K` navigate · `L` log · `D` mark done
   - Focus: `S` start · `P` pause/resume · `X` end · `J`/`K` navigate
   - Finance: `N` new transaction · `E` new envelope · `F` fund envelope · `J`/`K` navigate

   This is documentation, not a new interaction — just a single place that lists what already exists.

5. **Data Management** — the one genuinely new capability: a per-store record-count summary (how many tasks/projects/events/habits/transactions/focus sessions/cached insights currently exist — cheap to compute, useful for someone wondering "how much have I actually logged"), and a "clear all data" reset action for starting over — destructive, needs a real confirmation step (type-to-confirm or a double-click-through, the same weight Finance's envelope-delete and Tasks' undo already treat destructive actions with), separate and visually distinct from the safe Export/Import actions above it.

## Component types needed (for the designer's reference)

- **Toggle/select rows** (Preferences, Theme) — label + control, no chart, no card needed beyond a simple list.
- **Plain list** (Backup history) — timestamp + kind, newest first, same shape as a simple activity log.
- **Reference table/grouped list** (Shortcuts) — module name as a group heading, key + label pairs underneath, matching the `.kbd`/`.klbl` treatment already used in every module's own footer hint bar.
- **Stat row + destructive action** (Data Management) — small plain numbers per store, then a clearly separated danger-zone button.

## Not needed

No account/profile/login section — this app has no accounts. No sync settings — fully offline by design. No notification settings — Insights has no push notifications (see its own design brief). No AI/model settings of any kind. No new IndexedDB store — everything above either reuses `preferences`/`backups` (both already exist) or reads counts from the stores that already exist.
