# Console — Getting Started

This is a walkthrough for someone opening Console for the first time. If you just want the short version, see [README.md](README.md).

## First launch

Open `index.html` in your browser. You'll land on **Today** — a dashboard that stays empty until you start adding things elsewhere, since there's no demo data. Everything you create is saved automatically to your browser's local database (IndexedDB) as you go; there's no save button and no account to sign into.

The sidebar on the left is how you move between the 9 screens: Today, Tasks, Schedule, Habits, Finance, and Focus under "Workspace", then Analytics, Insights, and Settings under "Insight". Clicking one fades in the new screen.

At the top right: a range filter (7d/30d/90d/all/custom — used by Analytics), a command palette trigger (`⌘K` / `Ctrl+K`), and a light/dark theme toggle.

## Tasks

Tasks follows a GTD-style inbox-first flow: everything you capture lands in the Inbox first, and you process it from there into a due date, project, or context.

**Quick capture** understands a small syntax so you can type naturally and still get structured data:

| You type | Console understands |
|---|---|
| `today` / `tomorrow` | due date |
| a weekday name (`friday`, `mon`) | due date = next occurrence of that day |
| an explicit date (`2026-08-01`) | due date |
| `!low` / `!med` / `!high` | priority |
| `@phone`, `@errand`, any `@word` | context tag (you can have more than one) |
| `#client-a`, any `#word` | project (first one found; created if it doesn't exist yet) |

Example: `call vendor tomorrow !high @phone #client-a` creates a task titled "call vendor", due tomorrow, high priority, tagged `@phone`, filed under project "client-a". Anything left over after stripping those tokens becomes the task title.

The 8 views (Inbox, Today, This Week, Upcoming, Someday, Waiting, By Project, By Tag) are tabs across the top. Tasks can have subtasks (one level deep) and recur on a schedule (daily/weekly/monthly/weekday/weekend).

**Shortcuts:** `N` new task · `J`/`K` navigate up/down · `X` complete · `S` snooze · `T` jump to today · `⌘E` edit · `⌘Z` undo.

## Schedule

A calendar with 5 views: Day, Week, Month, Agenda, and a Theme Days editor. Every event is one of exactly 8 types — `deep_work`, `meeting`, `admin`, `exercise`, `break`, `social`, `errand`, `sleep` — shown as a color-coded legend. This is deliberate: the strict taxonomy is what makes Analytics' cross-domain views meaningful later.

Drag an event up or down to reschedule it (snaps to 15-minute increments). Recurring events support three edit modes when you change one occurrence: edit just this one, edit this-and-future, or skip this one. Past events need a planned-vs-actual log entry (a dashed "LOG" badge marks ones still waiting) — you can also mark one as skipped instead.

Theme Days let you label a weekday with an identity (e.g. "Maker Monday") from the Theme Days editor tab; it shows up as a small italic label under that day's header.

**Shortcuts:** `N` new event · `D`/`W`/`M` switch view · `J`/`K` navigate · `T` jump to today.

## Habits

Built around James Clear's Atomic Habits framework: each habit can have a cue, craving, response, and reward, plus an identity statement ("I am someone who...") and habit-stacking/environment-design notes.

Logging is multi-state, not just a checkbox: **done**, **partial**, **skip**, or **miss** — useful for habits with a quantitative target (pages read, minutes meditated, reps done) where "partial credit" is real information. Progress is shown as a rolling 30-day consistency percentage. There are no streaks anywhere in this app, on purpose — a single missed day resetting a "streak" to zero is treated as bad incentive design, not motivating.

4 views: Today (log today's habits), All habits, Correlations (habit consistency vs. other metrics), and Archive.

**Shortcuts:** `N` new habit · `J`/`K` navigate · `L` log · `D` mark done.

## Finance

Transaction tracking against a YNAB-style envelope budget: money is allocated into named envelopes (rent, groceries, savings, etc.), and each transaction draws down an envelope's remaining balance. A "To-Be-Budgeted" banner at the top shows what's left to assign. Multi-currency transactions carry their own FX rate.

The Subscriptions view audits recurring charges against actual usage ("Netflix · 0 uses this month") to surface candidates worth cancelling. Reports cross-reference Finance with Focus Sessions for a cost-per-focus-hour figure.

5 views: Overview, Transactions, Envelopes, Subscriptions, Reports.

**Shortcuts:** `N` new transaction · `E` new envelope · `F` fund an envelope · `J`/`K` navigate.

## Focus Sessions

A timer with three modes — **Pomodoro** (fixed work/break intervals), **Freeform** (open-ended, just tracks elapsed time), and **Stopwatch-with-target** (counts up toward a goal duration). You can start a session standalone or trigger it directly from a task, event, or habit, which links the session back to that item automatically.

**Soft-strict mode** dims the sidebar/topbar while a session is running as a visual focus cue — it never blocks navigation, so you can still switch screens if you need to. A floating timer stays visible in the corner from anywhere in the app while a session is active.

3 views: Timer, Log, Summary.

**Shortcuts:** `S` start · `P` pause/resume · `X` end · `J`/`K` navigate.

## Analytics

11 views that cross-reference data between modules — for example, Habit ↔ Output Correlation compares your output on habit-done days vs. habit-missed days, and Cost per Focus Hour combines Finance and Focus Sessions data. Every view respects the range filter in the top bar (7d/30d/90d/all/custom).

## Insights

A single feed of automatically-detected patterns, refreshed once per calendar day (not live/instant — checking more often than daily wasn't the goal). Each insight can be dismissed or snoozed for the current session, or marked read (which persists and clears the sidebar's unread badge). Detectors include things like procrastination trending up, a project not getting any time ("starving project"), a subscription that's not being used, and a habit's consistency dropping.

## Settings

Five sections:
- **Preferences** — default landing view (which screen you land on when you open the app), week start day, default task priority, default Focus mode/duration, and per-detector toggles for which Insights you want running.
- **Theme** — a second place to switch light/dark (same toggle as the topbar).
- **Backup & Restore History** — export/import your data as JSON, and see a log of past backups.
- **Shortcuts Reference** — every keyboard shortcut in the app, listed by module (the same ones documented above).
- **Data Management** — per-store record counts, and a type-to-confirm "clear all data" option if you want to start over.

## Backing everything up

Your data only exists in this browser's IndexedDB, on this device. Before switching browsers, clearing site data, or moving to a new machine:

**Settings → Backup & Restore History → Export** downloads everything as one JSON file. **Import** loads it back in — either into a fresh install or to restore after clearing data.

## Command palette

`⌘K` (Mac) or `Ctrl+K` (Windows/Linux) opens a fuzzy search across navigation, actions, and entities — a faster way to jump around once you're used to the app.
