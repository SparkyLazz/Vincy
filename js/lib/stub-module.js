/* Console — lib/stub-module.js
   Factory for the 8 not-yet-built modules. Each renders the shared `.empty` component
   (components.css) so nav links never dead-end. When a phase actually builds a module,
   its index.js gets replaced outright — this file only exists for what hasn't shipped yet. */

(function () {
  'use strict';

  window.Console = window.Console || {};
  Console.lib = Console.lib || {};

  Console.lib.createStubModule = function (title, phaseNote) {
    return {
      init: function (container) {
        container.innerHTML =
          '<div class="page-head">' +
            '<h1 class="page-title">' + title + '</h1>' +
          '</div>' +
          '<div class="card">' +
            '<div class="empty">' +
              '<div class="glyph">' +
                '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>' +
              '</div>' +
              '<div class="empty-title">Not built yet</div>' +
              '<div class="empty-sub">' + phaseNote + '</div>' +
            '</div>' +
          '</div>';
      },
      destroy: function () { /* no listeners/timers to tear down */ }
    };
  };
})();
