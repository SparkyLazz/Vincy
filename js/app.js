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
      db.getAllByIndex('events', 'start_date', todayISO)
    ]).then(function (r) {
      var tasks = r[0], habits = r[1], insights = r[2], eventsToday = r[3];

      var todayOpen = tasks.filter(function (t) {
        return t.status !== 'done' && (t.due_date === todayISO || !t.due_date);
      }).length;
      var tasksOpen = tasks.filter(function (t) { return t.status !== 'done'; }).length;
      var habitsActive = habits.filter(function (h) { return h.status === 'active'; }).length;
      var insightsUnread = insights.filter(function (i) { return !i.read; }).length;
      // Schedule's nav count = events today (not "this week") — picked to mirror Today's own
      // "todayOpen" semantics rather than a week-wide number; see docs/PROJECT_STATE.md.
      var eventsTodayCount = eventsToday.filter(function (e) { return e.status !== 'skipped'; }).length;

      setCount('today', todayOpen);
      setCount('tasks', tasksOpen);
      setCount('schedule', eventsTodayCount);
      setCount('habits', habitsActive);
      setCount('insights', insightsUnread);
    });
  }

  function setCount(route, n) {
    var item = document.querySelector('.nav-item[data-route="' + route + '"] .nav-count');
    if (!item) return;
    if (n > 0) { item.textContent = n; item.style.display = ''; }
    else { item.style.display = 'none'; }
  }

  function wireTopbarSegmented() {
    // Visual-only for Phase 1 — matches the prototype's own behavior (toggles .active,
    // doesn't yet filter anything). Real range-filtering lands with Analytics (Phase 7).
    document.querySelectorAll('.topbar .segmented').forEach(function (group) {
      group.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        group.querySelectorAll('button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
      });
    });
  }

  function refreshFloatingTimer() {
    var el = document.getElementById('floating-timer');
    if (!el) return;
    Console.db.getAll('focus_sessions').then(function (sessions) {
      var active = sessions.find(function (s) { return !s.end_at; });
      el.hidden = !active;
      // Populating the timer's contents from `active` is Phase 6 scope (real timer logic);
      // Phase 1 only guarantees the container exists and toggles visibility correctly.
    });
  }

  function boot() {
    var contentEl = document.getElementById('app-content');

    Console.db.open()
      .then(function () { return Console.theme.init(); })
      .then(function () {
        Console.router.init(contentEl);
        Console.palette.init();
        wireTopbarSegmented();
        refreshNavCounts();
        refreshFloatingTimer();
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
