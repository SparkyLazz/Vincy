# Phase 8 — Insights

Unlike Focus/Analytics before it, a real prototype exists for this phase: the user commissioned an external design pass (handed the project's own `Insights_Design_Brief.md` to an outside design tool) and uploaded the result, `Console Insights - Design Brief.html` (a "bundled page" mockup export, same format as the Analytics prototype). Extracted to `insights_extracted.html` for reference. Same extraction-not-recreation discipline as every other phase: markup/CSS/copy below is taken from that file; the 10 detectors' actual computation logic (never defined anywhere before this phase — the features list only lists 10 detector keys) is defined fresh here, grounded in the real schema.

**Touches `db.js` minimally**: the `insights` store already exists (`{keyPath:'id', indexes:[detector, created_at, score]}`) and `js/app.js`'s `refreshNavCounts()` already reads `insights.filter(i => !i.read)` for the sidebar badge — written in Phase 1 anticipating this phase. No schema/index change needed; `read`, `dismissed_at`, `snoozed_until` are added as plain (unindexed) fields on each row, same as every other module's optional fields.

## Design decisions

1. **"Runs daily at 06:00" becomes "runs once per calendar day, on first load that day."** This is a static `file://` page with no service worker and no real cron — a literal 6:00am background job is not possible. `Console.db.getPref('insights_last_run')` is checked against `todayISO()` on module init; if it doesn't match, all 10 detectors run now, and the pref is updated. The prototype's own "checked today at 6:00am" copy is kept as the displayed label (the *intent* — check once a day, first thing — is preserved even though the literal wall-clock time isn't enforceable offline).

2. **Detector rows are upserted by a stable id, not appended.** Each detector has one row max, keyed `id = 'insight:' + detectorKey` (not a random uuid) so a re-run updates the same row instead of duplicating it. On each day's run: a detector that fires gets its row put with a fresh `created_at`, `dismissed_at: null`, `snoozed_until: null`, `read: false` — a new day's re-detection is treated as a new finding, matching the prototype's own copy ("nothing is deleted, they'll resurface if the condition recurs"). A detector that no longer fires has its row deleted, so the feed never shows a stale non-issue.

3. **`read` = "seen this feed at least once," not "acted on."** The moment the Insights module renders the feed, every visible row is marked `read: true` (persisted) — this is what makes the sidebar's nav-count badge (already wired, decision above) mean "new since your last visit," the same semantics as an inbox. Dismiss/Snooze are a separate, lighter, **session-only** layer (in-memory `dismissed`/`snoozed` maps in the module, exactly matching the prototype's own mock `state`), not persisted — reloading the page or waiting for tomorrow's re-run is what actually clears them, matching the prototype's own "dismissed or snoozed **this session**" copy precisely, and avoiding inventing a persistence mechanism the prototype doesn't ask for.

4. **Each detector has one fixed severity tier, not a computed one.** The prototype assigns severity per detector (`rose`/"elevated" for Commitment Overload and Procrastination Rising, `amber`/"notable" for Starving Project, Estimate Accuracy Drift, Unscheduled Obligation, Subscription Low Use, Stale Waiting Item, `blue`/"minor" for Habit Consistency Drop, Envelope Overspend Pattern, Productive Hour Misalignment) — a stated design judgment about which *kinds* of findings matter more, not a per-instance score. Kept exactly as assigned in the prototype. Same anti-scoring-model discipline as Analytics' Energy Index and Habits' consistency.

5. **No event↔task linkage field exists anywhere in the schema** (checked — `events` has no `task_id`). Unscheduled Obligations therefore uses the honest computable proxy: a `!high` priority task due within the next 7 days where **its due-date has zero non-skipped scheduled events of any kind** — "nothing at all is blocked on the calendar that day" — rather than inventing a fake link. Logged here as a real, deliberate simplification (same category as Analytics' backlog-as-due-or-overdue proxy), not silently faked.

6. **Detectors that can find more than one qualifying item report the single worst one**, with the finding text noting how many others also qualify (e.g. "...and 2 other subscriptions"). Keeps the "one card per detector" shape the prototype shows while not hiding that more than one thing qualifies. Applies to Subscription Low Use, Stale Waiting Item, Habit Consistency Drop, Envelope Overspend Pattern.

7. **Not scoped to Analytics' global range filter.** Insights is a feed, not a chart — each detector defines its own fixed lookback window (stated per-detector below), same as Analytics' own Decay Analysis being unscoped to its range filter for the same underlying reason (staleness/patterns need to look back further than a single preset window).

## The 10 detectors, precisely defined

Each states: what it reads, its fixed lookback/threshold constants (named, not hidden), and when it fires.

1. **Commitment Overload** (severity: elevated) — `COMMITMENT_WEEKLY_CEILING_HOURS = 50`. Sum of this calendar week's scheduled event hours (all types, non-skipped) plus `est_minutes/60` for open tasks due this week. Fires if the total exceeds the ceiling. *"Scheduled hours plus estimates on tasks due this week add up to **58.5h** — past your **50h** weekly ceiling."*

2. **Procrastination Rising** (elevated) — `PROC_PERIOD_DAYS = 14`, `PROC_DROP_PP = 15` (percentage points), min 3 completed-with-due-date tasks per period. On-time % = tasks completed on/before `due_date` ÷ tasks completed with a `due_date`, using the task's last `activity` entry with `type: 'complete'` for its completion timestamp (falls back to `processed_at` if no activity entry exists). Compares the last 14 days to the 14 before that; fires if on-time % dropped by ≥15pp. *"On-time task completion has dropped to **54%** this period, down from **76%** the period before."*

3. **Starving Project** (notable) — `STARVING_LOOKBACK_DAYS = 21`, `STARVING_HOURS_THRESHOLD = 2`. Non-archived project with ≥1 open task where (event hours + focus hours) linked to that project over the last 21 days is below the threshold. Reports money spent in the same window for context (can be $0 or more — not itself the trigger). *"**#client-a** has 6 open tasks but only **1.5h** and **$0** logged against it in the last 3 weeks."*

4. **Estimate Accuracy Drift** (notable) — `ESTIMATE_DRIFT_WORSENING_PP = 20`, min 3 qualifying tasks per period. Qualifying task = has `est_minutes` and ≥1 linked `focus_sessions` row (via `task_id`). Error % = (actual − estimate) ÷ estimate × 100, averaged per calendar month. Fires if this month's average error is ≥20pp worse than last month's. *"Estimated vs. actual task time is off by **+62%** on average this month, up from **+18%** last month."*

5. **Unscheduled Obligation** (notable) — `UNSCHEDULED_LOOKAHEAD_DAYS = 7`. A `priority: 'high'` open task due within the next 7 days whose due-date has zero non-skipped scheduled events anywhere that day (decision #5's proxy). Reports the soonest-due qualifying task. *"**"Renew business license"** is due in **4 days** with no time blocked anywhere on the calendar."*

6. **Subscription Low Use** (notable) — same "cut candidate" definition as Analytics' Subscription-vs-Usage Matrix: `cost ≥ 15 && usage_count ≤ 4` this month, de-duped by title. Reports the highest-cost qualifying subscription (decision #6). *"**Netflix**: $17.99/mo, **0 uses** logged this month."*

7. **Stale Waiting Item** (notable) — `STALE_WAITING_DAYS = 14` (a separate stated constant from Analytics' own `DECAY_STALE_DAYS`, duplicated rather than imported, same "don't reach into another module's private constant" precedent as every prior phase). Task with `status: 'waiting'` untouched (days since `processed_at`, or `created_at` if unset) ≥14 days. Reports the stalest one. *"**"Vendor contract signature"** has sat in Waiting for **19 days** — past the 14-day threshold."*

8. **Habit Consistency Drop** (minor) — `HABIT_DROP_PP = 20`. For each active habit, `Console.lib.habits.consistency30` evaluated at today vs. at 30 days ago (same function, shifted `todayISO` — no new math). Fires if current is ≥20pp below the shifted value. Reports the habit with the largest drop. *"**"Morning pages"** consistency has fallen to **48%** this month, down from **81%** a month ago."*

9. **Envelope Overspend Pattern** (minor) — `ENVELOPE_LOOKBACK_PERIODS = 3`, fires at ≥2 of 3. Groups envelopes by `category_id` across the last 3 calendar-month periods; an envelope period counts as "overspent" if its linked transactions sum past `allocated`. Reports the category with the most overspent periods in the window. *"**"Dining out"** has gone over its monthly allocation **3 of the last 4** periods."* (worked example shown uses a 4-period window in the prototype copy; implementation checks the last 3 completed periods behind the current one, i.e. up to 4 periods total including the current one where relevant — keep the exact phrasing pattern, adjust the number to whatever the real data shows.)

10. **Productive Hour Misalignment** (minor) — `MISALIGN_LOOKBACK_DAYS = 30`, `MISALIGN_THRESHOLD_PCT = 50`. Same peak-window computation as Analytics' Productive Hours Heatmap (busiest day+hour cell for focus minutes) over the last 30 days; fires if ≥50% of scheduled `deep_work` events in that window start outside `peak_hour ± 1`. *"**62%** of scheduled deep-work blocks land outside your peak focus window (Wed 9–11am)."*

## Scope

1. `js/modules/insights/index.js` — replaces the currently-missing file (`index.html` already references it and already has a `.nav-count` badge + sidebar entry from Phase 1 groundwork). Single feed view, no tabs, no range filter.
2. New dedicated CSS (`.ins-*` family) in `components.css` matching the prototype's feed header / card / severity pill / empty state / dismissed-footer treatment exactly.
3. `db.js`: no schema change. `insights` rows gain `read`/`dismissed_at`/`snoozed_until` as plain fields.
4. `js/app.js`: no change needed — `refreshNavCounts()` already reads `insights.filter(i => !i.read)`.

## Acceptance criteria

- [ ] All 10 detectors run once per real calendar day (verified: reload within the same day does not re-run them; changing the system clock or waiting a day does).
- [ ] Every finding renders with real numbers pulled from real stores — no mock/demo data shipped in the final module.
- [ ] Dismiss/Snooze are session-only (reload restores everything the underlying data still supports); the persisted `read` flag drives the nav badge independently of Dismiss/Snooze.
- [ ] Empty state ("Nothing flagged right now") renders when zero detectors fire — not an error, not a placeholder apology.
- [ ] Every stated constant (weekly ceiling, lookback windows, percentage-point thresholds) is a named constant in the code, not a bare number.
- [ ] No invented CSS class ships without a matching rule — grepped before calling this code-verified (same gap Phase 6 hit twice, Phase 7 caught once during its own redesign).

## Explicitly out of scope

- No true background/6am scheduling — decision #1's honest once-per-day-on-load substitute.
- No event↔task linkage field added to `events` — decision #5's honest proxy instead.
- No cross-detector fused "how bad is today overall" score — each of the 10 stays independent, per decision #4.
- No multi-day persisted snooze windows — decision #3's session-only simplification.
