export type Role = 'ADMIN' | 'FINANCE_OFFICER' | 'DEPARTMENT_HEAD';
export type Health = 'OVERSPENT' | 'UNDER_UTILIZED' | 'LAGGING' | 'AHEAD' | 'ON_TRACK';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AlertType = 'UNDER_UTILIZATION' | 'OVERSPENDING' | 'SPIKE' | 'INACTIVITY' | 'PACE_DEVIATION';

export interface DeptRef { id: string; code: string; name: string }

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  department: DeptRef | null;
  active?: boolean;
  lastLoginAt?: string;
  createdAt?: string;
}

export interface Metrics {
  allocated: number;
  spent: number;
  remaining: number;
  utilization: number;
  timeElapsed: number;
  paceGap: number;
  projectedUtilization: number;
  projectedSpend: number;
  burnRatePerDay: number;
  daysElapsed: number;
  totalDays: number;
  transactionCount: number;
  lastExpenditureDate: string | null;
  daysSinceLastActivity: number;
  health: Health;
  riskScore: number;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
}

export interface Budget {
  id: string;
  code: string;
  title: string;
  department: DeptRef;
  financialYear: string;
  periodType: 'ANNUAL' | 'QUARTERLY';
  quarter?: number;
  periodStart: string;
  periodEnd: string;
  allocatedAmount: number;
  allocationDate: string;
  expenditureType: 'REVENUE' | 'CAPITAL';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  description?: string;
  source?: string;
  priorYear?: { budgetEstimate?: number; revisedEstimate?: number };
  metrics: Metrics;
  createdBy?: string | null;
}

export interface TrendPoint {
  month: string;
  label: string;
  spent: number;
  transactions: number;
  cumulative: number;
  cumulativePct: number;
  idealPct: number;
}

export interface CategorySlice { category: string; spent: number; count: number; share: number }

export interface DocRef { id: string; filename: string; size: number; mimeType: string }

export interface Expenditure {
  id: string;
  txnId: string;
  budget: { id: string; code: string; title: string };
  department: DeptRef;
  financialYear: string;
  amount: number;
  category: string;
  date: string;
  description: string;
  payee?: string;
  referenceNo?: string;
  documents: DocRef[];
  createdBy: string | null;
  createdAt: string;
}

export interface Alert {
  id: string;
  alertId: string;
  type: AlertType;
  severity: Severity;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  title: string;
  message: string;
  metrics?: Record<string, unknown>;
  financialYear?: string;
  department: DeptRef;
  budget?: { id: string; code: string; title: string };
  expenditure?: { id: string; txnId: string };
  detectedAt: string;
  lastDetectedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string | null;
  resolvedAt?: string;
  resolvedBy?: string | null;
  autoResolved?: boolean;
  resolutionNote?: string;
  notes: { text: string; by: string | null; at: string }[];
}

export interface AlertStats {
  open: number;
  totalDetected: number;
  bySeverity: Record<Severity, number>;
  byType: Partial<Record<AlertType, number>>;
  avgResponseHours: number | null;
  acknowledgedCount: number;
}

export interface Summary { allocated: number; spent: number; remaining: number; utilization: number; budgetCount: number }

export interface DeptSummary extends Summary {
  department: DeptRef;
  overspentCount: number;
  underUtilizedCount: number;
  avgRiskScore: number;
}

export interface Paged<T> { items: T[]; total: number; page: number; limit: number }

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Administrator',
  FINANCE_OFFICER: 'Finance Officer',
  DEPARTMENT_HEAD: 'Department Head',
};

export const HEALTH_LABELS: Record<Health, string> = {
  OVERSPENT: 'Overspent',
  UNDER_UTILIZED: 'Under-utilised',
  LAGGING: 'Lagging',
  AHEAD: 'Ahead of pace',
  ON_TRACK: 'On track',
};

export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  UNDER_UTILIZATION: 'Under-utilisation',
  OVERSPENDING: 'Overspending',
  SPIKE: 'Spending spike',
  INACTIVITY: 'Dormant funds',
  PACE_DEVIATION: 'Pace deviation',
};

export const EXPENSE_CATEGORIES = [
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
