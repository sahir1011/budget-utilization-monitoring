const express = require('express');
const mongoose = require('mongoose');
const { Department, Budget, User, Alert } = require('../models');
const { HttpError, asyncHandler, str, isObjectId } = require('../utils/http');
const { authorize, assertDepartmentAccess, isDeptHead, userDeptId } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { financialYearOf, isValidFinancialYear } = require('../utils/period');
const { budgetsWithMetrics, byDepartment, summarize, monthlyTrend, categoryBreakdown, alertStats } = require('../services/analytics');

const router = express.Router();

function fyParam(req) {
  const fy = str(req.query.fy);
  return fy && isValidFinancialYear(fy) ? fy : financialYearOf();
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const fy = fyParam(req);
    const deptFilter = isDeptHead(req.user) ? { _id: userDeptId(req.user) } : {};
    const departments = await Department.find(deptFilter).sort({ name: 1 }).lean();
    const ids = departments.map((d) => d._id);
    const items = await budgetsWithMetrics({ department: { $in: ids }, financialYear: fy });
    const summaries = new Map(byDepartment(items).map((s) => [s.department.id, s]));
    const [heads, alerts] = await Promise.all([
      User.find({ role: 'DEPARTMENT_HEAD', department: { $in: ids }, active: true }, 'name email department').lean(),
      Alert.aggregate([{ $match: { department: { $in: ids }, status: { $ne: 'RESOLVED' } } }, { $group: { _id: '$department', n: { $sum: 1 } } }]),
    ]);
    const openAlerts = new Map(alerts.map((a) => [String(a._id), a.n]));
    res.json({
      financialYear: fy,
      items: departments.map((d) => {
        const s = summaries.get(String(d._id));
        return {
          id: String(d._id),
          code: d.code,
          name: d.name,
          description: d.description,
          active: d.active,
          heads: heads.filter((h) => String(h.department) === String(d._id)).map((h) => ({ name: h.name, email: h.email })),
          allocated: s ? s.allocated : 0,
          spent: s ? s.spent : 0,
          remaining: s ? s.remaining : 0,
          utilization: s ? s.utilization : 0,
          budgetCount: s ? s.budgetCount : 0,
          avgRiskScore: s ? s.avgRiskScore : 0,
          openAlerts: openAlerts.get(String(d._id)) || 0,
        };
      }),
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    assertDepartmentAccess(req.user, req.params.id);
    const dept = await Department.findById(req.params.id).lean();
    if (!dept) throw new HttpError(404, 'Department not found');
    const fy = fyParam(req);
    const deptId = new mongoose.Types.ObjectId(req.params.id);
    const items = await budgetsWithMetrics({ department: deptId, financialYear: fy });
    const summary = summarize(items);
    const [trend, categories, alerts, heads] = await Promise.all([
      monthlyTrend({ department: deptId }, fy, summary.allocated),
      categoryBreakdown({ department: deptId, financialYear: fy }),
      alertStats({ department: deptId }),
      User.find({ role: 'DEPARTMENT_HEAD', department: deptId }, 'name email active').lean(),
    ]);
    res.json({
      department: { id: String(dept._id), code: dept.code, name: dept.name, description: dept.description, active: dept.active },
      financialYear: fy,
      summary,
      budgets: items.map((b) => ({ id: String(b._id), code: b.code, title: b.title, status: b.status, periodType: b.periodType, quarter: b.quarter, expenditureType: b.expenditureType, metrics: b.metrics })),
      trend,
      categories,
      alerts,
      heads: heads.map((h) => ({ name: h.name, email: h.email, active: h.active })),
    });
  })
);

router.post(
  '/',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const code = str(req.body.code, 12);
    const name = str(req.body.name, 150);
    if (!code || !/^[A-Za-z0-9-]{2,12}$/.test(code)) throw new HttpError(400, 'Code must be 2-12 letters, digits or hyphens');
    if (!name) throw new HttpError(400, 'Name is required');
    const dept = await Department.create({ code, name, description: str(req.body.description, 1000) });
    await audit(req, { action: 'CREATE', entity: 'Department', entityId: dept._id, summary: `Created department ${dept.code}`, after: dept.toObject() });
    res.status(201).json(dept);
  })
);

router.patch(
  '/:id',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const dept = await Department.findById(req.params.id);
    if (!dept) throw new HttpError(404, 'Department not found');
    const before = dept.toObject();
    if (req.body.name !== undefined) dept.name = str(req.body.name, 150);
    if (req.body.description !== undefined) dept.description = str(req.body.description, 1000);
    if (req.body.active !== undefined) dept.active = Boolean(req.body.active);
    await dept.save();
    await audit(req, { action: 'UPDATE', entity: 'Department', entityId: dept._id, summary: `Updated department ${dept.code}`, before, after: dept.toObject() });
    res.json(dept);
  })
);

router.delete(
  '/:id',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const dept = await Department.findById(req.params.id);
    if (!dept) throw new HttpError(404, 'Department not found');
    const [budgets, users] = await Promise.all([Budget.countDocuments({ department: dept._id }), User.countDocuments({ department: dept._id })]);
    if (budgets || users) throw new HttpError(409, 'Department has budgets or users mapped to it. Deactivate it instead.');
    await dept.deleteOne();
    await audit(req, { action: 'DELETE', entity: 'Department', entityId: dept._id, summary: `Deleted department ${dept.code}`, before: dept.toObject() });
    res.json({ message: 'Department deleted' });
  })
);

module.exports = router;
