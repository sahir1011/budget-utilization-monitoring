const mongoose = require('mongoose');
const { Expenditure } = require('../models');
const { pct, round2 } = require('../utils/money');
const { timeElapsedPct, daysBetween } = require('../utils/period');

// One aggregation pass: spent / count / first & last expenditure date per budget.
async function aggregateByBudget(match = {}) {
  const rows = await Expenditure.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$budget',
        spent: { $sum: '$amount' },
        count: { $sum: 1 },
        lastDate: { $max: '$date' },
        firstDate: { $min: '$date' },
      },
    },
  ]);
  const map = new Map();
  for (const r of rows) map.set(String(r._id), r);
  return map;
}

function toObjectIds(ids) {
  return ids.map((id) => new mongoose.Types.ObjectId(String(id)));
}

/**
 * Core utilisation metrics for a single budget. All money values are integer rupees;
 * percentages are rounded to 2 decimals only at the edge.
 */
function budgetMetrics(budget, agg, thresholds, asOf = new Date()) {
  const allocated = budget.allocatedAmount;
  const spent = agg ? agg.spent : 0;
  const start = new Date(budget.periodStart);
  const end = new Date(budget.periodEnd);
  const utilization = pct(spent, allocated);
  const timeElapsed = budget.status === 'CLOSED' ? 100 : timeElapsedPct(start, end, asOf);
  const totalDays = daysBetween(start, end) + 1;
  const effectiveNow = asOf > end ? end : asOf;
  const daysElapsed = Math.max(0, Math.min(totalDays, daysBetween(start, effectiveNow) + 1));
  const lastActivity = agg && agg.lastDate ? new Date(agg.lastDate) : null;
  const inactivityRef = lastActivity || start;
  const daysSinceLastActivity = asOf < start ? 0 : Math.max(0, daysBetween(inactivityRef, effectiveNow));

  // Linear burn-rate projection to period end.
  const projectedUtilization = timeElapsed > 0 ? round2((utilization / timeElapsed) * 100) : 0;
  const burnRatePerDay = daysElapsed > 0 ? Math.round(spent / daysElapsed) : 0;
  const projectedSpend = timeElapsed >= 100 ? spent : burnRatePerDay * totalDays;

  const m = {
    allocated,
    spent,
    remaining: allocated - spent,
    utilization,
    timeElapsed,
    paceGap: round2(utilization - timeElapsed),
    projectedUtilization,
    projectedSpend,
    burnRatePerDay,
    daysElapsed,
    totalDays,
    transactionCount: agg ? agg.count : 0,
    lastExpenditureDate: lastActivity,
    daysSinceLastActivity,
  };
  m.health = classifyHealth(m, thresholds, budget.status);
  m.riskScore = riskScore(m, thresholds, budget.status);
  m.riskLevel = m.riskScore >= 75 ? 'CRITICAL' : m.riskScore >= 50 ? 'HIGH' : m.riskScore >= 25 ? 'MODERATE' : 'LOW';
  return m;
}

function classifyHealth(m, t, status) {
  if (m.utilization > t.overspending.criticalPct) return 'OVERSPENT';
  if (m.timeElapsed >= t.underUtilization.timeElapsedAbovePct && m.utilization < t.underUtilization.utilizationBelowPct) {
    return 'UNDER_UTILIZED';
  }
  if (status !== 'CLOSED' && m.timeElapsed >= t.paceDeviation.minTimeElapsedPct) {
    if (m.paceGap < -t.paceDeviation.lagPctPoints) return 'LAGGING';
    if (m.projectedUtilization > t.paceDeviation.projectedOverPct) return 'AHEAD';
  }
  return 'ON_TRACK';
}

// Composite 0-100 analytical risk score (higher = needs attention sooner).
function riskScore(m, t, status) {
  let score = 0;
  // Under-utilisation pressure grows as the period runs out.
  const lag = Math.max(0, m.timeElapsed - m.utilization);
  score += Math.min(40, lag * 0.6 * (m.timeElapsed / 100 + 0.5));
  // Overspending pressure.
  if (m.utilization > t.overspending.warningPct) score += Math.min(35, (m.utilization - t.overspending.warningPct) * 2.5);
  // Projection beyond allocation while the period is still running.
  if (status !== 'CLOSED' && m.projectedUtilization > 100) score += Math.min(15, (m.projectedUtilization - 100) * 0.3);
  // Dormant funds.
  if (status !== 'CLOSED' && m.remaining > 0 && t.inactivity.days > 0) {
    score += Math.min(15, (m.daysSinceLastActivity / t.inactivity.days) * 7.5);
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

module.exports = { aggregateByBudget, budgetMetrics, toObjectIds };
