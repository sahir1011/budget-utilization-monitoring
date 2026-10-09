const express = require('express');
const mongoose = require('mongoose');
const { Expenditure, Alert } = require('../models');
const { HttpError, asyncHandler, str, isObjectId } = require('../utils/http');
const { departmentScope, assertDepartmentAccess } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { financialYearOf, isValidFinancialYear, fyMonthKeys, monthLabel, istDateString } = require('../utils/period');
const { rupeesToCrore } = require('../utils/money');
const { budgetsWithMetrics, byDepartment, summarize, monthlyTrend } = require('../services/analytics');
const { toCsv, toPdf } = require('../services/exporters');

const router = express.Router();

const cr = (rupees) => rupeesToCrore(rupees).toFixed(2);
const crIn = (rupees) => rupeesToCrore(rupees).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (date) => (date ? istDateString(date) : '');
const HEALTH_LABEL = { OVERSPENT: 'Overspent', UNDER_UTILIZED: 'Under-utilised', LAGGING: 'Lagging', AHEAD: 'Ahead of pace', ON_TRACK: 'On track' };

function readScope(req) {
  const fyIn = str(req.query.fy);
  const fy = fyIn && isValidFinancialYear(fyIn) ? fyIn : financialYearOf();
  const scope = { ...departmentScope(req.user) };
  const dept = str(req.query.department);
  if (dept && isObjectId(dept)) {
    assertDepartmentAccess(req.user, dept);
    scope.department = new mongoose.Types.ObjectId(dept);
  }
  return { fy, scope };
}

router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const { fy, scope } = readScope(req);
    const items = await budgetsWithMetrics({ ...scope, financialYear: fy });
    const summary = summarize(items);
    const trend = await monthlyTrend(scope, fy, summary.allocated);
    res.json({ financialYear: fy, summary, departments: byDepartment(items), trend });
  })
);

