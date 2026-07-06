/* Console — app.js
   Boot sequence. Loaded last, after db.js, theme.js, router.js, palette.js, and every
   module's index.js (under js/modules/) have registered themselves on the Console namespace. */
(function () {
  'use strict';
  window.Console = window.Console || {};

  function refreshNavCounts() {
    var db = Console.db;
    var todayISO = Console.lib.format.todayISO();

    Promise.all([
      db.getAll('tasks'), db.getAll('habits'), db.getAll('insights'),
      db.getAllByIndex('events', 'start_date', todayISO),
      db.getAll('envelopes'), db.getAll('transactions'), db.getAll('focus_sessions')
    ]).then(function (r) {
      var tasks = r[0], habits = r[1], insights = r[2], eventsToday = r[3];
      var envelopes = r[4], transactions = r[5], focusSessions = r[6];

      var todayOpen = tasks.filter(function (t) {
        return t.status !== 'done' && (t.due_date === todayISO || !t.due_date);
      }).length;
      var tasksOpen = tasks.filter(function (t) { return t.status !== 'done'; }).length;
      var habitsActive = habits.filter(function (h) { return h.status === 'active'; }).length;
      var insightsUnread = insights.filter(function (i) { return !i.read; }).length;
      // Schedule's nav count = events today (not "this week") — picked to mirror Today's own
      // "todayOpen" semantics rather than a week-wide number; see docs/PROJECT_STATE.md.
      var eventsTodayCount = eventsToday.filter(function (e) { return e.status !== 'skipped'; }).length;

      // Finance's nav count = envelopes needing attention this period (over-spent) — picked to
      // mirror the "needs your attention" semantics of Schedule's needs-log badge, rather than a
      // raw transaction/envelope total. See docs/phase_prompts/phase_5_finance.md item 10.
      var currentPeriod = todayISO.slice(0, 7);
      var overspentCount = envelopes.filter(function (e) {
        if (e.period !== currentPeriod) return false;
        var spent = transactions
          .filter(function (t) { return t.envelope_id === e.id && (t.date || '').slice(0, 7) === e.period; })
          .reduce(function (s, t) { return s + Math.abs(t.amount < 0 ? t.amount : 0); }, 0);
        return spent > (e.allocated || 0);
      }).length;

      // Focus's nav count is a binary "you have a session running" indicator (1 or hidden) rather
      // than a today-total tally — Today's stats strip already shows real focus hours, and the
      // floating timer already surfaces the active session's live state, so a second running total
      // in the sidebar would just duplicate those. This badge exists for the one thing neither of
      // those cover well from a glance at the sidebar: "is something active right now."
      var focusActiveCount = focusSessions.filter(function (s) { return !s.end_at; }).length ? 1 : 0;

      setCount('today', todayOpen);
      setCount('tasks', tasksOpen);
      setCount('schedule', eventsTodayCount);
      setCount('habits', habitsActive);
      setCount('finance', overspentCount);
      setCount('focus', focusActiveCount);
      setCount('insights', insightsUnread);
    });
  }

  function setCount(route, n) {
    var item = document.querySelector('.nav-item[data-route="' + route + '"] .nav-count');
    if (!item) return;
    if (n > 0) { item.textContent = n; item.style.display = ''; }
    else { item.style.display = 'none'; }
  }

  // Phase 7: real range-filtering, scoped to Analytics only (phase_7_analytics.md Design
  // Decision #2 — the control is global topbar chrome, but retrofitting live filtering into
  // Today/Tasks/Schedule/Habits/Finance/Focus would mean touching 6 already-verified, gated
  // modules for a feature none of them were built against; each keeps its own existing
  // date-nav/period logic untouched). `Console.analyticsRange` is the in-memory cache Analytics
  // reads from directly (synchronous, no DB round-trip needed on every render); it's kept in sync
  // with the persisted `preferences` row so the choice survives a reload.
  Console.analyticsRange = { preset: '30d', start: null, end: null };

  function persistAnalyticsRange(range) {
    Console.analyticsRange = range;
    Console.db.setPref('analytics_range', range);
    // The topbar control lives outside every module's own container (it's shell chrome, wired
    // once here in app.js), so Analytics — the only module that reads this — can't catch a range
    // change via its own click delegation. A plain DOM CustomEvent is the smallest thing that
    // works; no other module needs to know this fired.
    document.dispatchEvent(new CustomEvent('analytics-range-changed', { detail: range }));
  }

  function applyRangeButtonState(preset) {
    document.querySelectorAll('#range-segmented button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.range === preset);
    });
  }

  function wireTopbarSegmented() {
    var group = document.getElementById('range-segmented');
    var popover = document.getElementById('range-popover');
    var startInput = document.getElementById('range-start');
    var endInput = document.getElementById('range-end');
    var applyBtn = document.getElementById('range-apply');
    if (!group) return;

    group.addEventListener('click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var preset = btn.dataset.range;
      if (preset === 'custom') {
        // Don't commit yet — wait for Apply, so clicking "custom" then clicking away doesn't
        // silently switch the active range with no explicit start/end chosen.
        if (popover) popover.hidden = false;
        return;
      }
      if (popover) popover.hidden = true;
      applyRangeButtonState(preset);
      persistAnalyticsRange({ preset: preset, start: null, end: null });
    });

    if (applyBtn) {
      applyBtn.addEventListener('click', function () {
        var start = startInput && startInput.value;
        var end = endInput && endInput.value;
        if (!start || !end || start > end) return; // no silent partial/invalid range
        if (popover) popover.hidden = true;
        applyRangeButtonState('custom');
        persistAnalyticsRange({ preset: 'custom', start: start, end: end });
      });
    }

    // Click-outside-to-dismiss, standard popover behavior — doesn't discard a not-yet-applied
    // date selection, just closes without committing (Apply is still the only way to commit).
    document.addEventListener('click', function (e) {
      if (!popover || popover.hidden) return;
      if (e.target.closest('.range-filter')) return;
      popover.hidden = true;
    });
  }

  function restoreAnalyticsRange() {
    Console.db.getPref('analytics_range', { preset: '30d', start: null, end: null }).then(function (range) {
      Console.analyticsRange = range;
      applyRangeButtonState(range.preset);
      if (range.preset === 'custom') {
        var startInput = document.getElementById('range-start');
        var endInput = document.getElementById('range-end');
        if (startInput) startInput.value = range.start;
        if (endInput) endInput.value = range.end;
      }
    });
  }

  // Phase 9 (Settings): boot-time in-memory caches for the 4 preferences that get wired into real
  // consumption (phase_9_settings.md Decision #3) — same pattern as `Console.analyticsRange`
  // above. Must resolve BEFORE `Console.router.init()` runs, since `Console.defaultLandingView`
  // has to be set synchronously by the time router.js decides the initial hash. Settings' own
  // module updates these same globals live (in addition to persisting) when changed, so a change
  // takes effect immediately without needing a reload.
  function restoreSettingsDefaults() {
    return Promise.all([
      Console.db.getPref('default_landing_view', 'today'),
      Console.db.getPref('default_task_priority', null),
      Console.db.getPref('default_focus_mode', null),
      Console.db.getPref('default_focus_duration_min', null),
      Console.db.getPref('insights_detectors', null)
    ]).then(function (r) {
      Console.defaultLandingView = r[0];
      Console.taskDefaultPriority = r[1];
      Console.focusDefaults = (r[2] || r[3]) ? { mode: r[2] || 'pomodoro', targetMin: r[3] || 25 } : null;
      Console.insightsDetectorPrefs = r[4];
    });
  }

  // Phase 6: real cross-screen floating timer. This duplicates a few small helpers
  // (pad2/msToClock/computeElapsedMs) and the pause/end mutation logic that also live in
  // js/modules/focus/index.js — deliberate, same call as the TYPES/TYPE_LABEL duplication
  // documented there: app.js can't reach Focus's module-private closures (nor should it reach
  // into another module's internals), and the floating widget's whole reason to exist is working
  // from screens where Focus isn't mounted. If a third place ever needs this math, it moves to
  // js/lib/format.js then. Note this DOES mean a Pause/End click here won't retroactively refresh
  // Focus's own Timer view if it happens to be mounted at the same time — it self-corrects on
  // Focus's next 5-minute poll or the next time its view is switched/re-entered. Logged as a known
  // minor drift in docs/Console_Workflow.md rather than solved with cross-module event plumbing
  // that no other module pair in this app uses.
  var floatingTickHandle = null;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function msToClock(ms) {
    ms = Math.max(0, ms || 0);
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  function computeElapsedMs(s, nowMs) {
    var startMs = new Date(s.start_at).getTime();
    var pausedMs = s.paused_ms || 0;
    if (s.paused_at) return (new Date(s.paused_at).getTime() - startMs) - pausedMs;
    return (nowMs - startMs) - pausedMs;
  }

  // Soft-strict mode must be re-applied here (not just from within the Focus module) so it
  // survives a full page reload mid-session or navigating to/from Focus — see
  // phase_6_focus.md Design Decision #5.
  function applyStrictClass(active) {
    document.body.classList.toggle('focus-strict', !!(active && active.strict));
  }

  function refreshFloatingTimer() {
    var el = document.getElementById('floating-timer');
    if (!el) return;
    Console.db.getAll('focus_sessions').then(function (sessions) {
      var active = sessions.find(function (s) { return !s.end_at; });
      el.hidden = !active;
      applyStrictClass(active);
      if (floatingTickHandle) { clearInterval(floatingTickHandle); floatingTickHandle = null; }
      if (!active) return;

      var modeEl = el.querySelector('.ftmode');
      var titleEl = el.querySelector('.fttitle');
      var pauseBtn = el.querySelector('[data-act="ft-pause"]');
      if (modeEl) modeEl.textContent = active.mode;
      if (titleEl) titleEl.textContent = active.trigger_label || 'Standalone session';
      if (pauseBtn) pauseBtn.textContent = active.paused_at ? 'Resume' : 'Pause';

      var timeEl = el.querySelector('.fttime');
      function tick() { if (timeEl) timeEl.textContent = msToClock(computeElapsedMs(active, Date.now())); }
      tick();
      floatingTickHandle = setInterval(tick, 1000);
    });
  }

  function wireFloatingTimerControls() {
    var el = document.getElementById('floating-timer');
    if (!el) return;
    el.addEventListener('click', function (e) {
      var pauseBtn = e.target.closest('[data-act="ft-pause"]');
      var endBtn = e.target.closest('[data-act="ft-end"]');
      if (!pauseBtn && !endBtn) return;
      Console.db.getAll('focus_sessions').then(function (sessions) {
        var active = sessions.find(function (s) { return !s.end_at; });
        if (!active) return;
        if (pauseBtn) {
          if (active.paused_at) {
            active.paused_ms = (active.paused_ms || 0) + (Date.now() - new Date(active.paused_at).getTime());
            active.paused_at = null;
          } else {
            active.paused_at = new Date().toISOString();
          }
        } else {
          var now = Date.now();
          var finalPausedMs = (active.paused_ms || 0) + (active.paused_at ? (now - new Date(active.paused_at).getTime()) : 0);
          active.end_at = new Date(now).toISOString();
          active.paused_ms = finalPausedMs;
          active.paused_at = null;
          active.duration_min = Math.max(0, ((now - new Date(active.start_at).getTime()) - finalPausedMs) / 60000);
        }
        Console.db.put('focus_sessions', active).then(function () {
          refreshFloatingTimer();
          refreshNavCounts();
        });
      });
    });
  }

  function boot() {
    var contentEl = document.getElementById('app-content');

    Console.db.open()
      .then(function () { return Console.theme.init(); })
      .then(function () { return restoreSettingsDefaults(); })
      .then(function () {
        Console.router.init(contentEl);
        Console.palette.init();
        wireTopbarSegmented();
        wireFloatingTimerControls();
        restoreAnalyticsRange();
        refreshNavCounts();
        refreshFloatingTimer();
        // Keep the floating timer's mode/title/pause-label in sync with any change made from
        // inside the Focus module itself (start/pause/resume/end all happen there) — Focus has no
        // way to reach into app.js's closures directly, so this polls same as refreshNavCounts.
        setInterval(refreshFloatingTimer, 5000);
      })
      .catch(function (err) {
        console.error('[Console] boot failed', err);
        contentEl.innerHTML = '<div class="empty"><div class="empty-title">Failed to start</div>' +
          '<div class="empty-sub">' + err.message + '</div></div>';
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
