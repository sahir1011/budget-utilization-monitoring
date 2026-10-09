import { Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { CategorySlice, DeptSummary, Health, HEALTH_LABELS, Severity, Summary, TrendPoint, AlertStats, AlertType } from '../core/models';
import { CompactPipe, CrorePipe, PctPipe, RUPEES_PER_CRORE, formatCrore } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { ChartComponent, PALETTE } from '../shared/chart.component';
import { WIDGETS } from '../shared/widgets';

interface SlimBudget {
  id: string; code: string; title: string; department: { code: string; name: string };
  allocated: number; spent: number; utilization: number; timeElapsed: number; riskScore: number; riskLevel: string; health: Health; projectedUtilization: number;
}
interface Dashboard {
  financialYear: string;
  timeElapsed: number;
  summary: Summary;
  health: Partial<Record<Health, number>>;
  byDepartment: DeptSummary[];
  trend: TrendPoint[];
  categories: CategorySlice[];
  alerts: AlertStats;
  topRisk: SlimBudget[];
  underUtilized: SlimBudget[];
  recentAlerts: { id: string; alertId: string; type: AlertType; severity: Severity; status: string; title: string; message: string; department: string; budget: { id: string; code: string } | null; detectedAt: string }[];
  lastMonitoringRun: { at: string; budgetsEvaluated: number; created: number } | null;
}

const crore = (r: number) => Math.round((r / RUPEES_PER_CRORE) * 100) / 100;

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, CrorePipe, CompactPipe, PctPipe, ChartComponent, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Financial overview · FY {{ fy.selected() }}</h1>
        <p>
          {{ auth.isDeptHead() ? auth.user()?.department?.name : 'All departments' }}
          @if (data(); as d) {
            · {{ d.timeElapsed | pct }} of the financial year elapsed
            @if (d.lastMonitoringRun) { · last full scan {{ d.lastMonitoringRun.at | date: 'd MMM, h:mm a' }} }
          }
        </p>
      </div>
      @if (auth.canManageBudgets()) {
        <button class="btn btn-outline" (click)="runScan()" [disabled]="scanning()">{{ scanning() ? 'Scanning…' : '⟳ Run monitoring scan' }}</button>
      }
      <a class="btn btn-primary" routerLink="/expenditures/new">+ Record expenditure</a>
    </div>

    @if (loading() && !data()) {
      <app-loading />
    } @else if (error()) {
      <div class="banner error">{{ error() }}</div>
    } @else if (data(); as d) {
      @if (!d.summary.budgetCount) {
        <div class="card"><app-empty text="No budgets allocated for this financial year yet." /></div>
      } @else {
        <div class="grid kpis">
          <div class="card kpi accent">
            <div class="k-label">Total allocation</div>
            <div class="k-value">{{ d.summary.allocated | compact }}</div>
            <div class="k-sub">{{ d.summary.budgetCount }} budget heads · {{ d.byDepartment.length }} departments</div>
          </div>
          <div class="card kpi ok">
            <div class="k-label">Expenditure to date</div>
            <div class="k-value">{{ d.summary.spent | compact }}</div>
            <div class="k-sub">Balance {{ d.summary.remaining | compact }}</div>
          </div>
          <div class="card kpi" [class.warn]="d.summary.utilization < d.timeElapsed - 15" [class.ok]="d.summary.utilization >= d.timeElapsed - 15">
            <div class="k-label">Utilisation</div>
            <div class="k-value">{{ d.summary.utilization | pct: 2 }}</div>
            <div style="margin-top: 8px"><app-util-bar [value]="d.summary.utilization" [time]="d.timeElapsed" [showLabel]="false" /></div>
            <div class="k-sub">vs {{ d.timeElapsed | pct }} time elapsed</div>
          </div>
          <div class="card kpi danger">
            <div class="k-label">Open alerts</div>
            <div class="k-value">{{ d.alerts.open }}</div>
            <div class="k-sub">
              <span class="badge s-CRITICAL">{{ d.alerts.bySeverity.CRITICAL }} critical</span>
              <span class="badge s-HIGH">{{ d.alerts.bySeverity.HIGH }} high</span>
            </div>
          </div>
          <div class="card kpi">
            <div class="k-label">Avg. alert response</div>
            <div class="k-value">{{ d.alerts.avgResponseHours === null ? '—' : d.alerts.avgResponseHours + ' h' }}</div>
            <div class="k-sub">{{ d.alerts.acknowledgedCount }} acknowledged of {{ d.alerts.totalDetected }} detected</div>
          </div>
        </div>

        <div class="grid cols-3 mt">
          <div class="card">
            <div class="card-head"><h2>Allocation vs expenditure by department</h2><span class="muted small">₹ crore</span></div>
            <div class="card-body"><app-chart type="bar" [data]="deptChart()" [options]="deptChartOptions" [height]="320" /></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Budget health</h2></div>
            <div class="card-body"><app-chart type="doughnut" [data]="healthChart()" [options]="doughnutOptions" [height]="320" /></div>
          </div>
        </div>

        <div class="grid cols-3 mt">
          <div class="card">
            <div class="card-head"><h2>Cumulative utilisation vs linear target</h2><span class="muted small">% of allocation</span></div>
            <div class="card-body"><app-chart type="line" [data]="trendChart()" [options]="trendOptions" [height]="280" /></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Spend by category</h2></div>
            <div class="card-body"><app-chart type="pie" [data]="categoryChart()" [options]="doughnutOptions" [height]="280" /></div>
          </div>
        </div>

        <div class="grid cols-2 mt">
          <div class="card">
            <div class="card-head"><h2>Highest-risk budget heads</h2><a routerLink="/budgets" class="small">View all →</a></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Budget</th><th>Utilisation</th><th>Status</th><th class="text-right">Risk</th></tr></thead>
                <tbody>
                  @for (b of d.topRisk; track b.id) {
                    <tr>
                      <td class="title-cell"><a [routerLink]="['/budgets', b.id]">{{ b.title }}</a><div class="sub">{{ b.department.code }} · {{ b.allocated | compact }}</div></td>
                      <td><app-util-bar [value]="b.utilization" [time]="b.timeElapsed" /></td>
                      <td><app-health [value]="b.health" /></td>
                      <td class="text-right"><app-risk [value]="b.riskScore" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Recent alerts</h2><a routerLink="/alerts" class="small">Open alert centre →</a></div>
            @if (!d.recentAlerts.length) {
              <app-empty text="No open alerts. All monitored budgets are within thresholds." />
            }
            @for (a of d.recentAlerts; track a.id) {
              <div class="alert-item">
                <div class="bar" [class]="'bar bar-' + a.severity"></div>
                <div class="body">
                  <div class="title">{{ a.title }}</div>
                  <div class="msg small">{{ a.message }}</div>
                  <div class="meta"><app-sev [value]="a.severity" /><app-alert-type [value]="a.type" /><span>{{ a.department }}</span><span>{{ a.detectedAt | date: 'd MMM y' }}</span></div>
                </div>
              </div>
            }
          </div>
        </div>

        @if (d.underUtilized.length) {
          <div class="card mt">
            <div class="card-head"><h2>Idle & lagging funds</h2><span class="muted small">Largest unspent balances on under-utilised or lagging heads</span></div>
            <div class="table-wrap">
              <table class="table">
                <thead><tr><th>Budget</th><th>Dept</th><th class="num">Allocated</th><th class="num">Unspent</th><th>Utilisation vs time</th><th>Status</th></tr></thead>
                <tbody>
                  @for (b of d.underUtilized; track b.id) {
                    <tr>
                      <td class="title-cell"><a [routerLink]="['/budgets', b.id]">{{ b.title }}</a></td>
                      <td>{{ b.department.code }}</td>
                      <td class="num">{{ b.allocated | crore }}</td>
                      <td class="num">{{ b.allocated - b.spent | crore }}</td>
                      <td><app-util-bar [value]="b.utilization" [time]="b.timeElapsed" /></td>
                      <td><app-health [value]="b.health" /></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }
    }
  `,
})
export class DashboardPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  fy = inject(FyService);

  data = signal<Dashboard | null>(null);
  loading = signal(true);
  error = signal('');
  scanning = signal(false);

  constructor() {
    effect(() => {
      const fy = this.fy.selected();
      this.load(fy);
    });
  }

  async load(fy: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get<Dashboard>('/dashboard', { fy }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async runScan() {
    this.scanning.set(true);
    try {
      const r = await this.api.post<{ budgetsEvaluated: number; created: number; autoResolved: number }>('/monitoring/run');
      this.toast.success(`Scan complete: ${r.budgetsEvaluated} budgets evaluated, ${r.created} new alerts, ${r.autoResolved} auto-resolved.`);
      await this.load(this.fy.selected());
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.scanning.set(false);
    }
  }

  deptChart = computed<ChartConfiguration['data']>(() => {
    const d = this.data();
    const rows = d ? d.byDepartment : [];
    return {
      labels: rows.map((r) => r.department.code),
      datasets: [
        { label: 'Allocated', data: rows.map((r) => crore(r.allocated)), backgroundColor: '#c7d7fe', borderRadius: 4 },
        { label: 'Spent', data: rows.map((r) => crore(r.spent)), backgroundColor: '#1d4ed8', borderRadius: 4 },
      ],
    };
  });
  deptChartOptions: ChartConfiguration['options'] = {
    plugins: {
      tooltip: {
        callbacks: {
          title: (items) => this.data()?.byDepartment[items[0].dataIndex]?.department.name ?? '',
          label: (ctx) => `${ctx.dataset.label}: ${formatCrore((ctx.parsed.y ?? 0) * RUPEES_PER_CRORE)}`,
          afterBody: (items) => {
            const r = this.data()?.byDepartment[items[0].dataIndex];
            return r ? `Utilisation: ${r.utilization.toFixed(2)}%` : '';
          },
        },
      },
    },
    scales: { y: { ticks: { callback: (v) => Number(v).toLocaleString('en-IN') } } },
  };

  healthChart = computed<ChartConfiguration['data']>(() => {
    const h = this.data()?.health || {};
    const keys: Health[] = ['ON_TRACK', 'AHEAD', 'LAGGING', 'UNDER_UTILIZED', 'OVERSPENT'];
    const colors = ['#10b981', '#8b5cf6', '#f59e0b', '#f97316', '#ef4444'];
    return {
      labels: keys.map((k) => HEALTH_LABELS[k]),
      datasets: [{ data: keys.map((k) => h[k] || 0), backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
    };
  });

  trendChart = computed<ChartConfiguration['data']>(() => {
    const t = this.data()?.trend || [];
    const now = new Date();
    const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastActual = t.findIndex((p) => p.month === currentKey);
    return {
      labels: t.map((p) => p.label),
      datasets: [
        {
          label: 'Actual cumulative %',
          data: t.map((p, i) => (lastActual === -1 || i <= lastActual ? p.cumulativePct : null)),
          borderColor: '#1d4ed8',
          backgroundColor: 'rgba(29, 78, 216, 0.08)',
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
        { label: 'Linear target %', data: t.map((p) => p.idealPct), borderColor: '#94a3b8', borderDash: [6, 4], pointRadius: 0, fill: false },
      ],
    };
  });
  trendOptions: ChartConfiguration['options'] = {
    interaction: { mode: 'index', intersect: false },
    scales: { y: { beginAtZero: true, suggestedMax: 100, ticks: { callback: (v) => `${v}%` } } },
    plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%` } } },
  };

  categoryChart = computed<ChartConfiguration['data']>(() => {
    const c = this.data()?.categories || [];
    return {
      labels: c.map((x) => x.category),
      datasets: [{ data: c.map((x) => crore(x.spent)), backgroundColor: PALETTE, borderWidth: 2, borderColor: '#fff' }],
    };
  });
  doughnutOptions: ChartConfiguration['options'] = {
    plugins: {
      legend: { position: 'bottom' },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const total = (ctx.dataset.data as number[]).reduce((a, b) => a + (b || 0), 0);
            const v = Number(ctx.parsed);
            return `${ctx.label}: ${v.toLocaleString('en-IN')} (${total ? ((v / total) * 100).toFixed(1) : 0}%)`;
          },
        },
      },
    },
  };
}
