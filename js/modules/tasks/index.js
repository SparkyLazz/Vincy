/* Console — modules/tasks. Phase 2: GTD inbox-first capture + processing, 8 filtered views over
   one shared list+detail shell (extracted from console_tasks_prototype.html — see
   docs/phase_prompts/phase_2_tasks.md and docs/Console_Workflow.md for the extraction/conflict log).
   layout: 'flush' tells router.js/app.js this module owns the full content region itself (its own
   page-head-row/view-tabs-row/metrics-row/twopane-row each center to 1180px and own their padding)
   instead of rendering inside .content/.content-inner like Today's dashboard does. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;
  var keydownHandler = null;
  var refreshHandle = null;

  var currentView = 'inbox';
  var selectedId = null;
  var inlineEditing = null; // 'schedule' | 'move' | 'subtask' | 'tag' | null — which inline control is open in the detail pane

  var VIEWS = [
    { key: 'inbox', label: 'inbox' },
    { key: 'today', label: 'today' },
    { key: 'week', label: 'this week' },
    { key: 'upcoming', label: 'upcoming' },
    { key: 'someday', label: 'someday' },
    { key: 'waiting', label: 'waiting' },
    { key: 'project', label: 'by project' },
    { key: 'tag', label: 'by tag' }
  ];

  var cache = { tasks: [], projects: [] };
  var visibleOrder = []; // ids in the order currently rendered, for J/K navigation

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Thin wrappers over the shared date helpers (js/lib/format.js) — kept as local names since
  // they're called throughout this file (dateBucket, snooze, view filters), not just capture.
  function addDays(iso, n) { return fmt.addDaysISO(iso, n); }
  function daysBetween(fromISO, toISO) { return fmt.daysBetweenISO(fromISO, toISO); }

  // NLP-ish capture parsing and task creation moved to js/lib/capture.js in this pass — Today's
  // Quick Capture card needs the identical parser, and two copies drifting was the exact risk
  // the Phase 2 brief flagged for date-math sharing. See Console.lib.parseCapture/captureTask.

  // ---------------------------------------------------------------- metrics

  function computeMetrics(tasks) {
    var todayISO = fmt.todayISO();
    var weekAgoISO = addDays(todayISO, -7);
    var inboxDepth = tasks.filter(function (t) { return t.status === 'inbox'; }).length;
    var capturedThisWeek = tasks.filter(function (t) {
      return t.created_at && t.created_at.slice(0, 10) >= weekAgoISO;
    }).length;
    var processedTodayTasks = tasks.filter(function (t) {
      return t.processed_at && t.processed_at.slice(0, 10) === todayISO;
    });
    var avgSec = 0;
    if (processedTodayTasks.length) {
      var totalSec = processedTodayTasks.reduce(function (sum, t) {
        return sum + Math.max(0, (new Date(t.processed_at) - new Date(t.created_at)) / 1000);
      }, 0);
      avgSec = Math.round(totalSec / processedTodayTasks.length);
    }
    return {
      inboxDepth: inboxDepth,
      capturedThisWeek: capturedThisWeek,
      processedToday: processedTodayTasks.length,
      avgSec: avgSec
    };
  }

  // ---------------------------------------------------------------- view filtering

  function viewTasks(view, tasks, todayISO) {
    switch (view) {
      case 'inbox': return tasks.filter(function (t) { return t.status === 'inbox'; });
      case 'today': return tasks.filter(function (t) { return t.due_date === todayISO && t.status !== 'done'; });
      case 'week': return tasks.filter(function (t) {
        if (!t.due_date || t.status === 'done') return false;
        var d = daysBetween(todayISO, t.due_date);
        return d >= 0 && d < 7;
      });
      case 'upcoming': return tasks.filter(function (t) {
        if (!t.due_date || t.status === 'done') return false;
        var d = daysBetween(todayISO, t.due_date);
        return d < 14;
      });
      case 'someday': return tasks.filter(function (t) { return t.status === 'someday'; });
      case 'waiting': return tasks.filter(function (t) { return t.status === 'waiting'; });
      case 'project': return tasks.filter(function (t) { return t.status !== 'done' && t.project_id; });
      case 'tag': return tasks.filter(function (t) { return t.status !== 'done' && t.tags && t.tags.length; });
      default: return [];
    }
  }

  function viewCounts(tasks, todayISO) {
    var counts = {};
    VIEWS.forEach(function (v) { counts[v.key] = viewTasks(v.key, tasks, todayISO).length; });
    return counts;
  }

  function dateBucket(dueISO, todayISO) {
    var d = daysBetween(todayISO, dueISO);
    if (d < 0) return 'overdue';
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d < 7) return 'weekday';
    return 'nextweek';
  }

  function bucketLabel(bucket, dueISO) {
    var d = new Date(dueISO + 'T00:00:00');
    var wd = fmt.longWeekday(d).toLowerCase();
    var md = fmt.monthDay(d).toLowerCase();
    if (bucket === 'overdue') return 'overdue';
    if (bucket === 'today') return 'today · ' + wd.slice(0, 3) + ' ' + md;
    if (bucket === 'tomorrow') return 'tomorrow · ' + wd.slice(0, 3) + ' ' + md;
    if (bucket === 'weekday') return wd + ' · ' + md;
    return 'next week';
  }

  // Groups: [{ key, label, tasks: [...] }], in display order
  function buildGroups(view, tasks, projects, todayISO) {
    if (view === 'upcoming') {
      var buckets = {};
      var order = ['overdue', 'today', 'tomorrow', 'weekday', 'nextweek'];
      tasks.forEach(function (t) {
        var b = dateBucket(t.due_date, todayISO);
        buckets[b] = buckets[b] || [];
        buckets[b].push(t);
      });
      return order.filter(function (b) { return buckets[b] && buckets[b].length; }).map(function (b) {
        var label = b === 'nextweek' ? 'next week' : bucketLabel(b, buckets[b][0].due_date);
        buckets[b].sort(function (a, c) { return (a.due_date || '').localeCompare(c.due_date || ''); });
        return { key: b, label: label, tasks: buckets[b] };
      });
    }
    if (view === 'project') {
      var byProj = {};
      tasks.forEach(function (t) {
        var key = t.project_id || 'none';
        byProj[key] = byProj[key] || [];
        byProj[key].push(t);
      });
      return Object.keys(byProj).map(function (pid) {
        var proj = projects.find(function (p) { return p.id === pid; });
        return { key: pid, label: proj ? proj.name : 'no project', tasks: byProj[pid] };
      }).sort(function (a, b) { return a.label.localeCompare(b.label); });
    }
    if (view === 'tag') {
      var byTag = {};
      tasks.forEach(function (t) {
        (t.tags || []).forEach(function (tag) {
          byTag[tag] = byTag[tag] || [];
          byTag[tag].push(t);
        });
      });
      return Object.keys(byTag).sort().map(function (tag) {
        return { key: tag, label: '#' + tag, tasks: byTag[tag] };
      });
    }
    // inbox / today / week / someday / waiting — one flat group, no header
    return tasks.length ? [{ key: 'all', label: null, tasks: tasks }] : [];
  }

  // ---------------------------------------------------------------- rendering

  function priorityBars(pri) {
    var cls = pri ? ' ' + pri : '';
    return '<span class="priority' + cls + '"><span class="b"></span><span class="b"></span><span class="b"></span></span>';
  }

  function taskDur(t) {
    if (t.status === 'done') return 'done';
    if (t.due_time) return t.due_time;
    if (t.due_date) return '';
    return t.est_minutes ? '~' + t.est_minutes + 'm' : 'flexible';
  }

  function renderTaskRow(t) {
    var subCount = t.subtasks && t.subtasks.length
      ? '<span class="sub-count"><span class="done">' + t.subtasks.filter(function (s) { return s.done; }).length + '</span>/' + t.subtasks.length + ' subtasks</span>'
      : '';
    var ctx = (t.context || []).map(function (c) { return '<span class="ctx">@' + escapeHtml(c) + '</span>'; }).join('');
    var proj = t.project_id ? (function () {
      var p = cache.projects.find(function (pp) { return pp.id === t.project_id; });
      return p ? '<span class="proj">#' + escapeHtml(p.name) + '</span>' : '';
    })() : '';
    return (
      '<div class="task-row' + (t.status === 'done' ? ' done' : '') + (t.id === selectedId ? ' selected' : '') + '" data-id="' + t.id + '">' +
        '<span class="check" data-act="toggle-done" data-id="' + t.id + '"></span>' +
        '<div class="tinfo"><div class="ttitle">' + escapeHtml(t.title || 'Untitled') + '</div>' +
        '<div class="tmeta">' + ctx + proj + subCount + '</div></div>' +
        priorityBars(t.priority) +
        '<span class="tdur">' + escapeHtml(taskDur(t)) + '</span>' +
      '</div>'
    );
  }

  // Matches console_tasks_prototype.html's group-label gmeta format ("5 tasks · 3.5h est") —
  // the hour-estimate half was dropped in an earlier pass even though task.est_minutes is a real
  // schema field; restored here so real (if currently mostly zero, since nothing sets est_minutes
  // yet) data drives the same text the prototype shows, rather than a silently truncated format.
  function groupMeta(tasks) {
    var totalMin = tasks.reduce(function (sum, t) { return sum + (t.est_minutes || 0); }, 0);
    return tasks.length + ' tasks · ' + (totalMin / 60).toFixed(1) + 'h est';
  }

  function renderList(groups) {
    visibleOrder = [];
    if (!groups.length) {
      return (
        '<div class="empty">' +
          '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m9 12 2 2 4-4"/></svg></div>' +
          '<div class="empty-title">Nothing here</div>' +
          '<div class="empty-sub">' + emptyMessageFor(currentView) + '</div>' +
        '</div>'
      );
    }
    return groups.map(function (g) {
      var head = g.label
        ? '<div class="group-label' + (g.key === 'today' ? ' today' : '') + '"><span>' + escapeHtml(g.label) + '</span><span class="gmeta">' + groupMeta(g.tasks) + '</span></div>'
        : '';
      g.tasks.forEach(function (t) { visibleOrder.push(t.id); });
      return head + g.tasks.map(renderTaskRow).join('');
    }).join('');
  }

  function emptyMessageFor(view) {
    switch (view) {
      case 'inbox': return 'Capture something above — it lands here until you process it.';
      case 'today': return 'Nothing due today.';
      case 'week': return 'Nothing due in the next 7 days.';
      case 'upcoming': return 'Nothing due in the next 14 days.';
      case 'someday': return 'No someday/maybe items yet.';
      case 'waiting': return 'Nothing you’re waiting on.';
      case 'project': return 'No tasks assigned to a project yet.';
      case 'tag': return 'No tagged tasks yet.';
      default: return '';
    }
  }

  function renderDetail(task) {
    if (!task) {
      return (
        '<div class="empty">' +
          '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/></svg></div>' +
          '<div class="empty-title">No task selected</div>' +
          '<div class="empty-sub">Click a task, or use J/K to navigate.</div>' +
        '</div>'
      );
    }
    var proj = task.project_id ? cache.projects.find(function (p) { return p.id === task.project_id; }) : null;
    var chips = '';
    (task.context || []).forEach(function (c) { chips += '<span class="pill blue">@' + escapeHtml(c) + '</span>'; });
    if (proj) chips += '<span class="pill plum">#' + escapeHtml(proj.name) + '</span>';
    if (task.priority) chips += '<span class="pill amber">!' + task.priority + '</span>';
    (task.tags || []).forEach(function (t) { chips += '<span class="pill neutral">' + escapeHtml(t) + '</span>'; });

    var subtasks = task.subtasks || [];
    var doneCount = subtasks.filter(function (s) { return s.done; }).length;
    var pct = subtasks.length ? Math.round(doneCount / subtasks.length * 100) : 0;
    var subtaskList = subtasks.map(function (s) {
      return (
        '<div class="subtask' + (s.done ? ' done' : '') + '">' +
          '<span class="sub-check" data-act="toggle-subtask" data-sub="' + s.id + '"></span>' +
          '<span class="sub-title">' + escapeHtml(s.title) + '</span>' +
        '</div>'
      );
    }).join('');
    var subtaskAdd = inlineEditing === 'subtask'
      ? '<input type="text" class="notes-area compact" id="inline-subtask-input" placeholder="New subtask…">'
      : '';

    var activity = (task.activity || []).slice().reverse().map(function (a) {
      return (
        '<div class="activity-item' + (a.type ? ' ' + a.type : '') + '">' +
          '<span class="act-glyph"></span><span>' + escapeHtml(a.text) + '</span>' +
          '<span class="act-time">' + escapeHtml(new Date(a.at).toLocaleString()) + '</span>' +
        '</div>'
      );
    }).join('');

    var dueVal = task.due_date
      ? new Date(task.due_date + 'T00:00:00').toDateString()
      : 'No due date';

    var scheduleInline = inlineEditing === 'schedule'
      ? '<div class="detail-section"><input type="date" id="inline-schedule-input" value="' + (task.due_date || '') + '"></div>'
      : '';
    var moveInline = inlineEditing === 'move'
      ? '<div class="detail-section"><select id="inline-move-input"><option value="">No project</option>' +
          cache.projects.map(function (p) { return '<option value="' + p.id + '"' + (p.id === task.project_id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>'; }).join('') +
        '</select></div>'
      : '';
    var tagInline = inlineEditing === 'tag'
      ? '<input type="text" class="notes-area compact spaced" id="inline-tag-input" placeholder="Add tag, press Enter…">'
      : '';

    var actions = task.status === 'inbox'
      ? (
        '<button class="primary" data-act="process-today">Today</button>' +
        '<button data-act="process-schedule">Schedule</button>' +
        '<button data-act="process-someday">Someday</button>' +
        '<button data-act="process-waiting">Waiting</button>' +
        '<button class="danger" data-act="delete">Delete</button>'
      ) : (
        '<button class="primary" data-act="complete">' + (task.status === 'done' ? '↩ Reopen' : '✓ Complete') + '</button>' +
        '<button data-act="schedule">Schedule</button>' +
        '<button data-act="snooze">Snooze</button>' +
        '<button data-act="move">Move</button>' +
        '<button class="danger" data-act="delete">Delete</button>'
      );

    return (
      '<div class="detail-head">' +
        '<div class="detail-eyebrow">' + escapeHtml(task.status) + '</div>' +
        '<div class="detail-title">' + escapeHtml(task.title || 'Untitled') + '</div>' +
        '<div class="detail-chips">' + chips + tagInline + '</div>' +
      '</div>' +
      '<div class="detail-meta-grid">' +
        '<div class="dmeta-item"><div class="dmeta-lbl">Due</div><div class="dmeta-val">' + escapeHtml(dueVal) + '</div></div>' +
        '<div class="dmeta-item"><div class="dmeta-lbl">Created</div><div class="dmeta-val">' + escapeHtml(new Date(task.created_at).toLocaleDateString()) + '</div></div>' +
      '</div>' +
      scheduleInline + moveInline +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Subtasks · ' + doneCount + ' of ' + subtasks.length + '</span><span class="ds-action" data-act="add-subtask">+ add</span></div>' +
        (subtasks.length ? '<div class="subtask-progress"><div class="sbar"><div class="sfill" style="width:' + pct + '%;"></div></div><span>' + pct + '%</span></div>' : '') +
        '<div class="subtask-list">' + subtaskList + '</div>' + subtaskAdd +
      '</div>' +
      '<div class="detail-section">' +
        '<div class="ds-head"><span class="ds-title">Notes</span></div>' +
        '<textarea class="notes-area" id="notes-input">' + escapeHtml(task.notes || '') + '</textarea>' +
      '</div>' +
      '<div class="detail-section"><div class="ds-head"><span class="ds-title">Activity</span></div><div class="activity-list">' + activity + '</div></div>' +
      '<div class="detail-actions">' + actions + '</div>'
    );
  }

  function render() {
    var todayISO = fmt.todayISO();
    var tasks = cache.tasks;
    var counts = viewCounts(tasks, todayISO);
    var visibleTasks = viewTasks(currentView, tasks, todayISO);
    var groups = buildGroups(currentView, visibleTasks, cache.projects, todayISO);

    if (selectedId && !tasks.some(function (t) { return t.id === selectedId; })) selectedId = null;
    var selectedTask = selectedId ? tasks.find(function (t) { return t.id === selectedId; }) : null;

    var metrics = computeMetrics(tasks);
    var viewLabel = VIEWS.find(function (v) { return v.key === currentView; }).label;

    container.innerHTML =
      '<div class="page-head-row"><div class="inner">' +
        '<h1 class="page-title">Tasks &mdash; <span class="em">' + escapeHtml(viewLabel) + '</span></h1>' +
        '<span class="page-sub">' + visibleTasks.length + ' tasks</span>' +
        '<div class="page-actions">' +
          '<button class="btn-mini">Filter</button>' +
          '<button class="btn-mini">Sort: due</button>' +
          '<button class="btn-mini primary" id="btn-new-task">New task</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="view-tabs-row"><div class="view-tabs-inner">' +
        VIEWS.map(function (v) {
          return '<span class="vtab' + (v.key === currentView ? ' active' : '') + '" data-view="' + v.key + '">' + v.label + ' <span class="vcount">' + counts[v.key] + '</span></span>';
        }).join('') +
      '</div></div>' +
      '<div class="metrics-row"><div class="metrics-inner">' +
        '<div class="metric"><div class="mnum">' + metrics.inboxDepth + '</div><div class="mlbl"><span>inbox depth</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.capturedThisWeek + '</div><div class="mlbl"><span>captured this week</span><span class="mtrend">' + (metrics.capturedThisWeek / 7).toFixed(1) + '/day avg</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.processedToday + '</div><div class="mlbl"><span>processed today</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.avgSec + '<span class="munit">s</span></div><div class="mlbl"><span>avg processing time</span></div></div>' +
      '</div></div>' +
      '<div class="capture-row"><div class="capture-inner"><div class="capture-card">' +
        '<div class="cap-left"><div class="cap-glyph">+</div><input class="cap-input" id="cap-input" placeholder="call vendor tomorrow !high @phone #client-a" autocomplete="off"></div>' +
        '<div class="cap-right"><div class="cap-parsed" id="cap-parsed"></div></div>' +
      '</div></div></div>' +
      '<div class="twopane-row"><div class="twopane-inner">' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">' + escapeHtml(viewLabel.charAt(0).toUpperCase() + viewLabel.slice(1)) + '</span><span class="pane-meta">' + visibleTasks.length + ' tasks</span></div>' +
          '<div class="pane-body" id="task-list">' + renderList(groups) + '</div>' +
        '</div>' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">Task detail</span><span class="pane-meta">N J K X S T ⌘E</span></div>' +
          '<div class="pane-body" id="task-detail">' + renderDetail(selectedTask) + '</div>' +
        '</div>' +
      '</div></div>' +
      '<div class="kbd-hints">' +
        '<span class="khint"><span class="kbd">N</span><span class="klbl">new task</span></span>' +
        '<span class="khint"><span class="kbd">J</span><span class="kbd">K</span><span class="klbl">navigate</span></span>' +
        '<span class="khint"><span class="kbd">X</span><span class="klbl">complete</span></span>' +
        '<span class="khint"><span class="kbd">S</span><span class="klbl">schedule</span></span>' +
        '<span class="khint"><span class="kbd">T</span><span class="klbl">add tag</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">E</span><span class="klbl">edit notes</span></span>' +
      '</div>';

    wireDynamicInputs();
  }

  function wireDynamicInputs() {
    var capInput = document.getElementById('cap-input');
    if (capInput) {
      updateParsePreview(capInput.value);
      capInput.addEventListener('input', function () { updateParsePreview(capInput.value); });
      capInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && capInput.value.trim()) {
          e.preventDefault();
          submitCapture(capInput.value.trim());
        }
      });
    }
    var notesInput = document.getElementById('notes-input');
    if (notesInput) {
      notesInput.addEventListener('change', function () {
        var task = cache.tasks.find(function (t) { return t.id === selectedId; });
        if (!task) return;
        task.notes = notesInput.value;
        task.activity = task.activity || [];
        task.activity.push({ type: '', text: 'Notes updated', at: new Date().toISOString() });
        db.put('tasks', task);
      });
    }
    var scheduleInput = document.getElementById('inline-schedule-input');
    if (scheduleInput) {
      scheduleInput.addEventListener('change', function () {
        var task = cache.tasks.find(function (t) { return t.id === selectedId; });
        if (!task || !scheduleInput.value) return;
        task.due_date = scheduleInput.value;
        if (task.status === 'inbox') { task.status = 'active'; task.processed_at = task.processed_at || new Date().toISOString(); }
        task.activity = task.activity || [];
        task.activity.push({ type: '', text: 'Scheduled for ' + scheduleInput.value, at: new Date().toISOString() });
        inlineEditing = null;
        db.put('tasks', task).then(refreshAndRender);
      });
    }
    var moveInput = document.getElementById('inline-move-input');
    if (moveInput) {
      moveInput.addEventListener('change', function () {
        var task = cache.tasks.find(function (t) { return t.id === selectedId; });
        if (!task) return;
        task.project_id = moveInput.value || null;
        task.activity = task.activity || [];
        task.activity.push({ type: '', text: 'Moved to another project', at: new Date().toISOString() });
        inlineEditing = null;
        db.put('tasks', task).then(refreshAndRender);
      });
    }
    var subtaskInput = document.getElementById('inline-subtask-input');
    if (subtaskInput) {
      subtaskInput.focus();
      subtaskInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && subtaskInput.value.trim()) {
          var task = cache.tasks.find(function (t) { return t.id === selectedId; });
          if (!task) return;
          task.subtasks = task.subtasks || [];
          task.subtasks.push({ id: db.uuid(), title: subtaskInput.value.trim(), done: false });
          inlineEditing = null;
          db.put('tasks', task).then(refreshAndRender);
        } else if (e.key === 'Escape') {
          inlineEditing = null;
          render();
        }
      });
    }
    var tagInput = document.getElementById('inline-tag-input');
    if (tagInput) {
      tagInput.focus();
      tagInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && tagInput.value.trim()) {
          var task = cache.tasks.find(function (t) { return t.id === selectedId; });
          if (!task) return;
          task.tags = task.tags || [];
          task.tags.push(tagInput.value.trim());
          inlineEditing = null;
          db.put('tasks', task).then(refreshAndRender);
        } else if (e.key === 'Escape') {
          inlineEditing = null;
          render();
        }
      });
    }
  }

  function updateParsePreview(raw) {
    var el = document.getElementById('cap-parsed');
    if (!el) return;
    if (!raw.trim()) { el.innerHTML = ''; return; }
    var parsed = Console.lib.parseCapture(raw);
    var chips = '<span>Parsed:</span>';
    if (parsed.due_date) chips += '<span class="parsed-chip due">' + parsed.due_date + '</span>';
    if (parsed.priority) chips += '<span class="parsed-chip pri">!' + parsed.priority + '</span>';
    parsed.context.forEach(function (c) { chips += '<span class="parsed-chip ctx">@' + escapeHtml(c) + '</span>'; });
    if (parsed.projectName) chips += '<span class="parsed-chip proj">#' + escapeHtml(parsed.projectName) + '</span>';
    chips += '<span class="parsed-chip-sep">·</span><span class="parsed-chip submit">↵ capture</span>';
    el.innerHTML = chips;
  }

  function submitCapture(raw) {
    Console.lib.captureTask(raw).then(function (task) {
      if (task) refreshAndRender();
    });
  }

  // ---------------------------------------------------------------- actions

  function findTask(id) { return cache.tasks.find(function (t) { return t.id === id; }); }

  function toggleDone(id) {
    var task = findTask(id);
    if (!task) return;
    var wasDone = task.status === 'done';
    task._prevStatus = task._prevStatus || 'active';
    if (wasDone) {
      task.status = task._prevStatus || 'active';
    } else {
      task._prevStatus = task.status;
      task.status = 'done';
      if (!task.processed_at) task.processed_at = new Date().toISOString();
    }
    task.activity = task.activity || [];
    task.activity.push({ type: wasDone ? '' : 'complete', text: wasDone ? 'Reopened' : 'Completed', at: new Date().toISOString() });
    db.put('tasks', task).then(refreshAndRender);
  }

  function toggleSubtask(taskId, subId) {
    var task = findTask(taskId);
    if (!task) return;
    var sub = (task.subtasks || []).find(function (s) { return s.id === subId; });
    if (!sub) return;
    sub.done = !sub.done;
    task.activity = task.activity || [];
    task.activity.push({ type: sub.done ? 'complete' : '', text: 'Subtask “' + sub.title + '” ' + (sub.done ? 'completed' : 'reopened'), at: new Date().toISOString() });
    db.put('tasks', task).then(refreshAndRender);
  }

  function handleDetailAction(act, id) {
    var task = findTask(id);
    if (!task) return;
    var now = new Date().toISOString();
    task.activity = task.activity || [];

    switch (act) {
      case 'process-today':
        task.status = 'active'; task.due_date = fmt.todayISO(); task.processed_at = task.processed_at || now;
        task.activity.push({ type: 'process', text: 'Processed: scheduled for today', at: now });
        db.put('tasks', task).then(refreshAndRender);
        break;
      case 'process-someday':
        task.status = 'someday'; task.processed_at = task.processed_at || now;
        task.activity.push({ type: 'process', text: 'Processed: moved to someday/maybe', at: now });
        db.put('tasks', task).then(refreshAndRender);
        break;
      case 'process-waiting':
        task.status = 'waiting'; task.processed_at = task.processed_at || now;
        task.activity.push({ type: 'process', text: 'Processed: moved to waiting', at: now });
        db.put('tasks', task).then(refreshAndRender);
        break;
      case 'process-schedule':
      case 'schedule':
        inlineEditing = 'schedule'; render();
        break;
      case 'move':
        inlineEditing = 'move'; render();
        break;
      case 'snooze':
        task.due_date = task.due_date ? addDays(task.due_date, 1) : addDays(fmt.todayISO(), 1);
        task.activity.push({ type: '', text: 'Snoozed to ' + task.due_date, at: now });
        db.put('tasks', task).then(refreshAndRender);
        break;
      case 'complete':
        toggleDone(id);
        break;
      case 'add-subtask':
        inlineEditing = 'subtask'; render();
        break;
      case 'delete':
        db.remove('tasks', id).then(function () {
          if (selectedId === id) selectedId = null;
          refreshAndRender();
        });
        break;
    }
  }

  function onContainerClick(e) {
    var vtab = e.target.closest('.vtab');
    if (vtab) { currentView = vtab.dataset.view; selectedId = null; inlineEditing = null; render(); return; }

    var check = e.target.closest('[data-act="toggle-done"]');
    if (check) { toggleDone(check.dataset.id); return; }

    var subCheck = e.target.closest('[data-act="toggle-subtask"]');
    if (subCheck && selectedId) { toggleSubtask(selectedId, subCheck.dataset.sub); return; }

    var row = e.target.closest('.task-row');
    if (row && !e.target.closest('.check')) {
      selectedId = row.dataset.id; inlineEditing = null; render(); return;
    }

    var newTaskBtn = e.target.closest('#btn-new-task');
    if (newTaskBtn) { focusCapture(); return; }

    var detailAct = e.target.closest('[data-act]');
    if (detailAct && selectedId && detailAct.dataset.act) { handleDetailAction(detailAct.dataset.act, selectedId); }
  }

  function focusCapture() {
    var el = document.getElementById('cap-input');
    if (el) el.focus();
  }

  function onKeydown(e) {
    var overlay = document.getElementById('cmd-overlay');
    if (overlay && !overlay.hidden) return; // command palette owns the keyboard while open
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

    var key = e.key.toLowerCase();
    if (key === 'n') { e.preventDefault(); focusCapture(); return; }
    if (key === 'j' || key === 'k') {
      e.preventDefault();
      if (!visibleOrder.length) return;
      var idx = visibleOrder.indexOf(selectedId);
      if (idx === -1) idx = key === 'j' ? -1 : 0;
      idx = key === 'j' ? Math.min(visibleOrder.length - 1, idx + 1) : Math.max(0, idx - 1);
      selectedId = visibleOrder[idx];
      render();
      return;
    }
    if (key === 'x' && selectedId) { e.preventDefault(); toggleDone(selectedId); return; }
    if (key === 's' && selectedId) { e.preventDefault(); handleDetailAction('schedule', selectedId); return; }
    if (key === 't' && selectedId) { e.preventDefault(); inlineEditing = 'tag'; render(); return; }
    if (key === 'e' && (e.metaKey || e.ctrlKey) && selectedId) {
      e.preventDefault();
      var notes = document.getElementById('notes-input');
      if (notes) notes.focus();
    }
  }

  function refreshAndRender() {
    return Promise.all([db.getAll('tasks'), db.getAll('projects')]).then(function (results) {
      cache.tasks = results[0];
      cache.projects = results[1];
      render();
    });
  }

  Console.modules.tasks = {
    layout: 'flush',
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      selectedId = null;
      inlineEditing = null;
      currentView = 'inbox';
      container.addEventListener('click', onContainerClick);
      keydownHandler = onKeydown;
      document.addEventListener('keydown', keydownHandler);
      refreshAndRender();
      refreshHandle = setInterval(refreshAndRender, 5 * 60 * 1000);
    },
    destroy: function () {
      if (container) container.removeEventListener('click', onContainerClick);
      if (keydownHandler) { document.removeEventListener('keydown', keydownHandler); keydownHandler = null; }
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
      container = null;
    }
  };
})();
