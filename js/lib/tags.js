/* Console — lib/tags.js
   Single source of truth for the tag concept. Tags have no store of their own — they exist as
   string arrays on tasks (`tasks.tags`) and a single string on habits (`habits.tag`), and the
   habit↔task cross-domain link matches purely on that string. Before this file, three places
   derived "all tags" independently (the Tasks New-Task picker, Settings' Tags manager, Tasks'
   by-tag grouping) and disagreed with each other — e.g. a tag only a habit used showed up in the
   New-Task picker but not in Settings, which read as a bug ("where did #career come from?").
   Every module that needs the tag universe goes through collectTags() now.
   Load order: after js/lib/format.js, before any module (classic script tags in index.html). */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.lib = Console.lib || {};

  // One tag "spelling" everywhere — Habits links to Tasks purely by tag string, so a task tagged
  // "#Reading " and a habit tagged "reading" must resolve to the same tag or the habit's
  // cross-domain count silently reads 0. Strips any leading #, trims. Case is preserved for
  // display; use sameTag() for comparisons so case never breaks a link either.
  function normalizeTag(s) {
    return String(s == null ? '' : s).trim().replace(/^#+/, '').trim();
  }

  function sameTag(a, b) {
    return normalizeTag(a).toLowerCase() === normalizeTag(b).toLowerCase();
  }

  // The canonical union of every tag the app knows about — task tags AND habit tags — merged
  // case-insensitively (canonical display casing = first spelling encountered; tasks scan first).
  // Returns [{ tag, taskCount, habitCount }] sorted alphabetically. taskCount counts tasks that
  // carry the tag (a task can only count once even if it somehow held two case variants);
  // habitCount counts habits whose link tag matches.
  function collectTags(tasks, habits) {
    var rows = [];
    function rowFor(raw) {
      var i;
      for (i = 0; i < rows.length; i++) { if (sameTag(rows[i].tag, raw)) return rows[i]; }
      var row = { tag: normalizeTag(raw), taskCount: 0, habitCount: 0 };
      rows.push(row);
      return row;
    }
    (tasks || []).forEach(function (t) {
      var counted = [];
      (t.tags || []).forEach(function (tag) {
        if (!normalizeTag(tag)) return;
        var row = rowFor(tag);
        if (counted.indexOf(row) === -1) { row.taskCount++; counted.push(row); }
      });
    });
    (habits || []).forEach(function (h) {
      if (h && h.tag && normalizeTag(h.tag)) rowFor(h.tag).habitCount++;
    });
    return rows.sort(function (a, b) { return a.tag.toLowerCase().localeCompare(b.tag.toLowerCase()); });
  }

  Console.lib.normalizeTag = normalizeTag;
  Console.lib.sameTag = sameTag;
  Console.lib.collectTags = collectTags;
})();
