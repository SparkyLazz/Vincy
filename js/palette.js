/* Console — palette.js
   ⌘K / Ctrl+K command palette. Phase 1 scope: fuzzy-ish (substring) search across nav
   destinations plus two real actions (export/import), per phase_1_foundation.md. Entity
   search ("recent commands", real actions from other modules) grows in later phases —
   this file's job is the overlay mechanics, not the full command set. */
(function () {
  'use strict';
  window.Console = window.Console || {};

  var NAV_ITEMS = [
    { group: 'Workspace', label: 'Today', route: 'today' },
    { group: 'Workspace', label: 'Tasks', route: 'tasks' },
    { group: 'Workspace', label: 'Schedule', route: 'schedule' },
    { group: 'Workspace', label: 'Habits', route: 'habits' },
    { group: 'Workspace', label: 'Finance', route: 'finance' },
    { group: 'Workspace', label: 'Focus', route: 'focus' },
    { group: 'Insight', label: 'Analytics', route: 'analytics' },
    { group: 'Insight', label: 'Insights', route: 'insights' },
    { group: 'Insight', label: 'Settings', route: 'settings' }
  ];

  var ACTIONS = [
    { group: 'Actions', label: 'Export all data (JSON)', run: function () { Console.db.downloadExport(); } },
    { group: 'Actions', label: 'Import data from file…', run: function () { Console.router.navigate('settings'); } }
  ];

  var overlay, input, results;
  var activeIndex = 0;
  var entityCache = { tasks: [], habits: [], events: [], projects: [], transactions: [] };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function loadEntities() {
    return Promise.all([
      Console.db.getAll('tasks'),
      Console.db.getAll('habits'),
      Console.db.getAll('events'),
      Console.db.getAll('projects'),
      Console.db.getAll('transactions')
    ]).then(function (r) {
      entityCache.tasks = r[0];
      entityCache.habits = r[1];
      entityCache.events = r[2];
      entityCache.projects = r[3];
      entityCache.transactions = r[4];
    });
  }

  function allItems(q) {
    var base = NAV_ITEMS.concat(ACTIONS);
    if (!q) return base;

    var entities = [];
    var query = q.toLowerCase();
    entityCache.tasks.filter(function (t) { return (t.title || '').toLowerCase().indexOf(query) !== -1; }).slice(0, 5).forEach(function (t) {
      entities.push({ group: 'Tasks', label: t.title, route: 'tasks', kind: 'task', id: t.id });
    });
    entityCache.habits.filter(function (h) { return (h.name || '').toLowerCase().indexOf(query) !== -1; }).slice(0, 3).forEach(function (h) {
      entities.push({ group: 'Habits', label: h.name, route: 'habits', kind: 'habit', id: h.id });
    });
    entityCache.events.filter(function (e) { return (e.title || '').toLowerCase().indexOf(query) !== -1; }).slice(0, 3).forEach(function (e) {
      entities.push({ group: 'Events', label: e.title, route: 'schedule', kind: 'event', id: e.id, date: e.start_date });
    });
    entityCache.projects.filter(function (p) { return !p.archived_at && (p.name || '').toLowerCase().indexOf(query) !== -1; }).slice(0, 3).forEach(function (p) {
      entities.push({ group: 'Projects', label: p.name, route: 'tasks', kind: 'project', id: p.id });
    });
    entityCache.transactions.filter(function (t) {
      var haystack = [t.title, t.notes, t.currency, t.date].join(' ').toLowerCase();
      return haystack.indexOf(query) !== -1;
    }).slice(0, 5).forEach(function (t) {
      entities.push({
        group: 'Transactions',
        label: (t.title || 'Untitled transaction') + (t.date ? ' · ' + t.date : ''),
        route: 'finance',
        kind: 'transaction',
        id: t.id,
        period: (t.date || '').slice(0, 7),
        view: 'transactions'
      });
    });

    return base.concat(entities);
  }

  function matches(item, q) {
    if (!q) return item.group !== 'Tasks' && item.group !== 'Habits' && item.group !== 'Events' && item.group !== 'Projects';
    return (item.label || '').toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function runItem(item) {
    if (item.id) {
      Console.pendingSelection = {
        route: item.route,
        kind: item.kind,
        id: item.id,
        date: item.date || null,
        period: item.period || null,
        view: item.view || null
      };
      Console.router.navigate(item.route);
    } else if (item.route) {
      Console.router.navigate(item.route);
    }
    else if (item.run) item.run();
    close();
  }

  function renderResults(q) {
    var items = allItems(q).filter(function (i) { return matches(i, q); });
    activeIndex = 0;

    if (!items.length) {
      results.innerHTML = '<div class="empty"><div class="empty-title">No matches</div></div>';
      return;
    }

    var groups = {};
    var order = [];
    items.forEach(function (i) {
      if (!groups[i.group]) { groups[i.group] = []; order.push(i.group); }
      groups[i.group].push(i);
    });

    var html = '';
    var flatIndex = 0;
    order.forEach(function (groupName) {
      html += '<div class="pgroup">' + groupName + '</div>';
      groups[groupName].forEach(function (item) {
        html += '<div class="prow' + (flatIndex === 0 ? ' active' : '') + '" data-index="' + flatIndex + '">' +
          '<span>' + escapeHtml(item.label) + '</span></div>';
        flatIndex++;
      });
    });
    results.innerHTML = html;
    results._items = items;

    results.querySelectorAll('.prow').forEach(function (row) {
      row.addEventListener('click', function () {
        runItem(results._items[Number(row.dataset.index)]);
      });
    });
  }

  function setActive(index) {
    var rows = results.querySelectorAll('.prow');
    if (!rows.length) return;
    activeIndex = (index + rows.length) % rows.length;
    rows.forEach(function (r, i) { r.classList.toggle('active', i === activeIndex); });
    rows[activeIndex].scrollIntoView({ block: 'nearest' });
  }

  function open() {
    overlay.hidden = false;
    input.value = '';
    loadEntities().then(function () {
      renderResults('');
      input.focus();
    });
  }

  function close() {
    overlay.hidden = true;
  }

  function isOpen() { return !overlay.hidden; }

  function onKeydown(e) {
    var isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    if (isCmdK) {
      e.preventDefault();
      isOpen() ? close() : open();
      return;
    }
    if (!isOpen()) return;
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIndex + 1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIndex - 1); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      var items = results._items || [];
      if (items[activeIndex]) runItem(items[activeIndex]);
    }
  }

  function init() {
    overlay = document.getElementById('cmd-overlay');
    input = document.getElementById('cmd-input');
    results = document.getElementById('cmd-results');
    if (!overlay || !input || !results) return;

    document.addEventListener('keydown', onKeydown);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    input.addEventListener('input', function () { renderResults(input.value); });

    var trigger = document.querySelector('.cmd-trigger');
    if (trigger) trigger.addEventListener('click', open);
  }

  Console.palette = { init: init, open: open, close: close };
})();
