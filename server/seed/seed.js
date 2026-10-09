const bcrypt = require('bcryptjs');
const { Department, User, Budget, Expenditure, Setting, Counter } = require('../models');
const { PRS_SOURCE, departments, PROFILES, KINDS, SPIKE_LINE, FY27, FY26, USERS } = require('./data');
const { financialYearBounds } = require('../utils/period');
const { RUPEES_PER_LAKH } = require('../utils/money');
const { runMonitoring } = require('../services/monitoring');

const PIECES_3 = [0.42, 0.33, 0.25];
const PIECES_SPIKE = [0.88, 0.07, 0.05];
const DAYS_3 = [8, 17, 26];
const PIECES_2 = [0.55, 0.45];
const DAYS_2 = [12, 26];

const fmt = (n) => n.toLocaleString('en-IN');

function txnDate(fyStartYear, monthIndex, day) {
  // monthIndex 0 = April of fyStartYear; 06:30 UTC = 12:00 IST
  return new Date(Date.UTC(fyStartYear, 3 + monthIndex, day, 6, 30));
}

function singleDay(profile) {
  return profile === 'QUARTERLY' ? 25 : 14;
}

/** FY 2026-27: BE x execution ratio x release profile, up to `asOf`. */
function generateRunningYear(budget, line, ctx) {
  const [dept, short, , be, , kind, profile, prior, spikeMonth] = line;
  const fyStart = 2026;
  const ratio = prior.be25 && prior.re25 ? prior.re25 / prior.be25 : 1;
  const weights = PROFILES[profile];
  const templates = KINDS[kind];
  const out = [];
  for (let m = 0; m < 12; m++) {
    const monthLakh = Math.round(be * 100 * ratio * weights[m]);
    if (monthLakh <= 0) continue;
    if (templates.length === 1) {
      const date = txnDate(fyStart, m, singleDay(profile));
      if (date <= ctx.asOf) out.push({ lakh: monthLakh, date, line: templates[0] });
      continue;
    }
    const pieces = m === spikeMonth ? PIECES_SPIKE : PIECES_3;
    let allocated = 0;
    pieces.forEach((pw, j) => {
      const lakh = j === pieces.length - 1 ? monthLakh - allocated : Math.round(monthLakh * pw);
      allocated += lakh;
      const date = txnDate(fyStart, m, DAYS_3[j]);
      if (date > ctx.asOf || lakh <= 0) return;
      const tpl = m === spikeMonth && j === 0 && SPIKE_LINE[`${dept}-${short}`] ? SPIKE_LINE[`${dept}-${short}`] : templates[j];
      out.push({ lakh, date, line: tpl });
    });
  }
  return out.map((t) => toExpenditure(budget, t, dept, short));
}

/** FY 2025-26 (closed): distribute RE exactly over the year. */
function generateClosedYear(budget, line) {
  const [dept, short, , , re, , kind, profile] = line;
  const fyStart = 2025;
  const totalLakh = re * 100;
  const weights = PROFILES[profile];
  const templates = KINDS[kind];
  const slots = [];
  for (let m = 0; m < 12; m++) {
    if (!weights[m]) continue;
    if (templates.length === 1) slots.push({ share: weights[m], date: txnDate(fyStart, m, singleDay(profile)), line: templates[0] });
    else PIECES_2.forEach((pw, j) => slots.push({ share: weights[m] * pw, date: txnDate(fyStart, m, DAYS_2[j]), line: templates[j] }));
  }
  let allocated = 0;
  const out = slots.map((s, i) => {
    const lakh = i === slots.length - 1 ? totalLakh - allocated : Math.round(totalLakh * s.share);
    allocated += lakh;
    return { lakh, date: s.date, line: s.line };
  });
  return out.map((t) => toExpenditure(budget, t, dept, short));
}

function toExpenditure(budget, t, dept, short) {
  const [category, description, payee] = t.line;
  return {
    budget: budget._id,
    department: budget.department,
    financialYear: budget.financialYear,
    amount: t.lakh * RUPEES_PER_LAKH,
    category,
    date: t.date,
    description: description.replace('{t}', budget.title),
    payee,
    _ref: `${dept}/${short}/${budget.financialYear}`,
    createdBy: budget.createdBy,
  };
}

