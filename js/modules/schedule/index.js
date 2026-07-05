/* Console — modules/schedule. Phase 3: strict-typed calendar events, theme days, recurring events
   with 3 exception modes, mandatory planned-vs-actual logging, drag-to-reschedule. Shell (page-head-
   row/view-tabs-row/metrics-row/kbd-hints) reused verbatim from base.css (byte-checked shared with
   Tasks/Habits in Phase 2 — see base.css's own header comment). Grid/event styling extracted from
   prototypes/console_schedule_prototype.html (Week view only shown there; Day/Month/Agenda/Theme-
   days-editor are new layouts within the same shell — see docs/phase_prompts/phase_3_schedule.md).
   layout: 'flush' — same reasoning as Tasks (Phase 2): this module owns its own full-bleed rows. */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;
  var keydownHandler = null;
  var refreshHandle = null;

  // 8 strict types. CONFLICT resolved (docs/phase_prompts/phase_3_schedule.md): contract says
  // `sleep`, prototype styled `personal` instead — using the contract's name, prototype's CSS
  // values (see components.css `.event.sleep`).
  var TYPES = ['deep_work', 'meeting', 'admin', 'exercise', 'break', 'social', 'errand', 'sleep'];
  var TYPE_LABEL = {
    deep_work: 'deep work', meeting: 'meeting', admin: 'admin', exercise: 'exercise',
    break: 'break', social: 'social', errand: 'errand', sleep: 'sleep'
  };
  var VIEWS = [
    { key: 'day', label: 'day' },
    { key: 'week', label: 'week' },
    { key: 'month', label: 'month' },
    { key: 'agenda', label: 'agenda' },
    { key: 'theme', label: 'theme days' }
  ];
  var DOW_ABBR = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

  // Grid covers 7:00–22:00 (15 hourly rows @ 50px) — matches the prototype's 15 time-labels
  // (7 AM..9 PM) and 14 internal hour-lines per day column.
  var GRID_START_HOUR = 7, GRID_END_HOUR = 22;
  var PX_PER_MIN = 50 / 60;
  var RECUR_HORIZON_DAYS = 60; // how far ahead recurring definitions materialize real `events` rows

  var currentView = 'week';
  var anchorDate = new Date();
  var selectedId = null;
  var visibleOrder = [];
  var modalMode = null;        // null | 'event' | 'log'
  var modalEvent = null;
  var modalExceptionMode = 'one'; // 'one' | 'future' — only meaningful editing a recurring occurrence
  var modalDowPicker = [];     // days-of-week chosen when creating a new recurring definition
  var suppressNextClick = false; // true right after a drag that actually moved something

  var dragState = null;

  var cache = { events: [], event_logs: [], recur_defs: [], theme_days: [], projects: [] };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function timeToMin(t) { if (!t) return 0; var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }
  function minToTime(m) { m = ((m % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
  function snap15(m) { return Math.round(m / 15) * 15; }

  function findEvent(id) { return cache.events.find(function (e) { return e.id === id; }); }
  function eventsOnDate(iso) { return cache.events.filter(function (e) { return e.start_date === iso; }); }
  function projectName(id) { if (!id) return null; var p = cache.projects.find(function (pp) { return pp.id === id; }); return p ? p.name : null; }
  function eventLog(ev, dateISO) { return cache.event_logs.find(function (l) { return l.event_id === ev.id && l.date === dateISO; }); }

  function isPastEvent(ev) {
    var todayISO = fmt.todayISO();
    if (ev.start_date < todayISO) return true;
    if (ev.start_date === todayISO) {
      var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      return timeToMin(ev.end_time) <= nowMin;
    }
    return false;
  }

  function needsLog(ev) {
    if (ev.status === 'skipped') return false;
    if (!isPastEvent(ev)) return false;
    return !eventLog(ev, ev.start_date);
  }

  function isLiveEvent(ev) {
    if (ev.start_date !== fmt.todayISO()) return false;
    var nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return nowMin >= timeToMin(ev.start_time) && nowMin < timeToMin(ev.end_time);
  }

  // ---------------------------------------------------------------- data / recurrence materialization

  function materializeRecurring() {
    var todayISO = fmt.todayISO();
    var toCreate = [];
    cache.recur_defs.forEach(function (def) {
      if (def.active === false) return;
      for (var offset = 0; offset <= RECUR_HORIZON_DAYS; offset++) {
        var dateISO = fmt.addDaysISO(todayISO, offset);
        if (def.start_date && dateISO < def.start_date) continue;
        if (def.end_date && dateISO > def.end_date) continue;
        var d = new Date(dateISO + 'T00:00:00');
        if ((def.days_of_week || []).indexOf(d.getDay()) === -1) continue;
        var exists = cache.events.some(function (e) { return e.recur_id === def.id && e.start_date === dateISO; });
        if (exists) continue;
        toCreate.push({
          id: db.uuid(), recur_id: def.id, title: def.title, type: def.type,
          start_date: dateISO, start_time: def.start_time, end_time: def.end_time,
          project_id: def.project_id || null, notes: '', status: 'scheduled',
          created_at: new Date().toISOString()
        });
      }
    });
    if (!toCreate.length) return Promise.resolve(false);
    return Promise.all(toCreate.map(function (e) { return db.put('events', e); })).then(function () { return true; });
  }

  // Theme days editor always shows all 7 weekdays — seed blank rows once so there's always
  // something to render/edit rather than treating "no theme_days row yet" as an empty state.
  function ensureThemeDaysSeed() {
    var missing = [];
    for (var i = 0; i < 7; i++) {
      if (!cache.theme_days.some(function (t) { return t.day_of_week === i; })) missing.push(i);
    }
    if (!missing.length) return Promise.resolve(false);
    return Promise.all(missing.map(function (i) {
      return db.put('theme_days', { id: db.uuid(), day_of_week: i, label: '' });
    })).then(function () { return true; });
  }

  function loadAll() {
    return Promise.all([
      db.getAll('events'), db.getAll('event_logs'), db.getAll('event_recur_definitions'),
      db.getAll('theme_days'), db.getAll('projects')
    ]).then(function (r) {
      cache.events = r[0]; cache.event_logs = r[1]; cache.recur_defs = r[2];
      cache.theme_days = r[3]; cache.projects = r[4];
      return Promise.all([materializeRecurring(), ensureThemeDaysSeed()]);
    }).then(function (changed) {
      if (!changed[0] && !changed[1]) return;
      return Promise.all([db.getAll('events'), db.getAll('theme_days')]).then(function (r2) {
        cache.events = r2[0]; cache.theme_days = r2[1];
      });
    });
  }

  function refreshAndRender() { return loadAll().then(render); }

  // ---------------------------------------------------------------- metrics

  function computeMetrics() {
    var week = fmt.weekOf(anchorDate);
    var startISO = fmt.isoDate(week[0]), endISO = fmt.isoDate(week[6]);
    var weekEvents = cache.events.filter(function (e) { return e.start_date >= startISO && e.start_date <= endISO && e.status !== 'skipped'; });
    var scheduledMin = weekEvents.reduce(function (s, e) { return s + Math.max(0, timeToMin(e.end_time) - timeToMin(e.start_time)); }, 0);
    var executedMin = 0;
    weekEvents.forEach(function (e) {
      var log = eventLog(e, e.start_date);
      if (log && !log.skipped) executedMin += Math.max(0, timeToMin(log.actual_end || e.end_time) - timeToMin(log.actual_start || e.start_time));
    });
    var deepWorkMin = weekEvents.filter(function (e) { return e.type === 'deep_work'; })
      .reduce(function (s, e) { return s + Math.max(0, timeToMin(e.end_time) - timeToMin(e.start_time)); }, 0);
    // Theme-day adherence heuristic, deliberately simple per the Phase 3 brief (#8) — a themed day
    // "adheres" if it has any scheduled events at all. Not a scored model; documented here rather
    // than Console_Workflow.md since it's a one-line heuristic, not a structural decision.
    var themedDays = 0, adheredDays = 0;
    week.forEach(function (d) {
      var theme = cache.theme_days.find(function (t) { return t.day_of_week === d.getDay(); });
      if (theme && theme.label) {
        themedDays++;
        if (eventsOnDate(fmt.isoDate(d)).length) adheredDays++;
      }
    });
    return {
      scheduledHours: scheduledMin / 60,
      executedHours: executedMin / 60,
      deepWorkHours: deepWorkMin / 60,
      deepWorkPct: scheduledMin ? Math.round(deepWorkMin / scheduledMin * 100) : 0,
      adherencePct: themedDays ? Math.round(adheredDays / themedDays * 100) : 0
    };
  }

  // ---------------------------------------------------------------- head / nav helpers

  function viewLabel() { return VIEWS.find(function (v) { return v.key === currentView; }).label; }

  function periodSubLabel() {
    if (currentView === 'day') return fmt.longWeekday(anchorDate) + ' · ' + fmt.monthDay(anchorDate);
    if (currentView === 'month') return fmt.longWeekday(anchorDate) === fmt.longWeekday(anchorDate) ? monthYearLabel(anchorDate) : '';
    var week = fmt.weekOf(anchorDate);
    return fmt.monthDay(week[0]) + ' – ' + fmt.monthDay(week[6]);
  }

  function monthYearLabel(d) {
    var MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return MONTHS_FULL[d.getMonth()] + ' ' + d.getFullYear();
  }

  function stepDate(delta) {
    if (currentView === 'day') anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + delta);
    else if (currentView === 'month') anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth() + delta, 1);
    else anchorDate = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + delta * 7);
  }

  // ---------------------------------------------------------------- rendering: grid (Day/Week)

  function renderGrid(isDay) {
    var days = isDay ? [anchorDate] : fmt.weekOf(anchorDate);
    var todayISO = fmt.todayISO();

    var timeLabels = '';
    for (var h = GRID_START_HOUR; h < GRID_END_HOUR; h++) {
      var hh = h % 12 === 0 ? 12 : h % 12;
      timeLabels += '<div class="time-label">' + hh + ' ' + (h < 12 ? 'AM' : 'PM') + '</div>';
    }

    var headerCells = days.map(function (d) {
      var iso = fmt.isoDate(d);
      var isToday = iso === todayISO;
      var theme = cache.theme_days.find(function (t) { return t.day_of_week === d.getDay(); });
      return (
        '<div class="day-header' + (isToday ? ' today' : (fmt.isWeekend(d) ? ' weekend' : '')) + '" data-date="' + iso + '">' +
          '<div class="day-name">' + fmt.weekdayAbbr(d) + (isToday ? ' · today' : '') + '</div>' +
          '<div class="day-num">' + d.getDate() + '<span class="day-month">' + fmt.monthDay(d).split(' ')[0].toLowerCase() + '</span></div>' +
          (theme && theme.label ? '<div class="day-theme">' + escapeHtml(theme.label) + '</div>' : '') +
        '</div>'
      );
    }).join('');

    var colsHtml = days.map(function (d) {
      var iso = fmt.isoDate(d);
      var isToday = iso === todayISO;
      var lines = '';
      for (var i = 1; i < (GRID_END_HOUR - GRID_START_HOUR); i++) lines += '<div class="hour-line" style="top:' + (i * 50) + 'px;"></div>';

      var nowLine = '';
      if (isToday) {
        var now = new Date();
        var nowMin = now.getHours() * 60 + now.getMinutes();
        if (nowMin >= GRID_START_HOUR * 60 && nowMin < GRID_END_HOUR * 60) {
          nowLine = '<div class="now-line" style="top:' + ((nowMin - GRID_START_HOUR * 60) * PX_PER_MIN) + 'px;" data-time="' + fmt.timeHM(now) + '"></div>';
        }
      }

      var dayEvents = eventsOnDate(iso).sort(function (a, b) { return timeToMin(a.start_time) - timeToMin(b.start_time); });
      var evHtml = dayEvents.map(function (e) { visibleOrder.push(e.id); return renderGridEvent(e, iso); }).join('');
      return '<div class="day-col' + (isToday ? ' today-col' : '') + '" data-date="' + iso + '">' + lines + nowLine + evHtml + '</div>';
    }).join('');

    var legend = TYPES.map(function (t) { return '<span class="leg-item"><span class="type-dot ' + t + '"></span>' + TYPE_LABEL[t] + '</span>'; }).join('');

    return (
      '<div class="grid-row"><div class="grid-inner">' +
        '<div class="day-header-strip' + (isDay ? ' day-mode' : '') + '"><div class="corner"></div>' + headerCells + '</div>' +
        '<div class="week-grid' + (isDay ? ' day-mode' : '') + '">' +
          '<div class="time-axis">' + timeLabels + '</div>' + colsHtml +
        '</div>' +
        '<div class="grid-legend">' + legend +
          '<span class="leg-sep">·</span><span class="leg-item">live ● now</span><span class="leg-item">✓ logged</span>' +
          '<span class="leg-item warn-note">LOG = needs planned-vs-actual entry</span>' +
        '</div>' +
      '</div></div>'
    );
  }

  function renderGridEvent(e, iso) {
    var start = timeToMin(e.start_time), end = timeToMin(e.end_time);
    var top = (start - GRID_START_HOUR * 60) * PX_PER_MIN;
    var height = Math.max(18, (end - start) * PX_PER_MIN);
    var sizeClass = height <= 30 ? ' short' : (height <= 55 ? ' medium' : '');
    var log = eventLog(e, iso);

    var classes = 'event ' + e.type + sizeClass;
    if (e.status === 'skipped') classes += ' skipped';
    else if (log) classes += ' done';
    if (isLiveEvent(e)) classes += ' live';
    if (needsLog(e)) classes += ' needs-log';
    if (e.id === selectedId) classes += ' selected';

    return (
      '<div class="' + classes + '" style="top:' + top + 'px; height:' + height + 'px;" data-id="' + e.id + '">' +
        '<div class="e-time">' + e.start_time + '–' + e.end_time + '</div>' +
        '<div class="e-title">' + escapeHtml(e.title || 'Untitled') + '</div>' +
        '<div class="e-type">' + TYPE_LABEL[e.type] + '</div>' +
      '</div>'
    );
    // top/height are the only inline styles here — genuinely dynamic per-instance position on a
    // time grid, the explicit exception in docs/visual_contract.md's "no inline styles" rule.
  }

  // ---------------------------------------------------------------- rendering: month

  function renderMonth() {
    var year = anchorDate.getFullYear(), month = anchorDate.getMonth();
    var first = new Date(year, month, 1);
    var gridStart = new Date(year, month, 1 - first.getDay());
    var todayISO = fmt.todayISO();
    var cells = '';

    for (var i = 0; i < 42; i++) {
      var d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      var iso = fmt.isoDate(d);
      var outside = d.getMonth() !== month;
      var isToday = iso === todayISO;
      var dayEvents = eventsOnDate(iso).sort(function (a, b) { return timeToMin(a.start_time) - timeToMin(b.start_time); });
      var shown = dayEvents.slice(0, 3);
      var chips = shown.map(function (e) {
        visibleOrder.push(e.id);
        return '<div class="month-chip ' + e.type + (e.id === selectedId ? ' selected' : '') + '" data-id="' + e.id + '">' + escapeHtml(e.title || TYPE_LABEL[e.type]) + '</div>';
      }).join('');
      var more = dayEvents.length > 3 ? '<div class="month-more" data-date="' + iso + '">+' + (dayEvents.length - 3) + ' more</div>' : '';
      cells += (
        '<div class="month-cell' + (outside ? ' outside' : '') + (isToday ? ' today' : '') + '" data-date="' + iso + '">' +
          '<div class="mnum">' + d.getDate() + '</div><div class="mevents">' + chips + more + '</div>' +
        '</div>'
      );
    }

    var dowRow = DOW_ABBR.map(function (a) { return '<div class="mdow">' + a + '</div>'; }).join('');
    return (
      '<div class="grid-row"><div class="grid-inner">' +
        '<div class="month-dow-row">' + dowRow + '</div>' +
        '<div class="month-grid">' + cells + '</div>' +
      '</div></div>'
    );
  }

  // ---------------------------------------------------------------- rendering: agenda

  function agendaStateLabel(e) {
    if (e.status === 'skipped') return { label: 'skipped', cls: 'danger' };
    var log = eventLog(e, e.start_date);
    if (log) return { label: log.skipped ? 'skipped' : 'logged', cls: log.skipped ? 'danger' : 'success' };
    if (isLiveEvent(e)) return { label: 'live', cls: 'accent' };
    if (needsLog(e)) return { label: 'needs log', cls: 'warn' };
    return { label: 'planned', cls: 'neutral' };
  }

  function renderAgendaRow(e) {
    var state = agendaStateLabel(e);
    var proj = e.project_id ? projectName(e.project_id) : null;
    return (
      '<div class="list-row event' + (e.id === selectedId ? ' selected' : '') + '" data-id="' + e.id + '">' +
        '<span class="event-time"><strong>' + e.start_time + '</strong><br>' + e.end_time + '</span>' +
        '<div><span class="type-dot ' + e.type + '"></span>' + escapeHtml(e.title || 'Untitled') +
          '<div class="e-meta">' + TYPE_LABEL[e.type] + (proj ? ' · #' + escapeHtml(proj) : '') + '</div>' +
        '</div>' +
        '<span class="pill ' + state.cls + '">' + state.label + '</span>' +
      '</div>'
    );
  }

  function renderAgenda() {
    var week = fmt.weekOf(anchorDate);
    var startISO = fmt.isoDate(week[0]), endISO = fmt.isoDate(week[6]);
    var events = cache.events
      .filter(function (e) { return e.start_date >= startISO && e.start_date <= endISO; })
      .sort(function (a, b) { return (a.start_date + a.start_time).localeCompare(b.start_date + b.start_time); });
    visibleOrder = events.map(function (e) { return e.id; });

    var body;
    if (!events.length) {
      body = '<div class="empty"><div class="empty-title">Nothing scheduled</div><div class="empty-sub">No events in ' + escapeHtml(periodSubLabel()) + '.</div></div>';
    } else {
      var byDate = {};
      events.forEach(function (e) { (byDate[e.start_date] = byDate[e.start_date] || []).push(e); });
      body = Object.keys(byDate).sort().map(function (iso) {
        var d = new Date(iso + 'T00:00:00');
        var label = fmt.longWeekday(d) + ' · ' + fmt.monthDay(d);
        return '<div class="agenda-date-label">' + escapeHtml(label) + '</div>' + byDate[iso].map(renderAgendaRow).join('');
      }).join('');
    }

    return (
      '<div class="twopane-row"><div class="twopane-inner single">' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">Agenda</span><span class="pane-meta">' + events.length + ' events</span></div>' +
        '<div class="pane-body">' + body + '</div></div>' +
      '</div></div>'
    );
  }

  // ---------------------------------------------------------------- rendering: theme days editor

  function renderThemeEditor() {
    var rows = [0, 1, 2, 3, 4, 5, 6].map(function (dow) {
      var t = cache.theme_days.find(function (x) { return x.day_of_week === dow; }) || { day_of_week: dow, label: '' };
      return (
        '<div class="list-row themeday">' +
          '<span class="td-dow">' + DOW_ABBR[dow] + '</span>' +
          '<input type="text" class="input" data-act="theme-label" data-dow="' + dow + '" value="' + escapeHtml(t.label || '') + '" placeholder="e.g. Maker Monday">' +
        '</div>'
      );
    }).join('');
    return '<div class="twopane-row"><div class="twopane-inner single"><div class="row-list">' + rows + '</div></div></div>';
  }

  // ---------------------------------------------------------------- rendering: modal

  function renderModal() {
    if (!modalMode) return '<div class="modal-overlay" id="sched-modal" hidden></div>';
    if (modalMode === 'event') return renderEventModal();
    if (modalMode === 'log') return renderLogModal();
    return '';
  }

  function renderEventModal() {
    var e = modalEvent;
    var isNew = !!e._isNew;
    var isRecurOcc = !isNew && !!e.recur_id;

    var typeOptions = TYPES.map(function (t) { return '<option value="' + t + '"' + (e.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>'; }).join('');
    var projOptions = '<option value="">No project</option>' + cache.projects.map(function (p) {
      return '<option value="' + p.id + '"' + (e.project_id === p.id ? ' selected' : '') + '>' + escapeHtml(p.name) + '</option>';
    }).join('');

    var dowPicker = '';
    if (isNew) {
      dowPicker = (
        '<div class="modal-field"><label>Repeat on (optional)</label><div class="modal-dow-picker">' +
          DOW_ABBR.map(function (a, i) {
            return '<button type="button" data-act="toggle-dow" data-dow="' + i + '" class="' + (modalDowPicker.indexOf(i) !== -1 ? 'active' : '') + '">' + a + '</button>';
          }).join('') +
        '</div></div>'
      );
    }

    var recurNote = isRecurOcc ? '<div class="modal-readonly">Part of a recurring series. Choose how this change applies below.</div>' : '';

    var actions;
    if (isNew) {
      actions = '<button class="btn secondary" data-act="modal-cancel">Cancel</button><div class="spacer"></div><button class="btn accent" data-act="modal-save">Create</button>';
    } else if (isRecurOcc) {
      actions = (
        '<button class="btn danger" data-act="modal-skip">Skip occurrence</button><div class="spacer"></div>' +
        '<div class="modal-exc-picker">' +
          '<label><input type="radio" name="excmode" data-act="exc-mode" value="one" ' + (modalExceptionMode === 'one' ? 'checked' : '') + '> only this</label>' +
          '<label><input type="radio" name="excmode" data-act="exc-mode" value="future" ' + (modalExceptionMode === 'future' ? 'checked' : '') + '> this + future</label>' +
        '</div>' +
        '<button class="btn accent" data-act="modal-save">Save</button>'
      );
    } else {
      actions = '<button class="btn danger" data-act="modal-delete">Delete</button><div class="spacer"></div><button class="btn secondary" data-act="modal-cancel">Cancel</button><button class="btn accent" data-act="modal-save">Save</button>';
    }

    return (
      '<div class="modal-overlay" id="sched-modal">' +
        '<div class="modal wide">' +
          '<div class="modal-head"><span class="modal-title">' + (isNew ? 'New event' : 'Edit event') + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            recurNote +
            '<div class="modal-field"><label>Title</label><input type="text" class="input" id="mf-title" value="' + escapeHtml(e.title || '') + '" placeholder="Deep work · Project B"></div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Type</label><select class="input" id="mf-type">' + typeOptions + '</select></div>' +
              '<div class="modal-field"><label>Project</label><select class="input" id="mf-project">' + projOptions + '</select></div>' +
            '</div>' +
            '<div class="modal-row3">' +
              '<div class="modal-field"><label>Date</label><input type="date" class="input" id="mf-date" value="' + escapeHtml(e.start_date || '') + '"' + (isRecurOcc ? ' disabled' : '') + '></div>' +
              '<div class="modal-field"><label>Start</label><input type="time" class="input" id="mf-start" value="' + escapeHtml(e.start_time || '09:00') + '"></div>' +
              '<div class="modal-field"><label>End</label><input type="time" class="input" id="mf-end" value="' + escapeHtml(e.end_time || '10:00') + '"></div>' +
            '</div>' +
            dowPicker +
            '<div class="modal-field"><label>Notes</label><textarea class="input notes-area" id="mf-notes">' + escapeHtml(e.notes || '') + '</textarea></div>' +
          '</div>' +
          '<div class="modal-actions">' + actions + '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderLogModal() {
    var e = modalEvent;
    var log = eventLog(e, e.start_date) || {};
    return (
      '<div class="modal-overlay" id="sched-modal">' +
        '<div class="modal">' +
          '<div class="modal-head"><span class="modal-title">Log · ' + escapeHtml(e.title || 'Untitled') + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-readonly">Planned ' + e.start_time + '–' + e.end_time + ' · ' + fmt.monthDay(new Date(e.start_date + 'T00:00:00')) + '</div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Actual start</label><input type="time" class="input" id="mf-actual-start" value="' + escapeHtml(log.actual_start || e.start_time) + '"></div>' +
              '<div class="modal-field"><label>Actual end</label><input type="time" class="input" id="mf-actual-end" value="' + escapeHtml(log.actual_end || e.end_time) + '"></div>' +
            '</div>' +
            '<label class="modal-exc-picker"><input type="checkbox" id="mf-skipped" ' + (log.skipped ? 'checked' : '') + '> Mark as skipped instead of logging actual time</label>' +
          '</div>' +
          '<div class="modal-actions"><button class="btn secondary" data-act="modal-cancel">Cancel</button><div class="spacer"></div><button class="btn accent" data-act="modal-save-log">Save log</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- render dispatch

  function renderViewBody() {
    if (currentView === 'day') return renderGrid(true);
    if (currentView === 'week') return renderGrid(false);
    if (currentView === 'month') return renderMonth();
    if (currentView === 'agenda') return renderAgenda();
    if (currentView === 'theme') return renderThemeEditor();
    return '';
  }

  function render() {
    visibleOrder = [];
    var metrics = computeMetrics();

    container.innerHTML =
      '<div class="page-head-row"><div class="inner schedule-head-wrap">' +
        '<h1 class="page-title">Schedule &mdash; <span class="em">' + escapeHtml(viewLabel()) + '</span></h1>' +
        '<span class="page-sub">' + escapeHtml(periodSubLabel()) + '</span>' +
        '<div class="page-actions">' +
          (currentView !== 'theme'
            ? '<div class="date-nav"><button data-act="nav-prev">‹</button><button class="today-btn" data-act="nav-today">today</button><button data-act="nav-next">›</button></div>'
            : '') +
          '<button class="btn-mini primary" id="btn-new-event"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 5v14M5 12h14"/></svg>New event</button>' +
        '</div>' +
      '</div></div>' +
      '<div class="view-tabs-row"><div class="view-tabs-inner">' +
        VIEWS.map(function (v) { return '<span class="vtab' + (v.key === currentView ? ' active' : '') + '" data-view="' + v.key + '">' + v.label + '</span>'; }).join('') +
      '</div></div>' +
      '<div class="metrics-row"><div class="metrics-inner">' +
        '<div class="metric"><div class="mnum">' + metrics.scheduledHours.toFixed(1) + '<span class="munit">h</span></div><div class="mlbl"><span>scheduled this week</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.executedHours.toFixed(1) + '<span class="munit">h</span></div><div class="mlbl"><span>executed so far</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.deepWorkHours.toFixed(1) + '<span class="munit">h</span></div><div class="mlbl"><span>deep work scheduled</span><span class="mtrend">' + metrics.deepWorkPct + '% of total</span></div></div>' +
        '<div class="metric"><div class="mnum">' + metrics.adherencePct + '<span class="munit">%</span></div><div class="mlbl"><span>theme-day adherence</span></div></div>' +
      '</div></div>' +
      renderViewBody() +
      '<div class="kbd-hints">' +
        '<span class="khint"><span class="kbd">N</span><span class="klbl">new event</span></span>' +
        '<span class="khint"><span class="kbd">D</span><span class="kbd">W</span><span class="kbd">M</span><span class="klbl">view</span></span>' +
        '<span class="khint"><span class="kbd">J</span><span class="kbd">K</span><span class="klbl">navigate</span></span>' +
        '<span class="khint"><span class="kbd">T</span><span class="klbl">today</span></span>' +
        '<span class="khint"><span class="kbd">L</span><span class="klbl">log block</span></span>' +
        '<span class="khint"><span class="kbd">↵</span><span class="klbl">open</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">E</span><span class="klbl">edit</span></span>' +
      '</div>' +
      renderModal();

    if (modalMode === 'event') { var t = document.getElementById('mf-title'); if (t) t.focus(); }
    if (modalMode === 'log') { var a = document.getElementById('mf-actual-start'); if (a) a.focus(); }
  }

  // ---------------------------------------------------------------- modal actions

  function openNewEventModal(prefill) {
    modalMode = 'event';
    var d = (prefill && prefill.date) || fmt.isoDate(anchorDate);
    var st = (prefill && prefill.time) || '09:00';
    modalEvent = { _isNew: true, title: '', type: 'deep_work', start_date: d, start_time: st, end_time: minToTime(timeToMin(st) + 60), project_id: null, notes: '' };
    modalDowPicker = [];
    modalExceptionMode = 'one';
    render();
  }

  function openEditEventModal(ev) {
    if (!ev) return;
    modalMode = 'event';
    modalEvent = JSON.parse(JSON.stringify(ev));
    modalEvent._isNew = false;
    modalExceptionMode = 'one';
    render();
  }

  function openLogModal(ev) {
    if (!ev) return;
    modalMode = 'log';
    modalEvent = ev;
    render();
  }

  function closeModal() { modalMode = null; modalEvent = null; render(); }

  function readEventForm() {
    var dateEl = document.getElementById('mf-date');
    return {
      title: document.getElementById('mf-title').value.trim(),
      type: document.getElementById('mf-type').value,
      start_date: dateEl.disabled ? modalEvent.start_date : dateEl.value,
      start_time: document.getElementById('mf-start').value,
      end_time: document.getElementById('mf-end').value,
      project_id: document.getElementById('mf-project').value || null,
      notes: document.getElementById('mf-notes').value
    };
  }

  function saveEventModal() {
    var form = readEventForm();
    if (!form.title) return;

    if (modalEvent._isNew) {
      if (modalDowPicker.length) {
        var def = {
          id: db.uuid(), title: form.title, type: form.type, days_of_week: modalDowPicker.slice(),
          start_time: form.start_time, end_time: form.end_time, project_id: form.project_id,
          start_date: form.start_date, end_date: null, active: true, next_run_date: fmt.todayISO()
        };
        modalMode = null; modalEvent = null;
        db.put('event_recur_definitions', def).then(refreshAndRender);
      } else {
        var ev = {
          id: db.uuid(), recur_id: null, title: form.title, type: form.type, start_date: form.start_date,
          start_time: form.start_time, end_time: form.end_time, project_id: form.project_id, notes: form.notes,
          status: 'scheduled', created_at: new Date().toISOString()
        };
        selectedId = ev.id;
        modalMode = null; modalEvent = null;
        db.put('events', ev).then(refreshAndRender);
      }
      return;
    }

    if (modalEvent.recur_id && modalExceptionMode === 'future') {
      var occurrence = modalEvent;
      modalMode = null; modalEvent = null;
      saveEditFuture(occurrence, form);
      return;
    }

    var updated = modalEvent;
    updated.title = form.title; updated.type = form.type; updated.start_time = form.start_time;
    updated.end_time = form.end_time; updated.project_id = form.project_id; updated.notes = form.notes;
    if (!updated.recur_id) updated.start_date = form.start_date; // date only editable for standalone events
    delete updated._isNew;
    modalMode = null; modalEvent = null;
    db.put('events', updated).then(refreshAndRender);
  }

  // "Edit future": end the old recur definition the day before this occurrence, spin up a new
  // definition from this date forward with the edited fields, move this occurrence (and any
  // already-materialized future ones under the old definition) onto the new definition so the
  // updated fields take effect without duplicating or losing occurrences.
  function saveEditFuture(occurrence, form) {
    var oldDef = cache.recur_defs.find(function (d) { return d.id === occurrence.recur_id; });
    var splitDate = occurrence.start_date;

    if (!oldDef) {
      // Shouldn't normally happen (occurrence references a missing def) — fall back to editing
      // just this occurrence rather than silently dropping the edit.
      occurrence.title = form.title; occurrence.type = form.type; occurrence.start_time = form.start_time;
      occurrence.end_time = form.end_time; occurrence.project_id = form.project_id; occurrence.notes = form.notes;
      db.put('events', occurrence).then(refreshAndRender);
      return;
    }

    var endedOldDef = JSON.parse(JSON.stringify(oldDef));
    endedOldDef.end_date = fmt.addDaysISO(splitDate, -1);

    var newDef = {
      id: db.uuid(), title: form.title, type: form.type, days_of_week: oldDef.days_of_week.slice(),
      start_time: form.start_time, end_time: form.end_time, project_id: form.project_id,
      start_date: splitDate, end_date: (oldDef.end_date && oldDef.end_date >= splitDate) ? oldDef.end_date : null,
      active: true, next_run_date: splitDate
    };

    Promise.all([db.put('event_recur_definitions', endedOldDef), db.put('event_recur_definitions', newDef)])
      .then(function () {
        var toFix = cache.events.filter(function (e) { return e.recur_id === oldDef.id && e.start_date >= splitDate; });
        return Promise.all(toFix.map(function (e) {
          if (e.id === occurrence.id) {
            e.recur_id = newDef.id; e.title = form.title; e.type = form.type; e.start_time = form.start_time;
            e.end_time = form.end_time; e.project_id = form.project_id; e.notes = form.notes;
            return db.put('events', e);
          }
          return db.remove('events', e.id); // regenerated fresh under newDef on next materialize pass
        }));
      })
      .then(refreshAndRender);
  }

  function deleteModalEvent() {
    if (!modalEvent || modalEvent._isNew) return;
    var id = modalEvent.id;
    modalMode = null; modalEvent = null;
    db.remove('events', id).then(function () { if (selectedId === id) selectedId = null; }).then(refreshAndRender);
  }

  // Skip one occurrence: mark the row rather than delete it, so the materializer (which dedupes
  // by recur_id+date) sees a row already exists for that date and won't regenerate it.
  function skipModalOccurrence() {
    if (!modalEvent) return;
    var ev = modalEvent;
    ev.status = 'skipped';
    modalMode = null; modalEvent = null;
    db.put('events', ev).then(refreshAndRender);
  }

  function saveLogModal() {
    var e = modalEvent;
    var actualStart = document.getElementById('mf-actual-start').value;
    var actualEnd = document.getElementById('mf-actual-end').value;
    var skipped = document.getElementById('mf-skipped').checked;
    var log = eventLog(e, e.start_date) || { id: db.uuid(), event_id: e.id, date: e.start_date };
    log.planned_start = e.start_time; log.planned_end = e.end_time;
    log.actual_start = actualStart; log.actual_end = actualEnd; log.skipped = skipped;
    modalMode = null; modalEvent = null;
    db.put('event_logs', log).then(refreshAndRender);
  }

  function saveThemeLabel(dow, label) {
    var t = cache.theme_days.find(function (x) { return x.day_of_week === dow; });
    if (!t) t = { id: db.uuid(), day_of_week: dow, label: label };
    else t.label = label;
    db.put('theme_days', t).then(refreshAndRender);
  }

  // ---------------------------------------------------------------- drag-to-reschedule (15-min snap)

  function onContainerMouseDown(e) {
    var evEl = e.target.closest('.event');
    if (!evEl || !evEl.closest('.week-grid')) return; // grid only — not Agenda/Month chips
    var id = evEl.dataset.id;
    if (!findEvent(id)) return;
    e.preventDefault();
    dragState = {
      id: id, elem: evEl, startClientY: e.clientY,
      startTop: parseFloat(evEl.style.top) || 0, moved: false,
      dayCols: Array.prototype.slice.call(container.querySelectorAll('.day-col')),
      origDayCol: evEl.closest('.day-col'), hoverDayCol: null
    };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);
  }

  function onDragMove(e) {
    if (!dragState) return;
    var dy = e.clientY - dragState.startClientY;
    if (Math.abs(dy) > 4) dragState.moved = true;
    if (!dragState.moved) return;
    dragState.elem.style.top = Math.max(0, dragState.startTop + dy) + 'px';
    dragState.elem.classList.add('dragging');
    var atPoint = document.elementFromPoint(e.clientX, e.clientY);
    var col = atPoint ? atPoint.closest('.day-col') : null;
    dragState.hoverDayCol = col || dragState.origDayCol;
    dragState.dayCols.forEach(function (c) { c.classList.toggle('drop-target', c === dragState.hoverDayCol && c !== dragState.origDayCol); });
  }

  function onDragUp() {
    if (!dragState) return;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
    var ds = dragState; dragState = null;
    ds.dayCols.forEach(function (c) { c.classList.remove('drop-target'); });
    ds.elem.classList.remove('dragging');
    suppressNextClick = ds.moved;
    if (!ds.moved) return;

    var ev = findEvent(ds.id);
    if (!ev) { render(); return; }
    var deltaMin = Math.round(parseFloat(ds.elem.style.top) / PX_PER_MIN);
    var snappedStartMin = snap15(GRID_START_HOUR * 60 + deltaMin);
    var durationMin = timeToMin(ev.end_time) - timeToMin(ev.start_time);
    ev.start_date = (ds.hoverDayCol && ds.hoverDayCol.dataset.date) || ev.start_date;
    ev.start_time = minToTime(snappedStartMin);
    ev.end_time = minToTime(snappedStartMin + durationMin);
    db.put('events', ev).then(refreshAndRender);
  }

  // ---------------------------------------------------------------- click / change delegation

  function onContainerClick(e) {
    if (suppressNextClick) { suppressNextClick = false; return; }

    var vtab = e.target.closest('.vtab');
    if (vtab) { currentView = vtab.dataset.view; selectedId = null; render(); return; }

    if (e.target.closest('[data-act="nav-prev"]')) { stepDate(-1); render(); return; }
    if (e.target.closest('[data-act="nav-next"]')) { stepDate(1); render(); return; }
    if (e.target.closest('[data-act="nav-today"]')) { anchorDate = new Date(); render(); return; }
    if (e.target.closest('#btn-new-event')) { openNewEventModal(); return; }

    var monthMore = e.target.closest('.month-more');
    if (monthMore) { anchorDate = new Date(monthMore.dataset.date + 'T00:00:00'); currentView = 'day'; render(); return; }

    var dayHeader = e.target.closest('.day-header');
    if (dayHeader && currentView !== 'day') { anchorDate = new Date(dayHeader.dataset.date + 'T00:00:00'); currentView = 'day'; render(); return; }

    var evEl = e.target.closest('.event, .month-chip, .list-row.event');
    if (evEl && evEl.dataset.id) { selectedId = evEl.dataset.id; openEditEventModal(findEvent(selectedId)); return; }

    var toggleDow = e.target.closest('[data-act="toggle-dow"]');
    if (toggleDow) {
      var dow = +toggleDow.dataset.dow;
      var idx = modalDowPicker.indexOf(dow);
      if (idx === -1) modalDowPicker.push(dow); else modalDowPicker.splice(idx, 1);
      render();
      return;
    }

    if (e.target.closest('[data-act="modal-cancel"]')) { closeModal(); return; }
    if (e.target.closest('[data-act="modal-save"]')) { saveEventModal(); return; }
    if (e.target.closest('[data-act="modal-delete"]')) { deleteModalEvent(); return; }
    if (e.target.closest('[data-act="modal-skip"]')) { skipModalOccurrence(); return; }
    if (e.target.closest('[data-act="modal-save-log"]')) { saveLogModal(); return; }

    if (e.target.id === 'sched-modal') { closeModal(); return; } // click on backdrop closes
  }

  function onContainerChange(e) {
    var excRadio = e.target.closest('[data-act="exc-mode"]');
    if (excRadio) { modalExceptionMode = excRadio.value; return; }
    var themeInput = e.target.closest('[data-act="theme-label"]');
    if (themeInput) { saveThemeLabel(+themeInput.dataset.dow, themeInput.value); return; }
  }

  // ---------------------------------------------------------------- keyboard

  function onKeydown(e) {
    if (modalMode) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return; // modal owns input while open
    }
    var overlay = document.getElementById('cmd-overlay');
    if (overlay && !overlay.hidden) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

    var key = e.key.toLowerCase();
    if (key === 'n') { e.preventDefault(); openNewEventModal(); return; }
    if (key === 'd') { e.preventDefault(); currentView = 'day'; render(); return; }
    if (key === 'w') { e.preventDefault(); currentView = 'week'; render(); return; }
    if (key === 'm') { e.preventDefault(); currentView = 'month'; render(); return; }
    if (key === 't') { e.preventDefault(); anchorDate = new Date(); render(); return; }
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
    if (key === 'l' && selectedId) {
      var ev = findEvent(selectedId);
      if (ev && isPastEvent(ev)) { e.preventDefault(); openLogModal(ev); }
      return;
    }
    if (key === 'enter' && selectedId) { e.preventDefault(); openEditEventModal(findEvent(selectedId)); return; }
    if (key === 'e' && (e.metaKey || e.ctrlKey) && selectedId) { e.preventDefault(); openEditEventModal(findEvent(selectedId)); }
  }

  // ---------------------------------------------------------------- module lifecycle

  Console.modules.schedule = {
    layout: 'flush',
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      currentView = 'week';
      anchorDate = new Date();
      selectedId = null;
      modalMode = null; modalEvent = null;
      container.addEventListener('click', onContainerClick);
      container.addEventListener('change', onContainerChange);
      container.addEventListener('mousedown', onContainerMouseDown);
      keydownHandler = onKeydown;
      document.addEventListener('keydown', keydownHandler);
      refreshAndRender();
      refreshHandle = setInterval(refreshAndRender, 5 * 60 * 1000);
    },
    destroy: function () {
      if (container) {
        container.removeEventListener('click', onContainerClick);
        container.removeEventListener('change', onContainerChange);
        container.removeEventListener('mousedown', onContainerMouseDown);
      }
      if (keydownHandler) { document.removeEventListener('keydown', keydownHandler); keydownHandler = null; }
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
      if (dragState) { document.removeEventListener('mousemove', onDragMove); document.removeEventListener('mouseup', onDragUp); dragState = null; }
      container = null;
    }
  };
})();
