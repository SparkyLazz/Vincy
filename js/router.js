/* Console — router.js
   Hash-based routing (#/today, #/tasks, ...) so the app works opened directly from file://
   with no server. Each route maps to a module exposing init(container)/destroy(). */
(function () {
  'use strict';
  window.Console = window.Console || {};

  var DEFAULT_ROUTE = 'today';
  var VALID_ROUTES = ['today', 'tasks', 'schedule', 'habits', 'finance', 'focus', 'analytics', 'insights', 'settings'];

  var contentEl = null;
  var currentRoute = null;
  var currentModule = null;

  function parseHash() {
    var raw = (location.hash || '').replace(/^#\/?/, '');
    var key = raw.split('/')[0];
    return VALID_ROUTES.indexOf(key) !== -1 ? key : DEFAULT_ROUTE;
  }

  function updateChrome(route) {
    document.querySelectorAll('.nav-item[data-route]').forEach(function (item) {
      item.classList.toggle('active', item.dataset.route === route);
    });
    var here = document.querySelector('.breadcrumb .here');
    if (here) here.textContent = route;
  }

  function applyLayout(mod) {
    // Today (and every Phase 1 stub) render inside .content/.content-inner's own padding/max-width/
    // scroll. Tasks (Phase 2) declares `layout: 'flush'` because it brings its own full-bleed row
    // structure (page-head-row/view-tabs-row/metrics-row/twopane-row) and needs .content to stop
    // padding/centering/scrolling so only .twopane-row's inner pane scrolls. See base.css's
    // "TABBED MODULE LAYOUT" block and Console_Workflow.md for the full reasoning. Toggling a class
    // here — rather than restructuring index.html per module — means Today's already-verified
    // Phase 1 rendering path is untouched when `mod.layout` is unset (the default).
    var isFlush = !!(mod && mod.layout === 'flush');
    contentEl.classList.toggle('flush', isFlush);
    if (contentEl.parentElement) contentEl.parentElement.classList.toggle('flush', isFlush);
  }

  function go(route) {
    if (VALID_ROUTES.indexOf(route) === -1) route = DEFAULT_ROUTE;
    if (route === currentRoute) return;

    if (currentModule && typeof currentModule.destroy === 'function') {
      currentModule.destroy();
    }

    currentRoute = route;
    var mod = Console.modules[route];
    updateChrome(route);
    applyLayout(mod);

    if (!mod) {
      contentEl.innerHTML = '<div class="empty"><div class="empty-title">Module failed to load</div>' +
        '<div class="empty-sub">No module registered for "' + route + '".</div></div>';
      currentModule = null;
      return;
    }

    currentModule = mod;
    mod.init(contentEl);
  }

  function onHashChange() {
    go(parseHash());
  }

  function navigate(route) {
    // triggers hashchange -> go(); keeps the URL and app state in sync from one code path
    if (location.hash.replace(/^#\/?/, '') === route) { go(route); return; }
    location.hash = '#/' + route;
  }

  function init(container) {
    contentEl = container;
    document.querySelectorAll('.nav-item[data-route]').forEach(function (item) {
      item.addEventListener('click', function () { navigate(item.dataset.route); });
    });
    window.addEventListener('hashchange', onHashChange);
    if (!location.hash) location.hash = '#/' + DEFAULT_ROUTE;
    go(parseHash());
  }

  Console.router = { init: init, navigate: navigate, VALID_ROUTES: VALID_ROUTES };
})();
