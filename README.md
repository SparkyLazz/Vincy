# Console

A personal, fully offline productivity app — Tasks, Schedule, Habits, Finance, Focus Sessions, Analytics, and Insights, all in one place. No account, no server, no build step, no tracking. Your data lives in your browser and never leaves your machine.

New to the app? See **[TUTORIAL.md](TUTORIAL.md)** for a full walkthrough of every screen, the quick-capture syntax, and keyboard shortcuts.

## Features

- **Tasks** — GTD inbox-first capture with a quick-add syntax (`call vendor tomorrow !high @phone #client-a`), subtasks, recurring tasks, 8 views (Inbox, Today, This Week, Upcoming, Someday, Waiting, By Project, By Tag).
- **Schedule** — Day / Week / Month / Agenda calendar, 8 strict event types, recurring events with exception handling, drag-to-reschedule, mandatory planned-vs-actual logging.
- **Habits** — Atomic Habits framework (cue / craving / response / reward, identity, habit stacking), multi-state logging (done / partial / skip / miss), rolling 30-day consistency — deliberately no streaks.
- **Finance** — Multi-currency transactions, YNAB-style envelope budgeting with a To-Be-Budgeted pool, subscription usage audit, cost-per-focus-hour reporting.
- **Focus Sessions** — Pomodoro / Freeform / Stopwatch timers, soft-strict mode (dims the rest of the UI without blocking navigation), a floating session indicator visible from every screen, triggerable from a task, event, or habit.
- **Analytics** — 11 cross-domain views: investment matrix, planned-vs-executed, productive-hours heatmap, subscription-vs-usage, habit correlation, decay analysis, theme-day output, time-money rate, energy index, and more.
- **Insights** — 10 automatic detectors (procrastination trend, commitment overload, stale waiting items, subscription low-use, envelope overspend, and others) that re-check once a day and surface what needs attention.
- **Command palette** (`⌘K` / `Ctrl+K`), light/dark theme, and full JSON export/import for backup.

## Tech stack

Vanilla HTML, CSS, and JavaScript. No framework, no bundler, no `npm install`. Data is stored locally in the browser's IndexedDB — nothing is sent anywhere.

## Getting started

1. Clone or download this repo as a ZIP.
2. Open `index.html` directly in a modern desktop browser (Chrome, Edge, or Firefox) — double-click the file, or drag it into a browser window.

That's it. No server, no build step, no account.

> **Running from a local server instead of `file://`:** everything works either way. If your browser is fussy about `file://` pages (rare, but some browser security settings restrict local-file access to things like IndexedDB), serve the folder instead: `python3 -m http.server 8000` from the project root, then visit `http://localhost:8000`.

Your data is created the first time you use each screen — there's no seed/demo data, so Tasks/Schedule/Habits/Finance/Focus will look empty until you add your own.

## Backing up your data

Everything lives in your browser's IndexedDB for this page's origin, which means it's tied to one browser profile on one device. To move it, back it up, or restore after clearing browser data:

**Settings → Backup & Restore History → Export** downloads a full JSON snapshot. **Import** restores from that same file. Do this before clearing your browser's site data, switching browsers, or moving to a new machine.

## Project structure

```
index.html              App shell: sidebar, topbar, content region, floating timer, command palette
css/
  tokens.css             Design tokens — color, type, motion (durations/easing)
  base.css               App shell chrome + shared keyframes/motion system
  components.css         Every reusable UI component, one file, organized by module
js/
  db.js                  IndexedDB schema (15 object stores) and helpers
  router.js              Hash-based routing (#/today, #/tasks, ...)
  app.js                 Boot sequence, theme, floating timer, topbar wiring
  lib/                   Shared logic: quick-capture parser, habit math, date formatting
  modules/<name>/index.js  One folder per feature (today, tasks, schedule, habits, finance,
                           focus, analytics, insights, settings) — each exposes init()/destroy()
docs/                    Build history, full feature spec, and per-phase verification notes —
                         useful if you want to understand *why* something is built a certain way
prototypes/              Original design mockups the UI was built from
```

## Known limitations

- **Fonts load from Google Fonts on first visit** (Source Serif 4, Inter, JetBrains Mono). The original design called for self-hosting these for a fully air-gapped experience, but the current build links to `fonts.googleapis.com`. The app still works with no internet at all — it just falls back to your system fonts instead of the intended typefaces. Self-hosting them (download the 3 families, drop the font files in `fonts/`, add `@font-face` rules to `css/tokens.css`, drop the Google Fonts `<link>` tags from `index.html`) would close this gap if a fully offline first-run matters to you.
- **Week-start preference** is savable in Settings (Sunday/Monday) but not yet consumed — Schedule's week view and Analytics' productive-hours heatmap both still assume Monday-start.
- Data is scoped to one browser profile on one device (standard IndexedDB behavior, not a bug) — see "Backing up your data" above.

## License

MIT — see [LICENSE](LICENSE).
