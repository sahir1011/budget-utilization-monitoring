const { Budget, Expenditure, Alert, Setting, nextSequence } = require('../models');
const { getThresholds } = require('./settings');
const { budgetMetrics } = require('./metrics');
const { formatCrore, RUPEES_PER_CRORE, round2 } = require('../utils/money');
const { istDateString } = require('../utils/period');

const SEVERITY_ORDER = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const bump = (sev) => SEVERITY_ORDER[Math.min(SEVERITY_ORDER.indexOf(sev) + 1, SEVERITY_ORDER.length - 1)];

function median(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Robust statistical spike detection on a budget's transaction history.
 * Each transaction is compared only with the transactions recorded before it (no look-ahead),
 * using the modified z-score (Iglewicz & Hoaglin): z = 0.6745 * (x - median) / MAD.
 */
function detectSpikes(txns, allocated, t) {
  const findings = [];
  const history = [];
  for (const tx of txns) {
    const shareOfAllocation = allocated ? (tx.amount / allocated) * 100 : 0;
    let reason = null;
    let z = null;
    let ratio = null;
    if (history.length >= t.minHistory) {
      const sorted = [...history].sort((a, b) => a - b);
      const med = median(sorted);
      const mad = median(sorted.map((v) => Math.abs(v - med)).sort((a, b) => a - b));
      ratio = med > 0 ? tx.amount / med : null;
      z = mad > 0 ? (0.6745 * (tx.amount - med)) / mad : tx.amount > med ? Infinity : 0;
      if (z > t.modifiedZScore && ratio !== null && ratio >= t.medianMultiplier) {
        reason = `is ${round2(ratio)}x the median transaction (modified z-score ${Number.isFinite(z) ? round2(z) : '∞'})`;
      }
    }
    if (!reason && t.singleTxnShareOfAllocationPct > 0 && shareOfAllocation >= t.singleTxnShareOfAllocationPct && txns.length > 1) {
      reason = `alone consumes ${round2(shareOfAllocation)}% of the allocation`;
    }
    if (reason) {
      let severity = ratio !== null && ratio >= t.medianMultiplier * 2 ? 'HIGH' : 'MEDIUM';
      if (shareOfAllocation >= t.singleTxnShareOfAllocationPct) severity = bump(severity);
      findings.push({ tx, reason, z: Number.isFinite(z) ? round2(z) : null, ratio: ratio ? round2(ratio) : null, shareOfAllocation: round2(shareOfAllocation), severity });
    }
    history.push(tx.amount);
  }
  return findings;
}

/** Evaluate every rule for one budget and return the alert findings that currently hold. */
function evaluateBudget(budget, txns, t, asOf) {
  const agg = txns.length
    ? { spent: txns.reduce((a, x) => a + x.amount, 0), count: txns.length, lastDate: txns[txns.length - 1].date }
    : null;
  const m = budgetMetrics(budget, agg, t, asOf);
  const findings = [];
  const id = String(budget._id);
  const metricSnapshot = {
    utilization: m.utilization,
    timeElapsed: m.timeElapsed,
    allocated: m.allocated,
    spent: m.spent,
    remaining: m.remaining,
    projectedUtilization: m.projectedUtilization,
    daysSinceLastActivity: m.daysSinceLastActivity,
  };
  const isOpenPeriod = budget.status !== 'CLOSED' && m.timeElapsed < 100;

  // 1. Overspending / threshold breach
  if (t.overspending.enabled) {
    if (m.utilization > t.overspending.criticalPct) {
      findings.push({
        key: `OVERSPENDING:${id}`,
        type: 'OVERSPENDING',
        severity: 'CRITICAL',
        title: `Allocation exceeded: ${budget.title}`,
        message: `Expenditure of ${formatCrore(m.spent)} is ${m.utilization}% of the approved ${formatCrore(m.allocated)} (excess ${formatCrore(-m.remaining)}).`,
      });
    } else if (m.utilization >= t.overspending.warningPct && m.timeElapsed < t.overspending.warningTimeElapsedBelowPct) {
      findings.push({
        key: `OVERSPENDING:${id}`,
        type: 'OVERSPENDING',
        severity: 'HIGH',
        title: `Approaching allocation limit: ${budget.title}`,
        message: `${m.utilization}% of the allocation is already spent with only ${m.timeElapsed}% of the period elapsed. Remaining: ${formatCrore(m.remaining)}.`,
      });
    }
  }

  // 2. Under-utilisation (e.g. <40% used after 70% of time elapsed)
  if (
    t.underUtilization.enabled &&
    m.timeElapsed >= t.underUtilization.timeElapsedAbovePct &&
    m.utilization < t.underUtilization.utilizationBelowPct
  ) {
    let severity = m.utilization < 15 ? 'CRITICAL' : m.utilization < 25 ? 'HIGH' : 'MEDIUM';
    if (m.remaining >= t.highValueUnspentCrore * RUPEES_PER_CRORE) severity = bump(severity);
    findings.push({
      key: `UNDER_UTILIZATION:${id}`,
      type: 'UNDER_UTILIZATION',
      severity,
      title: `Under-utilised funds: ${budget.title}`,
      message: `Only ${m.utilization}% utilised after ${m.timeElapsed}% of the period. Unspent balance ${formatCrore(m.remaining)}.`,
    });
  }

  // 3. Pace deviation (mid-period early warning before the under-utilisation rule kicks in)
  if (t.paceDeviation.enabled && isOpenPeriod && m.timeElapsed >= t.paceDeviation.minTimeElapsedPct) {
    const underRuleActive = findings.some((f) => f.type === 'UNDER_UTILIZATION');
    const overRuleActive = findings.some((f) => f.type === 'OVERSPENDING');
    if (!underRuleActive && m.paceGap < -t.paceDeviation.lagPctPoints) {
      findings.push({
        key: `PACE_DEVIATION:${id}`,
        type: 'PACE_DEVIATION',
        severity: 'MEDIUM',
        title: `Spending lagging schedule: ${budget.title}`,
        message: `Utilisation ${m.utilization}% trails time elapsed (${m.timeElapsed}%) by ${round2(-m.paceGap)} percentage points.`,
      });
    } else if (!overRuleActive && m.projectedUtilization > t.paceDeviation.projectedOverPct) {
      findings.push({
        key: `PACE_DEVIATION:${id}`,
        type: 'PACE_DEVIATION',
        severity: m.projectedUtilization > 130 ? 'HIGH' : 'MEDIUM',
        title: `Projected to exceed allocation: ${budget.title}`,
        message: `At the current burn rate (${formatCrore(m.burnRatePerDay)}/day) spending is projected to reach ${m.projectedUtilization}% of the allocation by period end.`,
      });
    }
  }

  // 4. Inactivity of allocated funds
  if (t.inactivity.enabled && isOpenPeriod && m.remaining > 0 && m.daysSinceLastActivity >= t.inactivity.days) {
    findings.push({
      key: `INACTIVITY:${id}`,
      type: 'INACTIVITY',
      severity: m.daysSinceLastActivity >= t.inactivity.days * 2 ? 'HIGH' : 'MEDIUM',
      title: `Dormant allocation: ${budget.title}`,
      message: m.lastExpenditureDate
        ? `No expenditure recorded for ${m.daysSinceLastActivity} days (last on ${istDateString(m.lastExpenditureDate)}). ${formatCrore(m.remaining)} remains idle.`
        : `No expenditure recorded in ${m.daysSinceLastActivity} days since the period began. ${formatCrore(m.remaining)} remains idle.`,
    });
  }

  for (const f of findings) f.metrics = metricSnapshot;

  // 5. Abnormal spending spikes (per transaction)
  if (t.spike.enabled) {
    for (const s of detectSpikes(txns, budget.allocatedAmount, t.spike)) {
      findings.push({
        key: `SPIKE:${s.tx._id}`,
        type: 'SPIKE',
        severity: s.severity,
        expenditure: s.tx._id,
        title: `Spending spike: ${budget.title}`,
        message: `Transaction ${s.tx.txnId} of ${formatCrore(s.tx.amount)} on ${istDateString(s.tx.date)} ${s.reason}.`,
        metrics: { amount: s.tx.amount, modifiedZScore: s.z, medianRatio: s.ratio, shareOfAllocation: s.shareOfAllocation, txnId: s.tx.txnId },
      });
    }
  }
  return { metrics: m, findings };
}

async function newAlertId() {
  const seq = await nextSequence('alert');
  return `ALT-${String(seq).padStart(6, '0')}`;
}

/** Persist findings: create new alerts, refresh existing ones, auto-resolve cleared conditions. */
async function reconcileAlerts(budget, findings, asOf) {
  const stats = { created: 0, updated: 0, autoResolved: 0 };
  const existing = await Alert.find({ budget: budget._id });
  const byKey = new Map();
  for (const a of existing) {
    const list = byKey.get(a.key) || [];
    list.push(a);
    byKey.set(a.key, list);
  }
  const activeKeys = new Set();

  for (const f of findings) {
    activeKeys.add(f.key);
    const list = byKey.get(f.key) || [];
    const unresolved = list.find((a) => a.status !== 'RESOLVED');
    if (unresolved) {
      const changed = unresolved.severity !== f.severity || unresolved.message !== f.message;
      unresolved.severity = f.severity;
      unresolved.title = f.title;
      unresolved.message = f.message;
      unresolved.metrics = f.metrics;
      unresolved.lastDetectedAt = asOf;
      await unresolved.save();
      if (changed) stats.updated++;
      continue;
    }
    // A user-resolved alert at the same (or higher) severity suppresses re-raising; spikes are one-off.
    const manuallyResolved = list.find(
      (a) => a.status === 'RESOLVED' && (!a.autoResolved || f.type === 'SPIKE') &&
        SEVERITY_ORDER.indexOf(a.severity) >= SEVERITY_ORDER.indexOf(f.severity)
    );
    if (manuallyResolved || (f.type === 'SPIKE' && list.length)) continue;
    await Alert.create({
      alertId: await newAlertId(),
      key: f.key,
      type: f.type,
      severity: f.severity,
      department: budget.department._id || budget.department,
      budget: budget._id,
      expenditure: f.expenditure,
      financialYear: budget.financialYear,
      title: f.title,
      message: f.message,
      metrics: f.metrics,
      detectedAt: asOf,
      lastDetectedAt: asOf,
    });
    stats.created++;
  }

  for (const a of existing) {
    if (a.status !== 'RESOLVED' && !activeKeys.has(a.key)) {
      a.status = 'RESOLVED';
      a.autoResolved = true;
      a.resolvedAt = asOf;
      a.resolutionNote = a.type === 'SPIKE'
        ? 'Source transaction no longer qualifies as a spike (edited or removed).'
        : 'Condition cleared automatically on re-evaluation.';
      await a.save();
      stats.autoResolved++;
    }
  }
  return stats;
}

/**
 * Run the monitoring engine. Without budgetIds every budget is evaluated (scheduled / manual scan);
 * with budgetIds only those (triggered after an expenditure or budget change).
 */
async function runMonitoring({ budgetIds, asOf = new Date() } = {}) {
  const t = await getThresholds();
  const filter = budgetIds && budgetIds.length ? { _id: { $in: budgetIds } } : {};
  const budgets = await Budget.find(filter).lean();
  const totals = { budgetsEvaluated: 0, created: 0, updated: 0, autoResolved: 0, findings: 0 };

  for (const budget of budgets) {
    if (budget.status === 'FROZEN') continue; // frozen budgets are excluded from monitoring
    const txns = await Expenditure.find({ budget: budget._id }, { amount: 1, date: 1, txnId: 1 }).sort({ date: 1, createdAt: 1 }).lean();
    const { findings } = evaluateBudget(budget, txns, t, asOf);
    const s = await reconcileAlerts(budget, findings, asOf);
    totals.budgetsEvaluated++;
    totals.findings += findings.length;
    totals.created += s.created;
    totals.updated += s.updated;
    totals.autoResolved += s.autoResolved;
  }

  if (!budgetIds) {
    await Setting.findOneAndUpdate(
      { key: 'monitoring.lastRun' },
      { value: { at: asOf, ...totals } },
      { upsert: true }
    );
  }
  return totals;
}

// Fire-and-log helper used after writes; monitoring errors must not fail the user's save.
async function monitorBudgetsSafely(ids) {
  try {
    return await runMonitoring({ budgetIds: ids.filter(Boolean) });
  } catch (err) {
    console.error('Monitoring run failed:', err);
    return null;
  }
}

module.exports = { runMonitoring, monitorBudgetsSafely, evaluateBudget, detectSpikes };
