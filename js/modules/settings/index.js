/* Console — modules/settings. Full settings UI (5 sections) ships in Phase 8.
   Phase 1 only needs a bare trigger for JSON export/import (see phase_1_foundation.md
   acceptance criteria) — the underlying logic lives in db.js; this just exposes it. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  Console.modules.settings = {
    init: function (container) {
      container.innerHTML =
        '<div class="page-head">' +
          '<h1 class="page-title">Settings</h1>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-head">' +
            '<span class="card-title">Backup</span>' +
            '<span class="card-sub">JSON export / import</span>' +
          '</div>' +
          '<div class="stack">' +
            '<div class="hstack">' +
              '<button class="btn secondary" id="settings-export">Export all data</button>' +
              '<button class="btn secondary" id="settings-import">Import from file</button>' +
              '<input type="file" id="settings-import-input" accept="application/json" class="visually-hidden">' +
            '</div>' +
            '<div class="hint" id="settings-backup-status"></div>' +
          '</div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="empty">' +
            '<div class="glyph">' +
              '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 8v4l2.5 2.5"/></svg>' +
            '</div>' +
            '<div class="empty-title">Not fully built yet</div>' +
            '<div class="empty-sub">Preferences, shortcuts reference, and backup history ship in Phase 8.</div>' +
          '</div>' +
        '</div>';

      var statusEl = container.querySelector('#settings-backup-status');
      container.querySelector('#settings-export').addEventListener('click', function () {
        Console.db.downloadExport().then(function () {
          statusEl.textContent = 'Exported ' + new Date().toLocaleString() + '.';
        }).catch(function (err) {
          statusEl.textContent = 'Export failed: ' + err.message;
        });
      });

      var fileInput = container.querySelector('#settings-import-input');
      container.querySelector('#settings-import').addEventListener('click', function () {
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        var file = fileInput.files[0];
        if (!file) return;
        Console.db.uploadImport(file).then(function () {
          statusEl.textContent = 'Imported ' + new Date().toLocaleString() + '. Reload to see the data everywhere.';
        }).catch(function (err) {
          statusEl.textContent = 'Import failed: ' + err.message;
        });
        fileInput.value = '';
      });
    },
    destroy: function () { /* listeners are on nodes we discard with the container */ }
  };
})();
