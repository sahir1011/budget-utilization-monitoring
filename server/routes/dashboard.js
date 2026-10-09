const express = require('express');
const { Alert, Setting } = require('../models');
const { asyncHandler, str } = require('../utils/http');
const { departmentScope } = require('../middleware/auth');
const { financialYearOf, isValidFinancialYear } = require('../utils/period');
const { budgetsWithMetrics, summarize, byDepartment, monthlyTrend, categoryBreakdown, alertStats, fyTimeElapsed } = require('../services/analytics');

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const fyIn = str(req.query.fy);
    const fy = fyIn && isValidFinancialYear(fyIn) ? fyIn : financialYearOf();
    const scope = departmentScope(req.user);
    const items = await budgetsWithMetrics({ ...scope, financialYear: fy });
    const summary = summarize(items);

    const [trend, categories, alerts, recentAlerts, lastRun] = await Promise.all([
      monthlyTrend(scope, fy, summary.allocated),
      categoryBreakdown({ ...scope, financialYear: fy }),
      alertStats(scope),
      Alert.find({ ...scope, status: { $ne: 'RESOLVED' } })
        .sort({ lastDetectedAt: -1 })
        .limit(8)
        .populate('department', 'code name')
        .populate('budget', 'code title')
        .lean(),
      Setting.findOne({ key: 'monitoring.lastRun' }).lean(),
    ]);

    const slim = (b) => ({
      id: String(b._id),
      code: b.code,
      title: b.title,
      department: { code: b.department.code, name: b.department.name },
      allocated: b.metrics.allocated,
      spent: b.metrics.spent,
      utilization: b.metrics.utilization,
      timeElapsed: b.metrics.timeElapsed,
      riskScore: b.metrics.riskScore,
      riskLevel: b.metrics.riskLevel,
      health: b.metrics.health,
      projectedUtilization: b.metrics.projectedUtilization,
    });
    const health = items.reduce((acc, b) => ((acc[b.metrics.health] = (acc[b.metrics.health] || 0) + 1), acc), {});

    res.json({
      financialYear: fy,
      timeElapsed: fyTimeElapsed(fy),
      summary,
      health,
      byDepartment: byDepartment(items),
      trend,
      categories,
      alerts,
      topRisk: [...items].sort((a, b) => b.metrics.riskScore - a.metrics.riskScore).slice(0, 8).map(slim),
      underUtilized: items
        .filter((b) => ['UNDER_UTILIZED', 'LAGGING'].includes(b.metrics.health))
        .sort((a, b) => b.metrics.remaining - a.metrics.remaining)
        .slice(0, 6)
        .map(slim),
      recentAlerts: recentAlerts.map((a) => ({
        id: String(a._id),
        alertId: a.alertId,
        type: a.type,
        severity: a.severity,
        status: a.status,
        title: a.title,
        message: a.message,
        department: a.department ? a.department.code : null,
        budget: a.budget ? { id: String(a.budget._id), code: a.budget.code } : null,
        detectedAt: a.detectedAt,
      })),
      lastMonitoringRun: lastRun ? lastRun.value : null,
    });
  })
);

module.exports = router;
