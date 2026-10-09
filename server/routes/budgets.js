const express = require('express');
const { Budget, Department, Expenditure, Alert } = require('../models');
const { HttpError, asyncHandler, str, isObjectId, escapeRegex } = require('../utils/http');
const { authorize, departmentScope, assertDepartmentAccess } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { isValidAmount, formatCrore } = require('../utils/money');
const { isValidFinancialYear, periodBounds } = require('../utils/period');
const { parseDate } = require('../utils/validators');
const { budgetsWithMetrics, monthlyTrend, categoryBreakdown } = require('../services/analytics');
const { monitorBudgetsSafely } = require('../services/monitoring');

const router = express.Router();
const HEALTH = ['OVERSPENT', 'UNDER_UTILIZED', 'LAGGING', 'AHEAD', 'ON_TRACK'];

const view = (b) => ({
  id: String(b._id),
  code: b.code,
  title: b.title,
  department: b.department && b.department.code ? { id: String(b.department._id), code: b.department.code, name: b.department.name } : b.department,
  financialYear: b.financialYear,
  periodType: b.periodType,
  quarter: b.quarter,
  periodStart: b.periodStart,
  periodEnd: b.periodEnd,
  allocatedAmount: b.allocatedAmount,
  allocationDate: b.allocationDate,
  expenditureType: b.expenditureType,
  status: b.status,
  description: b.description,
  source: b.source,
  priorYear: b.priorYear,
  metrics: b.metrics,
  createdAt: b.createdAt,
  updatedAt: b.updatedAt,
});

