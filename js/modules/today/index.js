/* Console — modules/today. The one fully-real screen in Phase 1.
   Every section reads actual IndexedDB data. With no other module built yet, every store is
   legitimately empty — so most sections render their real empty state rather than mock content
   (see docs/phase_prompts/phase_1_foundation.md, acceptance criteria). The stats strip and the
   upcoming-week grid are exceptions: they're always-real computed structure (dates, zero counts),
   not "empty states", so they render normally even at zero. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null; // Console.lib.format, resolved at init (loaded before this file, but be defensive)
  var refreshHandle = null;

  function emptyCard(title, sub) {
    return (
      '<div class="empty">' +
        '<div class="glyph">' +
          '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M9 9.5c0-1.4 1.3-2.5 3-2.5s3 1.1 3 2.5c0 1.1-.7 1.7-1.5 2.2-.7.4-1.5.9-1.5 1.8" /><circle cx="12" cy="16.5" r=".6" fill="currentColor" stroke="none"/></svg>' +
        '</div>' +
        '<div class="empty-title">' + title + '</div>' +
        '<div class="empty-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function buildInsightSection(insights) {
    if (!insights.length) {
      return '<div class="card insight-empty-row">' + emptyCard('No insights yet', 'Insights start appearing once the daily detectors ship in Phase 7.') + '</div>';
    }
    var top = insights.sort(function (a, b) { return (b.score || 0) - (a.score || 0); })[0];
    return (
      '<div class="insight">' +
        '<div class="ihead">' +
          '<span class="ilabel">◇ Insight of the day</span>' +
          '<span class="imeta">detector: ' + top.detector + ' · score ' + (top.score || 0) + '</span>' +
        '</div>' +
        '<div class="itext">' + (top.text || '') + '</div>' +
        '<div class="iacts"><button>Dismiss</button></div>' +
      '</div>'
    );
  }

  function buildStatsStrip(stats) {
    function hstat(num, unit, label, barClass, pct) {
      return (
        '<div class="hstat">' +
          '<div class="num">' + num + '<span class="unit">' + unit + '</span></div>' +
          '<div class="lbl-row"><span class="lbl">' + label + '</span></div>' +
          '<div class="pbar-mini' + (barClass ? ' ' + barClass : '') + '"><div class="fill" style="width:' + pct + '%;"></div></div>' +
        '</div>'
      );
    }
    return (
      '<div class="stats-strip">' +
        hstat(stats.focusHours.toFixed(1), 'hrs', 'focus today', '', Math.min(100, stats.focusHours / 4 * 100)) +
        hstat(stats.tasksDone + '<span class="unit">/' + stats.tasksTotal + '</span>', '', 'tasks done', 'blue', stats.tasksTotal ? (stats.tasksDone / stats.tasksTotal * 100) : 0) +
        hstat(stats.habitsHit + '<span class="unit">/' + stats.habitsTotal + '</span>', '', 'habits hit', 'teal', stats.habitsTotal ? (stats.habitsHit / stats.habitsTotal * 100) : 0) +
        hstat((stats.netWeek >= 0 ? '<span class="dollar">+$</span>' : '<span class="dollar">-$</span>') + Math.abs(stats.netWeek), '', 'net this week', '', 0) +
      '</div>'
    );
  }

  // DRIFT (Phase 3 browser verification): this originally read `new Date(ev.start_at || ev.start_date)`
  // — but Schedule's real `events` schema (js/db.js, docs/phase_prompts/phase_3_schedule.md) has no
  // `start_at`, just a separate `start_date` ("YYYY-MM-DD") + `start_time` ("HH:MM"). Parsing
  // `start_date` alone as a Date silently produced midnight in the runtime's local-vs-UTC parsing,
  // not the event's real start time — invisible while Schedule didn't exist and this store was
  // always empty, a real bug the moment real events land. Fixed to combine both fields. Also wires
  // real live/logged state (event_logs) instead of the hardcoded "planned" every row showed before.
  function eventState(ev, logsByEventId, nowMin) {
    var log = logsByEventId[ev.id];
    if (ev.status === 'skipped') return 'planned';
    if (log) return log.skipped ? 'planned' : 'done';
    var startMin = timeStrToMin(ev.start_time), endMin = timeStrToMin(ev.end_time);
    if (nowMin >= startMin && nowMin < endMin) return 'live';
    return 'planned';
  }

  function timeStrToMin(t) { if (!t) return 0; var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }

  function buildCalendarCard(events, logsByEventId) {
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    var sorted = events.slice().sort(function (a, b) { return (a.start_time || '').localeCompare(b.start_time || ''); });
    var body = sorted.length
      ? '<div class="cal-list">' + sorted.map(function (ev) {
          var state = eventState(ev, logsByEventId, nowMin);
          var start = new Date(ev.start_date + 'T' + (ev.start_time || '00:00') + ':00');
          return (
            '<div class="cal-row' + (state === 'done' ? ' done' : '') + '">' +
              '<span class="ctime"><span class="t">' + fmt.timeHM(start) + '</span></span>' +
              '<span class="ctitle">' + (ev.title || 'Untitled') + '<span class="ctype">' + (ev.type || '') + '</span></span>' +
              '<span class="cstate ' + state + '">' + state + '</span>' +
            '</div>'
          );
        }).join('') + '</div>'
      : emptyCard('No events scheduled today', 'Schedule module ships in Phase 3.');
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Today’s calendar</span><span class="card-sub">' + events.length + ' events</span></div>' +
        body +
      '</div>'
    );
  }

  function buildTasksCard(tasks) {
    var body = tasks.length
      ? '<div class="task-list">' + tasks.map(function (t) {
          return (
            '<div class="task-row' + (t.status === 'done' ? ' done' : '') + '">' +
              '<span class="check"></span>' +
              '<div><div class="ttitle">' + (t.title || 'Untitled') + '</div></div>' +
            '</div>'
          );
        }).join('') + '</div>'
      : emptyCard('Nothing due today', 'Capture something in Quick capture below, or set a due date from Tasks.');
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Today’s tasks</span><span class="card-sub">' + tasks.filter(function (t) { return t.status === 'done'; }).length + ' / ' + tasks.length + ' done</span></div>' +
        body +
      '</div>'
    );
  }

  function buildHabitsCard(habits) {
    var body = habits.length
      ? '<div class="habit-list">' + habits.map(function (h) {
          return (
            '<div class="habit-row">' +
              '<div class="htoggle"></div>' +
              '<div class="hinfo"><div class="hname">' + (h.name || 'Untitled') + '</div></div>' +
              '<div class="hbar"><div class="fill" style="width:0%;"></div></div>' +
              '<div class="hpct">0%</div>' +
            '</div>'
          );
        }).join('') + '</div>'
      : emptyCard('No habits yet', 'Habits module ships in Phase 4.');
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Today’s habits</span><span class="card-sub">rolling 30d</span></div>' +
        body +
      '</div>'
    );
  }

  // Enabled and wired to real capture in Phase 2 (Tasks) — matches console_today_prototype.html,
  // which shows this textarea active with a real "inbox · N unprocessed" count, not the Phase 1
  // disabled placeholder. Shares Console.lib.captureTask with the Tasks module's own capture bar
  // (see js/lib/capture.js) rather than a second copy of the parser.
  function buildQuickCaptureCard(inboxDepth) {
    return (
      '<div class="qc-card">' +
        '<div class="card-head"><span class="card-title">Quick capture</span><span class="card-sub">inbox · ' + inboxDepth + ' unprocessed</span></div>' +
        '<textarea class="qc-input" id="qc-input" placeholder="Capture anything…&#10;&#10;Try: call vendor tomorrow !high @phone #client-a"></textarea>' +
        '<div class="qc-syntax">' +
          '<span class="chip"><span class="acc">!high</span> <span class="acc">!med</span> <span class="acc">!low</span> priority</span>' +
          '<span class="chip"><span class="b">@email</span> <span class="b">@phone</span> context</span>' +
          '<span class="chip"><span class="p">#project</span> link</span>' +
        '</div>' +
      '</div>'
    );
  }

  function wireQuickCapture(container) {
    var qc = container.querySelector('#qc-input');
    if (!qc) return;
    qc.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && qc.value.trim()) {
        e.preventDefault();
        var raw = qc.value.trim();
        Console.lib.captureTask(raw).then(function (task) {
          if (task) {
            qc.value = '';
            loadData().then(function (data) { render(container, data); });
          }
        });
      }
    });
  }

  function buildWeekCard(days, tasksByDate) {
    var cells = days.map(function (d) {
      var iso = fmt.isoDate(d);
      var isToday = fmt.sameDate(d, new Date());
      var count = (tasksByDate[iso] || 0);
      return (
        '<div class="day-card' + (isToday ? ' today' : '') + (fmt.isWeekend(d) ? ' weekend' : '') + '">' +
          '<div class="dow">' + fmt.weekdayAbbr(d) + '</div>' +
          '<div class="dnum">' + d.getDate() + '</div>' +
          '<div class="dstats"><span>' + count + '</span> tasks</div>' +
        '</div>'
      );
    }).join('');
    var range = fmt.monthDay(days[0]) + ' – ' + fmt.monthDay(days[6]);
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Upcoming week</span><span class="card-sub">' + range.toLowerCase() + '</span></div>' +
        '<div class="week-strip">' + cells + '</div>' +
      '</div>'
    );
  }

  function buildMoneyCard(transactions, envelopes) {
    if (!transactions.length && !envelopes.length) {
      return '<div class="card"><div class="card-head"><span class="card-title">Money snapshot</span></div>' +
        emptyCard('No transactions yet', 'Finance module ships in Phase 5.') + '</div>';
    }
    var net = transactions.reduce(function (sum, t) { return sum + (t.amount || 0); }, 0);
    var envRows = envelopes.map(function (e) {
      var pct = e.target ? Math.min(100, Math.round((e.spent || 0) / e.target * 100)) : 0;
      return (
        '<div class="env-row"><span class="ename">' + (e.name || 'Untitled') + '</span>' +
        '<div class="ebar"><div class="fill" style="width:' + pct + '%;"></div></div>' +
        '<span class="epct">' + pct + '%</span></div>'
      );
    }).join('');
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Money snapshot</span></div>' +
        '<div class="money-net"><span class="mnum">' + (net >= 0 ? '+$' : '-$') + Math.abs(net).toFixed(0) + '</span><span class="mlbl">net this month</span></div>' +
        '<div class="env-list">' + envRows + '</div>' +
      '</div>'
    );
  }

  function buildSuggestedFocusCard() {
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Suggested focus blocks</span></div>' +
        emptyCard('No suggestions yet', 'Activates once Tasks and Schedule (Phases 2–3) have data.') +
      '</div>'
    );
  }

  function buildWaitingCard(waitingTasks) {
    var body = waitingTasks.length
      ? '<div class="waiting-list">' + waitingTasks.map(function (t) {
          return (
            '<div class="wait-row">' +
              '<div class="wavatar">' + (t.title || '??').slice(0, 2).toUpperCase() + '</div>' +
              '<div><div class="wtitle">' + (t.title || 'Untitled') + '</div></div>' +
            '</div>'
          );
        }).join('') + '</div>'
      : emptyCard('Nothing you’re waiting on', 'Mark a task “Waiting” from its detail pane in Tasks.');
    return (
      '<div class="card">' +
        '<div class="card-head"><span class="card-title">Waiting for</span></div>' +
        body +
      '</div>'
    );
  }

  function render(container, data) {
    var now = new Date();
    container.innerHTML =
      '<div class="page-head">' +
        '<h1 class="page-title">Today &mdash; <span class="em">' + fmt.longWeekday(now) + '</span></h1>' +
        '<span class="page-date">' + fmt.monthDay(now) + ', ' + fmt.timeHM(now) + '</span>' +
      '</div>' +
      buildInsightSection(data.insights) +
      buildStatsStrip(data.stats) +
      '<div class="two-col">' + buildCalendarCard(data.eventsToday, data.logsByEventId) + buildTasksCard(data.tasksToday) + '</div>' +
      '<div class="two-col flip">' + buildHabitsCard(data.habits) + buildQuickCaptureCard(data.inboxDepth) + '</div>' +
      '<div class="two-col">' + buildWeekCard(data.weekDays, data.tasksByDate) + buildMoneyCard(data.transactions, data.envelopes) + '</div>' +
      '<div class="two-col flip">' + buildSuggestedFocusCard() + buildWaitingCard(data.waitingTasks) + '</div>';
    wireQuickCapture(container);
  }

  function loadData() {
    var db = Console.db;
    var todayISO = fmt.todayISO();
    var week = fmt.weekOf(new Date());

    return Promise.all([
      db.getAll('insights'),
      db.getAll('tasks'),
      db.getAllByIndex('events', 'start_date', todayISO),
      db.getAll('habits'),
      db.getAll('habit_logs'),
      db.getAll('focus_sessions'),
      db.getAll('transactions'),
      db.getAll('envelopes'),
      db.getAll('event_logs')
    ]).then(function (results) {
      var insights = results[0];
      var allTasks = results[1];
      var eventsToday = results[2];
      var habits = results[3];
      var habitLogs = results[4];
      var focusSessions = results[5];
      var transactions = results[6];
      var envelopes = results[7];
      var eventLogsAll = results[8];

      var logsByEventId = {};
      eventLogsAll.forEach(function (l) { if (l.date === todayISO) logsByEventId[l.event_id] = l; });

      var tasksToday = allTasks.filter(function (t) { return t.due_date === todayISO; });
      var waitingTasks = allTasks.filter(function (t) { return t.status === 'waiting'; });
      var inboxDepth = allTasks.filter(function (t) { return t.status === 'inbox'; }).length;

      var tasksByDate = {};
      allTasks.forEach(function (t) {
        if (!t.due_date) return;
        tasksByDate[t.due_date] = (tasksByDate[t.due_date] || 0) + 1;
      });

      var focusHoursToday = focusSessions
        .filter(function (s) { return (s.start_at || '').slice(0, 10) === todayISO; })
        .reduce(function (sum, s) { return sum + ((s.duration_min || 0) / 60); }, 0);

      var habitLogsToday = {};
      habitLogs.forEach(function (l) { if (l.date === todayISO) habitLogsToday[l.habit_id] = l.state; });
      var habitsHit = habits.filter(function (h) { return habitLogsToday[h.id] === 'done'; }).length;

      var weekStartISO = fmt.isoDate(week[0]);
      var weekEndISO = fmt.isoDate(week[6]);
      var netWeek = transactions
        .filter(function (t) { return t.date >= weekStartISO && t.date <= weekEndISO; })
        .reduce(function (sum, t) { return sum + (t.amount || 0); }, 0);

      return {
        insights: insights,
        stats: {
          focusHours: focusHoursToday,
          tasksDone: tasksToday.filter(function (t) { return t.status === 'done'; }).length,
          tasksTotal: tasksToday.length,
          habitsHit: habitsHit,
          habitsTotal: habits.filter(function (h) { return h.status === 'active'; }).length,
          netWeek: Math.round(netWeek)
        },
        eventsToday: eventsToday,
        tasksToday: tasksToday,
        habits: habits,
        weekDays: week,
        tasksByDate: tasksByDate,
        transactions: transactions,
        envelopes: envelopes,
        waitingTasks: waitingTasks,
        inboxDepth: inboxDepth,
        logsByEventId: logsByEventId
      };
    });
  }

  Console.modules.today = {
    init: function (container) {
      fmt = Console.lib.format;
      loadData().then(function (data) { render(container, data); });
      // keep the page-date/weekday fresh across midnight without a full reload
      refreshHandle = setInterval(function () {
        loadData().then(function (data) { render(container, data); });
      }, 5 * 60 * 1000);
    },
    destroy: function () {
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
    }
  };
})();
