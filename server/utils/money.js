// All monetary values are stored as whole rupees (integers) to avoid floating-point drift.
// 1 crore = 1,00,00,000 rupees. The UI captures amounts in crore with up to 2 decimals (i.e. ₹1 lakh precision).

const RUPEES_PER_CRORE = 10_000_000;
const RUPEES_PER_LAKH = 100_000;
const MAX_AMOUNT = 1e15; // well inside Number.MAX_SAFE_INTEGER

function isValidAmount(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_AMOUNT;
}

function croreToRupees(crore) {
  // Round through lakh units so 12.34 crore -> 1234 lakh exactly.
  return Math.round(Number(crore) * 100) * RUPEES_PER_LAKH;
}

function rupeesToCrore(rupees) {
  return rupees / RUPEES_PER_CRORE;
}

function sum(values) {
  return values.reduce((acc, v) => acc + (Number(v) || 0), 0);
}

// Percentage rounded to 2 decimals; returns 0 when the base is 0.
function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 10000) / 100;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function formatCrore(rupees) {
  const crore = rupeesToCrore(rupees);
  return '₹ ' + crore.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Cr';
}

module.exports = {
  RUPEES_PER_CRORE,
  RUPEES_PER_LAKH,
  isValidAmount,
  croreToRupees,
  rupeesToCrore,
  sum,
  pct,
  round2,
  formatCrore,
};