router.get(
  '/financial-years',
  asyncHandler(async (req, res) => {
    const years = await Budget.distinct('financialYear', departmentScope(req.user));
    res.json({ items: years.sort().reverse() });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { ...departmentScope(req.user) };
    const fy = str(req.query.fy);
    if (fy && isValidFinancialYear(fy)) filter.financialYear = fy;
    const dept = str(req.query.department);
    if (dept && isObjectId(dept)) {
      assertDepartmentAccess(req.user, dept);
      filter.department = dept;
    }
    const status = str(req.query.status);
    if (['ACTIVE', 'FROZEN', 'CLOSED'].includes(status)) filter.status = status;
    const periodType = str(req.query.periodType);
    if (['ANNUAL', 'QUARTERLY'].includes(periodType)) filter.periodType = periodType;
    const q = str(req.query.q, 100);
    if (q) filter.$or = [{ title: new RegExp(escapeRegex(q), 'i') }, { code: new RegExp(escapeRegex(q), 'i') }];

    let items = await budgetsWithMetrics(filter);
    const health = str(req.query.health);
    if (HEALTH.includes(health)) items = items.filter((b) => b.metrics.health === health);
    const sort = str(req.query.sort);
    const sorters = {
      utilization: (a, b) => b.metrics.utilization - a.metrics.utilization,
      risk: (a, b) => b.metrics.riskScore - a.metrics.riskScore,
      allocated: (a, b) => b.allocatedAmount - a.allocatedAmount,
    };
    if (sorters[sort]) items.sort(sorters[sort]);
    res.json({ items: items.map(view) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const [budget] = await budgetsWithMetrics({ _id: req.params.id });
    if (!budget) throw new HttpError(404, 'Budget not found');
    assertDepartmentAccess(req.user, budget.department._id);
    const full = await Budget.findById(req.params.id).populate('revisions.by', 'name').populate('createdBy', 'name').lean();
    const [trend, categories, recent, alerts] = await Promise.all([
      monthlyTrend({ budget: budget._id }, budget.financialYear, budget.allocatedAmount),
      categoryBreakdown({ budget: budget._id }),
      Expenditure.find({ budget: budget._id }).sort({ date: -1, createdAt: -1 }).limit(15).populate('createdBy', 'name').lean(),
      Alert.find({ budget: budget._id }).sort({ status: 1, lastDetectedAt: -1 }).limit(30).lean(),
    ]);
    res.json({
      budget: { ...view(budget), createdBy: full.createdBy ? full.createdBy.name : null },
      revisions: (full.revisions || []).map((r) => ({ previousAmount: r.previousAmount, newAmount: r.newAmount, reason: r.reason, by: r.by ? r.by.name : null, at: r.at })),
      trend,
      categories,
      recentExpenditures: recent.map((e) => ({ id: String(e._id), txnId: e.txnId, amount: e.amount, category: e.category, date: e.date, description: e.description, payee: e.payee, documents: (e.documents || []).length, createdBy: e.createdBy ? e.createdBy.name : null })),
      alerts: alerts.map((a) => ({ id: String(a._id), alertId: a.alertId, type: a.type, severity: a.severity, status: a.status, title: a.title, message: a.message, detectedAt: a.detectedAt })),
    });
  })
);

async function readBudgetInput(body, existing) {
  const out = {};
  if (body.code !== undefined || !existing) {
    out.code = str(body.code, 40);
    if (!out.code || !/^[A-Za-z0-9-]{3,40}$/.test(out.code)) throw new HttpError(400, 'Budget code must be 3-40 letters, digits or hyphens');
  }
  if (body.title !== undefined || !existing) {
    out.title = str(body.title, 200);
    if (!out.title) throw new HttpError(400, 'Title is required');
  }
  if (body.department !== undefined || !existing) {
    const id = str(body.department);
    if (!isObjectId(id) || !(await Department.exists({ _id: id }))) throw new HttpError(400, 'A valid department is required');
    out.department = id;
  }
  if (body.financialYear !== undefined || !existing) {
    out.financialYear = str(body.financialYear);
    if (!isValidFinancialYear(out.financialYear)) throw new HttpError(400, 'Financial year must look like 2026-27');
  }
  if (body.periodType !== undefined || !existing) {
    out.periodType = str(body.periodType) || 'ANNUAL';
    if (!['ANNUAL', 'QUARTERLY'].includes(out.periodType)) throw new HttpError(400, 'Invalid period type');
  }
  if (body.quarter !== undefined) {
    out.quarter = body.quarter === null || body.quarter === '' ? undefined : Number(body.quarter);
    if (out.quarter !== undefined && ![1, 2, 3, 4].includes(out.quarter)) throw new HttpError(400, 'Quarter must be 1-4');
  }
  if (body.allocatedAmount !== undefined || !existing) {
    const amt = Number(body.allocatedAmount);
    if (!isValidAmount(amt)) throw new HttpError(400, 'Allocated amount must be a positive whole number of rupees');
    out.allocatedAmount = amt;
  }
  if (body.allocationDate !== undefined || !existing) {
    out.allocationDate = parseDate(body.allocationDate);
    if (!out.allocationDate) throw new HttpError(400, 'A valid allocation date is required');
  }
  if (body.expenditureType !== undefined) {
    out.expenditureType = str(body.expenditureType);
    if (!['REVENUE', 'CAPITAL'].includes(out.expenditureType)) throw new HttpError(400, 'Invalid expenditure type');
  }
  if (body.status !== undefined) {
    out.status = str(body.status);
    if (!['ACTIVE', 'FROZEN', 'CLOSED'].includes(out.status)) throw new HttpError(400, 'Invalid status');
  }
  if (body.description !== undefined) out.description = str(body.description, 2000);
  if (body.source !== undefined) out.source = str(body.source, 500);
  return out;
}

router.post(
  '/',
  authorize('ADMIN', 'FINANCE_OFFICER'),
  asyncHandler(async (req, res) => {
    const input = await readBudgetInput(req.body, null);
    const bounds = periodBounds(input);
    if (input.periodType === 'QUARTERLY' && !input.quarter) throw new HttpError(400, 'Quarter is required for quarterly budgets');
    const budget = await Budget.create({ ...input, periodStart: bounds.start, periodEnd: bounds.end, createdBy: req.user._id });
    await audit(req, {
      action: 'CREATE',
      entity: 'Budget',
      entityId: budget._id,
      summary: `Created budget ${budget.code} with allocation ${formatCrore(budget.allocatedAmount)}`,
      after: budget.toObject(),
    });
    await monitorBudgetsSafely([budget._id]);
    res.status(201).json(view(budget.toObject()));
  })
);

router.patch(
  '/:id',
  authorize('ADMIN', 'FINANCE_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const budget = await Budget.findById(req.params.id);
    if (!budget) throw new HttpError(404, 'Budget not found');
    const before = budget.toObject();
    const input = await readBudgetInput(req.body, budget);
    const hasTxns = await Expenditure.exists({ budget: budget._id });

    const periodChanging = ['financialYear', 'periodType', 'quarter', 'department'].some(
      (k) => input[k] !== undefined && String(input[k]) !== String(budget[k])
    );
    if (periodChanging && hasTxns) throw new HttpError(409, 'Department and period cannot change once expenditures are recorded');

    if (input.allocatedAmount !== undefined && input.allocatedAmount !== budget.allocatedAmount) {
      const reason = str(req.body.revisionReason, 500);
      if (!reason) throw new HttpError(400, 'A reason is required when revising the allocated amount');
      budget.revisions.push({ previousAmount: budget.allocatedAmount, newAmount: input.allocatedAmount, reason, by: req.user._id });
    }
    Object.assign(budget, input);
    if (periodChanging || input.periodType) {
      const bounds = periodBounds(budget);
      budget.periodStart = bounds.start;
      budget.periodEnd = bounds.end;
    }
    await budget.save();
    await audit(req, { action: 'UPDATE', entity: 'Budget', entityId: budget._id, summary: `Updated budget ${budget.code}`, before, after: budget.toObject() });
    await monitorBudgetsSafely([budget._id]);
    res.json(view(budget.toObject()));
  })
);

router.delete(
  '/:id',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const budget = await Budget.findById(req.params.id);
    if (!budget) throw new HttpError(404, 'Budget not found');
    if (await Expenditure.exists({ budget: budget._id })) {
      throw new HttpError(409, 'Budgets with recorded expenditure cannot be deleted. Close or freeze it instead.');
    }
    await Alert.deleteMany({ budget: budget._id });
    await budget.deleteOne();
    await audit(req, { action: 'DELETE', entity: 'Budget', entityId: budget._id, summary: `Deleted budget ${budget.code}`, before: budget.toObject() });
    res.json({ message: 'Budget deleted' });
  })
);

module.exports = router;
