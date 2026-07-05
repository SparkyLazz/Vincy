/* Console — lib/habits.js (Phase 4)
   Rolling 30-day consistency % and day-chain math, shared between the Habits module (14-day
   mini chain, 60-day full chain, detail-panel %) and Today dashboard's habits card (per-habit
   today state + its own rolling %) — same reason js/lib/capture.js exists: two independent
   copies of this math is exactly the drift risk Console_Workflow.md flags every phase for.

   No streaks anywhere — this file computes exactly one consistency metric (rolling 30-day %,
   see consistency30 below) and nothing that resembles a "current streak" counter. That's a
   locked decision (docs/Console_Features_List.md), not an oversight.

   Heuristic, documented here and in docs/phase_prompts/phase_4_habits.md item 3 rather than a
   scoring model:
     - Window: from max(habit's created date, today - 29 days) through YESTERDAY. Today itself
       is excluded until it's actually logged — an unlogged "not yet" habit shouldn't drag its
       own number down mid-day (matches the prototype's "not yet" today-val state).
     - done    = 1 point   / 1 denominator
     - partial = 0.5 point / 1 denominator
     - miss, or no log at all for an eligible day = 0 point / 1 denominator
     - skip = excluded from BOTH point and denominator — the antifragile mechanic the prototype's
       own philosophy note describes ("missing one day never resets your progress"): a skip is a
       deliberate non-penalized pass, not a failure.
     - % = round(point / denominator * 100), or 0 if denominator is 0 (brand-new habit, no
       eligible days yet). */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.lib = Console.lib || {};

  var STATES = ['done', 'partial', 'skip', 'miss'];

  function fmt() { return Console.lib.format; }

  function findLog(logs, habitId, dateISO) {
    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      if (l.habit_id === habitId && l.date === dateISO) return l;
    }
    return null;
  }

  // Later of two ISO dates (string compare is safe for YYYY-MM-DD).
  function laterISO(a, b) { return a > b ? a : b; }
  function earlierISO(a, b) { return a < b ? a : b; }

  function consistency30(habitId, logs, todayISO, createdAtISO) {
    var f = fmt();
    var createdISO = (createdAtISO || todayISO).slice(0, 10);
    var windowStart = laterISO(createdISO, f.addDaysISO(todayISO, -29));
    var windowEnd = f.addDaysISO(todayISO, -1); // yesterday — today is excluded, see header note

    if (windowStart > windowEnd) return 0; // habit created today (or in the future) — nothing to score yet

    var point = 0, denom = 0;
    var day = windowStart;
    var guard = 0;
    while (day <= windowEnd && guard < 400) { // guard: sanity cap, this loop is always <=30 iterations in practice
      guard++;
      var log = findLog(logs, habitId, day);
      if (!log) {
        denom += 1; // no log on an eligible day = treated as miss, per the heuristic above
      } else if (log.state === 'done') {
        point += 1; denom += 1;
      } else if (log.state === 'partial') {
        point += 0.5; denom += 1;
      } else if (log.state === 'miss') {
        denom += 1;
      }
      // 'skip' — excluded entirely, no point/denom change
      day = f.addDaysISO(day, 1);
    }
    return denom ? Math.round(point / denom * 100) : 0;
  }

  // Returns an array of { date, state (or null if unlogged/before creation), today (bool) },
  // oldest-to-newest, covering the last `n` days ending today. Shorter than `n` if the habit is
  // younger than `n` days (days before creation are simply omitted, not padded with fake state).
  function dayChain(habitId, logs, todayISO, createdAtISO, n) {
    var f = fmt();
    var createdISO = (createdAtISO || todayISO).slice(0, 10);
    var out = [];
    for (var i = n - 1; i >= 0; i--) {
      var day = f.addDaysISO(todayISO, -i);
      if (day < createdISO) continue;
      var log = findLog(logs, habitId, day);
      out.push({ date: day, state: log ? log.state : null, today: day === todayISO });
    }
    return out;
  }

  Console.lib.habits = {
    STATES: STATES,
    findLog: findLog,
    consistency30: consistency30,
    dayChain: dayChain
  };
})();
