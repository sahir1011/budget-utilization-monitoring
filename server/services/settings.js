const { Setting } = require('../models');

const THRESHOLD_KEY = 'thresholds';

const DEFAULT_THRESHOLDS = Object.freeze({
  underUtilization: {
    enabled: true,
    utilizationBelowPct: 40, // flag if less than 40% used...
    timeElapsedAbovePct: 70, // ...after 70% of the period has elapsed
  },
  overspending: {
    enabled: true,
    warningPct: 90, // spending has reached 90% of allocation before the period is almost over
    warningTimeElapsedBelowPct: 90,
    criticalPct: 100, // spending exceeded the approved allocation
  },
  spike: {
    enabled: true,
    modifiedZScore: 3.5, // robust (median/MAD) z-score cut-off
    medianMultiplier: 2.5, // and the transaction must be at least 2.5x the median transaction
    minHistory: 6, // minimum prior transactions on the budget before spike logic applies
    singleTxnShareOfAllocationPct: 40, // any single transaction above 40% of allocation is a spike
  },
  inactivity: {
    enabled: true,
    days: 60, // no expenditure recorded for 60 days on an active budget
  },
  paceDeviation: {
    enabled: true,
    minTimeElapsedPct: 25,
    lagPctPoints: 30, // utilisation trails time elapsed by more than 30 percentage points
    projectedOverPct: 110, // linear burn-rate projects > 110% utilisation by period end
  },
  highValueUnspentCrore: 10000, // escalate under-utilisation severity when unspent funds exceed this (₹ crore)
});

function merge(defaults, value) {
  const out = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (v && typeof v === 'object') out[k] = merge(v, (value && value[k]) || {});
    else out[k] = value && value[k] !== undefined ? value[k] : v;
  }
  return out;
}

async function getThresholds() {
  const doc = await Setting.findOne({ key: THRESHOLD_KEY }).lean();
  return merge(DEFAULT_THRESHOLDS, doc ? doc.value : {});
}

// Validates & normalises admin input against the defaults' shape; only known numeric/boolean keys are kept.
function sanitizeThresholds(input) {
  const errors = [];
  const walk = (defaults, value, path) => {
    const out = {};
    for (const [k, def] of Object.entries(defaults)) {
      const v = value ? value[k] : undefined;
      const p = path ? `${path}.${k}` : k;
      if (def && typeof def === 'object') out[k] = walk(def, v, p);
      else if (typeof def === 'boolean') out[k] = v === undefined ? def : Boolean(v);
      else {
        const n = v === undefined ? def : Number(v);
        if (!Number.isFinite(n) || n < 0) errors.push(`${p} must be a non-negative number`);
        else if (/Pct$/.test(k) && n > 1000) errors.push(`${p} is out of range`);
        out[k] = n;
      }
    }
    return out;
  };
  const value = walk(DEFAULT_THRESHOLDS, input || {}, '');
  if (value.underUtilization.timeElapsedAbovePct > 100) errors.push('underUtilization.timeElapsedAbovePct cannot exceed 100');
  if (value.overspending.warningPct > value.overspending.criticalPct) errors.push('overspending.warningPct must be <= criticalPct');
  if (value.spike.minHistory < 2) errors.push('spike.minHistory must be at least 2');
  if (value.inactivity.days < 1) errors.push('inactivity.days must be at least 1');
  return { value, errors };
}

async function saveThresholds(value, userId) {
  return Setting.findOneAndUpdate(
    { key: THRESHOLD_KEY },
    { value, updatedBy: userId },
    { upsert: true, new: true }
  );
}

module.exports = { DEFAULT_THRESHOLDS, getThresholds, sanitizeThresholds, saveThresholds, THRESHOLD_KEY };
