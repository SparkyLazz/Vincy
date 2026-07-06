/* Console — modules/settings. Phase 9: full 5-section rebuild, replacing the Phase-1 stub
   entirely (that stub only had Export/Import + an "not fully built yet" empty state). Built from
   a real prototype the user commissioned and uploaded ("Console Settings - Design Brief.html") —
   same extraction discipline as every other phase's real prototype. Full design-decision log in
   docs/phase_prompts/phase_9_settings.md — read that before touching this file.

   No `layout: 'flush'` — plain sections, not a list+detail split. Renders inside
   .content/.content-inner like Today/Finance/Focus/Analytics/Insights.

   Touches no new store — everything here reads/writes the generic `preferences` store (already
   exists) or reads the existing `backups` store / per-store counts. Preferences that get wired
   into live consumption elsewhere (default landing view, default task priority, default Focus
   mode/duration, Insights detector toggles) update the relevant `Console.*` boot-time global
   immediately, in addition to persisting — so a change takes effect this session, not just after
   reload. `week_start` is persisted and has a working control here but is NOT yet consumed by
   Schedule/Analytics — a deliberate, documented gap (phase_9_settings.md Decision #2), not a
   silent one. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var db = null;
  var container = null;

  var DETECTOR_DEFS = [
    { key: 'commitment', name: 'Commitment Overload' },
    { key: 'procrastination', name: 'Procrastination Rising' },
    { key: 'starving', name: 'Starving Project' },
    { key: 'estimate', name: 'Estimate Accuracy Drift' },
    { key: 'unscheduled', name: 'Unscheduled Obligation' },
    { key: 'subscription', name: 'Subscription Low Use' },
    { key: 'waiting', name: 'Stale Waiting Item' },
    { key: 'habit', name: 'Habit Consistency Drop' },
    { key: 'envelope', name: 'Envelope Overspend Pattern' },
    { key: 'misalignment', name: 'Productive Hour Misalignment' }
  ];

  var LANDING_VIEWS = [
    { key: 'today', label: 'Today' }, { key: 'tasks', label: 'Tasks' }, { key: 'schedule', label: 'Schedule' },
    { key: 'habits', label: 'Habits' }, { key: 'finance', label: 'Finance' }, { key: 'focus', label: 'Focus' }
  ];
  var FOCUS_MODES = [{ key: 'pomodoro', label: 'Pomodoro' }, { key: 'freeform', label: 'Freeform' }, { key: 'stopwatch', label: 'Stopwatch' }];
  var FOCUS_DURATIONS = [25, 50, 90];

  var STAT_STORES = [
    { store: 'tasks', label: 'Tasks' }, { store: 'projects', label: 'Projects' }, { store: 'events', label: 'Events' },
    { store: 'habits', label: 'Habits' }, { store: 'transactions', label: 'Transactions' },
    { store: 'focus_sessions', label: 'Focus sessions' }, { store: 'insights', label: 'Cached insights' }
  ];

  var SHORTCUT_GROUPS = [
    { name: 'Global', items: [{ key: '⌘K', label: 'command palette' }] },
    { name: 'Tasks', items: [{ key: 'N', label: 'new task' }, { key: 'J/K', label: 'navigate' }, { key: 'X', label: 'complete' }, { key: 'S', label: 'snooze' }, { key: 'T', label: 'today' }, { key: '⌘E', label: 'edit' }, { key: '⌘Z', label: 'undo' }] },
    { name: 'Schedule', items: [{ key: 'N', label: 'new event' }, { key: 'D/W/M', label: 'switch view' }, { key: 'J/K', label: 'navigate' }, { key: 'T', label: 'jump to today' }] },
    { name: 'Habits', items: [{ key: 'N', label: 'new habit' }, { key: 'J/K', label: 'navigate' }, { key: 'L', label: 'log' }, { key: 'D', label: 'mark done' }] },
    { name: 'Focus', items: [{ key: 'S', label: 'start' }, { key: 'P', label: 'pause/resume' }, { key: 'X', label: 'end' }, { key: 'J/K', label: 'navigate' }] },
    { name: 'Finance', items: [{ key: 'N', label: 'new transaction' }, { key: 'E', label: 'new envelope' }, { key: 'F', label: 'fund envelope' }, { key: 'J/K', label: 'navigate' }] }
  ];

  // ---------------------------------------------------------------- state

  var state = {
    theme: 'light', weekStart: 'mon', priority: 'med', focusMode: 'pomodoro', focusDuration: 25,
    landingView: 'today', detectors: {}, backupLog: [], storeCounts: {}, confirming: false, clearing: false, confirmValue: ''
  };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------------------------------------------------------------- section renderers

  function segHtml(name, options, current, act) {
    return '<div class="set-seg" data-seg="' + name + '">' + options.map(function (o) {
      return '<button data-act="' + act + '" data-val="' + o.key + '"' + (o.key === current ? ' class="active"' : '') + '>' + escapeHtml(o.label) + '</button>';
    }).join('') + '</div>';
  }

  function switchHtml(key, on) {
    return '<button class="set-switch ' + (on ? 'on' : 'off') + '" data-act="toggle-detector" data-key="' + key + '"><span class="set-switch-thumb"></span></button>';
  }

  function renderPreferences() {
    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">01</span><h2 class="set-section-title">Preferences</h2></div>' +
        '<div class="set-card">' +

          '<div class="set-row">' +
            '<div><div class="set-row-title">Default landing view</div><div class="set-row-desc">Which module opens when Console launches.</div></div>' +
            '<select class="set-select" data-act="landing-view">' + LANDING_VIEWS.map(function (v) { return '<option value="' + v.key + '"' + (v.key === state.landingView ? ' selected' : '') + '>' + v.label + '</option>'; }).join('') + '</select>' +
          '</div>' +

          '<div class="set-row">' +
            '<div><div class="set-row-title">Week starts on</div><div class="set-row-desc">Persisted, but not yet applied to Schedule’s Week view or the Productive Hours Heatmap (see docs).</div></div>' +
            segHtml('week-start', [{ key: 'sun', label: 'Sunday' }, { key: 'mon', label: 'Monday' }], state.weekStart, 'week-start') +
          '</div>' +

          '<div class="set-row">' +
            '<div><div class="set-row-title">Default task priority</div><div class="set-row-desc">Applied to new tasks captured without one specified.</div></div>' +
            segHtml('priority', [{ key: 'low', label: '!low' }, { key: 'med', label: '!med' }, { key: 'high', label: '!high' }], state.priority, 'priority') +
          '</div>' +

          '<div class="set-row">' +
            '<div><div class="set-row-title">Default Focus session</div><div class="set-row-desc">Mode and duration pre-selected each time you start a session.</div></div>' +
            '<div class="set-row-controls">' +
              '<select class="set-select" data-act="focus-mode">' + FOCUS_MODES.map(function (m) { return '<option value="' + m.key + '"' + (m.key === state.focusMode ? ' selected' : '') + '>' + m.label + '</option>'; }).join('') + '</select>' +
              '<select class="set-select" data-act="focus-duration">' + FOCUS_DURATIONS.map(function (d) { return '<option value="' + d + '"' + (d === state.focusDuration ? ' selected' : '') + '>' + d + ' min</option>'; }).join('') + '</select>' +
            '</div>' +
          '</div>' +

          '<div class="set-detectors-head">' +
            '<div class="set-detectors-title">Insights detectors</div>' +
            '<div class="set-detectors-desc">Silence any detector without losing the others. Daily run: first load of each day.</div>' +
          '</div>' +
          '<div class="set-detectors-grid">' +
            DETECTOR_DEFS.map(function (d) {
              var on = state.detectors[d.key] !== false;
              return '<div class="set-detector-row"><span class="set-detector-name">' + escapeHtml(d.name) + '</span>' + switchHtml(d.key, on) + '</div>';
            }).join('') +
          '</div>' +

        '</div>' +
      '</div>'
    );
  }

  function renderTheme() {
    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">02</span><h2 class="set-section-title">Theme</h2></div>' +
        '<div class="set-card pad set-theme-row">' +
          '<div><div class="set-row-title">Appearance</div><div class="set-row-desc">Same control as the topbar toggle — set it from either place.</div></div>' +
          segHtml('theme', [{ key: 'light', label: 'light' }, { key: 'dark', label: 'dark' }], state.theme, 'theme') +
        '</div>' +
      '</div>'
    );
  }

  function renderBackup() {
    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">03</span><h2 class="set-section-title">Backup &amp; Restore History</h2></div>' +
        '<div class="set-card pad">' +
          '<div class="set-backup-actions">' +
            '<button class="set-btn-primary" data-act="export">Export all data</button>' +
            '<button class="set-btn-secondary" data-act="import">Import from file</button>' +
            '<input type="file" id="settings-import-input" accept="application/json" class="visually-hidden">' +
          '</div>' +
          (state.backupLog.length
            ? state.backupLog.map(function (b) {
                var dot = b.kind === 'export' ? 'var(--teal)' : 'var(--blue)';
                var label = b.kind === 'export' ? 'Exported' : 'Imported';
                var when = new Date(b.created_at).toLocaleString();
                return '<div class="set-backup-row"><span class="set-backup-dot" style="background:' + dot + '"></span><span class="set-backup-kind">' + label + '</span><span class="set-backup-when">' + escapeHtml(when) + '</span></div>';
              }).join('')
            : '<div class="hint">No exports or imports yet.</div>') +
          '<div class="hint" id="settings-backup-status"></div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderShortcuts() {
    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">04</span><h2 class="set-section-title">Shortcuts Reference</h2></div>' +
        '<div class="set-card pad-tight">' +
          SHORTCUT_GROUPS.map(function (grp) {
            return (
              '<div class="set-shortcut-group">' +
                '<div class="set-shortcut-group-name">' + escapeHtml(grp.name) + '</div>' +
                '<div class="set-shortcut-items">' +
                  grp.items.map(function (it) { return '<div class="set-shortcut-item"><span class="set-kbd">' + escapeHtml(it.key) + '</span><span class="set-kbd-label">' + escapeHtml(it.label) + '</span></div>'; }).join('') +
                '</div>' +
              '</div>'
            );
          }).join('') +
        '</div>' +
      '</div>'
    );
  }

  function renderDataManagement() {
    var confirmBlock = state.confirming
      ? '<div class="set-confirm-row">' +
          '<span class="set-confirm-text">Type <strong style="font-family:var(--mono);color:var(--ink-1);">DELETE</strong> to confirm — this cannot be undone.</span>' +
          '<input class="set-confirm-input" id="settings-confirm-input" placeholder="DELETE" value="' + escapeHtml(state.confirmValue) + '">' +
          '<button class="set-btn-secondary" data-act="confirm-clear">Confirm</button>' +
          '<button class="set-confirm-cancel" data-act="cancel-clear">Cancel</button>' +
        '</div>'
      : '';
    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">05</span><h2 class="set-section-title">Data Management</h2></div>' +
        '<div class="set-card pad" style="margin-bottom:14px;">' +
          '<div class="set-stat-grid">' +
            STAT_STORES.map(function (s) {
              return '<div><div class="set-stat-num">' + (state.storeCounts[s.store] || 0) + '</div><div class="set-stat-label">' + escapeHtml(s.label) + '</div></div>';
            }).join('') +
          '</div>' +
        '</div>' +
        '<div class="set-danger-zone">' +
          '<div><div class="set-danger-title">Danger zone</div><div class="set-danger-desc">Permanently erases every store on this device. Cannot be undone — export a backup first.</div></div>' +
          '<button class="set-danger-btn" data-act="start-clear">' + (state.clearing ? 'Erasing…' : 'Clear all data') + '</button>' +
        '</div>' +
        confirmBlock +
      '</div>'
    );
  }

  function render() {
    container.innerHTML = (
      '<div class="page-head"><h1 class="page-title">Settings</h1></div>' +
      '<div class="set-page-desc">Configuration, not data — everything here reuses what the app already stores.</div>' +
      renderPreferences() + renderTheme() + renderBackup() + renderShortcuts() + renderDataManagement()
    );
    var fileInput = container.querySelector('#settings-import-input');
    if (fileInput) fileInput.addEventListener('change', onImportFile);
  }

  // ---------------------------------------------------------------- persistence + live globals

  function setPrefAndGlobal(key, value, globalSetter) {
    db.setPref(key, value);
    if (globalSetter) globalSetter(value);
  }

  function onClick(e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.dataset.act;

    if (act === 'week-start') { state.weekStart = btn.dataset.val; db.setPref('week_start', state.weekStart); render(); }
    else if (act === 'priority') {
      state.priority = btn.dataset.val;
      setPrefAndGlobal('default_task_priority', state.priority, function (v) { Console.taskDefaultPriority = v; });
      render();
    }
    else if (act === 'theme') { Console.theme.set(btn.dataset.val); state.theme = btn.dataset.val; render(); }
    else if (act === 'toggle-detector') {
      var key = btn.dataset.key;
      state.detectors[key] = state.detectors[key] === false ? true : false;
      setPrefAndGlobal('insights_detectors', state.detectors, function (v) { Console.insightsDetectorPrefs = v; });
      render();
    }
    else if (act === 'export') {
      db.downloadExport().then(function () {
        var el = container.querySelector('#settings-backup-status');
        if (el) el.textContent = 'Exported ' + new Date().toLocaleString() + '.';
        return loadBackupLog();
      }).then(render);
    }
    else if (act === 'import') { container.querySelector('#settings-import-input').click(); }
    else if (act === 'start-clear') { state.confirming = true; state.confirmValue = ''; render(); focusConfirmInput(); }
    else if (act === 'cancel-clear') { state.confirming = false; render(); }
    else if (act === 'confirm-clear') { doClearAll(); }
  }

  function focusConfirmInput() {
    var el = container.querySelector('#settings-confirm-input');
    if (el) el.focus();
  }

  function onInput(e) {
    if (e.target && e.target.id === 'settings-confirm-input') state.confirmValue = e.target.value;
  }

  function onChangeSelect(e) {
    var t = e.target;
    if (!t || t.tagName !== 'SELECT') return;
    if (t.dataset.act === 'landing-view') { state.landingView = t.value; setPrefAndGlobal('default_landing_view', state.landingView); }
    else if (t.dataset.act === 'focus-mode') {
      state.focusMode = t.value;
      setPrefAndGlobal('default_focus_mode', state.focusMode, function () { Console.focusDefaults = Console.focusDefaults || {}; Console.focusDefaults.mode = state.focusMode; });
    } else if (t.dataset.act === 'focus-duration') {
      state.focusDuration = +t.value;
      setPrefAndGlobal('default_focus_duration_min', state.focusDuration, function () { Console.focusDefaults = Console.focusDefaults || {}; Console.focusDefaults.targetMin = state.focusDuration; });
    }
  }

  function onImportFile() {
    var fileInput = container.querySelector('#settings-import-input');
    var file = fileInput.files[0];
    if (!file) return;
    db.uploadImport(file).then(function () {
      var el = container.querySelector('#settings-backup-status');
      if (el) el.textContent = 'Imported ' + new Date().toLocaleString() + '. Reload to see the data everywhere.';
      return loadBackupLog();
    }).then(render).catch(function (err) {
      var el = container.querySelector('#settings-backup-status');
      if (el) el.textContent = 'Import failed: ' + err.message;
    });
    fileInput.value = '';
  }

  function doClearAll() {
    if (state.confirmValue !== 'DELETE') return;
    state.clearing = true;
    render();
    Promise.all(db.STORE_NAMES.map(function (name) { return db.clearStore(name); })).then(function () {
      location.reload();
    });
  }

  // ---------------------------------------------------------------- loaders

  function loadBackupLog() {
    return db.getAll('backups').then(function (rows) {
      state.backupLog = rows.slice().sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }).slice(0, 12);
    });
  }

  function loadStoreCounts() {
    return Promise.all(STAT_STORES.map(function (s) { return db.count(s.store); })).then(function (counts) {
      STAT_STORES.forEach(function (s, i) { state.storeCounts[s.store] = counts[i]; });
    });
  }

  function loadPrefs() {
    return Promise.all([
      db.getPref('theme', 'light'),
      db.getPref('week_start', 'mon'),
      db.getPref('default_task_priority', 'med'),
      db.getPref('default_focus_mode', 'pomodoro'),
      db.getPref('default_focus_duration_min', 25),
      db.getPref('default_landing_view', 'today'),
      db.getPref('insights_detectors', {})
    ]).then(function (r) {
      state.theme = r[0]; state.weekStart = r[1]; state.priority = r[2];
      state.focusMode = r[3]; state.focusDuration = r[4]; state.landingView = r[5];
      state.detectors = r[6] || {};
    });
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([loadPrefs(), loadBackupLog(), loadStoreCounts()]).then(render);
  }

  Console.modules.settings = {
    init: function (el) {
      container = el;
      db = Console.db;
      state.confirming = false; state.clearing = false; state.confirmValue = '';
      container.addEventListener('click', onClick);
      container.addEventListener('input', onInput);
      container.addEventListener('change', onChangeSelect);
      refreshAndRender();
    },
    destroy: function () {
      if (container) {
        container.removeEventListener('click', onClick);
        container.removeEventListener('input', onInput);
        container.removeEventListener('change', onChangeSelect);
      }
      container = null;
    }
  };
})();
