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

  function allItems() { return NAV_ITEMS.concat(ACTIONS); }

  function matches(item, q) {
    if (!q) return true;
    return item.label.toLowerCase().indexOf(q.toLowerCase()) !== -1;
  }

  function runItem(item) {
    if (item.route) Console.router.navigate(item.route);
    else if (item.run) item.run();
    close();
  }

  function renderResults(q) {
    var items = allItems().filter(function (i) { return matches(i, q); });
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
          '<span>' + item.label + '</span></div>';
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
    renderResults('');
    input.focus();
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
