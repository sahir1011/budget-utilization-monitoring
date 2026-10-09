const express = require('express');
const mongoose = require('mongoose');
const { Alert, ALERT_TYPES, SEVERITIES } = require('../models');
const { HttpError, asyncHandler, str, isObjectId, pagination } = require('../utils/http');
const { departmentScope, assertDepartmentAccess } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { isValidFinancialYear } = require('../utils/period');
const { alertStats } = require('../services/analytics');

const router = express.Router();
const SEVERITY_RANK = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

const view = (a) => ({
  id: String(a._id),
  alertId: a.alertId,
  type: a.type,
  severity: a.severity,
  status: a.status,
  title: a.title,
  message: a.message,
  metrics: a.metrics,
  financialYear: a.financialYear,
  department: a.department && a.department.code ? { id: String(a.department._id), code: a.department.code, name: a.department.name } : a.department,
  budget: a.budget && a.budget.code ? { id: String(a.budget._id), code: a.budget.code, title: a.budget.title } : a.budget,
  expenditure: a.expenditure && a.expenditure.txnId ? { id: String(a.expenditure._id), txnId: a.expenditure.txnId } : a.expenditure,
  detectedAt: a.detectedAt,
  lastDetectedAt: a.lastDetectedAt,
  acknowledgedAt: a.acknowledgedAt,
  acknowledgedBy: a.acknowledgedBy && a.acknowledgedBy.name ? a.acknowledgedBy.name : null,
  resolvedAt: a.resolvedAt,
  resolvedBy: a.resolvedBy && a.resolvedBy.name ? a.resolvedBy.name : a.autoResolved ? 'System' : null,
  autoResolved: a.autoResolved,
  resolutionNote: a.resolutionNote,
  notes: (a.notes || []).map((n) => ({ text: n.text, by: n.by && n.by.name ? n.by.name : null, at: n.at })),
});

function buildFilter(req) {
  const filter = { ...departmentScope(req.user) };
  const status = str(req.query.status);
  if (status === 'UNRESOLVED') filter.status = { $ne: 'RESOLVED' };
  else if (['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(status)) filter.status = status;
  const type = str(req.query.type);
  if (ALERT_TYPES.includes(type)) filter.type = type;
  const severity = str(req.query.severity);
  if (SEVERITIES.includes(severity)) filter.severity = severity;
  const dept = str(req.query.department);
  if (dept && isObjectId(dept)) {
    assertDepartmentAccess(req.user, dept);
    filter.department = new mongoose.Types.ObjectId(dept);
  }
  const budget = str(req.query.budget);
  if (budget && isObjectId(budget)) filter.budget = new mongoose.Types.ObjectId(budget);
  const fy = str(req.query.fy);
  if (fy && isValidFinancialYear(fy)) filter.financialYear = fy;
  return filter;
}

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    res.json(await alertStats(departmentScope(req.user)));
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = buildFilter(req);
    const { page, limit, skip } = pagination(req.query, 25);
    const [items, total] = await Promise.all([
      Alert.aggregate([
        { $match: filter },
        {
          $addFields: {
            _statusRank: { $indexOfArray: [['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], '$status'] },
            _sevRank: { $switch: { branches: Object.entries(SEVERITY_RANK).map(([k, v]) => ({ case: { $eq: ['$severity', k] }, then: v })), default: 0 } },
          },
        },
        { $sort: { _statusRank: 1, _sevRank: -1, lastDetectedAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { _id: 1 } },
      ]),
      Alert.countDocuments(filter),
    ]);
    const ids = items.map((i) => i._id);
    const docs = await Alert.find({ _id: { $in: ids } })
      .populate('department', 'code name')
      .populate('budget', 'code title')
      .populate('expenditure', 'txnId')
      .populate('acknowledgedBy', 'name')
      .populate('resolvedBy', 'name')
      .populate('notes.by', 'name')
      .lean();
    const byId = new Map(docs.map((d) => [String(d._id), d]));
    res.json({ items: ids.map((id) => view(byId.get(String(id)))), total, page, limit });
  })
);

async function loadForAction(req) {
  if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw new HttpError(404, 'Alert not found');
  assertDepartmentAccess(req.user, alert.department);
  return alert;
}

router.patch(
  '/:id/acknowledge',
  asyncHandler(async (req, res) => {
    const alert = await loadForAction(req);
    if (alert.status !== 'OPEN') throw new HttpError(409, `Alert is already ${alert.status.toLowerCase()}`);
    alert.status = 'ACKNOWLEDGED';
    alert.acknowledgedAt = new Date();
    alert.acknowledgedBy = req.user._id;
    const note = str(req.body.note, 1000);
    if (note) alert.notes.push({ text: note, by: req.user._id });
    await alert.save();
    await audit(req, { action: 'ACKNOWLEDGE', entity: 'Alert', entityId: alert._id, summary: `Acknowledged ${alert.alertId}` });
    res.json({ message: 'Alert acknowledged' });
  })
);

router.patch(
  '/:id/resolve',
  asyncHandler(async (req, res) => {
    const alert = await loadForAction(req);
    if (alert.status === 'RESOLVED') throw new HttpError(409, 'Alert is already resolved');
    const note = str(req.body.note, 1000);
    if (!note) throw new HttpError(400, 'A resolution note is required');
    if (!alert.acknowledgedAt) {
      alert.acknowledgedAt = new Date();
      alert.acknowledgedBy = req.user._id;
    }
    alert.status = 'RESOLVED';
    alert.resolvedAt = new Date();
    alert.resolvedBy = req.user._id;
    alert.autoResolved = false;
    alert.resolutionNote = note;
    await alert.save();
    await audit(req, { action: 'RESOLVE', entity: 'Alert', entityId: alert._id, summary: `Resolved ${alert.alertId}: ${note}` });
    res.json({ message: 'Alert resolved' });
  })
);

router.post(
  '/:id/notes',
  asyncHandler(async (req, res) => {
    const alert = await loadForAction(req);
    const note = str(req.body.note, 1000);
    if (!note) throw new HttpError(400, 'Note text is required');
    alert.notes.push({ text: note, by: req.user._id });
    await alert.save();
    res.status(201).json({ message: 'Note added' });
  })
);

module.exports = router;
