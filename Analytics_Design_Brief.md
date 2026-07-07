# Console — Analytics: Design Brief

For handoff to a design tool. Analytics is the one module in Console that was never built from a visual prototype — everything currently on screen is a hand-rolled, functional-but-plain first pass (no charting library, no dedicated design pass). This brief describes *what* each view needs to show; the visual treatment is open.

## Keep consistent with the rest of the app

- **Fonts**: Source Serif 4 (headings/display), Inter (body/UI), JetBrains Mono (labels, numbers, metadata) — no other fonts.
- **Palette**: warm off-white background, ink-black text, a warm terracotta/rust accent color, soft muted teal/amber/blue/rose as secondary accents. Light and dark theme both exist.
- **Feel**: generous whitespace, card-based panels with soft borders and rounded corners, restrained — data-dense but calm, not a flashy dashboard.
- **Current pain point**: chart panels read as small/cramped once several are stacked on one page, and there's no charting library in play, so line/bar/scatter visuals are currently basic hand-drawn shapes. This is the main thing worth a real design pass.

## Layout

One continuous scrollable page — not tabs. All 11 views stacked in order, each with a heading, separated by a clear visual break between sections. A range filter (7 days / 30 days / 90 days / all time / custom dates) sits in the app's top bar and affects every view at once.

## The 11 views

1. **Project Investment Matrix** — one dot per active project on a scatter plot: money spent (x-axis) vs. time invested (y-axis, calendar hours + focus session hours combined), dot size = number of open tasks on that project. A simple table with the same numbers underneath, for readability.

2. **Planned vs Executed** — for each of 8 schedule categories (deep work, meeting, admin, exercise, break, social, errand, sleep): scheduled hours vs. actually-logged hours, as a paired/grouped bar comparison per category.

3. **Productive Hours Heatmap** — a 7×24 grid (day of week × hour of day). Color intensity = how many focus minutes were logged in that slot, to reveal someone's real peak-focus windows.

4. **Subscription-vs-Usage Matrix** — one dot per recurring subscription: monthly cost (x-axis) vs. usage count (y-axis). The "expensive but barely used" quadrant should be visually called out as a cut candidate.

5. **Habit ↔ Output Correlation** — for each active habit, a paired comparison: average tasks completed and average focus hours on days the habit was done vs. days it wasn't.

6. **Calendar Load vs Todo Backlog** — two trend lines over time on one chart: scheduled hours per day, and the size of the open task backlog, to see whether a full calendar is crowding out actually getting things done.

7. **Decay Analysis** — a ranked list of tasks, projects, and habits, sorted by how long each has gone untouched, with anything over 14 days flagged as stale.

8. **Theme Day Output** — for each named theme day (e.g. someone might label Mondays "deep work day"), the average focus hours / tasks done / habit consistency on days with that theme, to check whether themed days actually deliver.

9. **Time-Money Rate** — a trend line of effective hourly rate (net income ÷ focus hours logged) over time.

10. **Cost per Focus Hour** — a trend line, paired with #9: fixed spending ÷ focus hours logged, over time.

11. **Energy Index** — one trend line: a single daily 0–100 score blending task-completion rate, habit consistency, and focus time against a daily target — a quick "how's the day/week going overall" read.

## Chart types needed (for the designer's reference)

- **Scatter plots** (views 1, 4) — with a readable table fallback for exact values.
- **Grouped/paired bar comparisons** (views 2, 5, 8) — two values side by side per category.
- **Heatmap grid** (view 3) — 7×24 cells, color intensity encodes value.
- **Trend lines** (views 6, 9, 10, 11) — simple line/area charts over a date range, sometimes two series on one chart (view 6).
- **Ranked list** (view 7) — not a chart, a sorted list with a "stale" flag.

## Not needed

No predictive or AI-scored metrics anywhere — every number is a plain, explainable calculation (sums, averages, ratios). No new data inputs — everything is computed from data the rest of the app already tracks (tasks, schedule, habits, transactions, focus sessions).
