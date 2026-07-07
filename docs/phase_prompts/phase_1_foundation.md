# Console — Phase 1: Foundation

> Ships with the fidelity bundle: `css/tokens.css`, `css/base.css`, `css/components.css`, `docs/visual_contract.md`, this brief, and `prototypes/console_today_prototype.html` as the visual reference. tokens → base → components are the source of truth for styling — copy verbatim, load in that order in `<head>`. The prototype's HTML structure (sidebar markup, nav items, topbar) is the structural reference — reuse it, don't redraw it from description. Missing a component? Add it to `components.css`, don't inline. Contract wins over prototype if they disagree. Follow `docs/Console_Workflow.md` — no rushing, one phase, fully verified, before moving to Schedule/Habits/Finance/Focus.

## Scope

Foundation = the app shell every other module plugs into, plus the Today dashboard (the one screen this phase fully ships).

1. Static `index.html` at project root — opens directly from `file://`, no build step, no bundler.
2. IndexedDB database `console-db` with **all 13 stores defined now** (see schema below) — even though only `tasks`/`projects`/`events`/`habits`/`focus_sessions`/`preferences` get real data this phase. Defining every store upfront avoids migrations later; this is a locked decision, not a suggestion.
3. Hash-based routing (`#/today`, `#/tasks/inbox`, etc.) — must work opening the file directly, no server.
4. Light/dark theme via `data-theme` attribute on `<html>`, toggled from the topbar control, persisted to the `preferences` store (not just in-memory — reload should keep the theme).
5. Command palette (`⌘K`) — the prototype only has the static trigger button (`.cmd-trigger`), no actual overlay. Build the real overlay using `components.css`'s `.palette` component (from the design library's COMMAND PALETTE section). Fuzzy search across: nav destinations, and a placeholder "recent commands" list (real entity/action search gets richer as later phases add data).
6. Module loader pattern: `js/modules/<name>/index.js` exports `init(container)` / `destroy()`. Phase 1 only implements `today`; the other 8 folders (`tasks`, `schedule`, `habits`, `finance`, `focus`, `analytics`, `insights`, `settings`) get a stub `init()` that renders an empty-state placeholder (using `components.css`'s `.empty` component) so nav links don't dead-end.
7. Today dashboard — the full fixed layout from `prototypes/console_today_prototype.html`: insight card → hero stats strip → today's calendar + tasks → habits + quick capture → upcoming week + money snapshot → waiting-for + suggested focus blocks. Since Tasks/Schedule/Habits/Finance/Focus aren't built yet, wire the dashboard to real IndexedDB reads that will legitimately return empty — render the empty states, don't fake data.
8. Floating active-session indicator (`.floating-timer`) — static/hidden in Phase 1 (no real focus session exists yet until Phase 6), but the component and its container should exist so Phase 6 only has to add behavior, not markup.
9. JSON export/import — minimal version: a settings-stub action that dumps all 13 stores to a JSON file and can re-import it. Full Settings UI is Phase 8; this is just the underlying db.js function plus a bare trigger.

## Data model — build all 13 stores now

| Store | Key indexes |
|---|---|
| `tasks` | status, project_id, due_date, tags |
| `projects` | status, archived_at |
| `events` | start_date, type, project_id |
| `event_logs` | event_id, date, `[event_id+date]` |
| `event_recur_definitions` | next_run_date |
| `theme_days` | day_of_week |
| `habits` | status, cadence |
| `habit_logs` | habit_id, date, `[habit_id+date]` |
| `transactions` | date, envelope_id, project_id, currency |
| `envelopes` | period, category_id |
| `categories` | type, parent_id |
| `focus_sessions` | start_at, type, task_id, habit_id |
| `insights` | detector, created_at, score |
| `preferences` | key |
| `backups` | created_at |

## Sidebar navigation (exact, from the prototype)

Two nav groups, in this order, each item with its existing SVG icon from `console_today_prototype.html`:

**Workspace** — Today (count = open items), Tasks (count = open tasks), Schedule, Habits (count = active habits), Finance, Focus
**Insight** — Analytics, Insights (count = unread insight cards), Settings

`Today` is active by default. Counts should read from IndexedDB, not be hardcoded — they'll legitimately show 0 until later phases add data.

## Acceptance criteria

- [ ] `index.html` opens from `file://` with no console errors, no network dependency except the Google Fonts `<link>` tags already in the prototype (self-hosted fonts are a later polish step, not blocking Phase 1).
- [ ] All 13 IndexedDB stores exist with correct key paths and indexes on first load (verify in devtools, not just by reading the code).
- [ ] Routing: navigating to `#/today`, `#/tasks`, `#/schedule`, etc. swaps the content region via each module's `init()`/`destroy()` without a full page reload; back/forward browser buttons work.
- [ ] Theme toggle switches instantly, persists across reload, matches `tokens.css` values in both modes.
- [ ] `⌘K` opens the command palette overlay; typing filters nav destinations; `Esc` closes it; matches `.palette` styling exactly.
- [ ] Today dashboard renders the full layout from the prototype with real (currently-empty) data — every section either shows real content or its actual empty state, never mock/placeholder text left in from the prototype.
- [ ] Full `docs/visual_contract.md` checklist passes for the Today screen, both themes.
- [ ] JSON export produces a valid file containing all 13 stores; re-importing it round-trips without data loss.

## Explicitly out of scope for this phase

- Any real functionality inside Tasks/Schedule/Habits/Finance/Focus/Analytics/Insights/Settings beyond their empty-state stub.
- NLP task capture, recurring events/habits, envelope budgeting, timer logic — all later phases.
- Self-hosted font files (`.woff2` in `/fonts/`) — using the Google Fonts CDN link from the prototypes is fine for now; self-hosting is a Phase 8 polish item.
- The 10 daily insight detectors — Phase 7. The insight card on Today can render a static "no insights yet" empty state.
