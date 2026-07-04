/* Console — lib/capture.js
   Shared NLP-ish quick-capture parser + task creation, extracted in Phase 2 (Tasks). Originally
   built as private functions inside js/modules/tasks/index.js, then pulled out here once Today's
   Quick Capture card (console_today_prototype.html) needed the same "type a line, get a real
   inbox task" behavior — two independent copies of date/priority/context/project parsing was
   exactly the kind of drift the Phase 2 brief warned about for recurrence math, so this lives in
   one place instead. See docs/phase_prompts/phase_2_tasks.md.
   Depends on Console.lib.format (date helpers) and Console.db — both load before this at
   init time, but this file only calls them inside functions, not at parse time, so load order
   just needs to put this before any module that calls Console.lib.parseCapture/captureTask. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.lib = Console.lib || {};

  var WEEKDAY_NAMES = {
    sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
    wed: 3, weds: 3, wednesday: 3, thu: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5, sat: 6, saturday: 6
  };

  // From a single free-text capture line, extracts:
  //   due date  — `today`, `tomorrow`, a weekday name (next occurrence), or an explicit YYYY-MM-DD
  //   priority  — !low / !med / !high
  //   context   — one or more @word tokens
  //   project   — the first #word token (name only; caller decides whether to create it)
  //   title     — remaining text with the above tokens stripped
  function parseCapture(raw) {
    var fmt = Console.lib.format;
    var text = raw;
    var result = { title: '', due_date: null, priority: null, context: [], projectName: null };

    var isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
    if (isoMatch) {
      result.due_date = isoMatch[1];
      text = text.replace(isoMatch[0], '');
    } else {
      var now = new Date();
      if (/\btoday\b/i.test(text)) {
        result.due_date = fmt.todayISO();
        text = text.replace(/\btoday\b/i, '');
      } else if (/\btomorrow\b/i.test(text)) {
        result.due_date = fmt.addDaysISO(fmt.todayISO(), 1);
        text = text.replace(/\btomorrow\b/i, '');
      } else {
        var wdMatch = text.match(/\b(sun|sunday|mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thurs|thursday|fri|friday|sat|saturday)\b/i);
        if (wdMatch) {
          var dow = WEEKDAY_NAMES[wdMatch[1].toLowerCase()];
          result.due_date = fmt.nextWeekdayISO(dow, now);
          text = text.replace(wdMatch[0], '');
        }
      }
    }

    var priMatch = text.match(/!(low|med|high)\b/i);
    if (priMatch) {
      result.priority = priMatch[1].toLowerCase();
      text = text.replace(priMatch[0], '');
    }

    var ctxMatches = text.match(/@[\w-]+/g);
    if (ctxMatches) {
      result.context = ctxMatches.map(function (c) { return c.slice(1); });
      text = text.replace(/@[\w-]+/g, '');
    }

    var projMatch = text.match(/#[\w-]+/);
    if (projMatch) {
      result.projectName = projMatch[0].slice(1);
      text = text.replace(/#[\w-]+/g, '');
    }

    result.title = text.replace(/\s+/g, ' ').trim();
    return result;
  }

  // Looks up an existing project by case-insensitive name against the live `projects` store
  // (not a caller-supplied cache — Today and Tasks each keep their own render cache, and a
  // shared helper reading stale cache state risks the two modules creating duplicate projects).
  function findOrCreateProject(name) {
    var db = Console.db;
    if (!name) return Promise.resolve(null);
    return db.getAll('projects').then(function (projects) {
      var existing = projects.find(function (p) {
        return p.name && p.name.toLowerCase() === name.toLowerCase();
      });
      if (existing) return existing.id;
      var proj = { id: db.uuid(), name: name, status: 'active', archived_at: null };
      return db.put('projects', proj).then(function () { return proj.id; });
    });
  }

  // Parses `raw`, creates the project inline if it doesn't exist yet (GTD inbox-first — capture
  // must never block on picking an existing project), writes a real `tasks` row with
  // status: 'inbox', and resolves the created task. Resolves null if there's no title to capture
  // (e.g. the line was only modifiers with no remaining text).
  function captureTask(raw) {
    var db = Console.db;
    var parsed = parseCapture(raw);
    if (!parsed.title) return Promise.resolve(null);
    return findOrCreateProject(parsed.projectName).then(function (projectId) {
      var now = new Date().toISOString();
      var task = {
        id: db.uuid(),
        title: parsed.title,
        status: 'inbox',
        priority: parsed.priority,
        context: parsed.context,
        project_id: projectId,
        tags: [],
        due_date: parsed.due_date,
        due_time: null,
        est_minutes: null,
        notes: '',
        subtasks: [],
        activity: [{ type: 'create', text: 'Captured via quick capture: “' + parsed.title + '”', at: now }],
        created_at: now,
        processed_at: null
      };
      return db.put('tasks', task).then(function () { return task; });
    });
  }

  Console.lib.parseCapture = parseCapture;
  Console.lib.captureTask = captureTask;
})();
