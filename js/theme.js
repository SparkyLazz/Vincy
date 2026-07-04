/* Console — theme.js
   Light/dark toggle, persisted to the `preferences` store (not just in-memory — a reload
   must keep the theme, per the Phase 1 acceptance criteria). */
(function () {
  'use strict';
  window.Console = window.Console || {};

  var PREF_KEY = 'theme';

  function apply(value) {
    document.documentElement.dataset.theme = value;
    document.querySelectorAll('#ttoggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.theme === value);
    });
  }

  function set(value) {
    apply(value);
    return Console.db.setPref(PREF_KEY, value);
  }

  function init() {
    return Console.db.getPref(PREF_KEY, 'light').then(function (value) {
      apply(value);
      var toggle = document.getElementById('ttoggle');
      if (toggle) {
        toggle.addEventListener('click', function (e) {
          var btn = e.target.closest('button');
          if (!btn) return;
          set(btn.dataset.theme);
        });
      }
      return value;
    });
  }

  Console.theme = { init: init, set: set, apply: apply };
})();
