const mongoose = require('mongoose');
const { Schema } = mongoose;

const ROLES = ['ADMIN', 'FINANCE_OFFICER', 'DEPARTMENT_HEAD'];
const ALERT_TYPES = ['UNDER_UTILIZATION', 'OVERSPENDING', 'SPIKE', 'INACTIVITY', 'PACE_DEVIATION'];
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const EXPENSE_CATEGORIES = [
  'Salaries & Wages',
  'Pensions',
  'Capital Works',
  'Procurement',
  'Grants-in-Aid to States',
  'Direct Benefit Transfer',
  'Subsidy',
  'Maintenance & Operations',
  'Grants to Institutions',
  'Administrative Expenses',
  'Other',
];

// ---------- Counter (human-readable sequential IDs) ----------
const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

async function nextSequence(name, inc = 1) {
  const doc = await Counter.findByIdAndUpdate(name, { $inc: { seq: inc } }, { new: true, upsert: true });
  return doc.seq;
}

// ---------- Department ----------
const departmentSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 12 },
    name: { type: String, required: true, unique: true, trim: true, maxlength: 150 },
    description: { type: String, trim: true, maxlength: 1000 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// ---------- User ----------
const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, maxlength: 160 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
  },
  { timestamps: true }
);
userSchema.pre('validate', function (next) {
  if (this.role === 'DEPARTMENT_HEAD' && !this.department) {
    this.invalidate('department', 'Department is required for Department Heads');
  }
  next();
});

// ---------- Budget ----------
const revisionSchema = new Schema(
  {
    previousAmount: Number,
    newAmount: Number,
    reason: String,
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const budgetSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 40 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    financialYear: { type: String, required: true, match: /^\d{4}-\d{2}$/, index: true },
    periodType: { type: String, enum: ['ANNUAL', 'QUARTERLY'], default: 'ANNUAL' },
    quarter: { type: Number, min: 1, max: 4 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    allocatedAmount: { type: Number, required: true, min: 1 }, // rupees
    allocationDate: { type: Date, required: true },
    expenditureType: { type: String, enum: ['REVENUE', 'CAPITAL'], default: 'REVENUE' },
    status: { type: String, enum: ['ACTIVE', 'FROZEN', 'CLOSED'], default: 'ACTIVE', index: true },
    description: { type: String, trim: true, maxlength: 2000 },
    source: { type: String, trim: true, maxlength: 500 }, // citation for the allocation figure
    priorYear: {
      budgetEstimate: Number, // rupees
      revisedEstimate: Number, // rupees
    },
    revisions: [revisionSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
budgetSchema.pre('validate', function (next) {
  if (this.periodType === 'QUARTERLY' && !this.quarter) this.invalidate('quarter', 'Quarter is required for quarterly budgets');
  if (this.periodType === 'ANNUAL') this.quarter = undefined;
  if (this.allocatedAmount !== undefined && !Number.isSafeInteger(this.allocatedAmount)) {
    this.invalidate('allocatedAmount', 'Allocated amount must be a whole number of rupees');
  }
  next();
});

// ---------- Document (supporting evidence, stored in MongoDB for serverless portability) ----------
const documentSchema = new Schema(
  {
    filename: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    data: { type: Buffer, required: true, select: false },
    expenditure: { type: Schema.Types.ObjectId, ref: 'Expenditure', index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department' },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ---------- Expenditure ----------
const expenditureSchema = new Schema(
  {
    txnId: { type: String, required: true, unique: true },
    budget: { type: Schema.Types.ObjectId, ref: 'Budget', required: true, index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    financialYear: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 1 }, // rupees
    category: { type: String, enum: EXPENSE_CATEGORIES, required: true },
    date: { type: Date, required: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    payee: { type: String, trim: true, maxlength: 200 },
    referenceNo: { type: String, trim: true, maxlength: 120 }, // sanction order / bill reference
    documents: [{ type: Schema.Types.ObjectId, ref: 'Document' }],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);
expenditureSchema.index({ budget: 1, date: 1 });
expenditureSchema.pre('validate', function (next) {
  if (this.amount !== undefined && !Number.isSafeInteger(this.amount)) {
    this.invalidate('amount', 'Amount must be a whole number of rupees');
  }
  next();
});

// ---------- Alert ----------
const alertSchema = new Schema(
  {
    alertId: { type: String, required: true, unique: true },
    key: { type: String, required: true, index: true }, // dedupe key e.g. UNDER_UTILIZATION:<budgetId>
    type: { type: String, enum: ALERT_TYPES, required: true, index: true },
    severity: { type: String, enum: SEVERITIES, required: true, index: true },
    status: { type: String, enum: ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'], default: 'OPEN', index: true },
    department: { type: Schema.Types.ObjectId, ref: 'Department', required: true, index: true },
    budget: { type: Schema.Types.ObjectId, ref: 'Budget', index: true },
    expenditure: { type: Schema.Types.ObjectId, ref: 'Expenditure' },
    financialYear: String,
    title: { type: String, required: true },
    message: { type: String, required: true },
    metrics: { type: Schema.Types.Mixed },
    detectedAt: { type: Date, default: Date.now },
    lastDetectedAt: { type: Date, default: Date.now },
    acknowledgedAt: Date,
    acknowledgedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    autoResolved: { type: Boolean, default: false },
    resolutionNote: { type: String, maxlength: 1000 },
    notes: [
      {
        text: { type: String, maxlength: 1000 },
        by: { type: Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date, default: Date.now },
        _id: false,
      },
    ],
  },
  { timestamps: true }
);

// ---------- Settings (threshold rules) ----------
const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ---------- Audit Log ----------
const auditLogSchema = new Schema(
  {
    action: { type: String, required: true, index: true }, // CREATE, UPDATE, DELETE, LOGIN, ...
    entity: { type: String, required: true, index: true }, // Budget, Expenditure, ...
    entityId: { type: String, index: true },
    summary: String,
    changes: Schema.Types.Mixed, // { field: { from, to } }
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: String,
    userRole: String,
    ip: String,
    at: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

const model = (name, schema) => mongoose.models[name] || mongoose.model(name, schema);

module.exports = {
  ROLES,
  ALERT_TYPES,
  SEVERITIES,
  EXPENSE_CATEGORIES,
  nextSequence,
  Counter,
  Department: model('Department', departmentSchema),
  User: model('User', userSchema),
  Budget: model('Budget', budgetSchema),
  Document: model('Document', documentSchema),
  Expenditure: model('Expenditure', expenditureSchema),
  Alert: model('Alert', alertSchema),
  Setting: model('Setting', settingSchema),
  AuditLog: model('AuditLog', auditLogSchema),
};
