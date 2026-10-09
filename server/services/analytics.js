const { Budget, Expenditure, Alert } = require('../models');
const { getThresholds } = require('./settings');
const { aggregateByBudget, budgetMetrics, toObjectIds } = require('./metrics');
const { pct, round2 } = require('../utils/money');
const { fyMonthKeys, monthLabel, financialYearBounds, timeElapsedPct } = require('../utils/period');

/** Budgets matching `filter`, each enriched with live utilisation metrics. */
async function budgetsWithMetrics(filter, { asOf = new Date(), thresholds } = {}) {
  const t = thresholds || (await getThresholds());
  const budgets = await Budget.find(filter).populate('department', 'code name').sort({ financialYear: -1, code: 1 }).lean();
  const aggs = await aggregateByBudget({ budget: { $in: budgets.map((b) => b._id) } });
  return budgets.map((b) => ({ ...b, metrics: budgetMetrics(b, aggs.get(String(b._id)), t, asOf) }));
}

function summarize(items) {
  const allocated = items.reduce((a, b) => a + b.metrics.allocated, 0);
  const spent = items.reduce((a, b) => a + b.metrics.spent, 0);
  return { allocated, spent, remaining: allocated - spent, utilization: pct(spent, allocated), budgetCount: items.length };
}

function byDepartment(items) {
  const groups = new Map();
  for (const b of items) {
    const key = String(b.department._id);
    if (!groups.has(key)) groups.set(key, { department: { id: key, code: b.department.code, name: b.department.name }, items: [] });
    groups.get(key).items.push(b);
  }
  return [...groups.values()]
    .map((g) => ({
      department: g.department,
      ...summarize(g.items),
      overspentCount: g.items.filter((b) => b.metrics.health === 'OVERSPENT').length,
      underUtilizedCount: g.items.filter((b) => ['UNDER_UTILIZED', 'LAGGING'].includes(b.metrics.health)).length,
      avgRiskScore: g.items.length ? Math.round(g.items.reduce((a, b) => a + b.metrics.riskScore, 0) / g.items.length) : 0,
    }))
    .sort((a, b) => b.allocated - a.allocated);
}

/** Monthly expenditure for a financial year plus cumulative actual vs. linear ideal. */
async function monthlyTrend(match, fy, totalAllocated) {
  const rows = await Expenditure.aggregate([
    { $match: { ...match, financialYear: fy } },
    { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$date', timezone: '+05:30' } }, spent: { $sum: '$amount' }, count: { $sum: 1 } } },
  ]);
  const byMonth = new Map(rows.map((r) => [r._id, r]));
  let cumulative = 0;
  return fyMonthKeys(fy).map((key, i) => {
    const r = byMonth.get(key);
    cumulative += r ? r.spent : 0;
    return {
      month: key,
      label: monthLabel(key),
      spent: r ? r.spent : 0,
      transactions: r ? r.count : 0,
      cumulative,
      cumulativePct: pct(cumulative, totalAllocated),
      idealPct: round2(((i + 1) / 12) * 100),
    };
  });
}

async function categoryBreakdown(match) {
  const rows = await Expenditure.aggregate([
    { $match: match },
    { $group: { _id: '$category', spent: { $sum: '$amount' }, count: { $sum: 1 } } },
    { $sort: { spent: -1 } },
  ]);
  const total = rows.reduce((a, r) => a + r.spent, 0);
  return rows.map((r) => ({ category: r._id, spent: r.spent, count: r.count, share: pct(r.spent, total) }));
}

async function alertStats(match) {
  const [bySeverity, byType, response] = await Promise.all([
    Alert.aggregate([{ $match: { ...match, status: { $ne: 'RESOLVED' } } }, { $group: { _id: '$severity', n: { $sum: 1 } } }]),
    Alert.aggregate([{ $match: { ...match, status: { $ne: 'RESOLVED' } } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Alert.aggregate([
      { $match: { ...match, acknowledgedAt: { $ne: null } } },
      { $group: { _id: null, avgMs: { $avg: { $subtract: ['$acknowledgedAt', '$detectedAt'] } }, n: { $sum: 1 } } },
    ]),
  ]);
  const toObj = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.n]));
  const sev = toObj(bySeverity);
  const total = Object.values(sev).reduce((a, n) => a + n, 0);
  const allDetected = await Alert.countDocuments(match);
  return {
    open: total,
    totalDetected: allDetected,
    bySeverity: { CRITICAL: sev.CRITICAL || 0, HIGH: sev.HIGH || 0, MEDIUM: sev.MEDIUM || 0, LOW: sev.LOW || 0 },
    byType: toObj(byType),
    avgResponseHours: response[0] ? round2(response[0].avgMs / 3_600_000) : null,
    acknowledgedCount: response[0] ? response[0].n : 0,
  };
}

function fyTimeElapsed(fy, asOf = new Date()) {
  const { start, end } = financialYearBounds(fy);
  return timeElapsedPct(start, end, asOf);
}

module.exports = { budgetsWithMetrics, summarize, byDepartment, monthlyTrend, categoryBreakdown, alertStats, fyTimeElapsed, toObjectIds };
