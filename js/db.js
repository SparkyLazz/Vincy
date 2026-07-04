/* Console — db.js
   IndexedDB layer. Classic script (no ES module import/export) on purpose: the app must open
   directly from file://, and `<script type="module">` module graphs are blocked by CORS in
   several browsers under the file:// origin. Everything hangs off the global `Console` namespace
   instead. See docs/Console_Workflow.md for the reasoning.

   All 13 stores from Console_Features_List.md are created now, at version 1, so no later phase
   needs a migration — a locked decision, not a convenience. */

(function () {
  'use strict';

  window.Console = window.Console || {};

  var DB_NAME = 'console-db';
  var DB_VERSION = 1;

  // store name -> { keyPath, indexes: [ [name, keyPathOrArray, options] ] }
  var SCHEMA = {
    tasks: { keyPath: 'id', indexes: [
      ['status', 'status'], ['project_id', 'project_id'], ['due_date', 'due_date'],
      ['tags', 'tags', { multiEntry: true }]
    ] },
    projects: { keyPath: 'id', indexes: [
      ['status', 'status'], ['archived_at', 'archived_at']
    ] },
    events: { keyPath: 'id', indexes: [
      ['start_date', 'start_date'], ['type', 'type'], ['project_id', 'project_id']
    ] },
    event_logs: { keyPath: 'id', indexes: [
      ['event_id', 'event_id'], ['date', 'date'], ['event_id_date', ['event_id', 'date']]
    ] },
    event_recur_definitions: { keyPath: 'id', indexes: [
      ['next_run_date', 'next_run_date']
    ] },
    theme_days: { keyPath: 'id', indexes: [
      ['day_of_week', 'day_of_week']
    ] },
    habits: { keyPath: 'id', indexes: [
      ['status', 'status'], ['cadence', 'cadence']
    ] },
    habit_logs: { keyPath: 'id', indexes: [
      ['habit_id', 'habit_id'], ['date', 'date'], ['habit_id_date', ['habit_id', 'date']]
    ] },
    transactions: { keyPath: 'id', indexes: [
      ['date', 'date'], ['envelope_id', 'envelope_id'], ['project_id', 'project_id'], ['currency', 'currency']
    ] },
    envelopes: { keyPath: 'id', indexes: [
      ['period', 'period'], ['category_id', 'category_id']
    ] },
    categories: { keyPath: 'id', indexes: [
      ['type', 'type'], ['parent_id', 'parent_id']
    ] },
    focus_sessions: { keyPath: 'id', indexes: [
      ['start_at', 'start_at'], ['type', 'type'], ['task_id', 'task_id'], ['habit_id', 'habit_id']
    ] },
    insights: { keyPath: 'id', indexes: [
      ['detector', 'detector'], ['created_at', 'created_at'], ['score', 'score']
    ] },
    preferences: { keyPath: 'key', indexes: [] },
    backups: { keyPath: 'id', indexes: [
      ['created_at', 'created_at']
    ] }
  };

  var STORE_NAMES = Object.keys(SCHEMA);
  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORE_NAMES.forEach(function (name) {
          if (db.objectStoreNames.contains(name)) return;
          var def = SCHEMA[name];
          var store = db.createObjectStore(name, { keyPath: def.keyPath });
          def.indexes.forEach(function (idx) {
            store.createIndex(idx[0], idx[1], idx[2] || {});
          });
        });
      };

      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function (e) {
        console.error('[Console.db] failed to open', e.target.error);
        reject(e.target.error);
      };
    });
    return _dbPromise;
  }

  function tx(storeName, mode) {
    return openDB().then(function (db) {
      return db.transaction(storeName, mode || 'readonly').objectStore(storeName);
    });
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function (e) { resolve(e.target.result); };
      request.onerror = function (e) { reject(e.target.error); };
    });
  }

  function put(storeName, value) {
    return tx(storeName, 'readwrite').then(function (store) { return wrap(store.put(value)); });
  }

  function get(storeName, key) {
    return tx(storeName, 'readonly').then(function (store) { return wrap(store.get(key)); });
  }

  function getAll(storeName) {
    return tx(storeName, 'readonly').then(function (store) { return wrap(store.getAll()); });
  }

  function getAllByIndex(storeName, indexName, query) {
    return tx(storeName, 'readonly').then(function (store) {
      return wrap(store.index(indexName).getAll(query));
    });
  }

  function remove(storeName, key) {
    return tx(storeName, 'readwrite').then(function (store) { return wrap(store.delete(key)); });
  }

  function count(storeName) {
    return tx(storeName, 'readonly').then(function (store) { return wrap(store.count()); });
  }

  function clearStore(storeName) {
    return tx(storeName, 'readwrite').then(function (store) { return wrap(store.clear()); });
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback for older engines — good enough for local-only ids
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---- preferences convenience (keyPath is literally "key") ----
  function getPref(key, fallback) {
    return get('preferences', key).then(function (row) {
      return row ? row.value : fallback;
    });
  }
  function setPref(key, value) {
    return put('preferences', { key: key, value: value });
  }

  // ---- export / import (Phase 1 acceptance criterion) ----
  function exportAll() {
    return Promise.all(STORE_NAMES.map(function (name) {
      return getAll(name).then(function (rows) { return [name, rows]; });
    })).then(function (pairs) {
      var out = { app: 'console', schema_version: DB_VERSION, exported_at: new Date().toISOString(), stores: {} };
      pairs.forEach(function (pair) { out.stores[pair[0]] = pair[1]; });
      return out;
    });
  }

  function importAll(payload) {
    if (!payload || !payload.stores) return Promise.reject(new Error('Invalid backup file — missing "stores".'));
    var names = Object.keys(payload.stores).filter(function (n) { return STORE_NAMES.indexOf(n) !== -1; });
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(names, 'readwrite');
        t.oncomplete = function () { resolve(); };
        t.onerror = function (e) { reject(e.target.error); };
        names.forEach(function (name) {
          var store = t.objectStore(name);
          store.clear();
          (payload.stores[name] || []).forEach(function (row) { store.put(row); });
        });
      });
    });
  }

  function downloadExport() {
    return exportAll().then(function (data) {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      var stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = 'console-backup-' + stamp + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return put('backups', { id: uuid(), created_at: new Date().toISOString(), kind: 'export' });
    });
  }

  function uploadImport(file) {
    return file.text().then(function (text) {
      var payload = JSON.parse(text);
      return importAll(payload).then(function () {
        return put('backups', { id: uuid(), created_at: new Date().toISOString(), kind: 'import' });
      });
    });
  }

  Console.db = {
    STORE_NAMES: STORE_NAMES,
    open: openDB,
    put: put,
    get: get,
    getAll: getAll,
    getAllByIndex: getAllByIndex,
    remove: remove,
    count: count,
    clearStore: clearStore,
    uuid: uuid,
    getPref: getPref,
    setPref: setPref,
    exportAll: exportAll,
    importAll: importAll,
    downloadExport: downloadExport,
    uploadImport: uploadImport
  };
})();
