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
   reload. `week_start` (originally the one deliberately-unconsumed control — phase_9_settings.md
   Decision #2) is now wired for real: format.js's weekOf() and Analytics' heatmap day ordering
   both read the Console.weekStart global this module keeps live. */
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
    landingView: 'today', baseCurrency: 'USD', detectors: {}, backupLog: [], storeCounts: {}, confirming: false, clearing: false, confirmValue: '',
    projects: [], projectTaskCounts: {}, tagRows: [],
    editingProjectId: null, editingProjectName: '', editingTag: null, editingTagName: '',
    fxRatesObj: {}, fxRates: [], editingCurrency: null
  };

  var CURRENCIES = [
    { key: 'USD', label: 'USD (US Dollar)' },
    { key: 'EUR', label: 'EUR (Euro)' },
    { key: 'GBP', label: 'GBP (British Pound)' },
    { key: 'JPY', label: 'JPY (Japanese Yen)' },
    { key: 'MYR', label: 'MYR (Malaysian Ringgit)' },
    { key: 'AUD', label: 'AUD (Australian Dollar)' },
    { key: 'CAD', label: 'CAD (Canadian Dollar)' },
    { key: 'CHF', label: 'CHF (Swiss Franc)' },
    { key: 'CNY', label: 'CNY (Chinese Yuan)' },
    { key: 'SGD', label: 'SGD (Singapore Dollar)' }
  ];

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
            '<div><div class="set-row-title">Week starts on</div><div class="set-row-desc">Applies to Schedule’s Day/Week grids, weekly totals on Today, Focus and Insights, and the Productive Hours Heatmap.</div></div>' +
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

          '<div class="set-row">' +
            '<div><div class="set-row-title">Base currency</div><div class="set-row-desc">Used as the base for all envelopes and reports in Finance.</div></div>' +
            '<select class="set-select" data-act="base-currency">' + CURRENCIES.map(function (c) { return '<option value="' + c.key + '"' + (c.key === state.baseCurrency ? ' selected' : '') + '>' + c.label + '</option>'; }).join('') + '</select>' +
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

  function renderProjectsTags() {
    var projectRows = state.projects.length
      ? state.projects.map(function (p) {
          var count = state.projectTaskCounts[p.id] || 0;
          var archived = p.status === 'archived';
          if (state.editingProjectId === p.id) {
            return (
              '<div class="set-row">' +
                '<input type="text" class="input" id="pm-edit-project-input" value="' + escapeHtml(state.editingProjectName) + '">' +
                '<div class="set-row-controls">' +
                  '<button class="btn sm accent" data-act="save-project-name" data-id="' + p.id + '">Save</button>' +
                  '<button class="btn sm secondary" data-act="cancel-edit-project">Cancel</button>' +
                '</div>' +
              '</div>'
            );
          }
          return (
            '<div class="set-row">' +
              '<div><div class="set-row-title">' + escapeHtml(p.name) + (archived ? ' <span class="pill neutral">archived</span>' : '') + '</div>' +
              '<div class="set-row-desc">' + count + ' task' + (count === 1 ? '' : 's') + '</div></div>' +
              '<div class="set-row-controls">' +
                '<button class="btn sm secondary" data-act="edit-project" data-id="' + p.id + '">Rename</button>' +
                '<button class="btn sm secondary" data-act="toggle-archive-project" data-id="' + p.id + '">' + (archived ? 'Reactivate' : 'Archive') + '</button>' +
                '<button class="btn sm danger" data-act="delete-project" data-id="' + p.id + '">Delete</button>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="set-row"><div><div class="set-row-desc">No projects yet — add one below, or create one from a task’s #project.</div></div></div>';

    var tagRows = state.tagRows.length
      ? state.tagRows.map(function (r) {
          if (state.editingTag === r.tag) {
            return (
              '<div class="set-row">' +
                '<input type="text" class="input" id="pm-edit-tag-input" value="' + escapeHtml(state.editingTagName) + '">' +
                '<div class="set-row-controls">' +
                  '<button class="btn sm accent" data-act="save-tag-name" data-tag="' + escapeHtml(r.tag) + '">Save</button>' +
                  '<button class="btn sm secondary" data-act="cancel-edit-tag">Cancel</button>' +
                '</div>' +
              '</div>'
            );
          }
          var usage = r.taskCount + ' task' + (r.taskCount === 1 ? '' : 's') +
            (r.habitCount ? ' · linked to ' + r.habitCount + ' habit' + (r.habitCount === 1 ? '' : 's') : '');
          return (
            '<div class="set-row">' +
              '<div><div class="set-row-title">#' + escapeHtml(r.tag) + '</div>' +
              '<div class="set-row-desc">' + usage + '</div></div>' +
              '<div class="set-row-controls">' +
                '<button class="btn sm secondary" data-act="edit-tag" data-tag="' + escapeHtml(r.tag) + '">Rename</button>' +
                '<button class="btn sm danger" data-act="delete-tag" data-tag="' + escapeHtml(r.tag) + '">Delete</button>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="set-row"><div><div class="set-row-desc">No tags yet — tag a task (or set a tag on a habit) and it’ll show up here.</div></div></div>';

    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">05</span><h2 class="set-section-title">Projects &amp; Tags</h2></div>' +
        '<div class="set-card" style="margin-bottom:14px;">' +
          '<div class="set-row"><div><div class="set-row-title">Projects</div><div class="set-row-desc">Rename or archive a project in one place — every task attached to it updates automatically.</div></div></div>' +
          projectRows +
          '<div class="set-row"><input type="text" class="input" id="pm-new-project" placeholder="New project name"><div class="set-row-controls"><button class="btn sm accent" data-act="add-project">Add project</button></div></div>' +
        '</div>' +
        '<div class="set-card">' +
          '<div class="set-row"><div><div class="set-row-title">Tags</div><div class="set-row-desc">Every tag in use — on tasks and as habit links. Renaming updates every task and linked habit together; deleting removes it from tasks and clears the link on habits.</div></div></div>' +
          tagRows +
        '</div>' +
      '</div>'
    );
  }

  // Finance stays offline by default (see phase_5_finance.md — no network calls anywhere in this
  // app). Rather than requiring an FX rate + original amount + converted amount every time a
  // foreign-currency transaction is logged, the user saves a rate here once; Finance's "New
  // transaction" form prefills from it, and its "Fetch live rate" button (an explicit, best-effort
  // online lookup) writes back here too, so the saved rate improves itself over time.
  function renderCurrencies() {
    var rows = state.fxRates.length
      ? state.fxRates.map(function (r) {
          if (state.editingCurrency === r.code) {
            return (
              '<div class="set-row">' +
                '<input type="text" class="input" id="pm-edit-currency-rate" value="' + escapeHtml(String(r.rate)) + '" placeholder="1.083">' +
                '<div class="set-row-controls">' +
                  '<button class="btn sm accent" data-act="save-currency-rate" data-code="' + r.code + '">Save</button>' +
                  '<button class="btn sm secondary" data-act="cancel-edit-currency">Cancel</button>' +
                '</div>' +
              '</div>'
            );
          }
          return (
            '<div class="set-row">' +
              '<div><div class="set-row-title">1 ' + escapeHtml(r.code) + ' = ' + r.rate + ' USD</div>' +
              '<div class="set-row-desc">' + (r.updated_at ? 'Updated ' + new Date(r.updated_at).toLocaleDateString() : 'Never updated') + '</div></div>' +
              '<div class="set-row-controls">' +
                '<button class="btn sm secondary" data-act="edit-currency" data-code="' + escapeHtml(r.code) + '">Edit</button>' +
                '<button class="btn sm danger" data-act="delete-currency" data-code="' + escapeHtml(r.code) + '">Delete</button>' +
              '</div>' +
            '</div>'
          );
        }).join('')
      : '<div class="set-row"><div><div class="set-row-desc">No saved rates yet — add one below, or use "Fetch live rate" on a foreign-currency transaction in Finance.</div></div></div>';

    return (
      '<div class="set-section">' +
        '<div class="set-section-head"><span class="set-section-num">06</span><h2 class="set-section-title">Currencies</h2></div>' +
        '<div class="set-card">' +
          '<div class="set-row"><div><div class="set-row-title">Your usual FX rates</div><div class="set-row-desc">Saved rates prefill new foreign-currency transactions automatically — no need to look one up each time. (Base: ' + state.baseCurrency + ')</div></div></div>' +
          rows +
          '<div class="set-row">' +
            '<div style="display:flex; gap:8px;">' +
              '<input type="text" class="input" id="pm-new-currency-code" placeholder="EUR" maxlength="3">' +
              '<input type="text" class="input" id="pm-new-currency-rate" placeholder="1.083">' +
            '</div>' +
            '<div class="set-row-controls"><button class="btn sm accent" data-act="add-currency">Add rate</button></div>' +
          '</div>' +
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
        '<div class="set-section-head"><span class="set-section-num">07</span><h2 class="set-section-title">Data Management</h2></div>' +
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
      renderPreferences() + renderTheme() + renderBackup() + renderShortcuts() + renderProjectsTags() + renderCurrencies() + renderDataManagement()
    );
    var fileInput = container.querySelector('#settings-import-input');
    if (fileInput) fileInput.addEventListener('change', onImportFile);
    wirePMInputs();
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

    if (act === 'week-start') { state.weekStart = btn.dataset.val; db.setPref('week_start', state.weekStart); Console.weekStart = state.weekStart; render(); }
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
    else if (act === 'add-project') { addProject(); }
    else if (act === 'edit-project') { startEditProject(btn.dataset.id); }
    else if (act === 'cancel-edit-project') { state.editingProjectId = null; render(); }
    else if (act === 'save-project-name') { saveProjectName(btn.dataset.id); }
    else if (act === 'toggle-archive-project') { toggleArchiveProject(btn.dataset.id); }
    else if (act === 'delete-project') { deleteProject(btn.dataset.id); }
    else if (act === 'edit-tag') { startEditTag(btn.dataset.tag); }
    else if (act === 'cancel-edit-tag') { state.editingTag = null; render(); }
    else if (act === 'save-tag-name') { saveTagName(btn.dataset.tag); }
    else if (act === 'delete-tag') { deleteTag(btn.dataset.tag); }
    else if (act === 'add-currency') { addCurrencyRate(); }
    else if (act === 'edit-currency') { state.editingCurrency = btn.dataset.code; render(); }
    else if (act === 'cancel-edit-currency') { state.editingCurrency = null; render(); }
    else if (act === 'save-currency-rate') { saveCurrencyRateEdit(btn.dataset.code); }
    else if (act === 'delete-currency') { deleteCurrencyRate(btn.dataset.code); }
  }

  // ---------------------------------------------------------------- currencies management

  function persistFxRates() {
    return db.setPref('fx_rates', state.fxRatesObj).then(function () {
      Console.fxRates = state.fxRatesObj;
      return loadFxRates();
    });
  }

  function addCurrencyRate() {
    var codeInput = container.querySelector('#pm-new-currency-code');
    var rateInput = container.querySelector('#pm-new-currency-rate');
    var code = codeInput ? codeInput.value.trim().toUpperCase() : '';
    var rate = rateInput ? +rateInput.value : NaN;
    if (!/^[A-Z]{3}$/.test(code) || rateInput.value === '' || isNaN(rate) || rate <= 0) return;
    state.fxRatesObj[code] = { rate: rate, updated_at: new Date().toISOString() };
    persistFxRates().then(render);
  }

  function saveCurrencyRateEdit(code) {
    var input = container.querySelector('#pm-edit-currency-rate');
    var rate = input ? +input.value : NaN;
    if (!input || input.value === '' || isNaN(rate) || rate <= 0) { state.editingCurrency = null; render(); return; }
    state.fxRatesObj[code] = { rate: rate, updated_at: new Date().toISOString() };
    state.editingCurrency = null;
    persistFxRates().then(render);
  }

  function deleteCurrencyRate(code) {
    delete state.fxRatesObj[code];
    persistFxRates().then(render);
  }

  // ---------------------------------------------------------------- projects & tags management

  function addProject() {
    var input = container.querySelector('#pm-new-project');
    var name = input ? input.value.trim() : '';
    if (!name) return;
    var dup = state.projects.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); });
    if (dup) { input.value = ''; return; } // already exists — reuse it from a task instead of forking a duplicate
    var proj = { id: db.uuid(), name: name, status: 'active', archived_at: null };
    db.put('projects', proj).then(loadProjectsAndTags).then(render);
  }

  function startEditProject(id) {
    var p = state.projects.find(function (pp) { return pp.id === id; });
    if (!p) return;
    state.editingProjectId = id;
    state.editingProjectName = p.name;
    render();
  }

  function saveProjectName(id) {
    var input = container.querySelector('#pm-edit-project-input');
    var name = input ? input.value.trim() : '';
    var p = state.projects.find(function (pp) { return pp.id === id; });
    if (!p || !name) { state.editingProjectId = null; render(); return; }
    p.name = name;
    db.put('projects', p).then(function () {
      state.editingProjectId = null;
      return loadProjectsAndTags();
    }).then(render);
  }

  function toggleArchiveProject(id) {
    var p = state.projects.find(function (pp) { return pp.id === id; });
    if (!p) return;
    var wasArchived = p.status === 'archived';
    p.status = wasArchived ? 'active' : 'archived';
    p.archived_at = wasArchived ? null : new Date().toISOString();
    db.put('projects', p).then(loadProjectsAndTags).then(render);
  }

  function deleteProject(id) {
    db.getAll('tasks').then(function (tasks) {
      var affected = tasks.filter(function (t) { return t.project_id === id; });
      return Promise.all(affected.map(function (t) { t.project_id = null; return db.put('tasks', t); }));
    }).then(function () { return db.remove('projects', id); }).then(loadProjectsAndTags).then(render);
  }

  function startEditTag(tag) {
    state.editingTag = tag;
    state.editingTagName = tag;
    render();
  }

  function saveTagName(oldTag) {
    var input = container.querySelector('#pm-edit-tag-input');
    var sameTag = Console.lib.sameTag;
    var newTag = input ? Console.lib.normalizeTag(input.value) : ''; // same "#Reading " → "Reading" cleanup every tag entry point applies
    if (!newTag || newTag === oldTag) { state.editingTag = null; render(); return; }
    // Case-insensitive throughout — the row being renamed is the canonical merged tag from
    // collectTags(), so any case variant still sitting on a task must rename with it.
    db.getAll('tasks').then(function (tasks) {
      var affected = tasks.filter(function (t) { return (t.tags || []).some(function (tg) { return sameTag(tg, oldTag); }); });
      return Promise.all(affected.map(function (t) {
        var renamed = t.tags.map(function (tg) { return sameTag(tg, oldTag) ? newTag : tg; });
        t.tags = renamed.filter(function (tg, i) { // dedupe if newTag (or a case variant) already existed on this task
          return renamed.findIndex(function (x) { return sameTag(x, tg); }) === i;
        });
        return db.put('tasks', t);
      }));
    }).then(function () {
      // Habits link to tasks by this same tag string — renaming it only on tasks would silently
      // sever every habit that pointed at the old name, so the habit side renames with it.
      return db.getAll('habits').then(function (habits) {
        var linked = habits.filter(function (h) { return h.tag && sameTag(h.tag, oldTag); });
        return Promise.all(linked.map(function (h) { h.tag = newTag; return db.put('habits', h); }));
      });
    }).then(function () {
      state.editingTag = null;
      return loadProjectsAndTags();
    }).then(render);
  }

  function deleteTag(tag) {
    var sameTag = Console.lib.sameTag;
    db.getAll('tasks').then(function (tasks) {
      var affected = tasks.filter(function (t) { return (t.tags || []).some(function (tg) { return sameTag(tg, tag); }); });
      return Promise.all(affected.map(function (t) {
        t.tags = t.tags.filter(function (tg) { return !sameTag(tg, tag); });
        return db.put('tasks', t);
      }));
    }).then(function () {
      // A habit whose link tag is deleted keeps working otherwise — clearing the tag (rather than
      // leaving it pointing at a name this list no longer shows) keeps what Settings displays and
      // what habits actually hold in agreement. The habit itself is untouched beyond the link.
      return db.getAll('habits').then(function (habits) {
        var linked = habits.filter(function (h) { return h.tag && sameTag(h.tag, tag); });
        return Promise.all(linked.map(function (h) { h.tag = null; return db.put('habits', h); }));
      });
    }).then(loadProjectsAndTags).then(render);
  }

  function wirePMInputs() {
    var newProjectInput = container.querySelector('#pm-new-project');
    if (newProjectInput) {
      newProjectInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addProject(); }
      });
    }
    var editProjectInput = container.querySelector('#pm-edit-project-input');
    if (editProjectInput) {
      editProjectInput.focus();
      editProjectInput.select();
      editProjectInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveProjectName(state.editingProjectId); }
        else if (e.key === 'Escape') { e.preventDefault(); state.editingProjectId = null; render(); }
      });
    }
    var editTagInput = container.querySelector('#pm-edit-tag-input');
    if (editTagInput) {
      editTagInput.focus();
      editTagInput.select();
      editTagInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveTagName(state.editingTag); }
        else if (e.key === 'Escape') { e.preventDefault(); state.editingTag = null; render(); }
      });
    }
    var newCurrencyRateInput = container.querySelector('#pm-new-currency-rate');
    if (newCurrencyRateInput) {
      newCurrencyRateInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); addCurrencyRate(); }
      });
    }
    var editCurrencyRateInput = container.querySelector('#pm-edit-currency-rate');
    if (editCurrencyRateInput) {
      editCurrencyRateInput.focus();
      editCurrencyRateInput.select();
      editCurrencyRateInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); saveCurrencyRateEdit(state.editingCurrency); }
        else if (e.key === 'Escape') { e.preventDefault(); state.editingCurrency = null; render(); }
      });
    }
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
    } else if (t.dataset.act === 'base-currency') {
      state.baseCurrency = t.value;
      setPrefAndGlobal('base_currency', state.baseCurrency, function (v) { Console.baseCurrency = v; });
      render();
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
      db.getPref('base_currency', 'USD'),
      db.getPref('insights_detectors', {})
    ]).then(function (r) {
      state.theme = r[0]; state.weekStart = r[1]; state.priority = r[2];
      state.focusMode = r[3]; state.focusDuration = r[4]; state.landingView = r[5];
      state.baseCurrency = r[6]; state.detectors = r[7] || {};

      // Sync globals for other modules to read
      Console.baseCurrency = state.baseCurrency;
    });
  }

  // There's no dedicated tags store (tags are string arrays on tasks plus a link string on each
  // habit), so "all tags in use" only exists as a derived view — computed by the one shared
  // collector (js/lib/tags.js) the New Task picker also uses. Scanning only tasks here (the old
  // behavior) made the two lists disagree: a tag only a habit used showed up when creating a task
  // but this section said "No tags yet".
  function loadProjectsAndTags() {
    return Promise.all([db.getAll('projects'), db.getAll('tasks'), db.getAll('habits')]).then(function (r) {
      state.projects = r[0].slice().sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
      var tasks = r[1];
      state.projectTaskCounts = {};
      tasks.forEach(function (t) { if (t.project_id) state.projectTaskCounts[t.project_id] = (state.projectTaskCounts[t.project_id] || 0) + 1; });
      state.tagRows = Console.lib.collectTags(tasks, r[2]); // [{ tag, taskCount, habitCount }]
    });
  }

  function loadFxRates() {
    return db.getPref('fx_rates', {}).then(function (rates) {
      state.fxRatesObj = rates || {};
      state.fxRates = Object.keys(state.fxRatesObj).sort().map(function (code) {
        return { code: code, rate: state.fxRatesObj[code].rate, updated_at: state.fxRatesObj[code].updated_at };
      });
    });
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([loadPrefs(), loadBackupLog(), loadStoreCounts(), loadProjectsAndTags(), loadFxRates()]).then(render);
  }

  Console.modules.settings = {
    init: function (el) {
      container = el;
      db = Console.db;
      state.confirming = false; state.clearing = false; state.confirmValue = '';
      state.editingProjectId = null; state.editingTag = null; state.editingCurrency = null;
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
