const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const { Budget, Expenditure, Document, EXPENSE_CATEGORIES, nextSequence } = require('../models');
const { HttpError, asyncHandler, str, isObjectId, escapeRegex, pagination } = require('../utils/http');
const { authorize, departmentScope, assertDepartmentAccess } = require('../middleware/auth');
const { audit } = require('../utils/audit');
const { isValidAmount, formatCrore } = require('../utils/money');
const { isValidFinancialYear, DAY_MS, istDateString } = require('../utils/period');
const { parseDate } = require('../utils/validators');
const { monitorBudgetsSafely } = require('../services/monitoring');

const router = express.Router();

const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_FILE_BYTES = 2 * 1024 * 1024; // Vercel functions cap request bodies at 4.5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 3 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) cb(null, true);
    else cb(new HttpError(400, `Unsupported file type: ${file.originalname}. Allowed: PDF, PNG, JPG, CSV, XLS(X), DOCX`));
  },
});

function handleUpload(req, res, next) {
  upload.array('documents', 3)(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(new HttpError(400, err.code === 'LIMIT_FILE_SIZE' ? 'Each document must be 2 MB or smaller' : err.message));
    }
    next(err);
  });
}

const view = (e) => ({
  id: String(e._id),
  txnId: e.txnId,
  budget: e.budget && e.budget.code ? { id: String(e.budget._id), code: e.budget.code, title: e.budget.title } : e.budget,
  department: e.department && e.department.code ? { id: String(e.department._id), code: e.department.code, name: e.department.name } : e.department,
  financialYear: e.financialYear,
  amount: e.amount,
  category: e.category,
  date: e.date,
  description: e.description,
  payee: e.payee,
  referenceNo: e.referenceNo,
  documents: (e.documents || []).map((d) => (d && d.filename ? { id: String(d._id), filename: d.filename, size: d.size, mimeType: d.mimeType } : d)),
  createdBy: e.createdBy && e.createdBy.name ? e.createdBy.name : null,
  createdAt: e.createdAt,
});

function safeFilename(name) {
  return String(name || 'document').replace(/[^\w.\- ()]/g, '_').slice(0, 200);
}

async function storeDocuments(files, expenditure, user) {
  const ids = [];
  for (const f of files || []) {
    const doc = await Document.create({
      filename: safeFilename(f.originalname),
      mimeType: f.mimetype,
      size: f.size,
      data: f.buffer,
      expenditure: expenditure._id,
      department: expenditure.department,
      uploadedBy: user._id,
    });
    ids.push(doc._id);
  }
  return ids;
}

function readFields(body, { partial }) {
  const out = {};
  if (body.amount !== undefined || !partial) {
    const amount = Number(body.amount);
    if (!isValidAmount(amount)) throw new HttpError(400, 'Amount must be a positive whole number of rupees');
    out.amount = amount;
  }
  if (body.category !== undefined || !partial) {
    out.category = str(body.category);
    if (!EXPENSE_CATEGORIES.includes(out.category)) throw new HttpError(400, 'Invalid expense category');
  }
  if (body.date !== undefined || !partial) {
    out.date = parseDate(body.date);
    if (!out.date) throw new HttpError(400, 'A valid transaction date is required');
  }
  if (body.description !== undefined || !partial) {
    out.description = str(body.description, 500);
    if (!out.description) throw new HttpError(400, 'Description is required');
  }
  if (body.payee !== undefined) out.payee = str(body.payee, 200);
  if (body.referenceNo !== undefined) out.referenceNo = str(body.referenceNo, 120);
  return out;
}

function assertDateInPeriod(date, budget) {
  if (date < budget.periodStart || date > budget.periodEnd) {
    throw new HttpError(400, `Transaction date must fall within the budget period (${istDateString(budget.periodStart)} to ${istDateString(budget.periodEnd)})`);
  }
  if (date.getTime() > Date.now() + DAY_MS) throw new HttpError(400, 'Transaction date cannot be in the future');
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = { ...departmentScope(req.user) };
    const fy = str(req.query.fy);
    if (fy && isValidFinancialYear(fy)) filter.financialYear = fy;
    const dept = str(req.query.department);
    if (dept && isObjectId(dept)) {
      assertDepartmentAccess(req.user, dept);
      filter.department = new mongoose.Types.ObjectId(dept);
    }
    const budget = str(req.query.budget);
    if (budget && isObjectId(budget)) filter.budget = new mongoose.Types.ObjectId(budget);
    const category = str(req.query.category);
    if (category && EXPENSE_CATEGORIES.includes(category)) filter.category = category;
    const from = parseDate(str(req.query.from));
    const to = parseDate(str(req.query.to));
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = from;
      if (to) filter.date.$lte = new Date(to.getTime() + DAY_MS - 1);
    }
    const q = str(req.query.q, 100);
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ description: re }, { txnId: re }, { payee: re }, { referenceNo: re }];
    }
    if (filter.department && typeof filter.department === 'string') filter.department = new mongoose.Types.ObjectId(filter.department);

    const { page, limit, skip } = pagination(req.query);
    const [items, total, sums] = await Promise.all([
      Expenditure.find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('budget', 'code title')
        .populate('department', 'code name')
        .populate('documents', 'filename size mimeType')
        .populate('createdBy', 'name')
        .lean(),
      Expenditure.countDocuments(filter),
      Expenditure.aggregate([{ $match: filter }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
    ]);
    res.json({ items: items.map(view), total, page, limit, totalAmount: sums[0] ? sums[0].amount : 0 });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const e = await Expenditure.findById(req.params.id)
      .populate('budget', 'code title')
      .populate('department', 'code name')
      .populate('documents', 'filename size mimeType')
      .populate('createdBy', 'name')
      .lean();
    if (!e) throw new HttpError(404, 'Expenditure not found');
    assertDepartmentAccess(req.user, e.department._id);
    res.json(view(e));
  })
);

