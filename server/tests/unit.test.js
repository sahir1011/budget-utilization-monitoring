const test = require('node:test');
const assert = require('node:assert/strict');
const { pct, croreToRupees, isValidAmount } = require('../utils/money');
const { financialYearBounds, quarterBounds, timeElapsedPct, financialYearOf, isValidFinancialYear, istDateString } = require('../utils/period');
const { budgetMetrics } = require('../services/metrics');
const { evaluateBudget, detectSpikes } = require('../services/monitoring');
const { DEFAULT_THRESHOLDS, sanitizeThresholds } = require('../services/settings');

const T = JSON.parse(JSON.stringify(DEFAULT_THRESHOLDS));
const CR = 10_000_000;

test('money helpers are exact', () => {
  assert.equal(croreToRupees(12.34), 123_400_000);
  assert.equal(croreToRupees('0.1'), 1_000_000);
  assert.equal(pct(1, 3), 33.33);
  assert.equal(pct(5, 0), 0);
  assert.equal(isValidAmount(1.5), false);
  assert.equal(isValidAmount(-1), false);
  assert.equal(isValidAmount(100), true);
});

test('financial year periods', () => {
  const { start, end } = financialYearBounds('2026-27');
  // Midnight IST (UTC+05:30)
  assert.equal(start.toISOString(), '2026-03-31T18:30:00.000Z');
  assert.equal(end.toISOString(), '2027-03-31T18:29:59.999Z');
  assert.equal(istDateString(start), '2026-04-01');
  assert.equal(istDateString(end), '2027-03-31');
  const q3 = quarterBounds('2026-27', 3);
  assert.equal(istDateString(q3.start), '2026-10-01');
  assert.equal(istDateString(q3.end), '2026-12-31');
  const q4 = quarterBounds('2026-27', 4);
  assert.equal(istDateString(q4.start), '2027-01-01');
  assert.equal(istDateString(q4.end), '2027-03-31');
  // A date-only input ("2027-03-31" parses as UTC midnight) falls inside the period; the next day does not.
  assert.ok(new Date('2027-03-31') <= end && new Date('2026-04-01') >= start);
  assert.ok(new Date('2027-04-01') > end);
  assert.equal(financialYearOf(new Date('2026-03-31T19:00:00Z')), '2026-27'); // already 1 Apr in India
  assert.equal(financialYearOf(new Date('2027-02-01')), '2026-27');
  assert.equal(financialYearOf(new Date('2026-04-01')), '2026-27');
  assert.ok(isValidFinancialYear('2099-00'));
  assert.ok(!isValidFinancialYear('2026-28'));
  assert.equal(timeElapsedPct(start, end, new Date('2025-01-01')), 0);
  assert.equal(timeElapsedPct(start, end, new Date('2030-01-01')), 100);
});

function budget(allocCrore, overrides = {}) {
  const { start, end } = financialYearBounds('2026-27');
  return { _id: 'b1', title: 'Test scheme', department: 'd1', financialYear: '2026-27', allocatedAmount: allocCrore * CR, periodStart: start, periodEnd: end, status: 'ACTIVE', ...overrides };
}

test('utilisation metrics', () => {
  const b = budget(1000);
  const asOf = new Date('2026-10-01T00:00:00Z'); // 183 of 365 days
  const m = budgetMetrics(b, { spent: 250 * CR, count: 5, lastDate: new Date('2026-09-20') }, T, asOf);
  assert.equal(m.utilization, 25);
  assert.equal(m.remaining, 750 * CR);
  assert.ok(Math.abs(m.timeElapsed - 50.14) < 0.1);
  assert.equal(m.daysSinceLastActivity, 11);
  assert.equal(m.health, 'ON_TRACK'); // lag 25pp < 30pp threshold
});

test('under-utilisation rule: <40% used after 70% elapsed', () => {
  const b = budget(1000);
  const asOf = new Date('2027-01-15T00:00:00Z'); // ~79% elapsed
  const txns = [{ _id: 't1', txnId: 'T1', amount: 300 * CR, date: new Date('2027-01-10') }];
  const { findings, metrics } = evaluateBudget(b, txns, T, asOf);
  assert.equal(metrics.utilization, 30);
  const f = findings.find((x) => x.type === 'UNDER_UTILIZATION');
  assert.ok(f, 'expected under-utilisation alert');
  assert.equal(f.severity, 'MEDIUM');
});

test('overspending rule: critical above 100%', () => {
  const b = budget(100);
  const asOf = new Date('2026-12-01T00:00:00Z');
  const txns = [
    { _id: 't1', txnId: 'T1', amount: 60 * CR, date: new Date('2026-06-01') },
    { _id: 't2', txnId: 'T2', amount: 45 * CR, date: new Date('2026-11-01') },
  ];
  const { findings } = evaluateBudget(b, txns, T, asOf);
  const f = findings.find((x) => x.type === 'OVERSPENDING');
  assert.equal(f.severity, 'CRITICAL');
});

test('inactivity rule fires after configured days', () => {
  const b = budget(100);
  const asOf = new Date('2026-09-01T00:00:00Z');
  const txns = [{ _id: 't1', txnId: 'T1', amount: 30 * CR, date: new Date('2026-06-01') }];
  const { findings } = evaluateBudget(b, txns, T, asOf);
  assert.ok(findings.some((x) => x.type === 'INACTIVITY'));
});

test('spike detection uses only prior history (robust z-score)', () => {
  const amounts = [10, 12, 11, 9, 10, 13, 11, 60, 12];
  const txns = amounts.map((a, i) => ({ _id: `t${i}`, txnId: `T${i}`, amount: a * CR, date: new Date(2026, 4, i + 1) }));
  const spikes = detectSpikes(txns, 10_000 * CR, T.spike);
  assert.equal(spikes.length, 1);
  assert.equal(spikes[0].tx.txnId, 'T7');
  // A steady series raises nothing
  assert.equal(detectSpikes(txns.slice(0, 7), 10_000 * CR, T.spike).length, 0);
});

test('threshold sanitisation rejects bad values', () => {
  assert.equal(sanitizeThresholds({ underUtilization: { utilizationBelowPct: -5 } }).errors.length, 1);
  assert.equal(sanitizeThresholds({ overspending: { warningPct: 120, criticalPct: 100 } }).errors.length, 1);
  const ok = sanitizeThresholds({ inactivity: { days: '45' }, evil: { $gt: 1 } });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.value.inactivity.days, 45);
  assert.equal(ok.value.evil, undefined);
});
