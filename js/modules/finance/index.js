/* Console — modules/finance. Phase 5: multi-currency transactions against a YNAB-style envelope
   budget, a subscription audit, and cross-domain cost-per-focus-hour reporting. Extracted from
   console_finance_prototype.html's "Overview" view — see docs/phase_prompts/phase_5_finance.md
   and docs/Console_Workflow.md for the extraction/conflict log (NOT the twopane/flush shell —
   reuses Today-dashboard's own .content/.content-inner + .page-head/.card/.two-col; `.card`
   name-collision resolved as `.pane` reuse; `.metrics-strip` scoped under `.metric`;
   `.list-row.txn` first real use). Transactions/Envelopes/Subscriptions/Reports have no
   prototype and are built fresh from already-proven atomic components, same precedent Phase 3/4
   used for their own new layouts.

   No `layout: 'flush'` here — Finance renders inside .content/.content-inner like Today does,
   NOT inside Tasks/Schedule/Habits' twopane shell (see brief's Resolved Conflict #1). */
(function () {
  'use strict';
  window.Console = window.Console || {};
  Console.modules = Console.modules || {};

  var fmt = null;
  var db = null;
  var container = null;
  var keydownHandler = null;
  var refreshHandle = null;

  var GROUP_LABELS = { fixed: 'Fixed', living: 'Living', personal: 'Personal', savings: 'Savings' };
  var GROUP_ORDER = ['fixed', 'living', 'personal', 'savings'];
  var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var LOW_USAGE_THRESHOLD = 3;

  var VIEWS = [
    { key: 'overview', label: 'overview' },
    { key: 'transactions', label: 'transactions' },
    { key: 'envelopes', label: 'envelopes' },
    { key: 'subscriptions', label: 'subscriptions' },
    { key: 'reports', label: 'reports' }
  ];

  var currentView = 'overview';
  var currentPeriod = null; // 'YYYY-MM'
  var selectedId = null;
  var visibleOrder = [];
  var hourlyMode = false; // view-state only, not persisted — same as the topbar's 7d/30d/90d/all toggle

  var modalMode = null; // null | 'txn' | 'envelope' | 'fund'
  var modalTxn = null;
  var modalEnvelope = null;
  var modalFund = null;

  var cache = { transactions: [], envelopes: [], categories: [], focusSessions: [] };

  // ---------------------------------------------------------------- month-period helpers
  // Kept local to Finance for now (per phase_5_finance.md) — no other phase needs month-period
  // math yet; if Analytics/Reports later do, extract to js/lib/format.js then, not before.

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function periodOf(dateISO) { return dateISO.slice(0, 7); }
  function todayPeriod() { return periodOf(fmt.todayISO()); }
  function addMonths(period, n) {
    var parts = period.split('-');
    var y = +parts[0], m = +parts[1] - 1 + n;
    y += Math.floor(m / 12);
    m = ((m % 12) + 12) % 12;
    return y + '-' + pad2(m + 1);
  }
  function periodLabel(period) {
    var parts = period.split('-');
    return MONTH_NAMES[+parts[1] - 1] + ' ' + parts[0];
  }

  // ---------------------------------------------------------------- helpers

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function findCategory(id) { return cache.categories.find(function (c) { return c.id === id; }); }
  function findEnvelope(id) { return cache.envelopes.find(function (e) { return e.id === id; }); }
  function findTxn(id) { return cache.transactions.find(function (t) { return t.id === id; }); }

  function findOrCreateCategory(name, group) {
    var existing = cache.categories.find(function (c) { return c.name && c.name.toLowerCase() === name.toLowerCase(); });
    if (existing) return Promise.resolve(existing.id);
    var cat = { id: db.uuid(), name: name, type: 'expense', parent_id: null, group: group || 'personal', goal_total: null };
    cache.categories.push(cat);
    return db.put('categories', cat).then(function () { return cat.id; });
  }

  function envelopesForPeriod(period) { return cache.envelopes.filter(function (e) { return e.period === period; }); }
  function txnsForPeriod(period) { return cache.transactions.filter(function (t) { return periodOf(t.date) === period; }); }

  // Envelope spend/remaining are always computed from transactions at read time, never stored —
  // same architectural call Phase 4 made for consistency30 (computed on demand, not cached).
  function envelopeSpent(env) {
    return cache.transactions
      .filter(function (t) { return t.envelope_id === env.id && periodOf(t.date) === env.period; })
      .reduce(function (s, t) { return s + Math.abs(t.amount < 0 ? t.amount : 0); }, 0);
  }

  // Lifetime total for a savings category — sums every period's envelope for that category, not
  // just the current month (a savings goal's "saved so far" is cumulative across periods).
  function categoryLifetimeSaved(categoryId) {
    return cache.envelopes
      .filter(function (e) { return e.category_id === categoryId; })
      .reduce(function (sum, e) { return sum + envelopeSpent(e); }, 0);
  }

  function incomeThisPeriod(period) {
    return txnsForPeriod(period).filter(function (t) { return t.amount > 0; }).reduce(function (s, t) { return s + t.amount; }, 0);
  }
  function expensesThisPeriod(period) {
    return txnsForPeriod(period).filter(function (t) { return t.amount < 0; }).reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);
  }
  function netThisPeriod(period) { return incomeThisPeriod(period) - expensesThisPeriod(period); }
  function allocatedThisPeriod(period) { return envelopesForPeriod(period).reduce(function (s, e) { return s + (e.allocated || 0); }, 0); }

  // Simplified but real YNAB rollover rule (documented per the brief — keep simple, log the
  // heuristic, same discipline Schedule used for theme-day adherence): only positive leftover on
  // rollover-enabled envelopes carries forward.
  function rolloverPool(period) {
    var prev = addMonths(period, -1);
    return envelopesForPeriod(prev).filter(function (e) { return e.rollover; })
      .reduce(function (sum, e) { var left = (e.allocated || 0) - envelopeSpent(e); return sum + Math.max(0, left); }, 0);
  }
  function toBeBudgeted(period) { return incomeThisPeriod(period) - allocatedThisPeriod(period) + rolloverPool(period); }

  function fixedSpentThisPeriod(period) {
    return envelopesForPeriod(period).filter(function (e) {
      var cat = findCategory(e.category_id);
      return cat && cat.group === 'fixed';
    }).reduce(function (sum, e) { return sum + envelopeSpent(e); }, 0);
  }
  function focusMinutesForPeriod(period) {
    return cache.focusSessions.filter(function (s) { return s.start_at && periodOf(s.start_at) === period; })
      .reduce(function (sum, s) { return sum + (s.duration_min || 0); }, 0);
  }
  function focusHoursForPeriod(period) { return focusMinutesForPeriod(period) / 60; }
  function costPerFocusHour(period) {
    var hrs = focusHoursForPeriod(period);
    return hrs > 0 ? fixedSpentThisPeriod(period) / hrs : null;
  }
  function hourlyRate(period) {
    var hrs = focusHoursForPeriod(period);
    var net = netThisPeriod(period);
    return (hrs > 0 && net > 0) ? net / hrs : null;
  }

  function subscriptionsForPeriod(period) { return txnsForPeriod(period).filter(function (t) { return t.recurring; }); }
  function lowUsageSubs(period) { return subscriptionsForPeriod(period).filter(function (t) { return (t.usage_count || 0) < LOW_USAGE_THRESHOLD; }); }

  function pctChange(cur, prev) {
    if (!prev) return cur > 0 ? 100 : 0;
    return Math.round((cur - prev) / Math.abs(prev) * 100);
  }

  // Formats a dollar amount; in hourly-equivalent mode, converts using this period's real
  // net-income/focus-hours rate — falls back to a clearly-labeled "no rate yet" state rather
  // than dividing by zero or fabricating a rate (per phase_5_finance.md item 6).
  function money(n, opts) {
    opts = opts || {};
    if (hourlyMode) {
      var rate = hourlyRate(currentPeriod);
      if (!rate) return '—h';
      return (n / rate).toFixed(1) + 'h';
    }
    var sign = opts.signed ? (n >= 0 ? '+' : '−') : (n < 0 ? '−' : '');
    var symbol = (Console.baseCurrency === 'USD' || Console.baseCurrency === 'CAD' || Console.baseCurrency === 'AUD' || Console.baseCurrency === 'SGD') ? '$' : (Console.baseCurrency === 'EUR' ? '€' : (Console.baseCurrency === 'GBP' ? '£' : (Console.baseCurrency === 'JPY' ? '¥' : (Console.baseCurrency === 'MYR' ? 'RM' : ''))));
    if (!symbol) return sign + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 }) + ' ' + Console.baseCurrency;
    return sign + symbol + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
  }

  // ---------------------------------------------------------------- metrics

  function computeMetrics(period) {
    var income = incomeThisPeriod(period), prevIncome = incomeThisPeriod(addMonths(period, -1));
    var expenses = expensesThisPeriod(period);
    var net = income - expenses;
    var savingsRate = income > 0 ? Math.round(net / income * 100) : 0;
    var hrs = focusHoursForPeriod(period);
    var rate = hourlyRate(period);
    return {
      income: income, incomeTrend: pctChange(income, prevIncome),
      expenses: expenses, expensePctOfIncome: income > 0 ? Math.round(expenses / income * 100) : 0,
      net: net, savingsRate: savingsRate,
      hourlyRate: rate, focusHours: hrs
    };
  }

  // ---------------------------------------------------------------- rendering: shell rows

  function renderPageHead(period) {
    var totalHours = focusHoursForPeriod(period);
    return (
      '<div class="page-head">' +
        '<h1 class="page-title">Finance &mdash; <span class="em">' + escapeHtml(periodLabel(period).split(' ')[0]) + '</span></h1>' +
        '<span class="page-sub">' + (Console.baseCurrency || 'USD') + ' · ' + totalHours.toFixed(0) + ' hours logged this month' + (hourlyMode ? ' · showing hourly-equivalent' : '') + '</span>' +
        '<div class="page-actions">' +
          '<div class="month-nav"><button data-act="month-prev">‹</button><button class="this-btn" data-act="month-this">' + (period === todayPeriod() ? 'this month' : escapeHtml(periodLabel(period))) + '</button><button data-act="month-next">›</button></div>' +
          '<button class="btn-mini' + (hourlyMode ? ' primary' : '') + '" id="btn-hourly-toggle">Hourly</button>' +
          '<button class="btn-mini" id="btn-import" title="Finance-only import — stubbed this phase, use Settings’ full JSON export/import for now">Import</button>' +
          '<button class="btn-mini primary" id="btn-new-txn">New transaction</button>' +
        '</div>' +
      '</div>'
    );
  }

  function viewCounts(period) {
    return {
      transactions: txnsForPeriod(period).length,
      envelopes: envelopesForPeriod(period).length,
      subscriptions: subscriptionsForPeriod(period).length
    };
  }

  function renderViewTabs(period) {
    var counts = viewCounts(period);
    return (
      '<div class="view-tabs">' +
        VIEWS.map(function (v) {
          var count = counts[v.key];
          return '<span class="vtab' + (v.key === currentView ? ' active' : '') + '" data-view="' + v.key + '">' + v.label + (count != null ? ' <span class="vcount">' + count + '</span>' : '') + '</span>';
        }).join('') +
      '</div>'
    );
  }

  function renderMetricsStrip(period) {
    var m = computeMetrics(period);
    return (
      '<div class="metrics-strip">' +
        '<div class="metric"><div class="mnum pos">' + money(m.income, { signed: true }) + '</div><div class="mlbl"><span>income · ' + periodLabel(period).split(' ')[0].toLowerCase() + '</span><span class="mtrend' + (m.incomeTrend < 0 ? ' warn' : '') + '">' + (m.incomeTrend >= 0 ? '▲' : '▼') + ' ' + Math.abs(m.incomeTrend) + '% MoM</span></div></div>' +
        '<div class="metric"><div class="mnum">' + money(m.expenses) + '</div><div class="mlbl"><span>expenses</span><span class="mtrend down">' + m.expensePctOfIncome + '% of income</span></div></div>' +
        '<div class="metric"><div class="mnum ' + (m.net >= 0 ? 'pos' : 'warn') + '">' + money(m.net, { signed: true }) + '</div><div class="mlbl"><span>net · savings rate</span><span class="mtrend">' + m.savingsRate + '%</span></div></div>' +
        '<div class="metric"><div class="mnum">' + (m.hourlyRate ? (money(m.hourlyRate).replace(/\d|\.|,/g, '')) + m.hourlyRate.toFixed(2) + '<span class="munit">/hr</span>' : '—') + '</div><div class="mlbl"><span>hourly equivalent</span><span class="mtrend">' + m.focusHours.toFixed(0) + 'h logged</span></div></div>' +
      '</div>'
    );
  }

  function renderTBBBanner(period) {
    var tbb = toBeBudgeted(period);
    var roll = rolloverPool(period);
    return (
      '<div class="tbb-banner">' +
        '<div class="tbb-left">' +
          '<div class="tbb-lbl">◇ To be budgeted · ' + periodLabel(period).split(' ')[0].toLowerCase() + '</div>' +
          '<div class="tbb-num">' + money(tbb, { signed: false }) + '</div>' +
          '<div class="tbb-sub">Assign every dollar.' + (roll > 0 ? ' <span class="rollover">+' + money(roll) + ' rollover</span> from ' + periodLabel(addMonths(period, -1)).split(' ')[0] + '’s unused envelopes.' : '') + '</div>' +
        '</div>' +
        '<div class="tbb-actions">' +
          '<button class="primary" data-act="auto-allocate">Auto-allocate</button>' +
          '<button data-act="fund-envelope">Fund envelope</button>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: envelopes

  function envGroupHtml(period, group) {
    var envs = envelopesForPeriod(period).filter(function (e) {
      var cat = findCategory(e.category_id);
      return cat && (cat.group || 'personal') === group;
    });
    if (!envs.length) return '';
    var groupAllocated = envs.reduce(function (s, e) { return s + (e.allocated || 0); }, 0);
    var cards = envs.map(function (e) {
      var cat = findCategory(e.category_id) || { name: 'Untitled' };
      var spent = envelopeSpent(e);
      var isSavings = group === 'savings';
      var pct = e.allocated ? Math.min(100, Math.round(spent / e.allocated * 100)) : 0;
      var remain = (e.allocated || 0) - spent;
      var remainCls = remain <= 0 ? 'done' : (pct >= 90 ? 'danger' : (pct >= 75 ? 'warn' : ''));
      var remainLbl = isSavings
        ? (remain <= 0 ? 'Full · ' + money(e.allocated) : money(remain) + ' left')
        : (remain <= 0 ? money(0) + ' left' : money(remain) + ' left');
      var barCls = isSavings ? 'savings' : (pct >= 90 ? 'danger' : (pct >= 75 ? 'warn' : ''));
      var txnCount = cache.transactions.filter(function (t) { return t.envelope_id === e.id && periodOf(t.date) === e.period; }).length;
      var noteBase = isSavings && cat.goal_total
        ? money(categoryLifetimeSaved(e.category_id)) + ' saved of ' + money(cat.goal_total) + ' goal'
        : (txnCount ? txnCount + ' transaction' + (txnCount === 1 ? '' : 's') + ' this period' : 'No activity yet');
      return (
        '<div class="env-card' + (e.id === selectedId ? ' selected' : '') + '" data-id="' + e.id + '">' +
          '<div class="ec-head"><div class="ec-name">' + escapeHtml(cat.name) + '</div><div class="ec-remain ' + remainCls + '">' + remainLbl + '</div></div>' +
          '<div class="ec-amounts"><span class="ec-spent">' + money(Math.round(spent)) + '</span><span class="ec-allocated">/ ' + money(Math.round(e.allocated || 0)) + (isSavings ? ' this mo' : '') + '</span></div>' +
          '<div class="ec-bar' + (barCls ? ' ' + barCls : '') + '"><div class="fill" style="width:' + pct + '%;"></div></div>' +
          '<div class="ec-note">' + escapeHtml(noteBase) + (txnCount && !isSavings ? ' <span class="txn-count">' + txnCount + ' txn' + (txnCount === 1 ? '' : 's') + '</span>' : '') + '</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="env-section">' +
        '<div class="env-section-label">' + GROUP_LABELS[group] + ' · ' + money(groupAllocated) + '</div>' +
        '<div class="env-grid">' + cards + '</div>' +
      '</div>'
    );
  }

  function renderEnvelopeGroups(period) {
    var body = GROUP_ORDER.map(function (g) { return envGroupHtml(period, g); }).join('');
    if (!body) return '<div class="env-groups">' + emptyState('No envelopes yet', 'Click "New envelope" (Envelopes view) or fund one from the To-Be-Budgeted banner.') + '</div>';
    return '<div class="env-groups">' + body + '</div>';
  }

  // ---------------------------------------------------------------- rendering: transactions (compact widget)

  function txnRowCompact(t) {
    var d = new Date(t.date + 'T00:00:00');
    var env = t.envelope_id ? findEnvelope(t.envelope_id) : null;
    var cat = env ? findCategory(env.category_id) : null;
    var envLabel = t.amount > 0 ? 'income' : (cat ? cat.name.toLowerCase() : 'uncategorized');
    var recurBadge = t.recurring ? '<span class="recur-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></span>' : '';
    var fxBadge = t.currency ? '<span class="fx-badge">' + escapeHtml(t.currency) + '</span>' : '';
    var fxOrig = t.currency ? '<span class="fx-orig">' + (t.original_amount != null ? t.original_amount.toLocaleString() : '') + ' ' + escapeHtml(t.currency) + '</span>' : '';
    return (
      '<div class="txn-row" data-id="' + t.id + '">' +
        '<div class="txn-date">' + fmt.monthDay(d).split(' ')[0].toLowerCase() + '<span class="txn-day">' + d.getDate() + '</span></div>' +
        '<div class="txn-info"><div class="txn-title">' + escapeHtml(t.title || 'Untitled') + fxBadge + recurBadge + '</div>' +
          '<div class="txn-meta"><span class="env-tag">' + escapeHtml(envLabel) + '</span>' + (t.recurring ? '· auto · ' + escapeHtml(t.recur_period || 'monthly') : '') + (t.currency ? '· FX ' + (t.fx_rate || 1).toFixed(3) : '') + '</div>' +
        '</div>' +
        '<div class="txn-amount ' + (t.amount >= 0 ? 'pos' : 'neg') + '">' + money(t.amount, { signed: true, cents: true }) + fxOrig + '</div>' +
      '</div>'
    );
  }

  function renderRecentTransactions(period) {
    var txns = txnsForPeriod(period).slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 10);
    var body = txns.length ? '<div class="txn-list">' + txns.map(txnRowCompact).join('') + '</div>'
      : emptyState('No transactions yet', 'Click "New transaction" to log your first one.');
    return (
      '<div class="pane"><div class="pane-head"><span class="pane-title">Recent transactions</span><span class="pane-meta">last 10 · view all</span></div>' +
        '<div class="pane-body">' + body + '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: insight callouts

  function renderInsightsRow(period) {
    var lowSubs = lowUsageSubs(period);
    var subsHtml = lowSubs.length
      ? lowSubs.map(function (t) {
          var tag = (t.usage_count || 0) === 0 ? 'zero' : 'low';
          return '<div class="ic-item"><span class="ii-name">' + escapeHtml(t.title) + '</span><span class="ii-tag ' + tag + '">' + (t.usage_count || 0) + ' use' + ((t.usage_count || 0) === 1 ? '' : 's') + '</span><span class="ii-amount">' + money(Math.abs(t.amount)) + '/mo</span></div>';
        }).join('')
      : '<div class="empty-sub">No low-usage subscriptions this period.</div>';
    var lowTotal = lowSubs.reduce(function (s, t) { return s + Math.abs(t.amount); }, 0);

    var cph = costPerFocusHour(period);
    var fixed = fixedSpentThisPeriod(period);
    var hrs = focusHoursForPeriod(period);

    return (
      '<div class="insights-row">' +
        '<div class="insight-card warn">' +
          '<div class="ic-head"><span class="ic-label">⚠ Subscription audit</span><span class="ic-meta">threshold: &lt;' + LOW_USAGE_THRESHOLD + ' uses</span></div>' +
          '<div class="ic-headline"><span class="big-num">' + money(lowTotal) + '</span> spent on subs you barely used.</div>' +
          '<div class="ic-desc">' + lowSubs.length + ' of ' + subscriptionsForPeriod(period).length + ' active subscriptions had fewer than ' + LOW_USAGE_THRESHOLD + ' uses this period. Worth an audit.</div>' +
          '<div class="ic-list">' + subsHtml + '</div>' +
        '</div>' +
        '<div class="insight-card info">' +
          '<div class="ic-head"><span class="ic-label">◇ Cost per focus hour</span><span class="ic-meta">cross-domain · real-time</span></div>' +
          '<div class="ic-headline">' + (cph != null ? '<span class="big-num">' + (money(cph).replace(/\d|\.|,/g, '')) + cph.toFixed(2) + '</span> per focus hour this month.' : 'No focus hours logged yet this month.') + '</div>' +
          '<div class="ic-desc">Fixed expenses divided by hours of deep-work logged.' + (cph == null ? ' Ships real numbers once Focus (Phase 6) writes sessions.' : ' Lower is better.') + '</div>' +
          '<div class="ic-breakdown">' +
            '<div class="bd-item"><div class="bd-lbl">Fixed spend</div><div class="bd-val">' + money(fixed) + '</div><div class="bd-sub">divided across…</div></div>' +
            '<div class="bd-item"><div class="bd-lbl">Focus hours · ' + periodLabel(period).split(' ')[0].toLowerCase() + '</div><div class="bd-val">' + hrs.toFixed(0) + ' h</div><div class="bd-sub">' + (cph != null ? '= ' + (money(cph).replace(/\d|\.|,/g, '')) + cph.toFixed(2) + ' per hour' : 'no rate yet') + '</div></div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- rendering: views

  function emptyState(title, sub) {
    return (
      '<div class="empty">' +
        '<div class="glyph"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/></svg></div>' +
        '<div class="empty-title">' + title + '</div>' +
        '<div class="empty-sub">' + sub + '</div>' +
      '</div>'
    );
  }

  function renderOverview(period) {
    visibleOrder = txnsForPeriod(period).map(function (t) { return t.id; });
    return (
      renderMetricsStrip(period) +
      renderTBBBanner(period) +
      '<div class="two-col">' +
        '<div class="pane"><div class="pane-head"><span class="pane-title">Envelopes · ' + envelopesForPeriod(period).length + ' active</span><span class="pane-meta">' + money(allocatedThisPeriod(period)) + ' allocated · ' + (allocatedThisPeriod(period) ? Math.round(envelopesForPeriod(period).reduce(function (s, e) { return s + envelopeSpent(e); }, 0) / allocatedThisPeriod(period) * 100) : 0) + '% spent</span></div>' +
          '<div class="pane-body">' + renderEnvelopeGroups(period) + '</div>' +
        '</div>' +
        renderRecentTransactions(period) +
      '</div>' +
      renderInsightsRow(period)
    );
  }

  function renderTransactionsView(period) {
    var txns = txnsForPeriod(period).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    visibleOrder = txns.map(function (t) { return t.id; });
    var body = txns.length
      ? txns.map(function (t) {
          var env = t.envelope_id ? findEnvelope(t.envelope_id) : null;
          var cat = env ? findCategory(env.category_id) : null;
          var envLabel = t.amount > 0 ? 'income' : (cat ? cat.name : 'uncategorized');
          var d = new Date(t.date + 'T00:00:00');
          return (
            '<div class="list-row txn' + (t.id === selectedId ? ' selected' : '') + '" data-id="' + t.id + '">' +
              '<div class="txn-date">' + fmt.monthDay(d).toLowerCase() + '</div>' +
              '<div class="txn-info"><div class="txn-title">' + escapeHtml(t.title || 'Untitled') + (t.recurring ? '<span class="recur-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></span>' : '') + '</div><div class="txn-meta">' + escapeHtml(t.notes || '') + '</div></div>' +
              '<div class="env-cell">' + escapeHtml(envLabel) + '</div>' +
              '<div class="txn-amount ' + (t.amount >= 0 ? 'pos' : 'neg') + '">' + money(t.amount, { signed: true, cents: true }) + '</div>' +
            '</div>'
          );
        }).join('')
      : emptyState('No transactions this period', 'Click "New transaction" to log your first one.');
    return '<div class="pane"><div class="pane-head"><span class="pane-title">All transactions</span><span class="pane-meta">' + txns.length + ' this period</span></div><div class="pane-body">' + body + '</div></div>';
  }

  function renderEnvelopesView(period) {
    visibleOrder = envelopesForPeriod(period).map(function (e) { return e.id; });
    return (
      renderTBBBanner(period) +
      '<div class="pane"><div class="pane-head"><span class="pane-title">Envelopes · ' + envelopesForPeriod(period).length + ' active</span><span class="pane-meta"><button class="btn-mini" id="btn-new-envelope">New envelope</button></span></div>' +
        '<div class="pane-body">' + renderEnvelopeGroups(period) + '</div>' +
      '</div>'
    );
  }

  function renderSubscriptionsView(period) {
    var subs = subscriptionsForPeriod(period).slice().sort(function (a, b) { return Math.abs(b.amount) - Math.abs(a.amount); });
    visibleOrder = subs.map(function (t) { return t.id; });
    var body = subs.length
      ? subs.map(function (t) {
          var tag = (t.usage_count || 0) === 0 ? 'zero' : ((t.usage_count || 0) < LOW_USAGE_THRESHOLD ? 'low' : 'ok');
          return (
            '<div class="ic-item" data-id="' + t.id + '">' +
              '<span class="ii-name">' + escapeHtml(t.title) + '</span>' +
              '<span class="ii-tag ' + tag + '">' + (t.usage_count || 0) + ' use' + ((t.usage_count || 0) === 1 ? '' : 's') + '</span>' +
              '<span class="ii-amount">' + money(Math.abs(t.amount)) + '/mo <button class="btn-mini" data-act="log-use" data-id="' + t.id + '">+1 use</button></span>' +
            '</div>'
          );
        }).join('')
      : emptyState('No subscriptions this period', 'Mark a recurring transaction as a subscription from its edit form.');
    return '<div class="pane"><div class="pane-head"><span class="pane-title">Subscriptions</span><span class="pane-meta">' + subs.length + ' this period</span></div><div class="pane-body"><div class="ic-list">' + body + '</div></div></div>';
  }

  // Reports — simple real 6-period trend, no scoring model (Analytics'/Insights' job per the
  // brief's exclusions). Reuses .list-row.report (added this phase alongside .list-row.txn).
  function renderReportsView(period) {
    var periods = [];
    for (var i = 5; i >= 0; i--) periods.push(addMonths(period, -i));
    var rows = periods.map(function (p) {
      var income = incomeThisPeriod(p), expenses = expensesThisPeriod(p), net = income - expenses;
      var cph = costPerFocusHour(p);
      return (
        '<div class="list-row report">' +
          '<div class="ti">' + escapeHtml(periodLabel(p).split(' ')[0]) + '</div>' +
          '<div class="num-mono pos">' + money(income) + '</div>' +
          '<div class="num-mono">' + money(expenses) + '</div>' +
          '<div class="num-mono ' + (net >= 0 ? 'pos' : 'neg') + '">' + money(net, { signed: true }) + '</div>' +
          '<div class="num-mono">' + (cph != null ? (money(cph).replace(/\d|\.|,/g, '')) + cph.toFixed(2) + '/hr' : '—') + '</div>' +
        '</div>'
      );
    }).join('');
    return (
      '<div class="pane"><div class="pane-head"><span class="pane-title">Last 6 months</span><span class="pane-meta">income · expenses · net · cost/focus-hr</span></div>' +
        '<div class="pane-body">' + rows + '</div>' +
      '</div>'
    );
  }

  function renderViewBody(period) {
    if (currentView === 'overview') return renderOverview(period);
    if (currentView === 'transactions') return renderTransactionsView(period);
    if (currentView === 'envelopes') return renderEnvelopesView(period);
    if (currentView === 'subscriptions') return renderSubscriptionsView(period);
    if (currentView === 'reports') return renderReportsView(period);
    return '';
  }

  // ---------------------------------------------------------------- rendering: modals

  function renderModal() {
    if (!modalMode) return '<div class="modal-overlay" id="fin-modal" hidden></div>';
    if (modalMode === 'txn') return renderTxnModal();
    if (modalMode === 'envelope') return renderEnvelopeModal();
    if (modalMode === 'fund') return renderFundModal();
    return '';
  }

  function renderTxnModal() {
    var t = modalTxn;
    var isNew = t._isNew;
    var envOptions = '<option value="">No envelope (income/uncategorized)</option>' +
      envelopesForPeriod(currentPeriod).map(function (e) {
        var cat = findCategory(e.category_id);
        return '<option value="' + e.id + '"' + (e.id === t.envelope_id ? ' selected' : '') + '>' + escapeHtml(cat ? cat.name : 'Untitled') + '</option>';
      }).join('');
    return (
      '<div class="modal-overlay" id="fin-modal">' +
        '<div class="modal wide">' +
          '<div class="modal-head"><span class="modal-title">' + (isNew ? 'New transaction' : 'Edit transaction') + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-field"><label>Title</label><input type="text" class="input" id="mf-title" value="' + escapeHtml(t.title || '') + '" placeholder="Groceries · Pasaraya"></div>' +
            '<div class="modal-row3">' +
              '<div class="modal-field"><label>Date</label><input type="date" class="input" id="mf-date" value="' + escapeHtml(t.date || currentPeriod + '-01') + '"></div>' +
              '<div class="modal-field"><label>Amount (+income / −expense)</label><input type="number" step="0.01" class="input" id="mf-amount" value="' + (t.amount != null ? t.amount : '') + '" placeholder="-47.30"></div>' +
              '<div class="modal-field"><label>Envelope</label><select class="input" id="mf-envelope">' + envOptions + '</select></div>' +
            '</div>' +
            '<div class="modal-row3">' +
              '<div class="modal-field"><label>Currency (optional, if foreign)</label><input type="text" class="input" id="mf-currency" value="' + escapeHtml(t.currency || '') + '" placeholder="EUR"></div>' +
              '<div class="modal-field"><label>FX rate</label><input type="number" step="0.0001" class="input" id="mf-fxrate" value="' + (t.fx_rate != null ? t.fx_rate : '') + '" placeholder="1.083"></div>' +
              '<div class="modal-field"><label>Original amount (same sign as Amount)</label><input type="number" step="0.01" class="input" id="mf-origamount" value="' + (t.original_amount != null ? t.original_amount : '') + '" placeholder="129.30"></div>' +
            '</div>' +
            // Offline by default (no other network call exists in this app) — this button is the
            // one opt-in exception: a best-effort live lookup that only fires on click, fills FX
            // rate + recomputes Amount, and remembers the rate in Settings › Currencies for next
            // time. If it's offline or the request fails, everything else in the form still works.
            '<div class="modal-fx-row">' +
              '<button type="button" class="btn sm secondary" id="btn-fetch-fx" data-act="fetch-fx-rate" title="Online lookup — needs a connection; everything else in Console works offline">Fetch live rate</button>' +
              '<span class="hint" id="fx-fetch-status"></span>' +
            '</div>' +
            '<label class="modal-exc-picker"><input type="checkbox" id="mf-recurring"' + (t.recurring ? ' checked' : '') + '> This is a recurring subscription</label>' +
            '<div class="modal-field"><label>Notes</label><textarea class="input notes-area" id="mf-notes">' + escapeHtml(t.notes || '') + '</textarea></div>' +
          '</div>' +
          '<div class="modal-actions">' +
            (isNew ? '' : '<button class="btn danger" data-act="modal-delete-txn">Delete</button>') +
            '<div class="spacer"></div><button class="btn secondary" data-act="modal-cancel">Cancel</button><button class="btn accent" data-act="modal-save-txn">' + (isNew ? 'Create' : 'Save') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderEnvelopeModal() {
    var e = modalEnvelope;
    var isNew = e._isNew;
    var cat = !isNew ? findCategory(e.category_id) : null;
    var groupOptions = GROUP_ORDER.map(function (g) { return '<option value="' + g + '"' + (g === e._group ? ' selected' : '') + '>' + GROUP_LABELS[g] + '</option>'; }).join('');
    return (
      '<div class="modal-overlay" id="fin-modal">' +
        '<div class="modal wide">' +
          '<div class="modal-head"><span class="modal-title">' + (isNew ? 'New envelope' : 'Edit envelope') + '</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            (isNew
              ? '<div class="modal-field"><label>Category name</label><input type="text" class="input" id="mf-catname" value="" placeholder="Groceries"></div>' +
                '<div class="modal-field"><label>Group</label><select class="input" id="mf-group">' + groupOptions + '</select></div>'
              : '<div class="modal-readonly">' + escapeHtml(cat ? cat.name : 'Untitled') + ' · ' + GROUP_LABELS[e._group] + '</div>') +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Allocated this period</label><input type="number" class="input" id="mf-allocated" value="' + (e.allocated != null ? e.allocated : '') + '" placeholder="200"></div>' +
              '<div class="modal-field"><label>Savings goal total (optional)</label><input type="number" class="input" id="mf-goal" value="' + (cat && cat.goal_total != null ? cat.goal_total : '') + '" placeholder="1200"></div>' +
            '</div>' +
            '<label class="modal-exc-picker"><input type="checkbox" id="mf-rollover"' + (e.rollover ? ' checked' : '') + '> Unused amount rolls over to next month</label>' +
          '</div>' +
          '<div class="modal-actions">' +
            (isNew ? '' : '<button class="btn danger" data-act="modal-delete-envelope">Delete</button>') +
            '<div class="spacer"></div><button class="btn secondary" data-act="modal-cancel">Cancel</button><button class="btn accent" data-act="modal-save-envelope">' + (isNew ? 'Create' : 'Save') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function renderFundModal() {
    var envOptions = envelopesForPeriod(currentPeriod).map(function (e) {
      var cat = findCategory(e.category_id);
      return '<option value="' + e.id + '">' + escapeHtml(cat ? cat.name : 'Untitled') + '</option>';
    }).join('');
    return (
      '<div class="modal-overlay" id="fin-modal">' +
        '<div class="modal">' +
          '<div class="modal-head"><span class="modal-title">Fund envelope</span><button class="modal-close" data-act="modal-cancel">&times;</button></div>' +
          '<div class="modal-body">' +
            '<div class="modal-readonly">To be budgeted: ' + money(toBeBudgeted(currentPeriod)) + '</div>' +
            '<div class="modal-row">' +
              '<div class="modal-field"><label>Envelope</label><select class="input" id="mf-fund-envelope">' + (envOptions || '<option value="">No envelopes yet — create one first</option>') + '</select></div>' +
              '<div class="modal-field"><label>Amount</label><input type="number" class="input" id="mf-fund-amount" value="' + (modalFund && modalFund.amount != null ? modalFund.amount : '') + '" placeholder="50"></div>' +
            '</div>' +
          '</div>' +
          '<div class="modal-actions"><button class="btn secondary" data-act="modal-cancel">Cancel</button><div class="spacer"></div><button class="btn accent" data-act="modal-save-fund">Fund</button></div>' +
        '</div>' +
      '</div>'
    );
  }

  // ---------------------------------------------------------------- render dispatch

  function render() {
    container.innerHTML =
      renderPageHead(currentPeriod) +
      renderViewTabs(currentPeriod) +
      renderViewBody(currentPeriod) +
      '<div class="kbd-hints">' +
        '<span class="khint"><span class="kbd">N</span><span class="klbl">new transaction</span></span>' +
        '<span class="khint"><span class="kbd">E</span><span class="klbl">envelope</span></span>' +
        '<span class="khint"><span class="kbd">F</span><span class="klbl">fund</span></span>' +
        '<span class="khint"><span class="kbd">J</span><span class="kbd">K</span><span class="klbl">navigate</span></span>' +
        '<span class="khint"><span class="kbd">↵</span><span class="klbl">open</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">E</span><span class="klbl">edit</span></span>' +
        '<span class="khint"><span class="kbd">⌘</span><span class="kbd">I</span><span class="klbl">import</span></span>' +
        '<span class="khint"><span class="kbd">?</span><span class="klbl">all shortcuts</span></span>' +
      '</div>' +
      renderModal();

    if (modalMode === 'txn') {
      var el = document.getElementById('mf-title'); if (el) el.focus();
      wireTxnFxInputs();
    }
  }

  // ---------------------------------------------------------------- FX rate helpers (transaction modal)

  // Recomputes home-currency Amount from Original amount × FX rate whenever either changes — the
  // user only has to know ONE of the three reliably (usually Original amount, what the receipt
  // says), not all three. Only fires when both inputs are present, so typing Amount directly still
  // works untouched for ordinary transactions in the base currency.
  function recomputeTxnAmount() {
    var currencyInput = document.getElementById('mf-currency');
    var fxRateInput = document.getElementById('mf-fxrate');
    var origAmountInput = document.getElementById('mf-origamount');
    var amountInput = document.getElementById('mf-amount');
    if (!currencyInput || !fxRateInput || !origAmountInput || !amountInput) return;
    if (!currencyInput.value.trim() || fxRateInput.value === '' || origAmountInput.value === '') return;
    var rate = +fxRateInput.value, orig = +origAmountInput.value;
    if (isNaN(rate) || isNaN(orig)) return;
    amountInput.value = (orig * rate).toFixed(2);
  }

  function wireTxnFxInputs() {
    var currencyInput = document.getElementById('mf-currency');
    var fxRateInput = document.getElementById('mf-fxrate');
    var origAmountInput = document.getElementById('mf-origamount');
    if (currencyInput) {
      currencyInput.addEventListener('input', function () {
        var code = currencyInput.value.trim().toUpperCase();
        var known = Console.fxRates && Console.fxRates[code];
        // Only prefill an empty rate — never stomp one the user (or a live fetch) already set.
        if (known && fxRateInput && !fxRateInput.value) {
          fxRateInput.value = known.rate;
          recomputeTxnAmount();
        }
      });
    }
    if (fxRateInput) fxRateInput.addEventListener('input', recomputeTxnAmount);
    if (origAmountInput) origAmountInput.addEventListener('input', recomputeTxnAmount);
  }

  // Best-effort, opt-in online lookup (frankfurter.dev — free, no key, ECB-sourced) — the one
  // network call in this whole app. Fires only on click, degrades to a plain status message if
  // offline or the request fails, and never blocks saving the transaction. On success it also
  // writes the rate back to the `fx_rates` preference (Settings › Currencies), so it's remembered
  // next time without needing another fetch.
  // NOTE: the API moved from frankfurter.app (unversioned /latest) to frankfurter.dev/v1 — the old
  // host now just 301s here. Hit this host directly so a redirect isn't a second point of failure.
  function fetchLiveFxRate() {
    var currencyInput = document.getElementById('mf-currency');
    var statusEl = document.getElementById('fx-fetch-status');
    var btn = document.getElementById('btn-fetch-fx');
    var code = currencyInput ? currencyInput.value.trim().toUpperCase() : '';

    if (statusEl) statusEl.textContent = '';
    var base = Console.baseCurrency || 'USD';
    if (!/^[A-Z]{3}$/.test(code)) { if (statusEl) statusEl.textContent = 'Enter a 3-letter currency code first (e.g. EUR).'; return; }
    if (code === base) { if (statusEl) statusEl.textContent = base + ' is the base currency — no rate needed.'; return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Fetching…'; }

    var controller = window.AbortController ? new AbortController() : null;
    var timeoutId = controller ? setTimeout(function () { controller.abort(); }, 6000) : null;

    function finish(message) {
      if (timeoutId) clearTimeout(timeoutId);
      if (btn) { btn.disabled = false; btn.textContent = 'Fetch live rate'; }
      if (statusEl) statusEl.textContent = message;
    }

    fetch('https://api.frankfurter.dev/v1/latest?from=' + code + '&to=' + base, controller ? { signal: controller.signal } : {})
      .then(function (res) { if (!res.ok) throw new Error('bad response: ' + res.status); return res.json(); })
      .then(function (data) {
        var rate = data && data.rates && data.rates[base];
        if (!rate) throw new Error('no rate in response');
        var fxRateInput = document.getElementById('mf-fxrate');
        if (fxRateInput) fxRateInput.value = rate;
        recomputeTxnAmount();
        Console.fxRates = Console.fxRates || {};
        Console.fxRates[code] = { rate: rate, updated_at: new Date().toISOString() };
        db.setPref('fx_rates', Console.fxRates);
        finish('Fetched 1 ' + code + ' = ' + rate + ' ' + base + ' just now — saved for next time.');
      })
      .catch(function (err) {
        console.error('[Finance] live FX fetch failed:', err); // logged, not just swallowed — so a real bug here is diagnosable, not indistinguishable from "just offline"
        finish('Couldn’t fetch a live rate — check your connection, or enter one manually.');
      });
  }

  // ---------------------------------------------------------------- modal actions

  function openNewTxnModal() {
    modalMode = 'txn';
    modalTxn = { _isNew: true, title: '', date: currentPeriod === todayPeriod() ? fmt.todayISO() : currentPeriod + '-01', amount: '', envelope_id: '', currency: '', fx_rate: '', original_amount: '', recurring: false, notes: '' };
    render();
  }
  function openEditTxnModal(t) {
    if (!t) return;
    modalMode = 'txn';
    modalTxn = JSON.parse(JSON.stringify(t));
    modalTxn._isNew = false;
    render();
  }
  function openNewEnvelopeModal() {
    modalMode = 'envelope';
    modalEnvelope = { _isNew: true, _group: 'personal', allocated: '', rollover: false };
    render();
  }
  function openEditEnvelopeModal(e) {
    if (!e) return;
    var cat = findCategory(e.category_id);
    modalMode = 'envelope';
    modalEnvelope = JSON.parse(JSON.stringify(e));
    modalEnvelope._isNew = false;
    modalEnvelope._group = cat ? (cat.group || 'personal') : 'personal';
    render();
  }
  function openFundModal() {
    modalMode = 'fund';
    modalFund = { amount: '' };
    render();
  }
  function closeModal() { modalMode = null; modalTxn = null; modalEnvelope = null; modalFund = null; render(); }

  function saveTxnModal() {
    var title = (document.getElementById('mf-title').value || '').trim();
    var amountRaw = document.getElementById('mf-amount').value;
    if (!title || amountRaw === '') return;
    var currency = (document.getElementById('mf-currency').value || '').trim() || null;
    var fxRaw = document.getElementById('mf-fxrate').value;
    var origRaw = document.getElementById('mf-origamount').value;
    var fields = {
      title: title,
      date: document.getElementById('mf-date').value || currentPeriod + '-01',
      amount: +amountRaw,
      envelope_id: document.getElementById('mf-envelope').value || null,
      currency: currency,
      fx_rate: currency && fxRaw !== '' ? +fxRaw : null,
      original_amount: currency && origRaw !== '' ? +origRaw : null,
      recurring: document.getElementById('mf-recurring').checked,
      notes: document.getElementById('mf-notes').value
    };
    if (fields.recurring) { fields.recur_period = 'monthly'; fields.usage_count = (modalTxn.usage_count || 0); }

    if (modalTxn._isNew) {
      var txn = fields;
      txn.id = db.uuid();
      db.put('transactions', txn).then(function () { selectedId = txn.id; modalMode = null; modalTxn = null; refreshAndRender(); });
    } else {
      var existing = findTxn(modalTxn.id);
      if (!existing) { closeModal(); return; }
      Object.keys(fields).forEach(function (k) { existing[k] = fields[k]; });
      db.put('transactions', existing).then(function () { modalMode = null; modalTxn = null; refreshAndRender(); });
    }
  }

  function deleteModalTxn() {
    if (!modalTxn || modalTxn._isNew) return;
    var id = modalTxn.id;
    var toDelete = findTxn(id);
    modalMode = null; modalTxn = null;
    db.remove('transactions', id).then(function () {
      if (selectedId === id) selectedId = null;
      refreshAndRender();
      Console.toast('Transaction deleted', {
        undo: function () {
          db.put('transactions', toDelete).then(refreshAndRender);
        }
      });
    });
  }

  function saveEnvelopeModal() {
    var allocatedRaw = document.getElementById('mf-allocated').value;
    if (allocatedRaw === '') return;
    var goalRaw = document.getElementById('mf-goal').value;

    if (modalEnvelope._isNew) {
      var name = (document.getElementById('mf-catname').value || '').trim();
      if (!name) return;
      var group = document.getElementById('mf-group').value;
      findOrCreateCategory(name, group).then(function (categoryId) {
        if (goalRaw !== '') {
          var cat = findCategory(categoryId);
          if (cat) { cat.goal_total = +goalRaw; db.put('categories', cat); }
        }
        var env = { id: db.uuid(), category_id: categoryId, period: currentPeriod, allocated: +allocatedRaw, rollover: document.getElementById('mf-rollover').checked };
        db.put('envelopes', env).then(function () { selectedId = env.id; modalMode = null; modalEnvelope = null; refreshAndRender(); });
      });
    } else {
      var existing = findEnvelope(modalEnvelope.id);
      if (!existing) { closeModal(); return; }
      existing.allocated = +allocatedRaw;
      existing.rollover = document.getElementById('mf-rollover').checked;
      var cat2 = findCategory(existing.category_id);
      var p = db.put('envelopes', existing);
      if (cat2 && goalRaw !== '') { cat2.goal_total = +goalRaw; p = p.then(function () { return db.put('categories', cat2); }); }
      p.then(function () { modalMode = null; modalEnvelope = null; refreshAndRender(); });
    }
  }

  // Unlike deleteModalTxn, this also clears envelope_id off any transactions that pointed at the
  // deleted envelope — otherwise those rows would keep a dangling foreign key forever (silently
  // falling back to "uncategorized" in the UI, but the stale id would still sit in the record).
  // Same "don't leave a real correctness gap even if the UI papers over it" discipline as the
  // Today-dashboard field-name fixes in Phase 4/5.
  function deleteModalEnvelope() {
    if (!modalEnvelope || modalEnvelope._isNew) return;
    var id = modalEnvelope.id;
    var toDelete = findEnvelope(id);
    modalMode = null; modalEnvelope = null;
    var orphaned = cache.transactions.filter(function (t) { return t.envelope_id === id; });
    var originalOrphaned = orphaned.map(function (t) { return Object.assign({}, t); });

    Promise.all(orphaned.map(function (t) { t.envelope_id = null; return db.put('transactions', t); }))
      .then(function () { return db.remove('envelopes', id); })
      .then(function () {
        if (selectedId === id) selectedId = null;
        refreshAndRender();
        Console.toast('Envelope deleted', {
          undo: function () {
            db.put('envelopes', toDelete)
              .then(function () {
                return Promise.all(originalOrphaned.map(function (t) { return db.put('transactions', t); }));
              })
              .then(refreshAndRender);
          }
        });
      });
  }

  function saveFundModal() {
    var envId = document.getElementById('mf-fund-envelope').value;
    var amountRaw = document.getElementById('mf-fund-amount').value;
    if (!envId || amountRaw === '') return;
    var env = findEnvelope(envId);
    if (!env) return;
    env.allocated = (env.allocated || 0) + (+amountRaw);
    db.put('envelopes', env).then(function () { modalMode = null; modalFund = null; refreshAndRender(); });
  }

  function logSubscriptionUse(id) {
    var t = findTxn(id);
    if (!t) return;
    t.usage_count = (t.usage_count || 0) + 1;
    db.put('transactions', t).then(refreshAndRender);
  }

  // ---------------------------------------------------------------- events

  function onContainerClick(e) {
    var vtab = e.target.closest('.vtab');
    if (vtab) { currentView = vtab.dataset.view; selectedId = null; render(); return; }

    if (e.target.closest('#btn-new-txn')) { openNewTxnModal(); return; }
    if (e.target.closest('#btn-new-envelope')) { openNewEnvelopeModal(); return; }
    if (e.target.closest('[data-act="fund-envelope"]')) { openFundModal(); return; }
    if (e.target.closest('#btn-hourly-toggle')) { hourlyMode = !hourlyMode; render(); return; }
    if (e.target.closest('#btn-import')) { return; } // stubbed per phase_5_finance.md exclusions

    var monthPrev = e.target.closest('[data-act="month-prev"]');
    if (monthPrev) { currentPeriod = addMonths(currentPeriod, -1); render(); return; }
    var monthNext = e.target.closest('[data-act="month-next"]');
    if (monthNext) { currentPeriod = addMonths(currentPeriod, 1); render(); return; }
    var monthThis = e.target.closest('[data-act="month-this"]');
    if (monthThis) { currentPeriod = todayPeriod(); render(); return; }

    var logUse = e.target.closest('[data-act="log-use"]');
    if (logUse) { logSubscriptionUse(logUse.dataset.id); return; }

    if (e.target.closest('[data-act="modal-cancel"]')) { closeModal(); return; }
    if (e.target.closest('[data-act="fetch-fx-rate"]')) { fetchLiveFxRate(); return; }
    if (e.target.closest('[data-act="modal-save-txn"]')) { saveTxnModal(); return; }
    if (e.target.closest('[data-act="modal-delete-txn"]')) { deleteModalTxn(); return; }
    if (e.target.closest('[data-act="modal-save-envelope"]')) { saveEnvelopeModal(); return; }
    if (e.target.closest('[data-act="modal-delete-envelope"]')) { deleteModalEnvelope(); return; }
    if (e.target.closest('[data-act="modal-save-fund"]')) { saveFundModal(); return; }
    if (e.target.id === 'fin-modal') { closeModal(); return; }

    var envCard = e.target.closest('.env-card');
    if (envCard) { selectedId = envCard.dataset.id; if (currentView === 'envelopes' || currentView === 'overview') { openEditEnvelopeModal(findEnvelope(selectedId)); } render(); return; }

    var txnRow = e.target.closest('.txn-row, .list-row.txn');
    if (txnRow && !e.target.closest('[data-act]')) { selectedId = txnRow.dataset.id; openEditTxnModal(findTxn(selectedId)); return; }
  }

  // ---------------------------------------------------------------- keyboard

  function onKeydown(e) {
    if (modalMode) {
      if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
      return;
    }
    var overlay = document.getElementById('cmd-overlay');
    if (overlay && !overlay.hidden) return;
    var active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) return;

    var key = e.key.toLowerCase();
    if (key === 'n') { e.preventDefault(); openNewTxnModal(); return; }
    if (key === 'f') { e.preventDefault(); openFundModal(); return; }
    if (key === 'e' && !(e.metaKey || e.ctrlKey) && selectedId) {
      var env = findEnvelope(selectedId);
      if (env) { e.preventDefault(); openEditEnvelopeModal(env); }
      return;
    }
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
    if (key === 'enter' && selectedId) {
      e.preventDefault();
      var t = findTxn(selectedId);
      if (t) { openEditTxnModal(t); return; }
      var env2 = findEnvelope(selectedId);
      if (env2) { openEditEnvelopeModal(env2); }
      return;
    }
    if (key === 'e' && (e.metaKey || e.ctrlKey) && selectedId) {
      e.preventDefault();
      var t2 = findTxn(selectedId);
      if (t2) { openEditTxnModal(t2); return; }
      var env3 = findEnvelope(selectedId);
      if (env3) openEditEnvelopeModal(env3);
      return;
    }
    if (key === 'i' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); /* stubbed, see brief exclusions */ }
  }

  // ---------------------------------------------------------------- lifecycle

  function refreshAndRender() {
    return Promise.all([
      db.getAll('transactions'), db.getAll('envelopes'), db.getAll('categories'), db.getAll('focus_sessions')
    ]).then(function (results) {
      cache.transactions = results[0];
      cache.envelopes = results[1];
      cache.categories = results[2];
      cache.focusSessions = results[3];
      render();
    });
  }

  Console.modules.finance = {
    init: function (el) {
      container = el;
      fmt = Console.lib.format;
      db = Console.db;
      currentView = 'overview';
      currentPeriod = todayPeriod();
      selectedId = null;
      hourlyMode = false;
      modalMode = null; modalTxn = null; modalEnvelope = null; modalFund = null;
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