router.post(
  '/',
  handleUpload,
  asyncHandler(async (req, res) => {
    const budgetId = str(req.body.budget);
    if (!isObjectId(budgetId)) throw new HttpError(400, 'A valid budget is required');
    const budget = await Budget.findById(budgetId);
    if (!budget) throw new HttpError(404, 'Budget not found');
    assertDepartmentAccess(req.user, budget.department);
    if (budget.status !== 'ACTIVE' && req.user.role !== 'ADMIN') {
      throw new HttpError(409, `Budget is ${budget.status.toLowerCase()}; expenditure cannot be recorded against it`);
    }
    const fields = readFields(req.body, { partial: false });
    assertDateInPeriod(fields.date, budget);

    const seq = await nextSequence('txn');
    const exp = new Expenditure({
      ...fields,
      txnId: `TXN-${budget.financialYear.replace('-', '')}-${String(seq).padStart(6, '0')}`,
      budget: budget._id,
      department: budget.department,
      financialYear: budget.financialYear,
      createdBy: req.user._id,
    });
    exp.documents = await storeDocuments(req.files, exp, req.user);
    await exp.save();
    await audit(req, {
      action: 'CREATE',
      entity: 'Expenditure',
      entityId: exp._id,
      summary: `Recorded ${exp.txnId} of ${formatCrore(exp.amount)} against ${budget.code}`,
      after: exp.toObject(),
    });
    const monitoring = await monitorBudgetsSafely([budget._id]);
    res.status(201).json({ ...view(exp.toObject()), monitoring });
  })
);

router.post(
  '/:id/documents',
  handleUpload,
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const exp = await Expenditure.findById(req.params.id);
    if (!exp) throw new HttpError(404, 'Expenditure not found');
    assertDepartmentAccess(req.user, exp.department);
    if (!req.files || !req.files.length) throw new HttpError(400, 'No files uploaded');
    if (exp.documents.length + req.files.length > 5) throw new HttpError(400, 'A transaction can hold at most 5 documents');
    const ids = await storeDocuments(req.files, exp, req.user);
    exp.documents.push(...ids);
    await exp.save();
    await audit(req, { action: 'UPLOAD', entity: 'Expenditure', entityId: exp._id, summary: `Attached ${ids.length} document(s) to ${exp.txnId}` });
    res.status(201).json({ added: ids.length });
  })
);

router.patch(
  '/:id',
  authorize('ADMIN', 'FINANCE_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const exp = await Expenditure.findById(req.params.id);
    if (!exp) throw new HttpError(404, 'Expenditure not found');
    const budget = await Budget.findById(exp.budget);
    if (budget.status === 'CLOSED' && req.user.role !== 'ADMIN') throw new HttpError(409, 'Expenditure on a closed budget can only be corrected by an Admin');
    const before = exp.toObject();
    const fields = readFields(req.body, { partial: true });
    if (fields.date) assertDateInPeriod(fields.date, budget);
    Object.assign(exp, fields);
    await exp.save();
    await audit(req, { action: 'UPDATE', entity: 'Expenditure', entityId: exp._id, summary: `Updated ${exp.txnId}`, before, after: exp.toObject() });
    await monitorBudgetsSafely([exp.budget]);
    res.json(view(exp.toObject()));
  })
);

router.delete(
  '/:id',
  authorize('ADMIN', 'FINANCE_OFFICER'),
  asyncHandler(async (req, res) => {
    if (!isObjectId(req.params.id)) throw new HttpError(400, 'Invalid id');
    const exp = await Expenditure.findById(req.params.id);
    if (!exp) throw new HttpError(404, 'Expenditure not found');
    await Document.deleteMany({ expenditure: exp._id });
    await exp.deleteOne();
    await audit(req, { action: 'DELETE', entity: 'Expenditure', entityId: exp._id, summary: `Deleted ${exp.txnId} (${formatCrore(exp.amount)})`, before: exp.toObject() });
    await monitorBudgetsSafely([exp.budget]);
    res.json({ message: 'Expenditure deleted' });
  })
);

module.exports = { router, EXPENSE_CATEGORIES };
