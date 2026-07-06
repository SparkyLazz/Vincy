/* Console — modules/insights. Phase 8: 10 cross-domain detectors, run once per real calendar day
   (see docs/phase_prompts/phase_8_insights.md Design Decision #1 — a literal 6:00am cron is not
   possible from a static file:// page with no service worker), cached to the `insights` store
   (already scaffolded in db.js since Phase 1, already read by js/app.js's nav-badge). Built from
   a real prototype the user commissioned and uploaded ("Console Insights - Design Brief.html") —
   same extraction discipline as every other phase's real prototype.

   No `layout: 'flush'` — a single feed, not a list+detail split. Renders inside
   .content/.content-inner like Today/Finance/Focus/Analytics.

   Persistence model (phase_8_insights.md Decision #2/#3): each detector's row is upserted by a
   stable id (`insight:<key>`), not appended — a re-run updates the same row. `read` means "seen
   this feed at least once" (drives the sidebar nav badge, already wired in app.js); Dismiss/Snooze
   are session-only (in-memory maps here, reset on reload), matching the prototype's own "this
   session" copy exactly — not a new persistence mechanism the prototype never asked for. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;

  var cache = { tasks: [], projects: [], events: [], habits: [], habitLogs: [], transactions: [], envelopes: [], categories: [], focusSessions: [], insights: [] };
  var sessionDismissed = {};
  var sessionSnoozed = {};

  // ---------------------------------------------------------------- stated constants
  // Every threshold below is named and documented in phase_8_insights.md's per-detector section —
  // none of these are hidden/bare numbers, same discipline as Analytics' DECAY_STALE_DAYS/
  // ENERGY_FOCUS_TARGET_MIN.

  var COMMITMENT_WEEKLY_CEILING_HOURS = 50;
  var PROC_PERIOD_DAYS = 14, PROC_DROP_PP = 15, PROC_MIN_SAMPLE = 3;
  var STARVING_LOOKBACK_DAYS = 21, STARVING_HOURS_THRESHOLD = 2;
  var ESTIMATE_DRIFT_WORSENING_PP = 20, ESTIMATE_MIN_SAMPLE = 3;
  var UNSCHEDULED_LOOKAHEAD_DAYS = 7;
  var SUB_COST_THRESHOLD = 15, SUB_USES_THRESHOLD = 4;
  var STALE_WAITING_DAYS = 14;
  var HABIT_DROP_PP = 20;
  var ENVELOPE_LOOKBACK_PERIODS = 3;
  var MISALIGN_LOOKBACK_DAYS = 30, MISALIGN_THRESHOLD_PCT = 50, MISALIGN_MIN_SAMPLE = 3;

  // ---------------------------------------------------------------- detector metadata (fixed, not computed — Decision #4)

  var DETECTOR_META = {
    commitment: { name: 'Commitment Overload', severity: 'elevated', color: 'rose', icon: 'stack', module: 'Schedule', href: '#/schedule' },
    procrastination: { name: 'Procrastination Rising', severity: 'elevated', color: 'rose', icon: 'trend', module: 'Tasks', href: '#/tasks' },
    starving: { name: 'Starving Project', severity: 'notable', color: 'amber', icon: 'seedling', module: 'Analytics', href: '#/analytics' },
    estimate: { name: 'Estimate Accuracy Drift', severity: 'notable', color: 'amber', icon: 'hourglass', module: 'Tasks', href: '#/tasks' },
    unscheduled: { name: 'Unscheduled Obligation', severity: 'notable', color: 'amber', icon: 'calendarX', module: 'Schedule', href: '#/schedule' },
    subscription: { name: 'Subscription Low Use', severity: 'notable', color: 'amber', icon: 'card', module: 'Finance', href: '#/finance' },
    waiting: { name: 'Stale Waiting Item', severity: 'notable', color: 'amber', icon: 'clock', module: 'Tasks', href: '#/tasks' },
    habit: { name: 'Habit Consistency Drop', severity: 'minor', color: 'blue', icon: 'waveform', module: 'Habits', href: '#/habits' },
    envelope: { name: 'Envelope Overspend Pattern', severity: 'minor', color: 'blue', icon: 'wallet', module: 'Finance', href: '#/finance' },
    misalignment: { name: 'Productive Hour Misalignment', severity: 'minor', color: 'blue', icon: 'refresh', module: 'Analytics', href: '#/analytics' }
  };

  var ICONS = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    trend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
    stack: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M12 3 2 8l10 5 10-5-10-5z"/><path d="M2 13l10 5 10-5"/></svg>',
    hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M6 2h12M6 22h12M6 2c0 6 12 6 12 10s-12 4-12 10M18 2c0 6-12 6-12 10s12 4 12 10"/></svg>',
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v3"/><path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-6a1 1 0 0 0-1-1h-5a2 2 0 1 0 0 4"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    calendarX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 9h18M9 15l4 4M13 15l-4 4"/></svg>',
    seedling: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M12 22V13"/><path d="M12 13C7 13 5 9 5 5c4 0 7 2 7 8z"/><path d="M12 13c5 0 7-4 7-8-4 0-7 2-7 8z"/></svg>',
    waveform: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" width="17" height="17" stroke-width="1.8"><path d="M3 12h2l2-7 3 14 3-10 2 5 2-3h4"/></svg>'
  };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2).replace(/\.00$/, ''); }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function monthPeriod(iso) { return (iso || '').slice(0, 7); }

  // Duplicated from Finance's own addMonths (module-private there) — same "don't reach into
  // another already-verified module's internals for a new consumer" precedent as every prior phase.
  function addMonthsToPeriod(period, n) {
    var parts = period.split('-');
    var y = +parts[0], m = +parts[1] - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }

  function eventDurationHours(e) {
    if (!e.start_time || !e.end_time) return 0;
    var sp = e.start_time.split(':'), ep = e.end_time.split(':');
    var startMin = (+sp[0]) * 60 + (+sp[1]);
    var endMin = (+ep[0]) * 60 + (+ep[1]);
    return Math.max(0, endMin - startMin) / 60;
  }

  function findTask(id) { return cache.tasks.find(function (t) { return t.id === id; }); }
  function findCategory(id) { return cache.categories.find(function (c) { return c.id === id; }); }

  // A task's completion date — its last `activity` entry with type 'complete', falling back to
  // `processed_at` if no activity log exists yet (phase_8_insights.md detector #2 note).
  function taskCompletedISO(t) {
    var entries = (t.activity || []).filter(function (a) { return a.type === 'complete'; });
    if (entries.length) return entries[entries.length - 1].at.slice(0, 10);
    return t.processed_at ? t.processed_at.slice(0, 10) : null;
  }

  // ---------------------------------------------------------------- detector 1: Commitment Overload

  function detCommitment(todayISO) {
    var week = fmt.weekOf(new Date(todayISO + 'T00:00:00'));
    var weekStartISO = fmt.isoDate(week[0]), weekEndISO = fmt.isoDate(week[6]);
    var scheduledHours = cache.events
      .filter(function (e) { return e.start_date >= weekStartISO && e.start_date <= weekEndISO && e.status !== 'skipped'; })
      .reduce(function (s, e) { return s + eventDurationHours(e); }, 0);
    var taskHours = cache.tasks
      .filter(function (t) { return t.status !== 'done' && t.due_date && t.due_date >= weekStartISO && t.due_date <= weekEndISO; })
      .reduce(function (s, t) { return s + (t.est_minutes || 0) / 60; }, 0);
    var total = scheduledHours + taskHours;
    if (total <= COMMITMENT_WEEKLY_CEILING_HOURS) return null;
    return {
      findingHtml: 'Scheduled hours plus estimates on tasks due this week add up to <strong>' + total.toFixed(1) + 'h</strong> — past your <strong>' + COMMITMENT_WEEKLY_CEILING_HOURS + 'h</strong> weekly ceiling.'
    };
  }

  // ---------------------------------------------------------------- detector 2: Procrastination Rising

  function detProcrastination(todayISO) {
    function onTimePct(startISO, endISO) {
      var done = cache.tasks.filter(function (t) {
        if (!t.due_date) return false;
        var completed = taskCompletedISO(t);
        return completed && completed >= startISO && completed <= endISO;
      });
      if (done.length < PROC_MIN_SAMPLE) return null;
      var onTime = done.filter(function (t) { return taskCompletedISO(t) <= t.due_date; }).length;
      return { pct: Math.round(onTime / done.length * 100), n: done.length };
    }
    var curStart = fmt.addDaysISO(todayISO, -(PROC_PERIOD_DAYS - 1));
    var priorEnd = fmt.addDaysISO(curStart, -1);
    var priorStart = fmt.addDaysISO(priorEnd, -(PROC_PERIOD_DAYS - 1));
    var cur = onTimePct(curStart, todayISO);
    var prior = onTimePct(priorStart, priorEnd);
    if (!cur || !prior) return null;
    var drop = prior.pct - cur.pct;
    if (drop < PROC_DROP_PP) return null;
    return {
      findingHtml: 'On-time task completion has dropped to <strong>' + cur.pct + '%</strong> this period, down from <strong>' + prior.pct + '%</strong> the period before.'
    };
  }

  // ---------------------------------------------------------------- detector 3: Starving Project

  function detStarving(todayISO) {
    var sinceISO = fmt.addDaysISO(todayISO, -STARVING_LOOKBACK_DAYS);
    var candidates = cache.projects.filter(function (p) { return !p.archived_at; }).map(function (p) {
      var openTasks = cache.tasks.filter(function (t) { return t.project_id === p.id && t.status !== 'done'; }).length;
      var eventHours = cache.events
        .filter(function (e) { return e.project_id === p.id && e.start_date >= sinceISO && e.start_date <= todayISO; })
        .reduce(function (s, e) { return s + eventDurationHours(e); }, 0);
      var focusHours = cache.focusSessions
        .filter(function (s) {
          var d = (s.start_at || '').slice(0, 10);
          if (d < sinceISO || d > todayISO) return false;
          var t = s.task_id && findTask(s.task_id);
          return t && t.project_id === p.id;
        })
        .reduce(function (s, sess) { return s + (sess.duration_min || 0) / 60; }, 0);
      var money_ = cache.transactions
        .filter(function (t) { return t.project_id === p.id && t.date >= sinceISO && t.date <= todayISO && t.amount < 0; })
        .reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);
      return { name: p.name || 'Untitled', openTasks: openTasks, hours: eventHours + focusHours, money: money_ };
    }).filter(function (p) { return p.openTasks >= 1 && p.hours < STARVING_HOURS_THRESHOLD; });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return a.hours - b.hours; });
    var w = candidates[0];
    return {
      findingHtml: '<strong>' + escapeHtml(w.name) + '</strong> has ' + w.openTasks + ' open tasks but only <strong>' + w.hours.toFixed(1) + 'h</strong> and <strong>' + money(w.money) + '</strong> logged against it in the last ' + Math.round(STARVING_LOOKBACK_DAYS / 7) + ' weeks.'
    };
  }

  // ---------------------------------------------------------------- detector 4: Estimate Accuracy Drift

  function detEstimate(todayISO) {
    var curPeriod = monthPeriod(todayISO), priorPeriod = addMonthsToPeriod(curPeriod, -1);
    var buckets = {};
    buckets[curPeriod] = []; buckets[priorPeriod] = [];
    cache.tasks.forEach(function (t) {
      if (!t.est_minutes) return;
      var sessions = cache.focusSessions.filter(function (s) { return s.task_id === t.id; });
      if (!sessions.length) return;
      var actualMin = sessions.reduce(function (s, sess) { return s + (sess.duration_min || 0); }, 0);
      var lastSessionDate = sessions.map(function (s) { return (s.start_at || '').slice(0, 10); }).sort().slice(-1)[0];
      var bucketKey = monthPeriod(taskCompletedISO(t) || lastSessionDate);
      if (buckets[bucketKey] === undefined) return;
      buckets[bucketKey].push((actualMin - t.est_minutes) / t.est_minutes * 100);
    });
    function avgErr(list) { return list.length >= ESTIMATE_MIN_SAMPLE ? list.reduce(function (s, v) { return s + v; }, 0) / list.length : null; }
    var curErr = avgErr(buckets[curPeriod]), priorErr = avgErr(buckets[priorPeriod]);
    if (curErr == null || priorErr == null) return null;
    if ((curErr - priorErr) < ESTIMATE_DRIFT_WORSENING_PP) return null;
    return {
      findingHtml: 'Estimated vs. actual task time is off by <strong>' + (curErr >= 0 ? '+' : '') + Math.round(curErr) + '%</strong> on average this month, up from <strong>' + (priorErr >= 0 ? '+' : '') + Math.round(priorErr) + '%</strong> last month.'
    };
  }

  // ---------------------------------------------------------------- detector 5: Unscheduled Obligation
  // No event<->task link field exists anywhere in the schema (checked) — proxy: due-date has zero
  // scheduled events of any kind (phase_8_insights.md Decision #5).

  function detUnscheduled(todayISO) {
    var lookaheadISO = fmt.addDaysISO(todayISO, UNSCHEDULED_LOOKAHEAD_DAYS);
    var candidates = cache.tasks.filter(function (t) {
      return t.priority === 'high' && t.status !== 'done' && t.due_date && t.due_date >= todayISO && t.due_date <= lookaheadISO;
    }).filter(function (t) {
      return !cache.events.some(function (e) { return e.start_date === t.due_date && e.status !== 'skipped'; });
    });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; });
    var w = candidates[0];
    var days = fmt.daysBetweenISO(todayISO, w.due_date);
    return {
      findingHtml: '<strong>"' + escapeHtml(w.title || 'Untitled') + '"</strong> is due in <strong>' + days + ' day' + (days === 1 ? '' : 's') + '</strong> with no time blocked anywhere on the calendar.'
    };
  }

  // ---------------------------------------------------------------- detector 6: Subscription Low Use

  function detSubscription(todayISO) {
    var curPeriod = monthPeriod(todayISO);
    var subs = cache.transactions.filter(function (t) { return t.recurring && monthPeriod(t.date) === curPeriod; });
    var byTitle = {};
    subs.forEach(function (t) { byTitle[t.title || 'Untitled'] = t; });
    var candidates = Object.keys(byTitle).map(function (title) {
      var t = byTitle[title];
      return { name: title, cost: Math.abs(t.amount || 0), uses: t.usage_count || 0 };
    }).filter(function (s) { return s.cost >= SUB_COST_THRESHOLD && s.uses <= SUB_USES_THRESHOLD; });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.cost - a.cost; });
    var w = candidates[0];
    var extra = candidates.length > 1 ? ', and ' + (candidates.length - 1) + ' other subscription' + (candidates.length > 2 ? 's' : '') : '';
    return {
      findingHtml: '<strong>' + escapeHtml(w.name) + '</strong>: ' + money(w.cost) + '/mo, <strong>' + w.uses + ' use' + (w.uses === 1 ? '' : 's') + '</strong> logged this month' + extra + '.'
    };
  }

  // ---------------------------------------------------------------- detector 7: Stale Waiting Item

  function detWaiting(todayISO) {
    var candidates = cache.tasks.filter(function (t) { return t.status === 'waiting'; }).map(function (t) {
      var sinceISO = (t.processed_at || t.created_at || todayISO).slice(0, 10);
      return { title: t.title || 'Untitled', days: fmt.daysBetweenISO(sinceISO, todayISO) };
    }).filter(function (t) { return t.days >= STALE_WAITING_DAYS; });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.days - a.days; });
    var w = candidates[0];
    var extra = candidates.length > 1 ? ' (' + (candidates.length - 1) + ' other item' + (candidates.length > 2 ? 's' : '') + ' also past threshold)' : '';
    return {
      findingHtml: '<strong>"' + escapeHtml(w.title) + '"</strong> has sat in Waiting for <strong>' + w.days + ' days</strong> — past the ' + STALE_WAITING_DAYS + '-day threshold' + extra + '.'
    };
  }

  // ---------------------------------------------------------------- detector 8: Habit Consistency Drop

  function detHabit(todayISO) {
    var lib = Console.lib.habits;
    var candidates = cache.habits.filter(function (h) { return h.status === 'active'; }).map(function (h) {
      var cur = lib.consistency30(h.id, cache.habitLogs, todayISO, h.created_at);
      var priorAsOf = fmt.addDaysISO(todayISO, -30);
      var prior = lib.consistency30(h.id, cache.habitLogs, priorAsOf, h.created_at);
      return { name: h.name || 'Untitled', cur: cur, prior: prior, drop: prior - cur };
    }).filter(function (h) { return h.drop >= HABIT_DROP_PP; });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.drop - a.drop; });
    var w = candidates[0];
    return {
      findingHtml: '<strong>"' + escapeHtml(w.name) + '"</strong> consistency has fallen to <strong>' + w.cur + '%</strong> this month, down from <strong>' + w.prior + '%</strong> a month ago.'
    };
  }

  // ---------------------------------------------------------------- detector 9: Envelope Overspend Pattern

  function detEnvelope(todayISO) {
    var curPeriod = monthPeriod(todayISO);
    var checkPeriods = [];
    for (var i = 1; i <= ENVELOPE_LOOKBACK_PERIODS; i++) checkPeriods.push(addMonthsToPeriod(curPeriod, -i));

    var byCategory = {};
    cache.envelopes.forEach(function (env) {
      if (checkPeriods.indexOf(env.period) === -1) return;
      var spent = cache.transactions
        .filter(function (t) { return t.envelope_id === env.id; })
        .reduce(function (s, t) { return s + Math.abs(t.amount < 0 ? t.amount : 0); }, 0);
      var overspent = spent > (env.allocated || 0);
      if (!byCategory[env.category_id]) byCategory[env.category_id] = 0;
      if (overspent) byCategory[env.category_id]++;
    });
    var candidates = Object.keys(byCategory).map(function (catId) {
      var cat = findCategory(catId);
      return { name: cat ? cat.name : 'Untitled', count: byCategory[catId] };
    }).filter(function (c) { return c.count >= 2; });
    if (!candidates.length) return null;
    candidates.sort(function (a, b) { return b.count - a.count; });
    var w = candidates[0];
    return {
      findingHtml: '<strong>"' + escapeHtml(w.name) + '"</strong> has gone over its monthly allocation <strong>' + w.count + ' of the last ' + ENVELOPE_LOOKBACK_PERIODS + '</strong> periods.'
    };
  }

  // ---------------------------------------------------------------- detector 10: Productive Hour Misalignment

  function detMisalignment(todayISO) {
    var sinceISO = fmt.addDaysISO(todayISO, -MISALIGN_LOOKBACK_DAYS);
    var grid = [];
    for (var d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    cache.focusSessions.forEach(function (s) {
      var dISO = (s.start_at || '').slice(0, 10);
      if (dISO < sinceISO || dISO > todayISO) return;
      var start = new Date(s.start_at);
      grid[start.getDay()][start.getHours()] += (s.duration_min || 0);
    });
    var peak = { dow: 0, hour: 0, mins: -1 };
    for (var dow = 0; dow < 7; dow++) { for (var h = 0; h < 24; h++) { if (grid[dow][h] > peak.mins) peak = { dow: dow, hour: h, mins: grid[dow][h] }; } }
    if (peak.mins <= 0) return null;

    var deepWork = cache.events.filter(function (e) {
      return e.type === 'deep_work' && e.start_date >= sinceISO && e.start_date <= todayISO && e.status !== 'skipped' && e.start_time;
    });
    if (deepWork.length < MISALIGN_MIN_SAMPLE) return null;
    var outside = deepWork.filter(function (e) {
      var hour = +e.start_time.split(':')[0];
      return Math.abs(hour - peak.hour) > 1;
    }).length;
    var pct = Math.round(outside / deepWork.length * 100);
    if (pct < MISALIGN_THRESHOLD_PCT) return null;
    var DOW_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var peakHourLabel = (peak.hour % 12 === 0 ? 12 : peak.hour % 12) + (peak.hour < 12 ? 'am' : 'pm') + '–' + ((peak.hour + 2) % 12 === 0 ? 12 : (peak.hour + 2) % 12) + ((peak.hour + 2) < 12 || (peak.hour + 2) >= 24 ? 'am' : 'pm');
    return {
      findingHtml: '<strong>' + pct + '%</strong> of scheduled deep-work blocks land outside your peak focus window (' + DOW_LABEL[peak.dow] + ' ' + peakHourLabel + ').'
    };
  }

  var DETECTORS = {
    commitment: detCommitment, procrastination: detProcrastination, starving: detStarving,
    estimate: detEstimate, unscheduled: detUnscheduled, subscription: detSubscription,
    waiting: detWaiting, habit: detHabit, envelope: detEnvelope, misalignment: detMisalignment
  };

  // ---------------------------------------------------------------- daily run

  function enabledDetectorKeys() {
    var pref = Console.insightsDetectorPrefs; // set by Settings (Phase 9), default: all enabled
    return Object.keys(DETECTORS).filter(function (k) { return !pref || pref[k] !== false; });
  }

  function runDetectorsIfNewDay() {
    var todayISO = fmt.todayISO();
    return db.getPref('insights_last_run', null).then(function (lastRun) {
      if (lastRun === todayISO) return false; // already ran today
      var nowISO = new Date().toISOString();
      var keys = enabledDetectorKeys();
      var writes = [];
      keys.forEach(function (key) {
        var result = DETECTORS[key](todayISO);
        var id = 'insight:' + key;
        if (result) {
          writes.push(db.put('insights', {
            id: id, detector: key, created_at: nowISO, score: 0,
            findingHtml: result.findingHtml, read: false, dismissed_at: null, snoozed_until: null
          }));
        } else {
          writes.push(db.remove('insights', id));
        }
      });
      return Promise.all(writes).then(function () { return db.setPref('insights_last_run', todayISO); }).then(function () { return true; });
    });
  }

  // ---------------------------------------------------------------- rendering

  function formatWhen(iso, todayISO) {
    var d = iso.slice(0, 10);
    if (d === todayISO) {
      var dt = new Date(iso);
      var h = dt.getHours(), m = dt.getMinutes();
      var hh = h % 12 === 0 ? 12 : h % 12;
      return 'today, ' + hh + ':' + pad2(m) + (h < 12 ? 'am' : 'pm');
    }
    var days = fmt.daysBetweenISO(d, todayISO);
    return days + 'd ago';
  }

  function cardHtml(row, todayISO) {
    var meta = DETECTOR_META[row.detector];
    if (!meta) return '';
    return (
      '<div class="ins-card" data-id="' + row.id + '">' +
        '<div class="ins-card-row">' +
          '<div class="ins-icon" style="background:var(--' + meta.color + '-soft);color:var(--' + meta.color + ')">' + ICONS[meta.icon] + '</div>' +
          '<div class="ins-card-body">' +
            '<div class="ins-card-top">' +
              '<span class="ins-label">' + escapeHtml(meta.name) + '</span>' +
              '<span class="ins-sev-pill" style="background:var(--' + meta.color + '-soft);color:var(--' + meta.color + ')">' + row.severity + '</span>' +
              '<span class="ins-when">' + formatWhen(row.created_at, todayISO) + '</span>' +
            '</div>' +
            '<div class="ins-finding">' + row.findingHtml + '</div>' +
            '<div class="ins-actions">' +
              '<a href="' + meta.href + '" class="ins-open-link">Open in ' + meta.module + ' <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" style="width:11px;height:11px;stroke-width:2.2"><path d="M7 17 17 7M8 7h9v9"/></svg></a>' +
              '<span class="ins-spacer"></span>' +
              '<button class="ins-btn-ghost" data-act="snooze" data-id="' + row.id + '">Snooze</button>' +
              '<button class="ins-btn-ghost" data-act="dismiss" data-id="' + row.id + '">Dismiss</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function emptyStateHtml() {
    return (
      '<div class="ins-empty">' +
        '<div class="ins-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="var(--teal)" style="width:26px;height:26px;stroke-width:1.8"><path d="M20 6 9 17l-5-5"/></svg></div>' +
        '<div class="ins-empty-title">Nothing flagged right now</div>' +
        '<div class="ins-empty-sub">All ' + Object.keys(DETECTORS).length + ' detectors ran today and found nothing worth a callout. Check back tomorrow.</div>' +
      '</div>'
    );
  }

  function render() {
    var todayISO = fmt.todayISO();
    var allActive = cache.insights.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; });
    var visible = allActive.filter(function (r) { return !sessionDismissed[r.id] && !sessionSnoozed[r.id]; });
    var hiddenCount = allActive.length - visible.length;

    // Mark visible rows as read (persisted "seen the feed" flag — drives the sidebar nav badge).
    visible.forEach(function (r) {
      if (!r.read) { r.read = true; db.put('insights', r); }
    });

    var head = (
      '<div class="page-head"><h1 class="page-title">Insights</h1></div>' +
      '<div class="page-sub" style="margin-bottom:14px;">Plain facts pulled from tasks, schedule, habits, transactions and focus sessions — nothing predicted, nothing scored across detectors.</div>' +
      '<div class="ins-header">' +
        '<div class="ins-meta-row">' +
          '<span class="ins-meta-text">checked <strong>today</strong> · ' + enabledDetectorKeys().length + ' detectors run</span>' +
          '<span class="ins-dot-sep"></span>' +
          '<span class="ins-active-count">' + visible.length + ' active</span>' +
        '</div>' +
      '</div>'
    );

    var body = visible.length
      ? '<div class="ins-feed">' + visible.map(function (r) { return cardHtml(r, todayISO); }).join('') + '</div>'
      : emptyStateHtml();

    var footer = hiddenCount > 0
      ? '<div class="ins-dismissed-footer"><span class="ins-dismissed-text">' + hiddenCount + ' dismissed or snoozed this session — nothing is deleted, they\'ll resurface if the condition recurs.</span><button class="ins-restore-btn" data-act="restore-all">Restore all</button></div>'
      : '';

    container.innerHTML = head + body + footer;
  }

  // ---------------------------------------------------------------- events

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'dismiss') { sessionDismissed[btn.dataset.id] = true; render(); }
    else if (act === 'snooze') { sessionSnoozed[btn.dataset.id] = true; render(); }
    else if (act === 'restore-all') { sessionDismissed = {}; sessionSnoozed = {}; render(); }
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([
      db.getAll('tasks'), db.getAll('projects'), db.getAll('events'),
      db.getAll('habits'), db.getAll('habit_logs'), db.getAll('transactions'),
      db.getAll('envelopes'), db.getAll('categories'), db.getAll('focus_sessions')
    ]).then(function (r) {
      cache.tasks = r[0]; cache.projects = r[1]; cache.events = r[2];
      cache.habits = r[3]; cache.habitLogs = r[4]; cache.transactions = r[5];
      cache.envelopes = r[6]; cache.categories = r[7]; cache.focusSessions = r[8];
      return runDetectorsIfNewDay();
    }).then(function () {
      return db.getAll('insights');
    }).then(function (rows) {
      // attach severity label from DETECTOR_META for rendering (kept out of the stored row —
      // severity is a fixed per-detector property, not per-instance data, so it's derived at
      // render time rather than duplicated into every stored row).
      cache.insights = rows.map(function (r) {
        var meta = DETECTOR_META[r.detector];
        r.severity = meta ? meta.severity : '';
        return r;
      });
      render();
    });
  }

  Console.modules.insights = {
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      sessionDismissed = {};
      sessionSnoozed = {};
      container.addEventListener('click', onClick);
      refreshAndRender();
    },
    destroy: function () {
      if (container) container.removeEventListener('click', onClick);
      container = null;
    }
  };
})();
