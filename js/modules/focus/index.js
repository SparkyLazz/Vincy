/* Console — modules/focus. Phase 6: Pomodoro/Freeform/Stopwatch-with-target timers, triggered from
   a task/event/habit or standalone, with a floating cross-screen indicator (wired in js/app.js, not
   here) and soft-strict mode. No prototype exists for Focus — every view here is built fresh from
   already-proven atomic components, same precedent Phase 3/5 used for their own new layouts. See
   docs/phase_prompts/phase_6_focus.md for the full design-decision log (layout choice, session-type
   taxonomy reuse, denormalized trigger_label, soft-strict as a body class, why no cross-module
   "start focus" buttons except Today's suggested-focus card).

   No `layout: 'flush'` here — same call Phase 5 made for Finance: none of Focus's 3 views are a
   natural list+detail split, so this renders inside .content/.content-inner like Today/Finance do. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;
  var keydownHandler = null;
  var refreshHandle = null;
  var tickHandle = null;

  // Session `type` reuses Schedule's exact 8-type taxonomy verbatim (phase_6_focus.md Design
  // Decision #2) — duplicated here rather than extracted into a shared lib, since Schedule's
  // TYPES/TYPE_LABEL are module-private (not exposed on Console.modules.schedule) and this is a
  // short, locked, rarely-changing list ("strict event typing... no free text" per
  // Console_Features_List.md's locked decisions). If a third module ever needs the same list,
  // extract to js/lib then — same "don't extract until it's really shared" discipline the project
  // already applies elsewhere, just deferred one module later than the strict "2 consumers" rule
  // would suggest, because touching Schedule's already-browser-verified module for this alone
  // isn't worth the re-verification risk.
  var TYPES = ['deep_work', 'meeting', 'admin', 'exercise', 'break', 'social', 'errand', 'sleep'];
  var TYPE_LABEL = {
    deep_work: 'deep work', meeting: 'meeting', admin: 'admin', exercise: 'exercise',
    break: 'break', social: 'social', errand: 'errand', sleep: 'sleep'
  };

  var MODES = [
    { key: 'pomodoro', label: 'pomodoro' },
    { key: 'freeform', label: 'freeform' },
    { key: 'stopwatch', label: 'stopwatch' }
  ];
  var KINDS = [
    { key: 'task', label: 'task' },
    { key: 'event', label: 'event' },
    { key: 'habit', label: 'habit' },
    { key: 'standalone', label: 'standalone' }
  ];

  var VIEWS = [
    { key: 'timer', label: 'timer' },
    { key: 'log', label: 'log' },
    { key: 'summary', label: 'summary' }
  ];

  var currentView = 'timer';
  var selectedId = null;
  var visibleOrder = [];

  // Draft config for the NOT-YET-STARTED session — only meaningful while idle. Baked into a real
  // focus_sessions row the moment Start is pressed.
  var draft = { mode: 'pomodoro', triggerKind: 'standalone', triggerId: '', type: 'deep_work', targetMin: 25, strict: false };

  var modalMode = null; // null | 'edit'
  var modalSession = null;

  var cache = { sessions: [], tasks: [], events: [], habits: [] };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function findSession(id) { return cache.sessions.find(function (s) { return s.id === id; }); }
  function findActiveSession() { return cache.sessions.find(function (s) { return !s.end_at; }); }

  function kindLabel(k) { return { task: 'Task', event: 'Event', habit: 'Habit', standalone: 'Standalone' }[k] || k; }

  function msToClock(ms) {
    ms = Math.max(0, ms || 0);
    var totalSec = Math.floor(ms / 1000);
    var h = Math.floor(totalSec / 3600);
    var m = Math.floor((totalSec % 3600) / 60);
    var s = totalSec % 60;
    if (h > 0) return h + ':' + pad2(m) + ':' + pad2(s);
    return pad2(m) + ':' + pad2(s);
  }

  function formatDuration(min) {
    min = Math.round(min || 0);
    if (min < 60) return min + 'm';
    var h = Math.floor(min / 60), m = min % 60;
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }

  // Elapsed time for a session, freezing while paused (phase_6_focus.md Design Decision #3's
  // paused_at/paused_ms accumulation model) — shared by the live clock, the Log view's in-progress
  // row, and the Summary view's "today" total for an active session.
  function computeElapsedMs(s, nowMs) {
    var startMs = new Date(s.start_at).getTime();
    var pausedMs = s.paused_ms || 0;
    if (s.paused_at) return (new Date(s.paused_at).getTime() - startMs) - pausedMs;
    return (nowMs - startMs) - pausedMs;
  }

  function sessionMinutes(s, nowMs) {
    return s.end_at ? (s.duration_min || 0) : computeElapsedMs(s, nowMs) / 60000;
  }

  function resolveTriggerLabel(kind, id) {
    if (kind === 'task') { var t = cache.tasks.find(function (x) { return x.id === id; }); return t ? (t.title || null) : null; }
    if (kind === 'event') { var e = cache.events.find(function (x) { return x.id === id; }); return e ? (e.title || null) : null; }
    if (kind === 'habit') { var h = cache.habits.find(function (x) { return x.id === id; }); return h ? (h.name || null) : null; }
    return null;
  }

  function triggerOptionsFor(kind, selectedTriggerId) {
    if (kind === 'task') {
      var openTasks = cache.tasks.filter(function (t) { return t.status !== 'done'; });
      return openTasks.length
        ? openTasks.map(function (t) { return '<option value="' + t.id + '"' + (t.id === selectedTriggerId ? ' selected' : '') + '>' + escapeHtml(t.title || 'Untitled') + '</option>'; }).join('')
        : '<option value="">No open tasks</option>';
    }
    if (kind === 'event') {
      var todayISO = fmt.todayISO();
      var upcoming = cache.events.filter(function (e) { return e.start_date >= todayISO; }).sort(function (a, b) { return (a.start_date + a.start_time).localeCompare(b.start_date + b.start_time); });
      return upcoming.length
        ? upcoming.map(function (e) { return '<option value="' + e.id + '"' + (e.id === selectedTriggerId ? ' selected' : '') + '>' + escapeHtml(e.title || 'Untitled') + ' · ' + e.start_date + '</option>'; }).join('')
        : '<option value="">No upcoming events</option>';
    }
    if (kind === 'habit') {
      var active = cache.habits.filter(function (h) { return h.status === 'active'; });
      return active.length
        ? active.map(function (h) { return '<option value="' + h.id + '"' + (h.id === selectedTriggerId ? ' selected' : '') + '>' + escapeHtml(h.name || 'Untitled') + '</option>'; }).join('')
        : '<option value="">No active habits</option>';
    }
    return '';
  }

  // ---------------------------------------------------------------- pending trigger (Today's
  // suggested-focus card deep link, phase_6_focus.md Design Decision #6 — router.js's parseHash
  // already ignores sub-segments beyond the first, so #/focus/task/<id> routes here untouched;
  // this module reads the extra segments itself.)

  function checkPendingTrigger() {
    var parts = (location.hash || '').replace(/^#\/?/, '').split('/');
    if (parts[0] !== 'focus' || parts.length < 3) return false;
    var kind = parts[1], id = parts[2];
    if (KINDS.indexOf(kind) === -1 || kind === 'standalone') return false;
    var label = resolveTriggerLabel(kind, id);
    if (label == null) return false; // stale/unknown id — don't silently pre-fill garbage
    draft.triggerKind = kind;
    draft.triggerId = id;
    history.replaceState(null, '', '#/focus'); // clean the hash so a reload doesn't re-trigger
    return true;
  }

  // ---------------------------------------------------------------- rendering: shell rows

  function renderPageHead() {
    var todayISO = fmt.todayISO();
    var todaySessions = cache.sessions.filter(function (s) { return (s.start_at || '').slice(0, 10) === todayISO; });
    var todayMin = todaySessions.reduce(function (sum, s) { return sum + sessionMinutes(s, Date.now()); }, 0);
    return (
      '<div class="page-head">' +
        '<h1 class="page-title">Focus</h1>' +
        '<span class="page-sub">' + todaySessions.length + ' session' + (todaySessions.length === 1 ? '' : 's') + ' today · ' + formatDuration(todayMin) + ' logged</span>' +
      '</div>'
    );
  }

  function renderViewTabs() {
    var counts = { timer: null, log: cache.sessions.length, summary: null };
    return (
      '<div class="view-tabs">' +
        VIEWS.map(function (v) {
          var count = counts[v.key];
          return '<span class="vtab' + (v.key === currentView ? ' active' : '') + '" data-view="' + v.key + '">' + v.label + (count != null ? ' <span class="vcount">' + count + '</span>' : '') + '</span>';
        }).join('') +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: timer view

  function emptyState(title, sub) {
    return (
      '<div class="empty">' +
        '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2M9 2h6"/></svg></div>' +
        '<div class="empty-title">' + title + '</div>' +
        '<div class="empty-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function renderIdleTimer() {
    var modeBtns = MODES.map(function (m) { return '<button type="button" data-act="pick-mode" data-mode="' + m.key + '" class="' + (draft.mode === m.key ? 'active' : '') + '">' + m.label + '</button>'; }).join('');
    var kindBtns = KINDS.map(function (k) { return '<button type="button" data-act="pick-kind" data-kind="' + k.key + '" class="' + (draft.triggerKind === k.key ? 'active' : '') + '">' + k.label + '</button>'; }).join('');
    var typeOptions = TYPES.map(function (t) { return '<option value="' + t + '"' + (draft.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>'; }).join('');
    var triggerField = draft.triggerKind !== 'standalone'
      ? '<div class="modal-field"><label>' + kindLabel(draft.triggerKind) + '</label><select class="input" id="ft-trigger">' + triggerOptionsFor(draft.triggerKind, draft.triggerId) + '</select></div>'
      : '';
    var typeField = '<div class="modal-field"><label>Session type</label><select class="input" id="ft-type">' + typeOptions + '</select></div>';
    var targetField = draft.mode !== 'freeform'
      ? '<div class="modal-field"><label>Target minutes</label><input type="number" min="1" class="input" id="ft-target" value="' + draft.targetMin + '"></div>'
      : '';
    var configMiddle = targetField
      ? '<div class="ft-config-row">' + typeField + targetField + '</div>'
      : typeField;
    return (
      '<div class="ft-clock">--:--</div>' +
      '<div class="ft-sub">idle · choose a mode and hit start</div>' +
      '<div class="ft-config">' +
        '<div class="modal-field"><label>Mode</label><div class="pill-segment">' + modeBtns + '</div></div>' +
        '<div class="modal-field"><label>Trigger</label><div class="pill-segment">' + kindBtns + '</div></div>' +
        triggerField +
        configMiddle +
        '<label class="modal-exc-picker"><input type="checkbox" id="ft-strict"' + (draft.strict ? ' checked' : '') + '> Soft strict mode — dims other UI while active, navigation still allowed</label>' +
      '</div>' +
      '<div class="ft-controls"><button class="btn accent lg" data-act="start-session">Start</button></div>'
    );
  }

  function renderActiveTimer(active) {
    var elapsedMs = computeElapsedMs(active, Date.now());
    var targetMs = (active.target_min || 0) * 60000;
    var overtime = targetMs > 0 && elapsedMs >= targetMs;
    var clockCls = 'ft-clock active' + (overtime ? ' overtime' : '');
    var subParts = [active.mode, TYPE_LABEL[active.type], active.trigger_label ? escapeHtml(active.trigger_label) : 'standalone'];
    if (active.target_min) subParts.push('target ' + active.target_min + 'm');
    if (active.paused_at) subParts.push('paused');
    var pauseBtn = active.paused_at
      ? '<button class="btn secondary lg" data-act="resume-session">Resume</button>'
      : '<button class="btn secondary lg" data-act="pause-session">Pause</button>';
    return (
      '<div class="' + clockCls + '" id="ft-live-clock">' + msToClock(elapsedMs) + '</div>' +
      '<div class="ft-sub" id="ft-live-sub">' + subParts.join(' · ') + '</div>' +
      '<div class="ft-controls">' + pauseBtn + '<button class="btn danger lg" data-act="end-session">End</button></div>'
    );
  }

  function renderFocusRow(s) {
    var start = new Date(s.start_at);
    var end = s.end_at ? new Date(s.end_at) : null;
    var timeRange = fmt.timeHM(start) + '–' + (end ? fmt.timeHM(end) : 'now');
    var durLabel = formatDuration(sessionMinutes(s, Date.now()));
    var triggerLbl = s.trigger_label ? escapeHtml(s.trigger_label) : 'standalone';
    return (
      '<div class="list-row focus' + (s.id === selectedId ? ' selected' : '') + '" data-id="' + s.id + '">' +
        '<div class="ft-time-range">' + timeRange + '</div>' +
        '<div><span class="type-dot ' + s.type + '"></span>' + TYPE_LABEL[s.type] + '<div class="ft-row-meta">' + s.mode + (s.end_at ? '' : ' · active') + '</div></div>' +
        '<span class="pill neutral ft-trigger">' + triggerLbl + '</span>' +
        '<div class="num-mono">' + durLabel + '</div>' +
      '</div>'
    );
  }

  function renderTimerView() {
    var active = findActiveSession();
    var body = active ? renderActiveTimer(active) : renderIdleTimer();
    var todayISO = fmt.todayISO();
    var todaySessions = cache.sessions.filter(function (s) { return (s.start_at || '').slice(0, 10) === todayISO; })
      .sort(function (a, b) { return b.start_at.localeCompare(a.start_at); });
    var miniList = todaySessions.length
      ? todaySessions.map(renderFocusRow).join('')
      : emptyState('No sessions yet today', 'Start one above.');
    return (
      '<div class="focus-timer-panel">' + body + '</div>' +
      '<div class="pane"><div class="pane-head"><span class="pane-title">Today’s sessions</span><span class="pane-meta">' + todaySessions.length + '</span></div>' +
        '<div class="pane-body">' + miniList + '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: log view

  function renderLogView() {
    var sessions = cache.sessions.slice().sort(function (a, b) { return b.start_at.localeCompare(a.start_at); });
    visibleOrder = sessions.map(function (s) { return s.id; });
    var body;
    if (!sessions.length) {
      body = emptyState('No sessions logged yet', 'Start your first one from the Timer tab.');
    } else {
      var byDate = {};
      var order = [];
      sessions.forEach(function (s) {
        var d = (s.start_at || '').slice(0, 10);
        if (!byDate[d]) { byDate[d] = []; order.push(d); }
        byDate[d].push(s);
      });
      body = order.map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        var label = iso === fmt.todayISO() ? 'today' : (fmt.longWeekday(d) + ' · ' + fmt.monthDay(d));
        return '<div class="agenda-date-label">' + escapeHtml(label) + '</div>' + byDate[iso].map(renderFocusRow).join('');
      }).join('');
    }
    return (
      '<div class="pane"><div class="pane-head"><span class="pane-title">Session log</span><span class="pane-meta">' + sessions.length + ' total</span></div>' +
        '<div class="pane-body">' + body + '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: summary view
  // Real numbers only, no scoring model — Analytics'/Insights' job per phase_6_focus.md exclusions.

  function renderSummaryView() {
    var todayISO = fmt.todayISO();
    var week = fmt.weekOf(new Date());
    var weekStartISO = fmt.isoDate(week[0]), weekEndISO = fmt.isoDate(week[6]);
    var now = Date.now();

    var todaySessions = cache.sessions.filter(function (s) { return (s.start_at || '').slice(0, 10) === todayISO; });
    var weekSessions = cache.sessions.filter(function (s) {
      var d = (s.start_at || '').slice(0, 10);
      return d >= weekStartISO && d <= weekEndISO;
    });
    var todayMin = todaySessions.reduce(function (sum, s) { return sum + sessionMinutes(s, now); }, 0);
    var weekMin = weekSessions.reduce(function (sum, s) { return sum + sessionMinutes(s, now); }, 0);

    var byType = TYPES.map(function (t) {
      var min = weekSessions.filter(function (s) { return s.type === t; }).reduce(function (sum, s) { return sum + sessionMinutes(s, now); }, 0);
      return { type: t, min: min };
    }).filter(function (x) { return x.min > 0; }).sort(function (a, b) { return b.min - a.min; });

    var byTrigger = KINDS.map(function (k) {
      var count = weekSessions.filter(function (s) {
        if (k.key === 'task') return !!s.task_id;
        if (k.key === 'event') return !!s.event_id;
        if (k.key === 'habit') return !!s.habit_id;
        return !s.task_id && !s.event_id && !s.habit_id;
      }).length;
      return { kind: k.key, count: count };
    });

    var typeRows = byType.length
      ? byType.map(function (x) { return '<div class="breakdown-row"><span><span class="type-dot ' + x.type + '"></span> ' + TYPE_LABEL[x.type] + '</span><span class="br-val">' + formatDuration(x.min) + '</span></div>'; }).join('')
      // CODE-VERIFY FIX: bare `.empty-sub` has no styling of its own — components.css scopes it as
      // `.empty .empty-sub` (italic/color only apply with the `.empty` ancestor present). Wrapping
      // it reuses the existing rule instead of adding a fourth "empty-ish text" component.
      : '<div class="empty"><div class="empty-sub">No sessions logged this week.</div></div>';

    var triggerRows = byTrigger.map(function (x) {
      return '<div class="breakdown-row"><span>' + kindLabel(x.kind) + '</span><span class="br-val">' + x.count + '</span></div>';
    }).join('');

    // CODE-VERIFY FIX: originally used invented `.metric`/`.mnum`/`.mlbl` classes with no CSS
    // definitions anywhere in the app (would've rendered as unstyled text). Reused `.hstat`
    // (Today's dashboard stat-tile — .num/.lbl-row .lbl, components.css line ~429) instead of
    // adding a third near-duplicate stat-tile component, same discipline as every other phase's
    // "reuse before inventing" rule.
    return (
      '<div class="pane"><div class="pane-head"><span class="pane-title">Totals</span></div>' +
        '<div class="pane-body"><div class="session-summary-grid">' +
          '<div class="hstat"><div class="num">' + formatDuration(todayMin) + '</div><div class="lbl-row"><span class="lbl">today</span></div></div>' +
          '<div class="hstat"><div class="num">' + formatDuration(weekMin) + '</div><div class="lbl-row"><span class="lbl">this week</span></div></div>' +
        '</div></div>' +
      '</div>' +
      '<div class="pane"><div class="pane-head"><span class="pane-title">By type</span><span class="pane-meta">this week</span></div>' +
        '<div class="pane-body"><div class="breakdown-list">' + typeRows + '</div></div>' +
      '</div>' +
      '<div class="pane"><div class="pane-head"><span class="pane-title">By trigger</span><span class="pane-meta">this week</span></div>' +
        '<div class="pane-body"><div class="breakdown-list">' + triggerRows + '</div></div>' +
      '</div>'
    );
  }

  function renderViewBody() {
    if (currentView === 'timer') return renderTimerView();
    if (currentView === 'log') return renderLogView();
    if (currentView === 'summary') return renderSummaryView();
    return '';
  }

  // ---------------------------------------------------------------- rendering: edit modal
  // Only type/trigger/notes are editable — start/end/duration are historical facts, matching the
  // "don't let the log rewrite what actually happened" spirit of Schedule's planned-vs-actual log.

  function renderModal() {
    if (modalMode !== 'edit' || !modalSession) return '<div class="modal-overlay" id="focus-modal" hidden></div>';
    var s = modalSession;
    var typeOptions = TYPES.map(function (t) { return '<option value="' + t + '"' + (t === s.type ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>'; }).join('');
    var kindBtns = KINDS.map(function (k) { return '<button type="button" data-act="modal-pick-kind" data-kind="' + k.key + '" class="' + (s._kind === k.key ? 'active' : '') + '">' + k.label + '</button>'; }).join('');
    var triggerField = s._kind !== 'standalone'
      ? '<div class="modal-field"><label>' + kindLabel(s._kind) + '</label><select class="input" id="mf-trigger">' + triggerOptionsFor(s._kind, s._triggerId) + '</select></div>'
      : '';
    var timeRange = fmt.timeHM(new Date(s.start_at)) + (s.end_at ? '–' + fmt.timeHM(new Date(s.end_at)) : ' (active)');
    return (
      '<div class="modal-overlay" id="focus-modal">' +
        '<div class="modal">' +
          '<div class="modal-head"><span class="modal-title">Edit session</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-readonly">' + fmt.monthDay(new Date(s.start_at)) + ' · ' + timeRange + ' · ' + formatDuration(sessionMinutes(s, Date.now())) + '</div>' +
            '<div class="modal-field"><label>Type</label><select class="input" id="mf-type">' + typeOptions + '</select></div>' +
            '<div class="modal-field"><label>Trigger</label><div class="pill-segment">' + kindBtns + '</div></div>' +
            triggerField +
            '<div class="modal-field"><label>Notes</label><textarea class="input notes-area" id="mf-notes">' + escapeHtml(s.notes || '') + '</textarea></div>' +
          '</div>' +
          '<div class="modal-actions"><button class="btn danger" data-act="modal-delete-session">Delete</button><div class="spacer"></div><button class="btn secondary" data-act="modal-cancel">Cancel</button><button class="btn accent" data-act="modal-save-session">Save</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- render dispatch

  function render() {
    container.innerHTML =
      renderPageHead() +
      renderViewTabs() +
      renderViewBody() +
      '<div class="kbd-hints">' +
        '<span class="khint"><span class="kbd">S</span><span class="klbl">start</span></span>' +
        '<span class="khint"><span class="kbd">P</span><span class="klbl">pause/resume</span></span>' +
        '<span class="khint"><span class="kbd">X</span><span class="klbl">end</span></span>' +
        '<span class="khint"><span class="kbd">J</span><span class="kbd">K</span><span class="klbl">navigate</span></span>' +
        '<span class="khint"><span class="kbd">↵</span><span class="klbl">edit</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">E</span><span class="klbl">edit</span></span>' +
      '</div>' +
      renderModal();
  }

  // ---------------------------------------------------------------- soft-strict body class
  // (phase_6_focus.md Design Decision #5). Set/cleared here immediately for on-screen feedback;
  // js/app.js's floating-timer refresh also re-applies/clears it from DB state independently so it
  // survives navigation away from Focus or a full page reload mid-session.

  function setStrictBodyClass(on) {
    document.body.classList.toggle('focus-strict', !!on);
  }

  // ---------------------------------------------------------------- draft sync
  // Reads whatever's currently in the config-panel DOM back into `draft` before a structural
  // re-render (mode/kind switch) would otherwise regenerate those fields from stale draft values
  // and silently discard an in-progress edit the user hadn't "committed" yet.

  function syncDraftFromDom() {
    var typeEl = document.getElementById('ft-type');
    var targetEl = document.getElementById('ft-target');
    var strictEl = document.getElementById('ft-strict');
    var triggerEl = document.getElementById('ft-trigger');
    if (typeEl) draft.type = typeEl.value;
    if (targetEl && targetEl.value) draft.targetMin = +targetEl.value;
    if (strictEl) draft.strict = strictEl.checked;
    if (triggerEl) draft.triggerId = triggerEl.value;
  }

  // ---------------------------------------------------------------- session actions

  function startSession() {
    if (findActiveSession()) return; // one active session at a time — see brief's exclusions
    syncDraftFromDom();
    var triggerId = draft.triggerKind !== 'standalone' ? (draft.triggerId || null) : null;
    var label = resolveTriggerLabel(draft.triggerKind, triggerId);
    var targetMin = draft.mode !== 'freeform' ? (+draft.targetMin || null) : null;
    var session = {
      id: db.uuid(), start_at: new Date().toISOString(), end_at: null,
      mode: draft.mode, type: draft.type,
      task_id: draft.triggerKind === 'task' ? triggerId : null,
      event_id: draft.triggerKind === 'event' ? triggerId : null,
      habit_id: draft.triggerKind === 'habit' ? triggerId : null,
      trigger_label: label, target_min: targetMin,
      paused_at: null, paused_ms: 0, strict: draft.strict, duration_min: null, notes: ''
    };
    db.put('focus_sessions', session).then(function () {
      setStrictBodyClass(draft.strict);
      refreshAndRender();
    });
  }

  function pauseSession() {
    var active = findActiveSession();
    if (!active || active.paused_at) return;
    active.paused_at = new Date().toISOString();
    db.put('focus_sessions', active).then(refreshAndRender);
  }

  function resumeSession() {
    var active = findActiveSession();
    if (!active || !active.paused_at) return;
    var now = Date.now();
    active.paused_ms = (active.paused_ms || 0) + (now - new Date(active.paused_at).getTime());
    active.paused_at = null;
    db.put('focus_sessions', active).then(refreshAndRender);
  }

  function endSession() {
    var active = findActiveSession();
    if (!active) return;
    var now = Date.now();
    var finalPausedMs = (active.paused_ms || 0) + (active.paused_at ? (now - new Date(active.paused_at).getTime()) : 0);
    var durationMin = Math.max(0, ((now - new Date(active.start_at).getTime()) - finalPausedMs) / 60000);
    active.end_at = new Date(now).toISOString();
    active.paused_ms = finalPausedMs;
    active.paused_at = null;
    active.duration_min = durationMin;
    db.put('focus_sessions', active).then(function () {
      setStrictBodyClass(false);
      refreshAndRender();
    });
  }

  // ---------------------------------------------------------------- edit modal actions

  function openEditModal(s) {
    if (!s) return;
    modalMode = 'edit';
    modalSession = JSON.parse(JSON.stringify(s));
    modalSession._kind = s.task_id ? 'task' : s.event_id ? 'event' : s.habit_id ? 'habit' : 'standalone';
    modalSession._triggerId = s.task_id || s.event_id || s.habit_id || '';
    render();
  }

  function closeModal() { modalMode = null; modalSession = null; render(); }

  function saveEditSession() {
    var typeEl = document.getElementById('mf-type');
    var triggerEl = document.getElementById('mf-trigger');
    var notesEl = document.getElementById('mf-notes');
    var kind = modalSession._kind;
    var triggerId = kind !== 'standalone' && triggerEl ? (triggerEl.value || null) : null;
    var label = resolveTriggerLabel(kind, triggerId);
    var existing = findSession(modalSession.id);
    if (!existing) { closeModal(); return; }
    existing.type = typeEl.value;
    existing.task_id = kind === 'task' ? triggerId : null;
    existing.event_id = kind === 'event' ? triggerId : null;
    existing.habit_id = kind === 'habit' ? triggerId : null;
    existing.trigger_label = label;
    existing.notes = notesEl.value;
    db.put('focus_sessions', existing).then(function () { modalMode = null; modalSession = null; refreshAndRender(); });
  }

  function deleteEditSession() {
    if (!modalSession) return;
    var id = modalSession.id;
    var wasActive = !modalSession.end_at;
    modalMode = null; modalSession = null;
    db.remove('focus_sessions', id).then(function () {
      if (selectedId === id) selectedId = null;
      if (wasActive) setStrictBodyClass(false);
      refreshAndRender();
    });
  }

  // ---------------------------------------------------------------- events

  function onContainerClick(e) {
    var vtab = e.target.closest('.vtab');
    if (vtab) { currentView = vtab.dataset.view; selectedId = null; render(); return; }

    var pickMode = e.target.closest('[data-act="pick-mode"]');
    if (pickMode) { syncDraftFromDom(); draft.mode = pickMode.dataset.mode; render(); return; }

    var pickKind = e.target.closest('[data-act="pick-kind"]');
    if (pickKind) { syncDraftFromDom(); draft.triggerKind = pickKind.dataset.kind; draft.triggerId = ''; render(); return; }

    if (e.target.closest('[data-act="start-session"]')) { startSession(); return; }
    if (e.target.closest('[data-act="pause-session"]')) { pauseSession(); return; }
    if (e.target.closest('[data-act="resume-session"]')) { resumeSession(); return; }
    if (e.target.closest('[data-act="end-session"]')) { endSession(); return; }

    var modalPickKind = e.target.closest('[data-act="modal-pick-kind"]');
    if (modalPickKind) { modalSession._kind = modalPickKind.dataset.kind; modalSession._triggerId = ''; render(); return; }

    if (e.target.closest('[data-act="modal-cancel"]')) { closeModal(); return; }
    if (e.target.closest('[data-act="modal-save-session"]')) { saveEditSession(); return; }
    if (e.target.closest('[data-act="modal-delete-session"]')) { deleteEditSession(); return; }
    if (e.target.id === 'focus-modal') { closeModal(); return; }

    var row = e.target.closest('.list-row.focus');
    if (row && row.dataset.id) { selectedId = row.dataset.id; openEditModal(findSession(selectedId)); return; }
  }

  // ---------------------------------------------------------------- keyboard

  function onKeydown(e) {
    if (modalMode) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    var overlay = document.getElementById('cmd-overlay');
    if (overlay && !overlay.hidden) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

    var key = e.key.toLowerCase();
    var activeSession = findActiveSession();
    if (key === 's' && !activeSession) { e.preventDefault(); startSession(); return; }
    if (key === 'p' && activeSession) { e.preventDefault(); activeSession.paused_at ? resumeSession() : pauseSession(); return; }
    if (key === 'x' && activeSession) { e.preventDefault(); endSession(); return; }
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
    if ((key === 'enter' || (key === 'e' && (e.metaKey || e.ctrlKey))) && selectedId) {
      e.preventDefault();
      openEditModal(findSession(selectedId));
    }
  }

  // ---------------------------------------------------------------- live clock tick
  // Updates only the clock text/class every second rather than a full re-render, so the Timer
  // view doesn't flicker or lose focus/scroll position while a session is running.

  function updateLiveClock() {
    if (currentView !== 'timer' || modalMode) return;
    var active = findActiveSession();
    var el = document.getElementById('ft-live-clock');
    if (!active || !el) return;
    var elapsedMs = computeElapsedMs(active, Date.now());
    el.textContent = msToClock(elapsedMs);
    var targetMs = (active.target_min || 0) * 60000;
    el.classList.toggle('overtime', targetMs > 0 && elapsedMs >= targetMs);
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([
      db.getAll('focus_sessions'), db.getAll('tasks'), db.getAll('events'), db.getAll('habits')
    ]).then(function (results) {
      cache.sessions = results[0];
      cache.tasks = results[1];
      cache.events = results[2];
      cache.habits = results[3];
      render();
    });
  }

  Console.modules.focus = {
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      currentView = 'timer';
      selectedId = null;
      modalMode = null; modalSession = null;
      draft = { mode: 'pomodoro', triggerKind: 'standalone', triggerId: '', type: 'deep_work', targetMin: 25, strict: false };
      container.addEventListener('click', onContainerClick);
      keydownHandler = onKeydown;
      document.addEventListener('keydown', keydownHandler);
      refreshAndRender().then(function () {
        if (checkPendingTrigger()) render();
      });
      tickHandle = setInterval(updateLiveClock, 1000);
      refreshHandle = setInterval(refreshAndRender, 5 * 60 * 1000);
    },
    destroy: function () {
      if (container) container.removeEventListener('click', onContainerClick);
      if (keydownHandler) { document.removeEventListener('keydown', keydownHandler); keydownHandler = null; }
      if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
      container = null;
    }
  };
})();
