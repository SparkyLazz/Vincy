/* Console — modules/habits. Phase 4: Atomic Habits framework fields, multi-state daily logging,
   rolling 30-day consistency (no streaks — Console.lib.habits owns that math), quantitative
   targets, and read-only cross-domain link counts. Extracted from
   console_habits_prototype.html's "All habits" view — see docs/phase_prompts/phase_4_habits.md
   and docs/Console_Workflow.md for the extraction/conflict log (`.pill.rose` -> `.pill.danger`,
   `.detail-head` padding, etc). Today/Correlations/Archive have no prototype and are built fresh
   from already-proven atomic components, same precedent Phase 3 used for its new event modal.
   layout: 'flush' — same reason Tasks/Schedule set it: this module owns page-head-row/view-tabs-
   row/metrics-row/twopane-row itself instead of rendering inside .content/.content-inner. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var hlib = null; // Console.lib.habits — consistency30 / dayChain, shared with Today dashboard
  var db = null;
  var container = null;
  var keydownHandler = null;
  var refreshHandle = null;

  var CATEGORY_COLORS = ['teal', 'blue', 'amber', 'plum', 'danger', 'neutral'];
  var STATES = ['done', 'partial', 'skip', 'miss'];

  var VIEWS = [
    { key: 'today', label: 'today' },
    { key: 'all', label: 'all habits' },
    { key: 'correlations', label: 'correlations' },
    { key: 'archive', label: 'archive' }
  ];

  var currentView = 'all';
  var selectedId = null;
  var visibleOrder = []; // ids in the order currently rendered, for J/K navigation

  var modalMode = null;  // null | 'habit' | 'log'
  var modalHabit = null; // working copy while the New/Edit habit modal is open
  var modalLog = null;   // working copy while the log modal is open — { habit_id, date, state, value, note }

  var cache = { habits: [], habitLogs: [], tasks: [], focusSessions: [], projects: [] };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findHabit(id) { return cache.habits.find(function (h) { return h.id === id; }); }

  function activeHabits() { return cache.habits.filter(function (h) { return h.status === 'active'; }); }
  function archivedHabits() { return cache.habits.filter(function (h) { return h.status === 'archived'; }); }

  function consistencyFor(h, todayISO) {
    return hlib.consistency30(h.id, cache.habitLogs, todayISO, h.created_at);
  }

  function todayLogFor(habitId, todayISO) {
    return hlib.findLog(cache.habitLogs, habitId, todayISO);
  }

  // One log row per [habit_id, date] — merges into the existing row for today rather than
  // creating a duplicate, matching the habit_id_date compound index in db.js.
  function upsertLog(habitId, dateISO, patch) {
    var existing = hlib.findLog(cache.habitLogs, habitId, dateISO);
    var row = existing || { id: db.uuid(), habit_id: habitId, date: dateISO, value: null, note: '' };
    row.state = patch.state;
    if (patch.value !== undefined) row.value = patch.value;
    if (patch.note !== undefined) row.note = patch.note;
    row.logged_at = new Date().toISOString();
    return db.put('habit_logs', row);
  }

  // Cross-domain counts (read-only this phase — see phase_4_habits.md item 4/exclusions).
  // Tasks link by tag OR by project name; Focus sessions link by the direct habit_id foreign key
  // already defined on the focus_sessions store in db.js (not a tag match — the schema already
  // models this as a direct relationship, not a fuzzy one).
  // Tag matching goes through Console.lib.sameTag (case-insensitive, leading-# stripped) — the
  // habit's tag and the task's tags are both free-typed text, so "Reading", "#reading" and
  // "reading " must all count as the same tag or this reads 0 for no visible reason. Project
  // names count too because quick capture's #word token creates a *project*, not a tag — a user
  // who typed "read chapter 4 #reading" reasonably expects that task to show up here.
  function taskLinkCount(h) {
    if (!h.tag) return 0;
    var sameTag = Console.lib.sameTag;
    var projIds = cache.projects.filter(function (p) { return sameTag(p.name, h.tag); })
      .map(function (p) { return p.id; });
    return cache.tasks.filter(function (t) {
      if ((t.tags || []).some(function (tag) { return sameTag(tag, h.tag); })) return true;
      return t.project_id && projIds.indexOf(t.project_id) !== -1;
    }).length;
  }
  function focusLinkCount(h) {
    return cache.focusSessions.filter(function (s) { return s.habit_id === h.id; }).length;
  }

  // ---------------------------------------------------------------- metrics

  function computeMetrics(todayISO) {
    var active = activeHabits();
    if (!active.length) {
      return { avgPct: 0, avgDelta: 0, trackedToday: 0, activeCount: 0, best: null, watch: null };
    }
    var prevISO = fmt.addDaysISO(todayISO, -30);
    var rows = active.map(function (h) {
      return { h: h, pct: consistencyFor(h, todayISO), prevPct: consistencyFor(h, prevISO) };
    });
    var avgPct = Math.round(rows.reduce(function (s, r) { return s + r.pct; }, 0) / rows.length);
    var avgPrevPct = Math.round(rows.reduce(function (s, r) { return s + r.prevPct; }, 0) / rows.length);
    var trackedToday = active.filter(function (h) { return !!todayLogFor(h.id, todayISO); }).length;
    var sorted = rows.slice().sort(function (a, b) { return b.pct - a.pct; });
    var best = sorted[0];
    var watch = sorted[sorted.length - 1];
    return {
      avgPct: avgPct, avgDelta: avgPct - avgPrevPct, trackedToday: trackedToday, activeCount: active.length,
      best: best, watch: watch
    };
  }

  // ---------------------------------------------------------------- rendering: shell rows

  function pageSub(todayISO) {
    var active = activeHabits();
    var all = cache.habits;
    var avgPct = active.length ? Math.round(active.reduce(function (s, h) { return s + consistencyFor(h, todayISO); }, 0) / active.length) : 0;
    var earliest = all.reduce(function (min, h) { return (!min || h.created_at < min) ? h.created_at : min; }, null);
    var daysIn = earliest ? Math.max(0, fmt.daysBetweenISO(earliest.slice(0, 10), todayISO)) : 0;
    return active.length + ' tracked · ' + avgPct + '% avg consistency · ' + daysIn + ' days in';
  }

  function renderMetrics(todayISO) {
    var m = computeMetrics(todayISO);
    var trackedLbl = (m.activeCount && m.trackedToday === m.activeCount)
      ? '<span class="mtrend">all tracked today</span>'
      : '<span class="mtrend down">' + (m.activeCount - m.trackedToday) + ' not yet logged</span>';
    var avgTrend = m.avgDelta >= 0
      ? '<span class="mtrend">▲ +' + m.avgDelta + ' pts vs last</span>'
      : '<span class="mtrend warn">▼ ' + m.avgDelta + ' pts vs last</span>';
    var bestBlock = m.best
      ? '<div class="metric"><div class="mnum teal">' + m.best.pct + '<span class="munit">%</span></div><div class="mlbl"><span>best · ' + escapeHtml(m.best.h.name.toLowerCase()) + '</span><span class="mtrend">' + escapeHtml(m.best.h.category_label || '') + '</span></div></div>'
      : '<div class="metric"><div class="mnum">—</div><div class="mlbl"><span>best</span></div></div>';
    var watchDelta = m.watch ? m.watch.pct - m.watch.prevPct : 0;
    var watchBlock = m.watch
      ? '<div class="metric"><div class="mnum amber">' + m.watch.pct + '<span class="munit">%</span></div><div class="mlbl"><span>watch · ' + escapeHtml(m.watch.h.name.toLowerCase()) + '</span><span class="mtrend' + (watchDelta < 0 ? ' warn' : '') + '">' + (watchDelta >= 0 ? '▲ +' : '▼ ') + Math.abs(watchDelta) + ' pts</span></div></div>'
      : '<div class="metric"><div class="mnum">—</div><div class="mlbl"><span>watch</span></div></div>';
    return (
      '<div class="metrics-row"><div class="metrics-inner">' +
        '<div class="metric"><div class="mnum teal">' + m.avgPct + '<span class="munit">%</span></div><div class="mlbl"><span>avg consistency · 30d</span>' + avgTrend + '</div></div>' +
        '<div class="metric"><div class="mnum">' + m.trackedToday + '<span class="munit">/' + m.activeCount + '</span></div><div class="mlbl"><span>active habits</span>' + trackedLbl + '</div></div>' +
        bestBlock + watchBlock +
      '</div></div>'
    );
  }

  function renderPhilosophy() {
    return (
      '<div class="philosophy"><div class="philosophy-inner">' +
        '<strong>No streaks</strong>Consistency is measured as rolling 30-day % — missing one day never resets your progress. Antifragile by design.' +
      '</div></div>'
    );
  }

  function viewCounts() {
    return {
      today: activeHabits().length,
      all: activeHabits().length,
      archive: archivedHabits().length
    };
  }

  // ---------------------------------------------------------------- rendering: habit card + grid

  function hcChainHtml(h, todayISO) {
    var chain = hlib.dayChain(h.id, cache.habitLogs, todayISO, h.created_at, 14);
    return chain.map(function (d) {
      var cls = 'day' + (d.state ? ' ' + d.state : '') + (d.today ? ' today' : '');
      return '<div class="' + cls + '"></div>';
    }).join('');
  }

  function renderHabitCard(h, todayISO) {
    var pct = consistencyFor(h, todayISO);
    var log = todayLogFor(h.id, todayISO);
    var todayVal = log
      ? ((log.value != null ? log.value + (h.target ? ' ' + h.target.unit : '') + ' · ' : '') + fmt.timeHM(new Date(log.logged_at)))
      : 'not yet';
    var target = h.target ? (h.target.amount + ' ' + h.target.unit + (h.cadence === 'n_per_week' ? ' · ' + h.cadence_n + 'x per week' : '/day'))
      : (h.cadence === 'n_per_week' ? h.cadence_n + 'x per week' : 'daily');
    var btns = STATES.map(function (s) {
      var glyph = s === 'done' ? '✓' : s === 'partial' ? '~' : s === 'skip' ? '○' : '×';
      var active = log && log.state === s ? ' active ' + s : '';
      return '<button class="hlog' + active + '" data-act="quick-log" data-id="' + h.id + '" data-state="' + s + '">' + glyph + '</button>';
    }).join('');
    return (
      '<div class="habit-card' + (h.id === selectedId ? ' selected' : '') + '" data-id="' + h.id + '">' +
        '<div class="hc-head"><div class="hc-name">' + escapeHtml(h.name) + '</div><div class="hc-pct' + (pct < 70 ? ' warn' : '') + '">' + pct + '%</div></div>' +
        '<div class="hc-meta"><span class="pill ' + (h.category_color || 'neutral') + '">' + escapeHtml(h.category_label || 'habit') + '</span><span class="hc-target">' + escapeHtml(target) + '</span></div>' +
        '<div class="hc-chain">' + hcChainHtml(h, todayISO) + '</div>' +
        '<div class="hc-today"><span class="today-lbl">Today</span><span class="today-val">' + escapeHtml(todayVal) + '</span>' +
          '<div class="log-btns">' + btns + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: detail panel

  function consistencyChartSvg(h, todayISO) {
    // Real 4-point trend (today, 30d ago, 60d ago, 90d ago) computed by shifting consistency30's
    // own `todayISO` argument backward — not mock data, and reuses the exact same rolling-window
    // math the cards/metrics use, just evaluated at an earlier "today".
    var p90 = consistencyFor(h, fmt.addDaysISO(todayISO, -90));
    var p60 = consistencyFor(h, fmt.addDaysISO(todayISO, -60));
    var p30 = consistencyFor(h, fmt.addDaysISO(todayISO, -30));
    var p0 = consistencyFor(h, todayISO);
    function y(pct) { return Math.round(50 - (pct / 100) * 46); }
    var pts = [[0, y(p90)], [133, y(p60)], [266, y(p30)], [400, y(p0)]];
    var poly = pts.map(function (p) { return p[0] + ',' + p[1]; }).join(' ');
    var area = 'M' + poly.replace(/ /g, ' L') + ' L400,60 L0,60 Z';
    return (
      '<svg viewBox="0 0 400 60" preserveAspectRatio="none">' +
        '<defs><linearGradient id="ccgrad" x1="0" x2="0" y1="0" y2="1">' +
          '<stop offset="0%" stop-color="var(--teal)" stop-opacity="0.35"/>' +
          '<stop offset="100%" stop-color="var(--teal)" stop-opacity="0"/>' +
        '</linearGradient></defs>' +
        '<path d="' + area + '" fill="url(#ccgrad)"/>' +
        '<polyline points="' + poly + '" fill="none" stroke="var(--teal)" stroke-width="1.8" vector-effect="non-scaling-stroke"/>' +
        '<circle cx="' + pts[3][0] + '" cy="' + pts[3][1] + '" r="3" fill="var(--teal)"/>' +
      '</svg>' +
      '<div class="cc-scale"><span>90d ago · ' + p90 + '%</span><span>60d ago · ' + p60 + '%</span><span>30d ago · ' + p30 + '%</span><span>today · ' + p0 + '%</span></div>'
    );
  }

  function chainFullHtml(h, todayISO) {
    var chain = hlib.dayChain(h.id, cache.habitLogs, todayISO, h.created_at, 60);
    var tally = { done: 0, partial: 0, skip: 0, miss: 0 };
    var cells = chain.map(function (d) {
      if (d.state) tally[d.state] = (tally[d.state] || 0) + 1;
      var cls = 'cf-day' + (d.state ? ' ' + d.state : '') + (d.today ? ' today' : '');
      return '<div class="' + cls + '"></div>';
    }).join('');
    var startLabel = chain.length ? fmt.monthDay(new Date(chain[0].date + 'T00:00:00')).toLowerCase() : '';
    var midLabel = chain.length ? fmt.monthDay(new Date(chain[Math.floor(chain.length / 2)].date + 'T00:00:00')).toLowerCase() : '';
    var todayLabel = 'today · ' + fmt.monthDay(new Date(todayISO + 'T00:00:00')).toLowerCase();
    return {
      cells: cells,
      tally: tally.done + ' done · ' + tally.partial + ' partial · ' + tally.skip + ' skip',
      labels: '<span>' + startLabel + '</span><span>' + midLabel + '</span><span>' + todayLabel + '</span>'
    };
  }

  function recentLogsHtml(h) {
    var logs = cache.habitLogs.filter(function (l) { return l.habit_id === h.id; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);
    if (!logs.length) return '<div class="empty-sub">No logs yet.</div>';
    return logs.map(function (l) {
      var d = new Date(l.date + 'T00:00:00');
      var isToday = l.date === fmt.todayISO();
      var dateLbl = isToday ? 'today' : fmt.weekdayAbbr(d);
      var timeLbl = l.logged_at ? fmt.timeHM(new Date(l.logged_at)) : '—';
      var valLbl = l.value != null ? (l.value + (h.target ? ' ' + h.target.unit : '')) : '—';
      return (
        '<div class="log-row">' +
          '<span class="lr-date">' + dateLbl + ' <span class="lr-time">' + timeLbl + '</span></span>' +
          '<span class="lr-value' + (l.value == null ? ' muted' : '') + '">' + escapeHtml(valLbl) + '</span>' +
          '<span class="lr-note">' + escapeHtml(l.note || '') + '</span>' +
          '<span class="lr-state ' + l.state + '">' + l.state + '</span>' +
        '</div>'
      );
    }).join('');
  }

  function crossDomainHtml(h) {
    if (!h.tag) {
      return '<div class="empty-sub">Set a tag on this habit to link matching Tasks and Focus sessions here.</div>';
    }
    var taskCount = taskLinkCount(h);
    var focusCount = focusLinkCount(h);
    return (
      '<div class="cd-links">' +
        '<div class="cd-link"><div class="cd-icn ' + (h.category_color || 'neutral') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg></div>' +
          '<div class="cd-info"><div class="cd-title">Focus sessions · linked</div><div class="cd-meta">' + focusCount + ' sessions total · started from this habit in Focus</div></div>' +
          '<div class="cd-count ' + (h.category_color || 'neutral') + '">' + focusCount + '</div>' +
        '</div>' +
        '<div class="cd-link"><div class="cd-icn blue"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 12 2 2 4-4"/></svg></div>' +
          '<div class="cd-info"><div class="cd-title">Tasks · #' + escapeHtml(h.tag) + '</div><div class="cd-meta">' + taskCount + ' linked tasks · tagged #' + escapeHtml(h.tag) + ' or in a project named “' + escapeHtml(h.tag) + '”</div></div>' +
          '<div class="cd-count blue">' + taskCount + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderDetail(h) {
    if (!h) {
      return (
        '<div class="empty">' +
          '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/></svg></div>' +
          '<div class="empty-title">No habit selected</div>' +
          '<div class="empty-sub">Click a habit, or use J/K to navigate.</div>' +
        '</div>'
      );
    }
    var todayISO = fmt.todayISO();
    var active = activeHabits();
    var idx = active.findIndex(function (a) { return a.id === h.id; }) + 1;
    var pct = consistencyFor(h, todayISO);
    var daysTracked = Math.max(0, fmt.daysBetweenISO(h.created_at.slice(0, 10), todayISO)) + 1;
    var totalLogged = cache.habitLogs.filter(function (l) { return l.habit_id === h.id && (l.state === 'done' || l.state === 'partial'); });
    var totalValue = h.target
      ? totalLogged.reduce(function (s, l) { return s + (l.value || 0); }, 0)
      : totalLogged.length;
    var totalLbl = h.target ? (totalValue.toLocaleString() + ' <span class="dhs-unit">' + escapeHtml(h.target.unit) + '</span>') : totalValue;
    var chain = chainFullHtml(h, todayISO);

    return (
      '<div class="detail-head">' +
        '<div class="dh-eyebrow">selected · ' + idx + ' of ' + active.length + '</div>' +
        '<div class="dh-title">' + escapeHtml(h.name) + '</div>' +
        (h.identity ? '<div class="dh-identity">' + escapeHtml(h.identity) + '</div>' : '') +
        '<div class="dh-stats">' +
          '<div class="dh-stat"><div class="dhs-num">' + pct + '<span class="dhs-unit">%</span></div><div class="dhs-lbl">rolling 30d</div></div>' +
          '<div class="dh-stat neutral"><div class="dhs-num">' + daysTracked + '</div><div class="dhs-lbl">days tracked</div></div>' +
          '<div class="dh-stat neutral"><div class="dhs-num">' + totalLbl + '</div><div class="dhs-lbl">total ' + (h.target ? escapeHtml(h.target.unit) : 'logged') + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Atomic Habits framework</span><span class="ds-action" data-act="edit-habit" data-id="' + h.id + '">edit</span></div>' +
        '<div class="framework-grid">' +
          '<div class="fw-item cue"><div class="fw-label">Cue<span class="fw-rule">— make it obvious</span></div><div class="fw-value">' + escapeHtml(h.cue || '—') + '</div></div>' +
          '<div class="fw-item craving"><div class="fw-label">Craving<span class="fw-rule">— make it attractive</span></div><div class="fw-value">' + escapeHtml(h.craving || '—') + '</div></div>' +
          '<div class="fw-item response"><div class="fw-label">Response<span class="fw-rule">— make it easy</span></div><div class="fw-value">' + escapeHtml(h.response || '—') + '</div></div>' +
          '<div class="fw-item reward"><div class="fw-label">Reward<span class="fw-rule">— make it satisfying</span></div><div class="fw-value">' + escapeHtml(h.reward || '—') + '</div></div>' +
        '</div>' +
        '<div class="stack-env-grid">' +
          '<div class="stack-item"><div class="si-label">Habit stacking</div><div class="si-value">' + escapeHtml(h.stack_before || '—') + (h.stack_before ? '<span class="stack-arrow">→</span>' + escapeHtml(h.name) : '') + '</div></div>' +
          '<div class="stack-item"><div class="si-label">Environment</div><div class="si-value">' + escapeHtml(h.environment || '—') + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Consistency · rolling 30d over last 90 days</span></div>' +
        '<div class="consistency-chart">' + consistencyChartSvg(h, todayISO) + '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Last 60 days</span><span class="ds-trend muted">' + chain.tally + '</span></div>' +
        '<div class="chain-full">' + chain.cells + '</div>' +
        '<div class="chain-labels">' + chain.labels + '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Recent logs</span></div>' +
        '<div class="log-history">' + recentLogsHtml(h) + '</div>' +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Cross-domain links</span></div>' +
        crossDomainHtml(h) +
      '</div>' +
      '<div class="detail-actions">' +
        '<button class="primary" data-act="log-today" data-id="' + h.id + '">Log · today</button>' +
        '<button data-act="edit-habit" data-id="' + h.id + '">Edit framework</button>' +
        '<button data-act="view-history" data-id="' + h.id + '">View history</button>' +
        '<button class="danger" data-act="archive-habit" data-id="' + h.id + '">Archive</button>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: views

  function emptyState(title, sub) {
    return (
      '<div class="empty">' +
        '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></div>' +
        '<div class="empty-title">' + title + '</div>' +
        '<div class="empty-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function renderAllView(todayISO) {
    var active = activeHabits();
    visibleOrder = active.map(function (h) { return h.id; });
    if (selectedId && !findHabit(selectedId)) selectedId = null;
    if (!selectedId && active.length) selectedId = active[0].id;
    var selected = selectedId ? findHabit(selectedId) : null;
    var gridBody = active.length
      ? '<div class="habits-grid">' + active.map(function (h) { return renderHabitCard(h, todayISO); }).join('') + '</div>'
      : emptyState('No habits yet', 'Click "New habit" to define your first one.');
    return (
      '<div class="twopane-row"><div class="twopane-inner">' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">Habits · rolling 30-day</span><span class="pane-meta">last 14 days shown</span></div>' +
          '<div class="pane-body" id="habits-list">' + gridBody + '</div>' +
        '</div>' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">Habit detail</span><span class="pane-meta">⌘ E to edit</span></div>' +
          '<div class="pane-body" id="habit-detail">' + renderDetail(selected) + '</div>' +
        '</div>' +
      '</div></div>'
    );
  }

  // Today view — reuses the exact .habit-list/.habit-row markup Today-dashboard's own habits
  // card shipped with in Phase 1 (base.css/components.css), now wired to real state instead of
  // the hardcoded empty toggle/0% fill it had before Habits existed.
  function renderTodayView(todayISO) {
    var active = activeHabits();
    visibleOrder = active.map(function (h) { return h.id; });
    if (!active.length) {
      return '<div class="twopane-row"><div class="twopane-inner single"><div class="pane"><div class="pane-body">' + emptyState('No habits yet', 'Click "New habit" to define your first one.') + '</div></div></div></div>';
    }
    var rows = active.map(function (h) {
      var log = todayLogFor(h.id, todayISO);
      var pct = consistencyFor(h, todayISO);
      var toggleCls = 'htoggle' + (log ? ' ' + log.state : '');
      return (
        '<div class="habit-row' + (h.id === selectedId ? ' selected' : '') + '" data-id="' + h.id + '">' +
          '<div class="' + toggleCls + '" data-act="quick-log" data-id="' + h.id + '" data-state="done"></div>' +
          '<div class="hinfo"><div class="hname">' + escapeHtml(h.name) + '</div><div class="hmeta">' + escapeHtml(h.category_label || '') + '</div></div>' +
          '<div class="hbar' + (pct < 70 ? ' warn' : '') + '"><div class="fill" style="width:' + pct + '%;"></div></div>' +
          '<div class="hpct">' + pct + '%</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="twopane-row"><div class="twopane-inner single"><div class="pane">' +
        '<div class="pane-head"><span class="pane-title">Today’s habits</span><span class="pane-meta">click the toggle to mark done, D/P/S to set state</span></div>' +
        '<div class="pane-body"><div class="habit-list">' + rows + '</div></div>' +
      '</div></div></div>'
    );
  }

  // Correlations — no prototype; simple real-data sort, richer scoring is Analytics' job
  // (Phase 7, "Habit ↔ Output Correlation"), see phase_4_habits.md items 6/exclusions.
  function renderCorrelationsView(todayISO) {
    var active = activeHabits();
    visibleOrder = active.map(function (h) { return h.id; });
    var sorted = active.slice().sort(function (a, b) { return consistencyFor(b, todayISO) - consistencyFor(a, todayISO); });
    if (!sorted.length) {
      return '<div class="twopane-row"><div class="twopane-inner single"><div class="pane"><div class="pane-body">' + emptyState('Nothing to correlate yet', 'Add habits and start logging to see correlations here.') + '</div></div></div></div>';
    }
    var rows = sorted.map(function (h) {
      var pct = consistencyFor(h, todayISO);
      var focusCount = focusLinkCount(h);
      var taskCount = taskLinkCount(h);
      return (
        '<div class="cd-link' + (h.id === selectedId ? ' selected' : '') + '" data-id="' + h.id + '">' +
          '<div class="cd-icn ' + (h.category_color || 'neutral') + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></div>' +
          '<div class="cd-info"><div class="cd-title">' + escapeHtml(h.name) + '</div><div class="cd-meta">' + focusCount + ' focus sessions · ' + taskCount + ' linked tasks</div></div>' +
          '<div class="cd-count ' + (h.category_color || 'neutral') + '">' + pct + '%</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="twopane-row"><div class="twopane-inner single"><div class="pane">' +
        '<div class="pane-head"><span class="pane-title">Correlations</span><span class="pane-meta">sorted by 30d consistency</span></div>' +
        '<div class="pane-body"><div class="cd-links">' + rows + '</div></div>' +
      '</div></div></div>'
    );
  }

  function renderArchiveView() {
    var archived = archivedHabits();
    visibleOrder = archived.map(function (h) { return h.id; });
    if (!archived.length) {
      return '<div class="twopane-row"><div class="twopane-inner single"><div class="pane"><div class="pane-body">' + emptyState('No archived habits', 'Archived habits (and their history) will show up here.') + '</div></div></div></div>';
    }
    var rows = archived.map(function (h) {
      return (
        '<div class="list-row habit' + (h.id === selectedId ? ' selected' : '') + '" data-id="' + h.id + '">' +
          '<div class="ti">' + escapeHtml(h.name) + '<span class="pill ' + (h.category_color || 'neutral') + '">' + escapeHtml(h.category_label || '') + '</span></div>' +
          '<span class="meta">' + escapeHtml(h.identity || '') + '</span>' +
          '<button class="btn-mini" data-act="reactivate-habit" data-id="' + h.id + '">Reactivate</button>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="twopane-row"><div class="twopane-inner single"><div class="pane">' +
        '<div class="pane-head"><span class="pane-title">Archive</span><span class="pane-meta">' + archived.length + ' archived</span></div>' +
        '<div class="pane-body">' + rows + '</div>' +
      '</div></div></div>'
    );
  }

  function renderViewBody(todayISO) {
    if (currentView === 'today') return renderTodayView(todayISO);
    if (currentView === 'all') return renderAllView(todayISO);
    if (currentView === 'correlations') return renderCorrelationsView(todayISO);
    if (currentView === 'archive') return renderArchiveView();
    return '';
  }

  // ---------------------------------------------------------------- rendering: modal

  function renderModal() {
    if (!modalMode) return '<div class="modal-overlay" id="habits-modal" hidden></div>';
    if (modalMode === 'habit') return renderHabitModal();
    if (modalMode === 'log') return renderLogModal();
    return '';
  }

  function renderHabitModal() {
    var h = modalHabit;
    var isNew = h._isNew;
    var colorOptions = CATEGORY_COLORS.map(function (c) { return '<option value="' + c + '"' + (c === h.category_color ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    var cadenceOptions = ['daily', 'n_per_week'].map(function (c) {
      return '<option value="' + c + '"' + (c === h.cadence ? ' selected' : '') + '>' + (c === 'daily' ? 'daily' : 'N times per week') + '</option>';
    }).join('');
    return (
      '<div class="modal-overlay" id="habits-modal">' +
        '<div class="modal wide">' +
          '<div class="modal-head"><span class="modal-title">' + (isNew ? 'New habit' : 'Edit habit') + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-field"><label>Name</label><input type="text" class="input" id="mf-name" value="' + escapeHtml(h.name || '') + '" placeholder="Read 30 min"></div>' +
            '<div class="modal-field"><label>Identity ("I am a ___")</label><input type="text" class="input" id="mf-identity" value="' + escapeHtml(h.identity || '') + '" placeholder="I am a reader"></div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Category label</label><input type="text" class="input" id="mf-category-label" value="' + escapeHtml(h.category_label || '') + '" placeholder="keystone"></div>' +
              '<div class="modal-field"><label>Category color</label><select class="input" id="mf-category-color">' + colorOptions + '</select></div>' +
            '</div>' +
            '<div class="modal-row3">' +
              '<div class="modal-field"><label>Cadence</label><select class="input" id="mf-cadence">' + cadenceOptions + '</select></div>' +
              '<div class="modal-field"><label>× per week</label><input type="number" min="1" max="7" class="input" id="mf-cadence-n" value="' + (h.cadence_n || 3) + '"></div>' +
              '<div class="modal-field"><label>Tag (optional)</label><input type="text" class="input" id="mf-tag" value="' + escapeHtml(h.tag || '') + '" placeholder="reading"></div>' +
            '</div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Target unit (optional)</label><input type="text" class="input" id="mf-target-unit" value="' + escapeHtml(h.target_unit || '') + '" placeholder="pages"></div>' +
              '<div class="modal-field"><label>Target amount</label><input type="number" class="input" id="mf-target-amount" value="' + escapeHtml(h.target_amount != null ? h.target_amount : '') + '" placeholder="30"></div>' +
            '</div>' +
            '<div class="modal-field"><label>Cue <span class="fw-rule">— make it obvious</span></label><textarea class="input notes-area" id="mf-cue">' + escapeHtml(h.cue || '') + '</textarea></div>' +
            '<div class="modal-field"><label>Craving <span class="fw-rule">— make it attractive</span></label><textarea class="input notes-area" id="mf-craving">' + escapeHtml(h.craving || '') + '</textarea></div>' +
            '<div class="modal-field"><label>Response <span class="fw-rule">— make it easy</span></label><textarea class="input notes-area" id="mf-response">' + escapeHtml(h.response || '') + '</textarea></div>' +
            '<div class="modal-field"><label>Reward <span class="fw-rule">— make it satisfying</span></label><textarea class="input notes-area" id="mf-reward">' + escapeHtml(h.reward || '') + '</textarea></div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Habit stacking (comes before this)</label><input type="text" class="input" id="mf-stack" value="' + escapeHtml(h.stack_before || '') + '" placeholder="Make coffee"></div>' +
              '<div class="modal-field"><label>Environment</label><input type="text" class="input" id="mf-environment" value="' + escapeHtml(h.environment || '') + '" placeholder="Book on the table"></div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-actions"><button class="btn secondary" data-act="modal-cancel">Cancel</button><div class="spacer"></div><button class="btn accent" data-act="modal-save">' + (isNew ? 'Create' : 'Save') + '</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderLogModal() {
    var h = findHabit(modalLog.habit_id);
    if (!h) { modalMode = null; modalLog = null; return ''; }
    var stateBtns = STATES.map(function (s) {
      return '<button type="button" data-act="pick-log-state" data-state="' + s + '" class="' + (modalLog.state === s ? 'active' : '') + '">' + s + '</button>';
    }).join('');
    var valueField = h.target
      ? '<div class="modal-field"><label>Value (' + escapeHtml(h.target.unit) + ')</label><input type="number" class="input" id="mf-value" value="' + (modalLog.value != null ? modalLog.value : '') + '"></div>'
      : '';
    return (
      '<div class="modal-overlay" id="habits-modal">' +
        '<div class="modal">' +
          '<div class="modal-head"><span class="modal-title">Log · ' + escapeHtml(h.name) + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-readonly">' + modalLog.date + '</div>' +
            '<div class="modal-field"><label>State</label><div class="pill-segment">' + stateBtns + '</div></div>' +
            valueField +
            '<div class="modal-field"><label>Note</label><textarea class="input notes-area" id="mf-note">' + escapeHtml(modalLog.note || '') + '</textarea></div>' +
          '</div>' +
          '<div class="modal-actions"><button class="btn secondary" data-act="modal-cancel">Cancel</button><div class="spacer"></div><button class="btn accent" data-act="modal-save-log">Save log</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- render dispatch

  function render() {
    var todayISO = fmt.todayISO();
    var counts = viewCounts();

    container.innerHTML =
      '<div class="page-head-row"><div class="inner">' +
        '<h1 class="page-title">Habits &mdash; <span class="em">' + escapeHtml(VIEWS.find(function (v) { return v.key === currentView; }).label) + '</span></h1>' +
        '<span class="page-sub">' + escapeHtml(pageSub(todayISO)) + '</span>' +
        '<div class="page-actions">' +
          '<button class="btn-mini">Filter</button>' +
          '<button class="btn-mini primary" id="btn-new-habit">New habit</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="view-tabs-row"><div class="view-tabs-inner">' +
        VIEWS.map(function (v) {
          var count = counts[v.key];
          return '<span class="vtab' + (v.key === currentView ? ' active' : '') + '" data-view="' + v.key + '">' + v.label + (count != null ? ' <span class="vcount">' + count + '</span>' : '') + '</span>';
        }).join('') +
      '</div></div>' +
      renderMetrics(todayISO) +
      renderPhilosophy() +
      renderViewBody(todayISO) +
      '<div class="kbd-hints">' +
        '<span class="khint"><span class="kbd">N</span><span class="klbl">new habit</span></span>' +
        '<span class="khint"><span class="kbd">J</span><span class="kbd">K</span><span class="klbl">navigate</span></span>' +
        '<span class="khint"><span class="kbd">L</span><span class="klbl">log habit</span></span>' +
        '<span class="khint"><span class="kbd">D</span><span class="klbl">done</span></span>' +
        '<span class="khint"><span class="kbd">P</span><span class="klbl">partial</span></span>' +
        '<span class="khint"><span class="kbd">S</span><span class="klbl">skip</span></span>' +
        '<span class="khint"><span class="kbd">↵</span><span class="klbl">open</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">E</span><span class="klbl">edit</span></span>' +
        '<span class="khint"><span class="kbd">?</span><span class="klbl">all shortcuts</span></span>' +
      '</div>' +
      renderModal();

    if (modalMode === 'habit') { var n = document.getElementById('mf-name'); if (n) n.focus(); }
  }

  // ---------------------------------------------------------------- modal actions

  function openNewHabitModal() {
    modalMode = 'habit';
    modalHabit = {
      _isNew: true, name: '', identity: '', cadence: 'daily', cadence_n: 3,
      category_label: '', category_color: 'teal', target_unit: '', target_amount: '',
      cue: '', craving: '', response: '', reward: '', stack_before: '', environment: '', tag: '',
      status: 'active', created_at: new Date().toISOString()
    };
    render();
  }

  function openEditHabitModal(h) {
    if (!h) return;
    modalMode = 'habit';
    modalHabit = JSON.parse(JSON.stringify(h));
    modalHabit._isNew = false;
    modalHabit.target_unit = h.target ? h.target.unit : '';
    modalHabit.target_amount = h.target ? h.target.amount : '';
    render();
  }

  function openLogModal(h) {
    if (!h) return;
    var todayISO = fmt.todayISO();
    var existing = hlib.findLog(cache.habitLogs, h.id, todayISO);
    modalMode = 'log';
    modalLog = existing ? JSON.parse(JSON.stringify(existing)) : { habit_id: h.id, date: todayISO, state: 'done', value: h.target ? h.target.amount : null, note: '' };
    render();
  }

  function closeModal() { modalMode = null; modalHabit = null; modalLog = null; render(); }

  function saveHabitModal() {
    var name = (document.getElementById('mf-name').value || '').trim();
    if (!name) return; // name is the one required field
    var cadence = document.getElementById('mf-cadence').value;
    var targetUnit = (document.getElementById('mf-target-unit').value || '').trim();
    var targetAmountRaw = document.getElementById('mf-target-amount').value;
    var target = (targetUnit && targetAmountRaw !== '') ? { unit: targetUnit, amount: +targetAmountRaw } : null;
    var fields = {
      name: name,
      identity: document.getElementById('mf-identity').value,
      cadence: cadence,
      cadence_n: cadence === 'n_per_week' ? +document.getElementById('mf-cadence-n').value : null,
      category_label: document.getElementById('mf-category-label').value,
      category_color: document.getElementById('mf-category-color').value,
      target: target,
      tag: Console.lib.normalizeTag(document.getElementById('mf-tag').value) || null,
      cue: document.getElementById('mf-cue').value,
      craving: document.getElementById('mf-craving').value,
      response: document.getElementById('mf-response').value,
      reward: document.getElementById('mf-reward').value,
      stack_before: document.getElementById('mf-stack').value,
      environment: document.getElementById('mf-environment').value
    };

    if (modalHabit._isNew) {
      var habit = fields;
      habit.id = db.uuid();
      habit.status = 'active';
      habit.created_at = modalHabit.created_at;
      db.put('habits', habit).then(function () {
        selectedId = habit.id;
        modalMode = null; modalHabit = null;
        refreshAndRender();
      });
    } else {
      var existing = findHabit(modalHabit.id);
      if (!existing) { closeModal(); return; }
      Object.keys(fields).forEach(function (k) { existing[k] = fields[k]; });
      db.put('habits', existing).then(function () {
        modalMode = null; modalHabit = null;
        refreshAndRender();
      });
    }
  }

  function saveLogModal() {
    var h = findHabit(modalLog.habit_id);
    if (!h) { closeModal(); return; }
    var valueEl = document.getElementById('mf-value');
    var noteEl = document.getElementById('mf-note');
    var patch = {
      state: modalLog.state,
      value: valueEl ? (valueEl.value === '' ? null : +valueEl.value) : null,
      note: noteEl ? noteEl.value : ''
    };
    upsertLog(modalLog.habit_id, modalLog.date, patch).then(function () {
      modalMode = null; modalLog = null;
      refreshAndRender();
    });
  }

  // ---------------------------------------------------------------- quick actions

  function quickSetState(habitId, state) {
    var h = findHabit(habitId);
    if (!h) return;
    var todayISO = fmt.todayISO();
    var existing = hlib.findLog(cache.habitLogs, habitId, todayISO);
    var value = existing && existing.value != null ? existing.value : null;
    if (value == null && h.target) {
      value = state === 'done' ? h.target.amount : state === 'partial' ? Math.round(h.target.amount / 2) : null;
    }
    upsertLog(habitId, todayISO, { state: state, value: value, note: existing ? existing.note : '' }).then(refreshAndRender);
  }

  function archiveHabit(id, archived) {
    var h = findHabit(id);
    if (!h) return;
    h.status = archived ? 'archived' : 'active';
    db.put('habits', h).then(function () {
      if (selectedId === id) selectedId = null;
      refreshAndRender();
    });
  }

  // ---------------------------------------------------------------- events

  function onContainerClick(e) {
    var vtab = e.target.closest('.vtab');
    if (vtab) { currentView = vtab.dataset.view; selectedId = null; render(); return; }

    var newBtn = e.target.closest('#btn-new-habit');
    if (newBtn) { openNewHabitModal(); return; }

    var quick = e.target.closest('[data-act="quick-log"]');
    if (quick) { quickSetState(quick.dataset.id, quick.dataset.state); return; }

    var pickLogState = e.target.closest('[data-act="pick-log-state"]');
    if (pickLogState) { modalLog.state = pickLogState.dataset.state; render(); return; }

    var logToday = e.target.closest('[data-act="log-today"]');
    if (logToday) { openLogModal(findHabit(logToday.dataset.id)); return; }

    var editHabit = e.target.closest('[data-act="edit-habit"]');
    if (editHabit) { openEditHabitModal(findHabit(editHabit.dataset.id)); return; }

    var viewHistory = e.target.closest('[data-act="view-history"]');
    if (viewHistory) {
      var pane = document.getElementById('habit-detail');
      var hist = pane && pane.querySelector('.log-history');
      if (hist) hist.scrollIntoView({ block: 'nearest' });
      return;
    }

    var archiveBtn = e.target.closest('[data-act="archive-habit"]');
    if (archiveBtn) { archiveHabit(archiveBtn.dataset.id, true); return; }

    var reactivateBtn = e.target.closest('[data-act="reactivate-habit"]');
    if (reactivateBtn) { archiveHabit(reactivateBtn.dataset.id, false); return; }

    if (e.target.closest('[data-act="modal-cancel"]')) { closeModal(); return; }
    if (e.target.closest('[data-act="modal-save"]')) { saveHabitModal(); return; }
    if (e.target.closest('[data-act="modal-save-log"]')) { saveLogModal(); return; }
    if (e.target.id === 'habits-modal') { closeModal(); return; } // backdrop click closes

    var card = e.target.closest('.habit-card, .habit-row, .cd-link, .list-row.habit');
    if (card && card.dataset.id && !e.target.closest('[data-act]')) { selectedId = card.dataset.id; render(); }
  }

  // ---------------------------------------------------------------- keyboard

  function onKeydown(e) {
    if (modalMode) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return; // modal owns input while open
    }
    var overlay = document.getElementById('cmd-overlay');
    if (overlay && !overlay.hidden) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

    var key = e.key.toLowerCase();
    if (key === 'n') { e.preventDefault(); openNewHabitModal(); return; }
    if (key === 'j' || key === 'k') {
      e.preventDefault();
      if (!visibleOrder.length) return;
      var idx = visibleOrder.indexOf(selectedId);
      if (idx === -1) idx = key === 'j' ? -1 : 0;
      idx = key === 'j' ? Math.min(visibleOrder.length - 1, idx + 1) : Math.max(0, idx - 1);
      selectedId = visibleOrder[idx];
      render();
      return;
    }
    if (key === 'l' && selectedId) { e.preventDefault(); openLogModal(findHabit(selectedId)); return; }
    if ((key === 'd' || key === 'p' || key === 's') && selectedId) {
      e.preventDefault();
      quickSetState(selectedId, key === 'd' ? 'done' : key === 'p' ? 'partial' : 'skip');
      return;
    }
    if (key === 'enter' && selectedId) { e.preventDefault(); if (currentView !== 'all') { currentView = 'all'; } render(); return; }
    if (key === 'e' && (e.metaKey || e.ctrlKey) && selectedId) { e.preventDefault(); openEditHabitModal(findHabit(selectedId)); }
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([
      db.getAll('habits'), db.getAll('habit_logs'), db.getAll('tasks'), db.getAll('focus_sessions'),
      db.getAll('projects')
    ]).then(function (results) {
      cache.habits = results[0];
      cache.habitLogs = results[1];
      cache.projects = results[4];
      cache.tasks = results[2];
      cache.focusSessions = results[3];
      render();
    });
  }

  Console.modules.habits = {
    layout: 'flush', // Tasks/Schedule set this too
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      hlib = Console.lib.habits;
      db = Console.db;
      currentView = 'all';
      selectedId = null;
      modalMode = null; modalHabit = null; modalLog = null;
      container.addEventListener('click', onContainerClick);
      keydownHandler = onKeydown;
      document.addEventListener('keydown', keydownHandler);
      refreshAndRender();
      refreshHandle = setInterval(refreshAndRender, 5 * 60 * 1000);
    },
    destroy: function () {
      if (container) container.removeEventListener('click', onContainerClick);
      if (keydownHandler) { document.removeEventListener('keydown', keydownHandler); keydownHandler = null; }
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
      container = null;
    }
  };
})();
