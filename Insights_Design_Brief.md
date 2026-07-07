# Console — Insights: Design Brief

For handoff to a design tool. Insights is the one remaining module with zero prototype and almost zero spec — `Console_Features_List.md` only names "10 detectors, run daily at 06:00" and lists their internal keys, nothing else. This brief defines what each detector actually means and what the feed should look like; the visual treatment is open.

## Keep consistent with the rest of the app

- **Fonts**: Source Serif 4 (headings/display), Inter (body/UI), JetBrains Mono (labels, numbers, metadata) — no other fonts.
- **Palette**: warm off-white background, ink-black text, warm terracotta/rust accent, soft muted teal/amber/blue/plum/rose as secondary accents. Light and dark theme both exist.
- **Feel**: same restrained, card-based, generous-whitespace feel as Analytics. This is a feed of plain facts, not a notifications-panel/red-badge-alarm feel — nothing here should read as an urgent alert. Calm, matter-of-fact tone even when what's found is a problem.
- **Nothing predicted.** Every card states something that has already happened, with the real numbers behind it shown plainly — same "every number computed, nothing predicted" rule Analytics follows. No AI-generated advice text, no confidence percentages, no forecasts of what will happen next.

## Layout

One feed, one view (the spec's own screen count: "Insights feed · 1 view"). Cards stacked vertically, most severe/most recent first. A small header line states when detectors last ran ("checked today at 6:00am") and how many active insights there are — this is also the number shown as a badge on the sidebar's Insights nav item. Each card can be dismissed (acknowledged — "seen it, not now") or snoozed; dismissed cards drop out of the feed but nothing is ever silently deleted. An empty state ("Nothing flagged right now") is the common case, not a placeholder to apologize for.

## Each card needs

- Which detector fired, in plain language (not the internal snake_case key)
- The actual finding, stated as a fact with real numbers ("Netflix: $17.99/mo, 0 uses this month" — not "your subscription usage seems low")
- A severity indicator (used only to sort the feed — see "Not needed" below)
- When it was detected
- A link/action back to the relevant module (Tasks/Schedule/Habits/Finance/Focus/Analytics) so the person can act on it immediately, not just read about it

## The 10 detectors

1. **Estimate Accuracy Drift** — compares how far off your task time-estimates have been recently vs. a prior stretch. If the gap between estimated and actual hours (from linked focus sessions) has gotten meaningfully wider recently than it was before, that's worth surfacing — your planning is getting less reliable, not just occasionally off.

2. **Procrastination Rising** — tracks how often tasks get finished on time vs. late, and flags it when that's trending the wrong way — a falling on-time-completion rate over the last couple of periods, not just one bad week.

3. **Commitment Overload** — adds up scheduled calendar hours plus the estimated hours still sitting in open tasks due soon, and flags it when that total is pushing past what a week can realistically hold (a stated, sane weekly-hours ceiling, not a guess).

4. **Stale Waiting Items** — anything sitting in the Tasks "Waiting" bucket untouched past a plain day threshold (same idea as Analytics' Decay Analysis, but scoped specifically to things you're blocked on / waiting for someone else).

5. **Subscription Low Use** — a recurring charge that's expensive and barely used this period (same "cut candidate" definition as Analytics' Subscription-vs-Usage Matrix) — surfaced as a direct callout instead of something you'd only notice by opening a chart.

6. **Envelope Overspend Pattern** — a budget envelope that's gone over its allocation more than once in the last few periods — a repeating pattern, not a single rough month that corrects itself.

7. **Habit Consistency Drop** — a habit whose rolling consistency has fallen off meaningfully compared to where it was a month ago — catches a habit quietly slipping before it fully disappears.

8. **Unscheduled Obligations** — an important task with a real due date coming up soon that has no actual time blocked for it anywhere on the calendar — a commitment that only exists as a line on a list, not as protected time.

9. **Starving Project** — an active project with open tasks that has had almost no time or money put into it recently — the opposite corner of Analytics' Investment Matrix: still open, quietly getting nothing.

10. **Productive Hour Misalignment** — your scheduled deep-work blocks are landing outside the hours where you actually produce your best focus time (per Analytics' own Productive Hours Heatmap) — the calendar and your real energy aren't lined up.

## Card types needed (for the designer's reference)

- A simple **feed card**: icon/label for which detector fired, one or two lines of plain finding text with real numbers bolded, a timestamp, a small severity tag, a dismiss/snooze control, and a link into the relevant module. All ten detectors use the same card shape — nothing here needs a chart or a table, just clear text.
- A **feed header**: last-checked time + active count.
- An **empty state**: calm, not apologetic — this is the normal, good state.

## Not needed

No predictive or AI-scored metrics — every finding is a plain, explainable comparison (a threshold crossed, a trend over two comparable periods, a plain sum vs. a stated reference number). The one internal "score" field mentioned in the data model exists purely to sort the feed by how far past its own threshold something is — it's not a fused/opaque score across detectors, and it's never shown to the person as if it were a diagnosis. No push notifications, no sound, no red urgent-alert styling — this is an offline app the person opens on their own schedule. No new data inputs — everything is computed from data the rest of the app already tracks (tasks, schedule, habits, transactions, focus sessions).
