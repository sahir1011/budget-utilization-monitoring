const express = require('express');
const { AuditLog, Setting } = require('../models');
const { HttpError, asyncHandler, str, pagination, escapeRegex } = require('../utils/http');
const { authorize } = require('../middleware/auth');
const { audit, diff } = require('../utils/audit');
const { parseDate } = require('../utils/validators');
const { getThresholds, sanitizeThresholds, saveThresholds, DEFAULT_THRESHOLDS } = require('../services/settings');
const { runMonitoring } = require('../services/monitoring');
const { DAY_MS } = require('../utils/period');

// ---- Settings (threshold rules) ----
const settings = express.Router();

settings.get(
  '/thresholds',
  asyncHandler(async (req, res) => {
    const doc = await Setting.findOne({ key: 'thresholds' }).populate('updatedBy', 'name').lean();
    res.json({
      value: await getThresholds(),
      defaults: DEFAULT_THRESHOLDS,
      updatedAt: doc ? doc.updatedAt : null,
      updatedBy: doc && doc.updatedBy ? doc.updatedBy.name : null,
    });
  })
);

settings.put(
  '/thresholds',
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const before = await getThresholds();
    const { value, errors } = sanitizeThresholds(req.body);
    if (errors.length) throw new HttpError(400, errors.join('; '));
    await saveThresholds(value, req.user._id);
    const flat = (o, p = '') =>
      Object.entries(o).reduce((acc, [k, v]) => (v && typeof v === 'object' ? { ...acc, ...flat(v, `${p}${k}.`) } : { ...acc, [`${p}${k}`]: v }), {});
    await audit(req, { action: 'UPDATE', entity: 'Settings', entityId: 'thresholds', summary: 'Updated monitoring threshold rules', changes: diff(flat(before), flat(value)) });
    const monitoring = await runMonitoring();
    res.json({ value, monitoring });
  })
);

// ---- Monitoring engine ----
const monitoring = express.Router();

monitoring.post(
  '/run',
  authorize('ADMIN', 'FINANCE_OFFICER'),
  asyncHandler(async (req, res) => {
    const result = await runMonitoring();
    await audit(req, { action: 'MONITORING_RUN', entity: 'Monitoring', summary: `Manual scan: ${result.budgetsEvaluated} budgets, ${result.created} new alerts, ${result.autoResolved} auto-resolved` });
    res.json(result);
  })
);

monitoring.get(
  '/last-run',
  asyncHandler(async (req, res) => {
    const doc = await Setting.findOne({ key: 'monitoring.lastRun' }).lean();
    res.json(doc ? doc.value : null);
  })
);

// Called by Vercel Cron (see vercel.json). Protected by CRON_SECRET, not by user JWT.
const cron = asyncHandler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized');
  const result = await runMonitoring();
  await audit(req, { action: 'MONITORING_RUN', entity: 'Monitoring', summary: `Scheduled scan: ${result.budgetsEvaluated} budgets, ${result.created} new alerts` });
  res.json(result);
});

// ---- Audit logs ----
const auditLogs = express.Router();
auditLogs.use(authorize('ADMIN'));

auditLogs.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = {};
    const entity = str(req.query.entity, 40);
    if (entity) filter.entity = entity;
    const action = str(req.query.action, 40);
    if (action) filter.action = action;
    const q = str(req.query.q, 100);
    if (q) filter.$or = [{ summary: new RegExp(escapeRegex(q), 'i') }, { userName: new RegExp(escapeRegex(q), 'i') }];
    const from = parseDate(str(req.query.from));
    const to = parseDate(str(req.query.to));
    if (from || to) {
      filter.at = {};
      if (from) filter.at.$gte = from;
      if (to) filter.at.$lte = new Date(to.getTime() + DAY_MS - 1);
    }
    const { page, limit, skip } = pagination(req.query, 30);
    const [items, total, entities, actions] = await Promise.all([
      AuditLog.find(filter).sort({ at: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
      AuditLog.distinct('entity'),
      AuditLog.distinct('action'),
    ]);
    res.json({
      items: items.map((l) => ({ id: String(l._id), action: l.action, entity: l.entity, entityId: l.entityId, summary: l.summary, changes: l.changes, userName: l.userName, userRole: l.userRole, ip: l.ip, at: l.at })),
      total,
      page,
      limit,
      entities: entities.sort(),
      actions: actions.sort(),
    });
  })
);

module.exports = { settings, monitoring, cron, auditLogs };
