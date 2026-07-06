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

  // View/route transition (added on top of the FX pass, per explicit user request — a page-fade
  // on nav clicks). Two things make this less trivial than every other animation in this pass:
  // 1) `contentEl` (`#app-content`) is a persistent node that just gets its `innerHTML` swapped,
  //    never replaced, so a CSS `animation` on it only plays once (on load) unless something
  //    restarts it — the standard fix is remove-class/force-reflow/re-add-class.
  // 2) Every module's real render() runs inside an IndexedDB promise callback (`loadData().then(
  //    function (data) { render(container, data); })`, checked across today/tasks/schedule/etc. —
  //    `mod.init(contentEl)` returns immediately, before that promise resolves. Firing the restart
  //    right after calling `init()` (what an earlier version of this function did) would restart
  //    the animation on the OLD content a beat before the new content actually lands, so the fade
  //    would play against a stale/near-empty container instead of the view the user is navigating
  //    to. A MutationObserver watching for the real childList swap — whenever it actually happens,
  //    sync or async — is what makes this work uniformly for every module without editing each
  //    one's render() to call back into the router.
  var routeFadeObserver = null;
  function armRouteFade() {
    if (routeFadeObserver) { routeFadeObserver.disconnect(); routeFadeObserver = null; }
    if (!contentEl) return;
    routeFadeObserver = new MutationObserver(function () {
      routeFadeObserver.disconnect();
      routeFadeObserver = null;
      contentEl.classList.remove('route-fade');
      void contentEl.offsetWidth;
      contentEl.classList.add('route-fade');
    });
    routeFadeObserver.observe(contentEl, { childList: true });
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
    // Armed before either branch mutates contentEl below, so it catches that mutation whenever it
    // actually lands — immediately for the synchronous fallback branch, or later for a real
    // module's async render().
    armRouteFade();

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
    // Phase 9 (Settings): `Console.defaultLandingView` is read from `preferences` by app.js's
    // boot() BEFORE router.init() is called (see app.js's restoreSettingsDefaults()), so it's
    // available synchronously here — falls back to the original hardcoded 'today' if unset or
    // invalid, same as every other route validation in this file.
    var landing = Console.defaultLandingView;
    if (!location.hash) location.hash = '#/' + (VALID_ROUTES.indexOf(landing) !== -1 ? landing : DEFAULT_ROUTE);
    go(parseHash());
  }

  Console.router = { init: init, navigate: navigate, VALID_ROUTES: VALID_ROUTES };
})();