async function seedDatabase({ asOf = new Date(), log = console.log } = {}) {
  log('Seeding departments…');
  const deptDocs = await Department.insertMany(departments);
  const deptByCode = Object.fromEntries(deptDocs.map((d) => [d.code, d]));

  log('Seeding users…');
  const userDocs = [];
  for (const u of USERS) {
    userDocs.push({
      name: u.name,
      email: u.email,
      role: u.role,
      department: u.department ? deptByCode[u.department]._id : undefined,
      passwordHash: await bcrypt.hash(u.password, 10),
    });
  }
  const users = await User.insertMany(userDocs);
  const admin = users.find((u) => u.role === 'ADMIN');
  const finance = users.find((u) => u.role === 'FINANCE_OFFICER');
  const headOf = (deptId) => users.find((u) => u.role === 'DEPARTMENT_HEAD' && String(u.department) === String(deptId)) || finance;

  log('Seeding budgets…');
  const fy27 = financialYearBounds('2026-27');
  const fy26 = financialYearBounds('2025-26');
  const budgetDocs = [];
  for (const line of FY27) {
    const [dept, short, title, be, type, , , prior] = line;
    const ratio = prior.be25 && prior.re25 ? prior.re25 / prior.be25 : null;
    budgetDocs.push({
      code: `${dept}-${short}-2627`,
      title,
      department: deptByCode[dept]._id,
      financialYear: '2026-27',
      periodType: 'ANNUAL',
      periodStart: fy27.start,
      periodEnd: fy27.end,
      allocatedAmount: be * 100 * RUPEES_PER_LAKH,
      allocationDate: fy27.start,
      expenditureType: type,
      status: 'ACTIVE',
      source: short === 'UD' ? `${PRS_SOURCE} (derived: Ministry total less PMAY-U)` : PRS_SOURCE,
      description:
        `Budget Estimate 2026-27: ₹${fmt(be)} crore.` +
        (prior.be25 ? ` BE 2025-26: ₹${fmt(prior.be25)} crore.` : '') +
        (prior.re25 ? ` RE 2025-26: ₹${fmt(prior.re25)} crore.` : '') +
        (ratio ? ` Seeded spend follows the 2025-26 execution ratio (RE/BE = ${(ratio * 100).toFixed(1)}%).` : ' Seeded spend assumes on-plan execution.'),
      priorYear: {
        budgetEstimate: prior.be25 ? prior.be25 * 100 * RUPEES_PER_LAKH : undefined,
        revisedEstimate: prior.re25 ? prior.re25 * 100 * RUPEES_PER_LAKH : undefined,
      },
      createdBy: finance._id,
      _line: line,
      _year: 27,
    });
  }
  for (const line of FY26) {
    const [dept, short, title, be, re, type] = line;
    budgetDocs.push({
      code: `${dept}-${short}-2526`,
      title,
      department: deptByCode[dept]._id,
      financialYear: '2025-26',
      periodType: 'ANNUAL',
      periodStart: fy26.start,
      periodEnd: fy26.end,
      allocatedAmount: be * 100 * RUPEES_PER_LAKH,
      allocationDate: fy26.start,
      expenditureType: type,
      status: 'CLOSED',
      source: PRS_SOURCE,
      description: `Allocation = Budget Estimate 2025-26 (₹${fmt(be)} crore). Recorded expenditure totals the Revised Estimate 2025-26 (₹${fmt(re)} crore), i.e. ${((re / be) * 100).toFixed(1)}% utilisation.`,
      createdBy: admin._id,
      _line: line,
      _year: 26,
    });
  }
  const budgets = await Budget.insertMany(budgetDocs.map(({ _line, _year, ...b }) => b));

  log('Generating expenditure transactions…');
  let txns = [];
  budgets.forEach((b, i) => {
    const meta = budgetDocs[i];
    const withCreator = { ...b.toObject(), createdBy: headOf(b.department)._id };
    txns.push(...(meta._year === 27 ? generateRunningYear(withCreator, meta._line, { asOf }) : generateClosedYear(withCreator, meta._line)));
  });
  txns.sort((a, b) => a.date - b.date);
  const refCounters = {};
  txns = txns.map((t, i) => {
    refCounters[t._ref] = (refCounters[t._ref] || 0) + 1;
    const { _ref, ...rest } = t;
    return {
      ...rest,
      txnId: `TXN-${t.financialYear.replace('-', '')}-${String(i + 1).padStart(6, '0')}`,
      referenceNo: `${_ref}/SO-${String(refCounters[_ref]).padStart(3, '0')}`,
    };
  });
  await Expenditure.insertMany(txns);
  await Counter.findByIdAndUpdate('txn', { seq: txns.length }, { upsert: true });

  log('Running monitoring engine…');
  const result = await runMonitoring({ asOf });
  log(`Seed complete: ${deptDocs.length} departments, ${users.length} users, ${budgets.length} budgets, ${txns.length} transactions, ${result.created} alerts.`);
  return { departments: deptDocs.length, users: users.length, budgets: budgets.length, expenditures: txns.length, alerts: result.created };
}

/** Seed once on a fresh database. A unique lock row prevents concurrent cold starts double-seeding. */
async function seedIfEmpty() {
  if (await User.estimatedDocumentCount()) return false;
  try {
    await Setting.create({ key: 'seed.lock', value: { at: new Date() } });
  } catch (err) {
    if (err.code === 11000) return false;
    throw err;
  }
  await seedDatabase();
  return true;
}

module.exports = { seedDatabase, seedIfEmpty };