const REPORTS = {
  'department-summary': {
    title: 'Department-wise Financial Summary',
    async load({ fy, scope }) {
      const items = await budgetsWithMetrics({ ...scope, financialYear: fy });
      return { rows: byDepartment(items), total: summarize(items) };
    },
    columns: [
      { header: 'Code', width: 0.07, value: (r) => r.department.code },
      { header: 'Department', width: 0.27, value: (r) => r.department.name },
      { header: 'Budgets', width: 0.07, align: 'right', value: (r) => r.budgetCount },
      { header: 'Allocated (Rs Cr)', width: 0.13, align: 'right', value: (r) => crIn(r.allocated), csv: (r) => cr(r.allocated) },
      { header: 'Spent (Rs Cr)', width: 0.13, align: 'right', value: (r) => crIn(r.spent), csv: (r) => cr(r.spent) },
      { header: 'Balance (Rs Cr)', width: 0.13, align: 'right', value: (r) => crIn(r.remaining), csv: (r) => cr(r.remaining) },
      { header: 'Utilisation %', width: 0.1, align: 'right', value: (r) => r.utilization.toFixed(2) },
      { header: 'Avg risk', width: 0.1, align: 'right', value: (r) => r.avgRiskScore },
    ],
  },
  budgets: {
    title: 'Budget Utilisation Register',
    async load({ fy, scope }) {
      const items = await budgetsWithMetrics({ ...scope, financialYear: fy });
      return { rows: items, total: summarize(items) };
    },
    columns: [
      { header: 'Code', width: 0.12, value: (r) => r.code },
      { header: 'Budget head / scheme', width: 0.24, value: (r) => r.title },
      { header: 'Dept', width: 0.06, value: (r) => r.department.code },
      { header: 'Period', width: 0.07, value: (r) => (r.periodType === 'QUARTERLY' ? `Q${r.quarter}` : 'Annual') },
      { header: 'Allocated (Rs Cr)', width: 0.11, align: 'right', value: (r) => crIn(r.metrics.allocated), csv: (r) => cr(r.metrics.allocated) },
      { header: 'Spent (Rs Cr)', width: 0.11, align: 'right', value: (r) => crIn(r.metrics.spent), csv: (r) => cr(r.metrics.spent) },
      { header: 'Util %', width: 0.06, align: 'right', value: (r) => r.metrics.utilization.toFixed(2) },
      { header: 'Time %', width: 0.06, align: 'right', value: (r) => r.metrics.timeElapsed.toFixed(1) },
      { header: 'Status', width: 0.1, value: (r) => HEALTH_LABEL[r.metrics.health] },
      { header: 'Risk', width: 0.07, align: 'right', value: (r) => r.metrics.riskScore },
    ],
  },
  expenditures: {
    title: 'Expenditure Transactions',
    async load({ fy, scope }) {
      const rows = await Expenditure.find({ ...scope, financialYear: fy })
        .sort({ date: 1 })
        .limit(5000)
        .populate('budget', 'code')
        .populate('department', 'code')
        .lean();
      const amount = rows.reduce((a, r) => a + r.amount, 0);
      return { rows, total: { spent: amount, count: rows.length } };
    },
    columns: [
      { header: 'Txn ID', width: 0.13, value: (r) => r.txnId },
      { header: 'Date', width: 0.08, value: (r) => d(r.date) },
      { header: 'Dept', width: 0.06, value: (r) => (r.department ? r.department.code : '') },
      { header: 'Budget', width: 0.12, value: (r) => (r.budget ? r.budget.code : '') },
      { header: 'Category', width: 0.13, value: (r) => r.category },
      { header: 'Description', width: 0.25, value: (r) => r.description },
      { header: 'Reference', width: 0.11, value: (r) => r.referenceNo || '' },
      { header: 'Amount (Rs Cr)', width: 0.12, align: 'right', value: (r) => crIn(r.amount), csv: (r) => cr(r.amount) },
    ],
  },
  alerts: {
    title: 'Anomaly & Alert Register',
    async load({ fy, scope }) {
      const rows = await Alert.find({ ...scope, financialYear: fy }).sort({ detectedAt: -1 }).populate('department', 'code').populate('budget', 'code').lean();
      return { rows, total: { count: rows.length, open: rows.filter((r) => r.status !== 'RESOLVED').length } };
    },
    columns: [
      { header: 'Alert ID', width: 0.09, value: (r) => r.alertId },
      { header: 'Detected', width: 0.08, value: (r) => d(r.detectedAt) },
      { header: 'Dept', width: 0.06, value: (r) => (r.department ? r.department.code : '') },
      { header: 'Budget', width: 0.12, value: (r) => (r.budget ? r.budget.code : '') },
      { header: 'Type', width: 0.11, value: (r) => r.type.replace(/_/g, ' ') },
      { header: 'Severity', width: 0.07, value: (r) => r.severity },
      { header: 'Status', width: 0.09, value: (r) => r.status },
      { header: 'Details', width: 0.38, value: (r) => r.message.replace(/₹/g, 'Rs') },
    ],
  },
  'monthly-trend': {
    title: 'Monthly Expenditure Trend',
    async load({ fy, scope }) {
      const items = await budgetsWithMetrics({ ...scope, financialYear: fy });
      const total = summarize(items);
      return { rows: await monthlyTrend(scope, fy, total.allocated), total };
    },
    columns: [
      { header: 'Month', width: 0.16, value: (r) => r.label },
      { header: 'Transactions', width: 0.14, align: 'right', value: (r) => r.transactions },
      { header: 'Spent (Rs Cr)', width: 0.2, align: 'right', value: (r) => crIn(r.spent), csv: (r) => cr(r.spent) },
      { header: 'Cumulative (Rs Cr)', width: 0.2, align: 'right', value: (r) => crIn(r.cumulative), csv: (r) => cr(r.cumulative) },
      { header: 'Cumulative %', width: 0.15, align: 'right', value: (r) => r.cumulativePct.toFixed(2) },
      { header: 'Linear target %', width: 0.15, align: 'right', value: (r) => r.idealPct.toFixed(2) },
    ],
  },
};

router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const type = str(req.query.type);
    const format = str(req.query.format) === 'pdf' ? 'pdf' : 'csv';
    const report = REPORTS[type];
    if (!report) throw new HttpError(400, `Unknown report type. Use one of: ${Object.keys(REPORTS).join(', ')}`);
    const { fy, scope } = readScope(req);
    const { rows, total } = await report.load({ fy, scope });
    const filename = `${type}-${fy}.${format}`;

    await audit(req, { action: 'EXPORT', entity: 'Report', entityId: type, summary: `Exported ${report.title} (${fy}) as ${format.toUpperCase()}` });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(toCsv(report.columns, rows));
    }
    const summaryLines = [];
    if (total.allocated !== undefined) {
      summaryLines.push(`Allocated: Rs ${crIn(total.allocated)} Cr    Spent: Rs ${crIn(total.spent)} Cr    Balance: Rs ${crIn(total.remaining)} Cr    Utilisation: ${total.utilization.toFixed(2)}%`);
    } else if (total.spent !== undefined) {
      summaryLines.push(`${total.count} transactions totalling Rs ${crIn(total.spent)} Cr`);
    } else if (total.count !== undefined) {
      summaryLines.push(`${total.count} alerts (${total.open} unresolved)`);
    }
    const scopeLabel = req.user.role === 'DEPARTMENT_HEAD' ? req.user.department.name : scope.department ? 'Selected department' : 'All departments';
    const pdf = await toPdf(report.columns, rows, {
      title: report.title,
      subtitle: `Financial Year ${fy}  •  ${scopeLabel}  •  Amounts in Rs crore`,
      generatedBy: `${req.user.name} (${req.user.role.replace(/_/g, ' ')})`,
      summaryLines,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdf);
  })
);

module.exports = { router, fyMonthKeys, monthLabel };
