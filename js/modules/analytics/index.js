/* Console — modules/analytics. Replaced entirely when Phase 7 (Analytics + Insights) is built. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};
  Console.modules.analytics = Console.lib.createStubModule(
    'Analytics',
    '11 chart views ship in Phase 7, once the modules that feed them have data.'
  );
})();
