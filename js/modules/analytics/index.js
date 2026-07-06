/* Console — modules/analytics. Phase 7: 11 cross-domain views over data every other module
   already writes. REBUILT from a real prototype the user commissioned and uploaded
   ("Console Analytics - Design Brief.html", a bundled/templated mockup export) — same
   "extraction, not recreation" discipline as every other phase: markup/CSS/structure below is
   taken directly from that file (see css/components.css's `.av-*` block), data-computation logic
   is unchanged from the first hand-rolled pass (already verified against real stores) and is
   reused verbatim; only the HTML the view functions produce has changed. Full design-decision
   log in docs/phase_prompts/phase_7_analytics.md — read that before touching this file.

   No `layout: 'flush'` — same call Phase 5/6 made: these are cards/charts/tables, not a
   list+detail split, so this renders inside .content/.content-inner like Today/Finance/Focus.

   Range filtering: reads `Console.analyticsRange` (set by js/app.js from the topbar's
   7d/30d/90d/all/custom segmented control — Design Decision #2, only this module reads it) and
   listens for the `analytics-range-changed` DOM event app.js dispatches when the user changes it
   while this module happens to be mounted (the control lives in topbar chrome, outside this
   module's own container, so it can't be caught via normal click delegation). */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;
  var rangeChangeHandler = null;
  var refreshHandle = null;

  // Decay Analysis's staleness threshold and Energy Index's daily focus reference — both stated
  // here, not buried, per phase_7_analytics.md's acceptance criteria (real, documented numbers,
  // not hidden ones).
  var DECAY_STALE_DAYS = 14;
  var ENERGY_FOCUS_TARGET_MIN = 240; // 4h/day reference

  // Prototype's per-project/per-category color cycle (all resolve to existing tokens.css vars —
  // the prototype was built against Console's own design tokens, not a new palette).
  var COLOR_CYCLE = ['accent', 'blue', 'plum', 'teal', 'amber', 'rose'];

  var cache = { tasks: [], projects: [], events: [], eventLogs: [], themeDays: [], habits: [], habitLogs: [], transactions: [], envelopes: [], categories: [], focusSessions: [] };

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(0); }

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

  function round1(n) { return Math.round(n * 10) / 10; }

  // Rounds a positive number up to a "nice" axis-tick ceiling (1/2/5/10 x 10^n) — used so scatter
  // axis labels read like "$500"/"1,000" instead of an arbitrary computed max.
  function niceCeil(n) {
    if (!isFinite(n) || n <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log10(n)));
    var f = n / pow;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * pow;
  }

  // ---------------------------------------------------------------- range resolution
  // Design Decision #2/#3 (phase_7_analytics.md): reads the global Console.analyticsRange app.js
  // maintains. "all" is bounded to the earliest real date in the data (not year zero) so a weekly
  // bucketing pass over it doesn't produce thousands of empty buckets.

  function earliestDataISO() {
    var dates = [];
    cache.transactions.forEach(function (t) { if (t.date) dates.push(t.date); });
    cache.events.forEach(function (e) { if (e.start_date) dates.push(e.start_date); });
    cache.tasks.forEach(function (t) { if (t.created_at) dates.push(t.created_at.slice(0, 10)); });
    cache.habitLogs.forEach(function (l) { if (l.date) dates.push(l.date); });
    cache.focusSessions.forEach(function (s) { if (s.start_at) dates.push(s.start_at.slice(0, 10)); });
    dates.sort();
    return dates.length ? dates[0] : fmt.todayISO();
  }

  function resolveRange() {
    var r = Console.analyticsRange || { preset: '30d' };
    var todayISO = fmt.todayISO();
    if (r.preset === 'custom' && r.start && r.end) return { startISO: r.start, endISO: r.end, label: r.start + ' → ' + r.end };
    if (r.preset === 'all') return { startISO: earliestDataISO(), endISO: todayISO, label: 'all time' };
    var days = r.preset === '7d' ? 7 : r.preset === '90d' ? 90 : 30;
    return { startISO: fmt.addDaysISO(todayISO, -(days - 1)), endISO: todayISO, label: 'last ' + days + 'd' };
  }

  function inRange(iso, range) { return !!iso && iso >= range.startISO && iso <= range.endISO; }

  function eachDayISO(range) {
    var out = [];
    var cur = range.startISO;
    var guard = 0;
    while (cur <= range.endISO && guard < 5000) { out.push(cur); cur = fmt.addDaysISO(cur, 1); guard++; }
    return out;
  }

  // 7-day buckets covering the range, oldest first; last bucket may be shorter than 7 days.
  function weeklyBuckets(range) {
    var out = [];
    var cur = range.startISO;
    var guard = 0;
    while (cur <= range.endISO && guard < 500) {
      var end = fmt.addDaysISO(cur, 6);
      if (end > range.endISO) end = range.endISO;
      out.push({ startISO: cur, endISO: end });
      cur = fmt.addDaysISO(end, 1);
      guard++;
    }
    return out;
  }

  function eventDurationHours(e) {
    if (!e.start_time || !e.end_time) return 0;
    var sp = e.start_time.split(':'), ep = e.end_time.split(':');
    var startMin = (+sp[0]) * 60 + (+sp[1]);
    var endMin = (+ep[0]) * 60 + (+ep[1]);
    return Math.max(0, endMin - startMin) / 60;
  }

  function focusHoursForRange(range, extraFilter) {
    return cache.focusSessions
      .filter(function (s) { return inRange((s.start_at || '').slice(0, 10), range) && (!extraFilter || extraFilter(s)); })
      .reduce(function (sum, s) { return sum + (s.duration_min || 0) / 60; }, 0);
  }

  function findProject(id) { return cache.projects.find(function (p) { return p.id === id; }); }
  function findTask(id) { return cache.tasks.find(function (t) { return t.id === id; }); }
  function findEvent(id) { return cache.events.find(function (e) { return e.id === id; }); }

  // ---------------------------------------------------------------- shared mini-components

  function emptyState(title, sub) {
    return (
      '<div class="empty">' +
        '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><path d="M3 3v18h18"/><path d="M7 14l3-3 4 4 6-7"/></svg></div>' +
        '<div class="empty-title">' + title + '</div>' +
        '<div class="empty-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function legendHtml(items) {
    // items: [{swatch: 'dot'|'bar', color, label}]
    return '<div class="av-legend">' + items.map(function (it) {
      var swatch = it.swatch === 'bar'
        ? '<span class="av-legend-bar" style="background:' + it.color + '"></span>'
        : '<span class="av-legend-dot" style="background:' + it.color + '"></span>';
      return '<span class="av-legend-item">' + swatch + escapeHtml(it.label) + '</span>';
    }).join('') + '</div>';
  }

  // Generic line-chart coordinate builder — ports the prototype's own `Component.buildSeries`
  // verbatim (same math, same rounding), fed real min/max instead of decorative ones.
  function buildSeries(values, w, h, padTop, padBottom, min, max) {
    var n = values.length;
    if (max === min) { max = min + 1; }
    var usableH = h - padTop - padBottom;
    var pts = values.map(function (v, i) {
      var x = n > 1 ? (i / (n - 1)) * w : 0;
      var y = padTop + usableH - ((v - min) / (max - min)) * usableH;
      return { x: round1(x), y: round1(y) };
    });
    var points = pts.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    var area = 'M' + pts[0].x + ',' + (h - padBottom) + ' ' + pts.map(function (p) { return 'L' + p.x + ',' + p.y; }).join(' ') + ' L' + pts[pts.length - 1].x + ',' + (h - padBottom) + ' Z';
    return { points: points, area: area };
  }

  // Line + area chart, no axis — used by Time-Money Rate / Cost per Focus Hour / Energy Index.
  function lineAreaSvg(values, w, h, padTop, padBottom, color, baseline) {
    var min = Math.min.apply(null, values), max = Math.max.apply(null, values);
    var series = buildSeries(values, w, h, padTop, padBottom, min, max);
    var base = baseline ? '<line x1="0" y1="' + (h - padBottom) + '" x2="' + w + '" y2="' + (h - padBottom) + '" stroke="' + baseline + '" stroke-width="1"></line>' : '';
    return (
      '<svg viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;height:' + (h - 20) + 'px;display:block;">' +
        base +
        '<path d="' + series.area + '" fill="' + color + '" opacity="0.12"></path>' +
        '<polyline points="' + series.points + '" fill="none" stroke="' + color + '" stroke-width="2.4" vector-effect="non-scaling-stroke"></polyline>' +
      '</svg>'
    );
  }

  // ---------------------------------------------------------------- view 1: Project Investment Matrix

  function renderInvestment(range) {
    var openProjects = cache.projects.filter(function (p) { return !p.archived_at; });
    var raw = openProjects.map(function (p, i) {
      var spend = cache.transactions
        .filter(function (t) { return t.project_id === p.id && inRange(t.date, range) && t.amount < 0; })
        .reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);
      var eventHours = cache.events
        .filter(function (e) { return e.project_id === p.id && inRange(e.start_date, range); })
        .reduce(function (s, e) { return s + eventDurationHours(e); }, 0);
      var focusHours = focusHoursForRange(range, function (s) {
        var t = s.task_id && findTask(s.task_id);
        var e = s.event_id && findEvent(s.event_id);
        return (t && t.project_id === p.id) || (e && e.project_id === p.id);
      });
      var openTasks = cache.tasks.filter(function (t) { return t.project_id === p.id && t.status !== 'done'; }).length;
      return { name: p.name || 'Untitled', spend: spend, hours: eventHours + focusHours, tasks: openTasks, color: 'var(--' + COLOR_CYCLE[i % COLOR_CYCLE.length] + ')' };
    }).filter(function (p) { return p.spend > 0 || p.hours > 0; });

    if (!raw.length) return emptyState('Not enough data yet', 'Needs at least one active project with spend or time logged in this range.');

    var spendMax = niceCeil(Math.max.apply(null, raw.map(function (p) { return p.spend; })) || 1);
    var hoursMax = niceCeil(Math.max.apply(null, raw.map(function (p) { return p.hours; })) || 1);
    var tasksMax = Math.max.apply(null, raw.map(function (p) { return p.tasks; }).concat([1]));

    var points = raw.map(function (p) {
      return {
        cx: round1(60 + (p.spend / spendMax) * 760),
        cy: round1(340 - (p.hours / hoursMax) * 320),
        r: round1(8 + (p.tasks / tasksMax) * 17),
        p: p
      };
    });

    var dots = points.map(function (pt) {
      return '<circle cx="' + pt.cx + '" cy="' + pt.cy + '" r="' + pt.r + '" fill="' + pt.p.color + '" fill-opacity="0.28" stroke="' + pt.p.color + '" stroke-width="2"></circle>' +
        '<text x="' + pt.cx + '" y="' + pt.cy + '" text-anchor="middle" dominant-baseline="central" font-family="var(--mono)" font-size="10" font-weight="700" fill="' + pt.p.color + '">' + pt.p.tasks + '</text>';
    }).join('');

    var svg = (
      '<svg viewBox="0 0 860 400" style="width:100%;height:380px;display:block;overflow:visible;">' +
        '<line x1="60" y1="20" x2="60" y2="340" stroke="var(--line-2)" stroke-width="1"></line>' +
        '<line x1="60" y1="340" x2="820" y2="340" stroke="var(--line-2)" stroke-width="1"></line>' +
        '<text x="10" y="24" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + hoursMax.toFixed(0) + 'h</text>' +
        '<text x="10" y="184" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + (hoursMax / 2).toFixed(0) + 'h</text>' +
        '<text x="18" y="344" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">0h</text>' +
        '<text x="60" y="362" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">$0</text>' +
        '<text x="418" y="362" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + money(spendMax / 2) + '</text>' +
        '<text x="780" y="362" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + money(spendMax) + '</text>' +
        '<text x="380" y="392" font-family="var(--mono)" font-size="10.5" fill="var(--ink-3)" font-weight="700">MONEY SPENT →</text>' +
        '<text x="-190" y="15" transform="rotate(-90)" font-family="var(--mono)" font-size="10.5" fill="var(--ink-3)" font-weight="700">TIME INVESTED →</text>' +
        dots +
      '</svg>'
    );

    var legend = legendHtml(raw.map(function (p) { return { swatch: 'dot', color: p.color, label: p.name }; }));

    var table = (
      '<div class="av-table investment">' +
        '<div class="av-table-head">' +
          '<div class="av-th">Project</div><div class="av-th right">Spend</div><div class="av-th right">Hours</div><div class="av-th right">Open tasks</div>' +
        '</div>' +
        raw.map(function (p) {
          return '<div class="av-table-row">' +
            '<div class="av-td name"><span class="av-td-dot" style="background:' + p.color + '"></span>' + escapeHtml(p.name) + '</div>' +
            '<div class="av-td right">' + money(p.spend) + '</div>' +
            '<div class="av-td right">' + p.hours.toFixed(1) + 'h</div>' +
            '<div class="av-td right strong">' + p.tasks + '</div>' +
          '</div>';
        }).join('') +
      '</div>'
    );

    return '<div class="av-card">' + svg + legend + table + '</div>';
  }

  // ---------------------------------------------------------------- view 2: Planned vs Executed

  var TYPES = ['deep_work', 'meeting', 'admin', 'exercise', 'break', 'social', 'errand', 'sleep'];
  var TYPE_LABEL = { deep_work: 'Deep work', meeting: 'Meeting', admin: 'Admin', exercise: 'Exercise', break: 'Break', social: 'Social', errand: 'Errand', sleep: 'Sleep' };

  function renderPlanned(range) {
    var eventsInRange = cache.events.filter(function (e) { return inRange(e.start_date, range) && e.status !== 'skipped'; });
    if (!eventsInRange.length) return emptyState('No scheduled events in this range', 'Add events in Schedule to see planned-vs-executed here.');
    var rows = TYPES.map(function (type) {
      var typeEvents = eventsInRange.filter(function (e) { return e.type === type; });
      var planned = typeEvents.reduce(function (s, e) { return s + eventDurationHours(e); }, 0);
      var executed = typeEvents.reduce(function (s, e) {
        var log = cache.eventLogs.find(function (l) { return l.event_id === e.id && l.date === e.start_date; });
        if (!log || log.skipped || !log.actual_start || !log.actual_end) return s;
        var sp = log.actual_start.split(':'), ep = log.actual_end.split(':');
        var min = Math.max(0, ((+ep[0]) * 60 + (+ep[1])) - ((+sp[0]) * 60 + (+sp[1])));
        return s + min / 60;
      }, 0);
      return { type: type, planned: planned, executed: executed };
    }).filter(function (r) { return r.planned > 0 || r.executed > 0; });
    if (!rows.length) return emptyState('No scheduled events in this range', 'Add events in Schedule to see planned-vs-executed here.');

    var legend = legendHtml([
      { swatch: 'bar', color: 'var(--accent-lt)', label: 'scheduled' },
      { swatch: 'bar', color: 'var(--teal)', label: 'actually logged' }
    ]);

    var body = rows.map(function (r) {
      var rowMax = Math.max(r.planned, r.executed, 0.1) * 1.18;
      var schedPct = round1((r.planned / rowMax) * 100);
      var actualPct = round1((r.executed / rowMax) * 100);
      var delta = round1(r.executed - r.planned);
      var deltaColor = Math.abs(delta) < 0.6 ? 'var(--ink-3)' : (delta < 0 ? 'var(--danger)' : 'var(--teal)');
      return (
        '<div class="av-bar-row">' +
          '<div class="av-bar-label">' + TYPE_LABEL[r.type] + '</div>' +
          '<div class="av-bar-stack">' +
            '<div class="av-bar-line"><div class="av-bar-track"><div class="fill" style="background:var(--accent-lt);width:' + schedPct + '%"></div></div><span class="av-bar-value">' + r.planned.toFixed(1) + 'h sched</span></div>' +
            '<div class="av-bar-line"><div class="av-bar-track"><div class="fill" style="background:var(--teal);width:' + actualPct + '%"></div></div><span class="av-bar-value strong">' + r.executed.toFixed(1) + 'h actual</span></div>' +
          '</div>' +
          '<div class="av-bar-delta" style="color:' + deltaColor + '">' + (delta >= 0 ? '+' : '') + delta + 'h</div>' +
        '</div>'
      );
    }).join('');

    return '<div class="av-card">' + legend + body + '</div>';
  }

  // ---------------------------------------------------------------- view 3: Productive Hours Heatmap

  function renderHeatmap(range) {
    var grid = [];
    for (var d = 0; d < 7; d++) grid.push(new Array(24).fill(0));
    var max = 0;
    cache.focusSessions.forEach(function (s) {
      var dateISO = (s.start_at || '').slice(0, 10);
      if (!inRange(dateISO, range)) return;
      var start = new Date(s.start_at);
      var dow = start.getDay(), hour = start.getHours();
      grid[dow][hour] += (s.duration_min || 0);
      if (grid[dow][hour] > max) max = grid[dow][hour];
    });
    if (!max) return emptyState('Not enough data yet', 'Needs logged focus sessions in this range.');

    var DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon..Sun, matching prototype's week order
    var DOW_LABEL = { 0: 'Sun', 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat' };

    var peak = { day: '', hour: 0, mins: 0 };
    DOW_ORDER.forEach(function (dow) {
      for (var h = 0; h < 24; h++) { if (grid[dow][h] > peak.mins) peak = { day: DOW_LABEL[dow], hour: h, mins: Math.round(grid[dow][h]) }; }
    });
    function hourLabel(h) { var hh = h % 12 === 0 ? 12 : h % 12; return hh + (h < 12 ? 'am' : 'pm'); }

    var hourHeader = Array.from({ length: 24 }, function (_, h) {
      return '<div class="av-heatmap-hour">' + (h % 3 === 0 ? (h < 10 ? '0' + h : h) + ':00' : '') + '</div>';
    }).join('');

    var rows = DOW_ORDER.map(function (dow) {
      var cells = grid[dow].map(function (mins) {
        var alpha = clamp(mins / max, 0, 1);
        var bg = alpha < 0.04 ? 'var(--paper-2)' : 'rgba(201,100,66,' + (0.08 + alpha * 0.85).toFixed(2) + ')';
        return '<div class="av-heatmap-cell" style="background:' + bg + '" title="' + DOW_LABEL[dow] + ' ' + hourLabel(0) + ' · ' + Math.round(mins) + 'm"></div>';
      }).join('');
      return '<div class="av-heatmap-day">' + DOW_LABEL[dow] + '</div>' + cells;
    }).join('');

    var footer = (
      '<div class="av-heatmap-footer">' +
        '<div class="av-heatmap-peak">Peak focus window: <strong>' + peak.day + ', ' + hourLabel(peak.hour) + '</strong> · ' + peak.mins + ' min logged</div>' +
        '<div class="av-heatmap-scale">less' +
          '<span class="av-heatmap-swatch s1"></span><span class="av-heatmap-swatch s2"></span><span class="av-heatmap-swatch s3"></span><span class="av-heatmap-swatch s4"></span>' +
        'more</div>' +
      '</div>'
    );

    return '<div class="av-card"><div class="av-heatmap">' + hourHeader + rows + '</div>' + footer + '</div>';
  }

  // ---------------------------------------------------------------- view 4: Subscription-vs-Usage Matrix

  function renderSubs(range) {
    var subs = cache.transactions.filter(function (t) { return t.recurring && inRange(t.date, range); });
    // De-dupe by title — a recurring charge appears once per period; the matrix is per-subscription,
    // not per-charge, so multiple months of the same subscription collapse to one dot (latest wins).
    var byTitle = {};
    subs.forEach(function (t) { byTitle[t.title || 'Untitled'] = t; });
    var titles = Object.keys(byTitle);
    if (!titles.length) return emptyState('No recurring subscriptions in this range', 'Mark a transaction as recurring in Finance to see it here.');

    var raw = titles.map(function (title) {
      var t = byTitle[title];
      var cost = Math.abs(t.amount || 0);
      var uses = t.usage_count || 0;
      var cut = cost >= 15 && uses <= 4;
      return { name: title, cost: cost, uses: uses, cut: cut };
    });

    var costMax = niceCeil(Math.max.apply(null, raw.map(function (s) { return s.cost; })) || 1);
    var usesMax = niceCeil(Math.max.apply(null, raw.map(function (s) { return s.uses; })) || 1);
    var cutThreshold = 15;

    var points = raw.map(function (s) {
      return { cx: round1(60 + (s.cost / costMax) * 660), cy: round1(340 - (s.uses / usesMax) * 320), s: s };
    });

    var cutRectX = cutThreshold <= costMax ? round1(60 + (cutThreshold / costMax) * 660) : null;
    var cutRect = cutRectX != null ? (
      '<rect x="' + cutRectX + '" y="20" width="' + round1(720 - cutRectX) + '" height="' + round1((4 / usesMax) * 320) + '" fill="var(--rose-soft)" opacity="0.7"></rect>' +
      '<text x="' + cutRectX + '" y="34" font-family="var(--mono)" font-size="10" font-weight="700" fill="var(--danger)">CUT CANDIDATES</text>'
    ) : '';

    var dots = points.map(function (pt) {
      var color = pt.s.cut ? 'var(--danger)' : 'var(--teal)';
      return '<circle cx="' + pt.cx + '" cy="' + pt.cy + '" r="9" fill="' + color + '" fill-opacity="0.85" stroke="var(--card)" stroke-width="2"></circle>' +
        '<text x="' + pt.cx + '" y="' + pt.cy + '" dx="13" dy="4" font-family="var(--body)" font-size="11" font-weight="600" fill="var(--ink-2)">' + escapeHtml(pt.s.name) + '</text>';
    }).join('');

    var svg = (
      '<svg viewBox="0 0 760 400" style="width:100%;height:380px;display:block;overflow:visible;">' +
        cutRect +
        '<line x1="60" y1="20" x2="60" y2="340" stroke="var(--line-2)" stroke-width="1"></line>' +
        '<line x1="60" y1="340" x2="720" y2="340" stroke="var(--line-2)" stroke-width="1"></line>' +
        '<text x="10" y="24" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + usesMax + ' uses</text>' +
        '<text x="18" y="344" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">0</text>' +
        '<text x="60" y="362" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">$0</text>' +
        '<text x="670" y="362" font-family="var(--mono)" font-size="10" fill="var(--ink-3)">' + money(costMax) + '/mo</text>' +
        '<text x="330" y="392" font-family="var(--mono)" font-size="10.5" fill="var(--ink-3)" font-weight="700">MONTHLY COST →</text>' +
        '<text x="-190" y="15" transform="rotate(-90)" font-family="var(--mono)" font-size="10.5" fill="var(--ink-3)" font-weight="700">USAGE COUNT →</text>' +
        dots +
      '</svg>'
    );

    var table = (
      '<div class="av-table subs">' +
        '<div class="av-table-head">' +
          '<div class="av-th">Subscription</div><div class="av-th right">Cost / mo</div><div class="av-th right">Uses</div><div class="av-th right">Verdict</div>' +
        '</div>' +
        raw.map(function (s) {
          var verdict = s.cut
            ? '<span class="pill danger">cut candidate</span>'
            : '<span class="pill teal">keep</span>';
          return '<div class="av-table-row">' +
            '<div class="av-td name">' + escapeHtml(s.name) + '</div>' +
            '<div class="av-td right">' + money(s.cost) + '</div>' +
            '<div class="av-td right">' + s.uses + '</div>' +
            '<div class="av-td right">' + verdict + '</div>' +
          '</div>';
        }).join('') +
      '</div>'
    );

    return '<div class="av-card">' + svg + table + '</div>';
  }

  // ---------------------------------------------------------------- view 5: Habit <-> Output Correlation

  function renderHabitCorr(range) {
    var active = cache.habits.filter(function (h) { return h.status === 'active'; });
    if (!active.length) return emptyState('No active habits yet', 'Add one in Habits to see output correlation here.');
    var days = eachDayISO(range);
    var tasksDoneByDay = {};
    cache.tasks.forEach(function (t) {
      if (t.status === 'done' && t.due_date && inRange(t.due_date, range)) tasksDoneByDay[t.due_date] = (tasksDoneByDay[t.due_date] || 0) + 1;
    });
    var focusMinByDay = {};
    cache.focusSessions.forEach(function (s) {
      var d = (s.start_at || '').slice(0, 10);
      if (inRange(d, range)) focusMinByDay[d] = (focusMinByDay[d] || 0) + (s.duration_min || 0);
    });
    var rows = active.map(function (h, i) {
      var doneDays = [], notDoneDays = [];
      days.forEach(function (d) {
        var log = cache.habitLogs.find(function (l) { return l.habit_id === h.id && l.date === d; });
        (log && log.state === 'done' ? doneDays : notDoneDays).push(d);
      });
      function avg(list, map) { return list.length ? list.reduce(function (s, d) { return s + (map[d] || 0); }, 0) / list.length : 0; }
      return {
        name: h.name || 'Untitled',
        color: COLOR_CYCLE[i % COLOR_CYCLE.length],
        tasksOn: avg(doneDays, tasksDoneByDay), tasksOff: avg(notDoneDays, tasksDoneByDay),
        focusOn: avg(doneDays, focusMinByDay) / 60, focusOff: avg(notDoneDays, focusMinByDay) / 60
      };
    });

    var taskMax = Math.max.apply(null, rows.map(function (r) { return Math.max(r.tasksOn, r.tasksOff); }).concat([1]));
    var focusMax = Math.max.apply(null, rows.map(function (r) { return Math.max(r.focusOn, r.focusOff); }).concat([1]));

    var cards = rows.map(function (r) {
      var barColor = 'var(--' + r.color + ')';
      var tasksDelta = round1(r.tasksOn - r.tasksOff);
      var focusDelta = round1(r.focusOn - r.focusOff);
      return (
        '<div class="av-mini-card">' +
          '<div class="av-mini-card-head"><div class="av-mini-card-name">' + escapeHtml(r.name) + '</div></div>' +
          '<div class="av-metric-group">' +
            '<div class="av-metric-head"><span>Tasks completed</span><span class="delta">' + (tasksDelta >= 0 ? '+' : '') + tasksDelta + '</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track"><div class="fill" style="background:' + barColor + ';width:' + round1(r.tasksOn / taskMax * 100) + '%"></div></div><span class="av-metric-bar-val">' + r.tasksOn.toFixed(1) + '</span><span class="av-metric-bar-tag">on-day</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track"><div class="fill" style="background:var(--ink-4);width:' + round1(r.tasksOff / taskMax * 100) + '%"></div></div><span class="av-metric-bar-val off">' + r.tasksOff.toFixed(1) + '</span><span class="av-metric-bar-tag">off-day</span></div>' +
          '</div>' +
          '<div class="av-metric-group">' +
            '<div class="av-metric-head"><span>Focus hours</span><span class="delta">' + (focusDelta >= 0 ? '+' : '') + focusDelta + '</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track"><div class="fill" style="background:' + barColor + ';width:' + round1(r.focusOn / focusMax * 100) + '%"></div></div><span class="av-metric-bar-val">' + r.focusOn.toFixed(1) + 'h</span><span class="av-metric-bar-tag">on-day</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track"><div class="fill" style="background:var(--ink-4);width:' + round1(r.focusOff / focusMax * 100) + '%"></div></div><span class="av-metric-bar-val off">' + r.focusOff.toFixed(1) + 'h</span><span class="av-metric-bar-tag">off-day</span></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return '<div class="av-card-grid">' + cards + '</div>';
  }

  // ---------------------------------------------------------------- view 6: Calendar Load vs Todo Backlog

  function renderBacklog(range) {
    var days = eachDayISO(range);
    if (days.length < 2) return emptyState('Not enough data yet', 'Needs at least 2 days in this range.');
    var loadVals = [], backlogVals = [];
    days.forEach(function (d) {
      var loadHours = cache.events.filter(function (e) { return e.start_date === d && e.status !== 'skipped'; }).reduce(function (s, e) { return s + eventDurationHours(e); }, 0);
      var backlog = cache.tasks.filter(function (t) { return t.status !== 'done' && t.due_date && t.due_date <= d; }).length;
      loadVals.push(loadHours);
      backlogVals.push(backlog);
    });

    var loadMin = Math.min.apply(null, loadVals), loadMax = Math.max.apply(null, loadVals);
    var backlogMin = Math.min.apply(null, backlogVals), backlogMax = Math.max.apply(null, backlogVals);
    var loadSeries = buildSeries(loadVals, 860, 260, 20, 30, loadMin, loadMax);
    var backlogSeries = buildSeries(backlogVals, 860, 260, 20, 30, backlogMin, backlogMax);

    var legend = legendHtml([
      { swatch: 'bar', color: 'var(--blue)', label: 'scheduled hours / day' },
      { swatch: 'bar', color: 'var(--accent)', label: 'open task backlog' }
    ]);

    var svg = (
      '<svg viewBox="0 0 860 260" style="width:100%;height:260px;display:block;">' +
        '<line x1="0" y1="230" x2="860" y2="230" stroke="var(--line-1)" stroke-width="1"></line>' +
        '<path d="' + loadSeries.area + '" fill="var(--blue)" opacity="0.10"></path>' +
        '<polyline points="' + loadSeries.points + '" fill="none" stroke="var(--blue)" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>' +
        '<path d="' + backlogSeries.area + '" fill="var(--accent)" opacity="0.08"></path>' +
        '<polyline points="' + backlogSeries.points + '" fill="none" stroke="var(--accent)" stroke-width="2.2" vector-effect="non-scaling-stroke"></polyline>' +
      '</svg>'
    );

    var footer = '<div class="av-chart-footer"><span>' + escapeHtml(range.startISO) + '</span><span>' + escapeHtml(range.endISO) + '</span></div>';

    return '<div class="av-card">' + legend + svg + footer + '</div>';
  }

  // ---------------------------------------------------------------- view 7: Decay Analysis
  // Not scoped to the range filter (decision: staleness inherently looks back further than any
  // "last 7/30/90d" window would show) — a flat ranked list instead.

  function renderDecay() {
    var todayISO = fmt.todayISO();
    var items = [];
    cache.tasks.filter(function (t) { return t.status !== 'done'; }).forEach(function (t) {
      var sinceISO = (t.due_date && t.due_date < todayISO) ? t.due_date : (t.created_at || todayISO).slice(0, 10);
      items.push({ kind: 'task', label: t.title || 'Untitled', days: fmt.daysBetweenISO(sinceISO, todayISO) });
    });
    cache.projects.filter(function (p) { return !p.archived_at; }).forEach(function (p) {
      var touchDates = []
        .concat(cache.tasks.filter(function (t) { return t.project_id === p.id; }).map(function (t) { return (t.created_at || '').slice(0, 10); }))
        .concat(cache.events.filter(function (e) { return e.project_id === p.id; }).map(function (e) { return e.start_date; }))
        .concat(cache.transactions.filter(function (t) { return t.project_id === p.id; }).map(function (t) { return t.date; }))
        .filter(Boolean).sort();
      var last = touchDates.length ? touchDates[touchDates.length - 1] : null;
      if (last) items.push({ kind: 'project', label: p.name || 'Untitled', days: fmt.daysBetweenISO(last, todayISO) });
    });
    cache.habits.filter(function (h) { return h.status === 'active'; }).forEach(function (h) {
      var logs = cache.habitLogs.filter(function (l) { return l.habit_id === h.id; }).map(function (l) { return l.date; }).sort();
      var last = logs.length ? logs[logs.length - 1] : (h.created_at || '').slice(0, 10);
      items.push({ kind: 'habit', label: h.name || 'Untitled', days: fmt.daysBetweenISO(last, todayISO) });
    });
    items = items.filter(function (i) { return i.days >= 0; }).sort(function (a, b) { return b.days - a.days; });
    if (!items.length) return emptyState('Nothing to analyze yet', 'Add tasks, projects, or habits to see staleness here.');

    var maxDays = Math.max.apply(null, items.map(function (i) { return i.days; }).concat([1]));
    var TYPE_COLOR = { task: 'var(--blue)', project: 'var(--plum)', habit: 'var(--teal)' };
    var TYPE_BG = { task: 'var(--blue-soft)', project: 'var(--plum-soft)', habit: 'var(--teal-soft)' };

    var rows = items.map(function (i) {
      var stale = i.days >= DECAY_STALE_DAYS;
      return (
        '<div class="av-decay-row">' +
          '<span class="av-decay-type" style="background:' + TYPE_BG[i.kind] + ';color:' + TYPE_COLOR[i.kind] + '">' + i.kind + '</span>' +
          '<span class="av-decay-name">' + escapeHtml(i.label) + '</span>' +
          '<div class="av-decay-track"><div class="fill" style="background:' + TYPE_COLOR[i.kind] + ';width:' + round1(clamp(i.days / maxDays, 0, 1) * 100) + '%"></div></div>' +
          '<div class="av-decay-days">' + i.days + 'd' + (stale ? ' <span class="av-decay-warn" title="stale">⚠</span>' : '') + '</div>' +
        '</div>'
      );
    }).join('');

    return '<div class="av-card tight-top">' + rows + '</div>';
  }

  // ---------------------------------------------------------------- view 8: Theme Day Output

  function renderThemeDay(range) {
    var days = eachDayISO(range);
    var byTheme = {};
    days.forEach(function (d) {
      var dow = new Date(d + 'T00:00:00').getDay();
      var theme = cache.themeDays.find(function (t) { return t.day_of_week === dow; });
      var label = (theme && theme.label) ? theme.label : '(untitled)';
      if (!byTheme[label]) byTheme[label] = { focusMin: 0, tasksDone: 0, habitHitPct: [], days: 0 };
      var bucket = byTheme[label];
      bucket.days++;
      bucket.focusMin += cache.focusSessions.filter(function (s) { return (s.start_at || '').slice(0, 10) === d; }).reduce(function (s, x) { return s + (x.duration_min || 0); }, 0);
      bucket.tasksDone += cache.tasks.filter(function (t) { return t.status === 'done' && t.due_date === d; }).length;
      var activeHabits = cache.habits.filter(function (h) { return h.status === 'active'; }).length;
      var doneCount = cache.habitLogs.filter(function (l) { return l.date === d && l.state === 'done'; }).length;
      bucket.habitHitPct.push(activeHabits ? doneCount / activeHabits * 100 : 0);
    });
    var labels = Object.keys(byTheme);
    if (!labels.length) return emptyState('No theme days configured', 'Label your weekdays in Schedule to see output by theme here.');

    var themeRows = labels.map(function (l) {
      var b = byTheme[l];
      return {
        name: l,
        focusOn: b.focusMin / b.days / 60,
        tasksOn: b.tasksDone / b.days,
        habitOn: b.habitHitPct.reduce(function (s, x) { return s + x; }, 0) / b.habitHitPct.length
      };
    });
    // "off" reference = average across all OTHER themed days, so each card still reads as on-vs-off.
    themeRows.forEach(function (r, i) {
      var others = themeRows.filter(function (_, j) { return j !== i; });
      function avgOf(key) { return others.length ? others.reduce(function (s, o) { return s + o[key]; }, 0) / others.length : r[key]; }
      r.focusOff = avgOf('focusOn'); r.tasksOff = avgOf('tasksOn'); r.habitOff = avgOf('habitOn');
    });

    var focusMax = Math.max.apply(null, themeRows.map(function (r) { return Math.max(r.focusOn, r.focusOff); }).concat([1]));
    var taskMax = Math.max.apply(null, themeRows.map(function (r) { return Math.max(r.tasksOn, r.tasksOff); }).concat([1]));

    var cards = themeRows.map(function (r) {
      return (
        '<div class="av-mini-card">' +
          '<div class="av-mini-card-title">' + escapeHtml(r.name) + '</div>' +
          '<div class="av-metric-group">' +
            '<div class="av-metric-head"><span>Focus hrs</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--accent);width:' + round1(r.focusOn / focusMax * 100) + '%"></div></div><span class="av-metric-bar-val">' + r.focusOn.toFixed(1) + 'h</span><span class="av-metric-bar-tag">on</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--ink-4);width:' + round1(r.focusOff / focusMax * 100) + '%"></div></div><span class="av-metric-bar-val off">' + r.focusOff.toFixed(1) + 'h</span><span class="av-metric-bar-tag">off</span></div>' +
          '</div>' +
          '<div class="av-metric-group">' +
            '<div class="av-metric-head"><span>Tasks done</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--blue);width:' + round1(r.tasksOn / taskMax * 100) + '%"></div></div><span class="av-metric-bar-val">' + r.tasksOn.toFixed(1) + '</span><span class="av-metric-bar-tag">on</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--ink-4);width:' + round1(r.tasksOff / taskMax * 100) + '%"></div></div><span class="av-metric-bar-val off">' + r.tasksOff.toFixed(1) + '</span><span class="av-metric-bar-tag">off</span></div>' +
          '</div>' +
          '<div class="av-metric-group">' +
            '<div class="av-metric-head"><span>Habit consistency</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--teal);width:' + round1(clamp(r.habitOn, 0, 100)) + '%"></div></div><span class="av-metric-bar-val">' + Math.round(r.habitOn) + '%</span><span class="av-metric-bar-tag">on</span></div>' +
            '<div class="av-metric-bar-line"><div class="av-metric-bar-track sm"><div class="fill" style="background:var(--ink-4);width:' + round1(clamp(r.habitOff, 0, 100)) + '%"></div></div><span class="av-metric-bar-val off">' + Math.round(r.habitOff) + '%</span><span class="av-metric-bar-tag">off</span></div>' +
          '</div>' +
        '</div>'
      );
    }).join('');

    return '<div class="av-card-grid">' + cards + '</div>';
  }

  // ---------------------------------------------------------------- views 9 & 10: Time-Money Rate, Cost per Focus Hour
  // Both duplicate Finance's per-period formulas, generalized to arbitrary weekly buckets instead
  // of Finance's own calendar-month `period` strings (phase_7_analytics.md Design Decision #6).
  // Rendered together as one section, matching the prototype's combined "09-10" heading.

  function weeklyFinanceSeries(range) {
    var buckets = weeklyBuckets(range);
    return buckets.map(function (b) {
      var txns = cache.transactions.filter(function (t) { return inRange(t.date, b); });
      var income = txns.filter(function (t) { return t.amount > 0; }).reduce(function (s, t) { return s + t.amount; }, 0);
      var expenses = txns.filter(function (t) { return t.amount < 0; }).reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);
      var net = income - expenses;
      var focusHrs = focusHoursForRange(b);
      return { x: b.startISO.slice(5), net: net, expenses: expenses, focusHrs: focusHrs, hourlyRate: focusHrs > 0 ? net / focusHrs : null, costPerHr: focusHrs > 0 ? expenses / focusHrs : null };
    });
  }

  function metricPairCard(name, formula, values, color, unitFmt) {
    if (values.length < 2) return '<div class="av-pair-card">' + emptyState('Not enough data yet', 'Needs focus hours logged across at least 2 weeks in this range.') + '</div>';
    var chart = lineAreaSvg(values, 860, 220, 16, 26, color, null);
    var last = values[values.length - 1];
    return (
      '<div class="av-pair-card">' +
        '<div class="av-pair-head"><span class="av-mini-card-name">' + name + '</span><span class="av-pair-formula">' + formula + '</span></div>' +
        chart +
        '<div class="av-pair-value" style="color:' + color + '">' + unitFmt(last) + '</div>' +
      '</div>'
    );
  }

  function renderRateCost(range) {
    var series = weeklyFinanceSeries(range);
    var rateVals = series.filter(function (p) { return p.hourlyRate != null; }).map(function (p) { return p.hourlyRate; });
    var costVals = series.filter(function (p) { return p.costPerHr != null; }).map(function (p) { return p.costPerHr; });
    var rateCard = metricPairCard('Time-money rate', 'net income ÷ focus hrs', rateVals, 'var(--teal)', function (v) { return '$' + v.toFixed(2) + '<span class="unit">/hr today</span>'; });
    var costCard = metricPairCard('Cost per focus hour', 'fixed spend ÷ focus hrs', costVals, 'var(--plum)', function (v) { return '$' + v.toFixed(2) + '<span class="unit">/focus hr today</span>'; });
    return '<div class="av-pair-grid">' + rateCard + costCard + '</div>';
  }

  // ---------------------------------------------------------------- view 11: Energy Index
  // A plain unweighted average of 3 real percentages — not a scored/predictive model
  // (phase_7_analytics.md Design Decision #5). ENERGY_FOCUS_TARGET_MIN (240 = 4h/day) is the one
  // stated reference number involved; the other two components are already real 0-100% ratios.

  function renderEnergy(range) {
    var days = eachDayISO(range);
    if (days.length < 2) return emptyState('Not enough data yet', 'Needs at least 2 days in this range.');
    var activeHabits = cache.habits.filter(function (h) { return h.status === 'active'; }).length;
    var values = days.map(function (d) {
      var tasksDue = cache.tasks.filter(function (t) { return t.due_date === d; }).length;
      var tasksDone = cache.tasks.filter(function (t) { return t.due_date === d && t.status === 'done'; }).length;
      var taskPct = tasksDue ? clamp(tasksDone / tasksDue * 100, 0, 100) : 0;
      var habitDone = cache.habitLogs.filter(function (l) { return l.date === d && l.state === 'done'; }).length;
      var habitPct = activeHabits ? clamp(habitDone / activeHabits * 100, 0, 100) : 0;
      var focusMin = cache.focusSessions.filter(function (s) { return (s.start_at || '').slice(0, 10) === d; }).reduce(function (s, x) { return s + (x.duration_min || 0); }, 0);
      var focusPct = clamp(focusMin / ENERGY_FOCUS_TARGET_MIN * 100, 0, 100);
      return (taskPct + habitPct + focusPct) / 3;
    });
    var energyToday = Math.round(values[values.length - 1]);
    var chart = lineAreaSvg(values, 1080, 240, 20, 30, 'var(--accent)', 'var(--accent-line)');
    return (
      '<div class="av-energy-card">' +
        '<div class="av-energy-grid">' +
          '<div>' +
            '<div class="av-energy-score">' + energyToday + '</div>' +
            '<div class="av-energy-label">today’s energy score</div>' +
            '<div class="av-energy-sub">Blending completion rate, habit consistency and focus time vs. target.</div>' +
          '</div>' +
          chart +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- shell

  var SECTIONS = [
    { num: '01', kind: 'Scatter + table', title: 'Project Investment Matrix', desc: 'Money spent vs. time invested per active project this range. Dot size scales with open tasks.', render: renderInvestment },
    { num: '02', kind: 'Paired bars', title: 'Planned vs Executed', desc: 'Scheduled hours vs. actually-logged hours per category, this range.', render: renderPlanned },
    { num: '03', kind: 'Heatmap', title: 'Productive Hours Heatmap', desc: 'Focus minutes logged by day of week and hour of day — your real peak windows.', render: renderHeatmap },
    { num: '04', kind: 'Scatter + table', title: 'Subscription-vs-Usage Matrix', desc: 'Monthly cost vs. usage count per subscription. Expensive-but-barely-used sits in the flagged corner.', render: renderSubs },
    { num: '05', kind: 'Small multiples', title: 'Habit ↔ Output Correlation', desc: 'Average tasks completed and focus hours on days each habit was done vs. not.', render: renderHabitCorr },
    { num: '06', kind: 'Dual trend line', title: 'Calendar Load vs Todo Backlog', desc: 'Scheduled hours per day against open-task backlog size — does a full calendar crowd out getting things done?', render: renderBacklog },
    { num: '07', kind: 'Ranked list', title: 'Decay Analysis', desc: 'Tasks, projects and habits ranked by days untouched. Anything past ' + DECAY_STALE_DAYS + ' days is flagged stale.', render: renderDecay },
    { num: '08', kind: 'Small multiples', title: 'Theme Day Output', desc: 'Do themed days actually deliver? Average focus hours, tasks done and habit consistency on vs. off.', render: renderThemeDay },
    { num: '09–10', kind: 'Trend lines', title: 'Time-Money Rate & Cost per Focus Hour', desc: 'Effective hourly rate against fixed spending divided by focus hours — read together, one story.', render: renderRateCost },
    { num: '11', kind: 'Trend line · hero', title: 'Energy Index', desc: 'One daily 0–100 score blending task completion, habit consistency and focus time against target — the quick overall read.', render: renderEnergy }
  ];

  function renderPageHead(range) {
    return (
      '<div class="page-head">' +
        '<h1 class="page-title">Analytics — <span class="em">' + escapeHtml(range.label) + '</span></h1>' +
      '</div>' +
      '<div class="page-sub">11 views · every number computed, nothing predicted</div>' +
      '<p class="av-desc" style="margin:6px 0 28px;max-width:640px;">Everything below reads from tasks, schedule, habits, transactions and focus sessions you already logged — the range filter above scopes all eleven.</p>'
    );
  }

  function renderAllSections(range) {
    return SECTIONS.map(function (s) {
      var body = s.render(range);
      return (
        '<div class="av-view">' +
          '<div class="av-head">' +
            '<div class="av-eyebrow">' + s.num + ' · ' + s.kind + '</div>' +
            '<h2 class="av-title">' + escapeHtml(s.title) + '</h2>' +
            '<p class="av-desc">' + s.desc + '</p>' +
          '</div>' +
          body +
        '</div>'
      );
    }).join('');
  }

  function render() {
    var range = resolveRange();
    container.innerHTML = renderPageHead(range) + renderAllSections(range);
  }

  // ---------------------------------------------------------------- events

  function onRangeChanged() { render(); }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([
      db.getAll('tasks'), db.getAll('projects'), db.getAll('events'), db.getAll('event_logs'),
      db.getAll('theme_days'), db.getAll('habits'), db.getAll('habit_logs'),
      db.getAll('transactions'), db.getAll('envelopes'), db.getAll('categories'), db.getAll('focus_sessions')
    ]).then(function (r) {
      cache.tasks = r[0]; cache.projects = r[1]; cache.events = r[2]; cache.eventLogs = r[3];
      cache.themeDays = r[4]; cache.habits = r[5]; cache.habitLogs = r[6];
      cache.transactions = r[7]; cache.envelopes = r[8]; cache.categories = r[9]; cache.focusSessions = r[10];
      render();
    });
  }

  Console.modules.analytics = {
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      rangeChangeHandler = onRangeChanged;
      document.addEventListener('analytics-range-changed', rangeChangeHandler);
      refreshAndRender();
      refreshHandle = setInterval(refreshAndRender, 5 * 60 * 1000);
    },
    destroy: function () {
      if (rangeChangeHandler) { document.removeEventListener('analytics-range-changed', rangeChangeHandler); rangeChangeHandler = null; }
      if (refreshHandle) { clearInterval(refreshHandle); refreshHandle = null; }
      container = null;
    }
  };
})();
