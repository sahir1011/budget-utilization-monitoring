// Indian financial year runs 1 April -> 31 March. "2026-27" = 1 Apr 2026 to 31 Mar 2027.
const DAY_MS = 24 * 60 * 60 * 1000;
const FY_PATTERN = /^(\d{4})-(\d{2})$/;

function isValidFinancialYear(fy) {
  const m = FY_PATTERN.exec(String(fy || ''));
  if (!m) return false;
  return (Number(m[1]) + 1) % 100 === Number(m[2]);
}

function financialYearOf(date = new Date()) {
  const d = new Date(new Date(date).getTime() + (5 * 60 + 30) * 60 * 1000); // IST calendar
  const y = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
}

function fyStartYear(fy) {
  return Number(String(fy).slice(0, 4));
}

// Period boundaries are midnight India Standard Time (UTC+05:30), the government's working timezone.
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const istMidnight = (y, m, d) => new Date(Date.UTC(y, m, d) - IST_OFFSET_MS);

function financialYearBounds(fy) {
  const y = fyStartYear(fy);
  return {
    start: istMidnight(y, 3, 1),
    end: new Date(istMidnight(y + 1, 3, 1).getTime() - 1),
  };
}

// Q1 = Apr-Jun, Q2 = Jul-Sep, Q3 = Oct-Dec, Q4 = Jan-Mar
function quarterBounds(fy, quarter) {
  const y = fyStartYear(fy);
  const startMonth = 3 + (quarter - 1) * 3; // months from January of start year
  return {
    start: istMidnight(y, startMonth, 1),
    end: new Date(istMidnight(y, startMonth + 3, 1).getTime() - 1),
  };
}

/** Calendar date (YYYY-MM-DD) of an instant in IST. */
function istDateString(date) {
  return new Date(new Date(date).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function periodBounds({ financialYear, periodType, quarter }) {
  return periodType === 'QUARTERLY' ? quarterBounds(financialYear, quarter) : financialYearBounds(financialYear);
}

function timeElapsedPct(start, end, asOf = new Date()) {
  const total = end - start;
  if (total <= 0) return 100;
  const elapsed = Math.min(Math.max(asOf - start, 0), total);
  return Math.round((elapsed / total) * 10000) / 100;
}

function daysBetween(a, b) {
  return Math.floor((b - a) / DAY_MS);
}

function monthKey(date) {
  const d = new Date(date);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

// Ordered month keys Apr..Mar for a financial year
function fyMonthKeys(fy) {
  const y = fyStartYear(fy);
  const keys = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y, 3 + i, 1));
    keys.push(monthKey(d));
  }
  return keys;
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(key) {
  const [y, m] = key.split('-');
  return `${MONTH_LABELS[Number(m) - 1]} ${y.slice(2)}`;
}

module.exports = {
  DAY_MS,
  isValidFinancialYear,
  financialYearOf,
  financialYearBounds,
  quarterBounds,
  periodBounds,
  timeElapsedPct,
  daysBetween,
  monthKey,
  fyMonthKeys,
  monthLabel,
  istDateString,
  IST_OFFSET_MS,
};
