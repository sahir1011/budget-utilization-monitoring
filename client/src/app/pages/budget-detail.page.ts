import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AlertType, Budget, CategorySlice, Severity, TrendPoint } from '../core/models';
import { CompactPipe, CrorePipe, PctPipe, RUPEES_PER_CRORE, formatCrore } from '../core/format';
import { ToastService } from '../core/ui.service';
import { ChartComponent, PALETTE } from '../shared/chart.component';
import { WIDGETS } from '../shared/widgets';

interface Detail {
  budget: Budget;
  revisions: { previousAmount: number; newAmount: number; reason: string; by: string | null; at: string }[];
  trend: TrendPoint[];
  categories: CategorySlice[];
  recentExpenditures: { id: string; txnId: string; amount: number; category: string; date: string; description: string; payee?: string; documents: number; createdBy: string | null }[];
  alerts: { id: string; alertId: string; type: AlertType; severity: Severity; status: string; title: string; message: string; detectedAt: string }[];
}

@Component({
  selector: 'app-budget-detail',
  imports: [RouterLink, DatePipe, CrorePipe, CompactPipe, PctPipe, ChartComponent, ...WIDGETS],
  template: `
    @if (loading() && !data()) {
      <app-loading />
    } @else if (error()) {
      <div class="banner error">{{ error() }}</div>
    } @else if (data(); as d) {
      <div class="page-head">
        <div class="titles">
          <div class="crumbs"><a routerLink="/budgets">Budgets</a> / <span class="mono">{{ d.budget.code }}</span></div>
          <h1>{{ d.budget.title }}</h1>
          <p>
            <a [routerLink]="['/departments', d.budget.department.id]">{{ d.budget.department.name }}</a> ·
            FY {{ d.budget.financialYear }} {{ d.budget.periodType === 'QUARTERLY' ? '· Q' + d.budget.quarter : '' }} ·
            {{ d.budget.periodStart | date: 'd MMM y' }} – {{ d.budget.periodEnd | date: 'd MMM y' }} ·
            <span class="badge" [class]="'badge st-' + d.budget.status">{{ d.budget.status }}</span>
            <app-health [value]="d.budget.metrics.health" />
          </p>
        </div>
        @if (d.budget.status === 'ACTIVE') {
          <a class="btn btn-primary" [routerLink]="['/expenditures/new']" [queryParams]="{ budget: d.budget.id }">+ Record expenditure</a>
        }
        @if (auth.canManageBudgets()) {
          <a class="btn btn-outline" [routerLink]="['/budgets', d.budget.id, 'edit']">Edit</a>
        }
        @if (auth.isAdmin() && d.budget.metrics.transactionCount === 0) {
          <button class="btn btn-outline" (click)="remove()">Delete</button>
        }
      </div>

      <div class="grid kpis">
        <div class="card kpi accent"><div class="k-label">Allocated</div><div class="k-value">{{ d.budget.allocatedAmount | compact }}</div><div class="k-sub">{{ d.budget.allocatedAmount | crore }}</div></div>
        <div class="card kpi ok"><div class="k-label">Spent</div><div class="k-value">{{ d.budget.metrics.spent | compact }}</div><div class="k-sub">{{ d.budget.metrics.transactionCount }} transactions</div></div>
        <div class="card kpi" [class.danger]="d.budget.metrics.remaining < 0"><div class="k-label">Balance</div><div class="k-value">{{ d.budget.metrics.remaining | compact }}</div><div class="k-sub">{{ d.budget.metrics.remaining | crore }}</div></div>
        <div class="card kpi"><div class="k-label">Projected at period end</div><div class="k-value">{{ d.budget.metrics.projectedUtilization | pct }}</div><div class="k-sub">burn rate {{ d.budget.metrics.burnRatePerDay | crore }}/day</div></div>
        <div class="card kpi"><div class="k-label">Risk score</div><div class="k-value"><app-risk [value]="d.budget.metrics.riskScore" /></div><div class="k-sub">{{ d.budget.metrics.riskLevel }} · last spend {{ d.budget.metrics.daysSinceLastActivity }} days ago</div></div>
      </div>

      <div class="card mt">
        <div class="card-body">
          <div class="row" style="justify-content: space-between">
            <h2>Utilisation {{ d.budget.metrics.utilization | pct: 2 }}</h2>
            <div class="legend-inline"><span><i style="background:#10b981"></i>Spent</span><span><i style="background:#0f172a; width:3px"></i>Time elapsed {{ d.budget.metrics.timeElapsed | pct }}</span></div>
          </div>
          <div class="util lg mt"><app-util-bar [value]="d.budget.metrics.utilization" [time]="d.budget.metrics.timeElapsed" [showLabel]="false" /></div>
          <p class="muted small mt">
            Pace gap {{ d.budget.metrics.paceGap > 0 ? '+' : '' }}{{ d.budget.metrics.paceGap.toFixed(2) }} percentage points ·
            day {{ d.budget.metrics.daysElapsed }} of {{ d.budget.metrics.totalDays }} ·
            projected spend {{ d.budget.metrics.projectedSpend | crore }}
          </p>
        </div>
      </div>

      <div class="grid cols-3 mt">
        <div class="card">
          <div class="card-head"><h2>Monthly expenditure</h2><span class="muted small">bars: ₹ crore · line: cumulative %</span></div>
          <div class="card-body"><app-chart type="bar" [data]="trendChart()" [options]="trendOptions" [height]="300" /></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>By category</h2></div>
          <div class="card-body">
            @if (d.categories.length) {
              <app-chart type="doughnut" [data]="catChart()" [options]="catOptions" [height]="300" />
            } @else { <app-empty text="No expenditure yet." /> }
          </div>
        </div>
      </div>

      <div class="grid cols-2 mt">
        <div class="card">
          <div class="card-head"><h2>Alerts on this budget</h2><a [routerLink]="['/alerts']" [queryParams]="{ budget: d.budget.id }" class="small">Manage →</a></div>
          @if (!d.alerts.length) { <app-empty text="No anomalies detected for this budget." /> }
          @for (a of d.alerts; track a.id) {
            <div class="alert-item">
              <div class="bar" [class]="'bar bar-' + a.severity"></div>
              <div class="body">
                <div class="title">{{ a.title }}</div>
                <div class="msg small">{{ a.message }}</div>
                <div class="meta"><app-sev [value]="a.severity" /><app-alert-type [value]="a.type" /><span class="badge" [class]="'badge st-' + a.status">{{ a.status }}</span><span>{{ a.detectedAt | date: 'd MMM y' }}</span></div>
              </div>
            </div>
          }
        </div>
        <div class="card">
          <div class="card-head"><h2>Budget details</h2></div>
          <div class="card-body stack">
            <dl class="dl">
              <dt>Expenditure type</dt><dd>{{ d.budget.expenditureType }}</dd>
              <dt>Allocation date</dt><dd>{{ d.budget.allocationDate | date: 'd MMM y' }}</dd>
              @if (d.budget.priorYear?.budgetEstimate) { <dt>BE previous year</dt><dd>{{ d.budget.priorYear!.budgetEstimate! | crore }}</dd> }
              @if (d.budget.priorYear?.revisedEstimate) { <dt>RE previous year</dt><dd>{{ d.budget.priorYear!.revisedEstimate! | crore }}</dd> }
              <dt>Last expenditure</dt><dd>{{ d.budget.metrics.lastExpenditureDate ? (d.budget.metrics.lastExpenditureDate | date: 'd MMM y') : '—' }}</dd>
              <dt>Created by</dt><dd>{{ d.budget.createdBy || '—' }}</dd>
            </dl>
            @if (d.budget.description) { <p>{{ d.budget.description }}</p> }
            @if (d.budget.source) { <p class="source">Source: {{ d.budget.source }}</p> }
            @if (d.revisions.length) {
              <h3>Allocation revisions</h3>
              @for (r of d.revisions; track r.at) {
                <div class="note">{{ r.previousAmount | crore }} → <b>{{ r.newAmount | crore }}</b> · {{ r.reason }} <span class="muted">— {{ r.by }}, {{ r.at | date: 'd MMM y' }}</span></div>
              }
            }
          </div>
        </div>
      </div>

      <div class="card mt">
        <div class="card-head"><h2>Recent transactions</h2><a [routerLink]="['/expenditures']" [queryParams]="{ budget: d.budget.id }" class="small">All transactions →</a></div>
        @if (!d.recentExpenditures.length) {
          <app-empty text="No expenditure recorded yet." />
        } @else {
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th>Txn ID</th><th>Date</th><th>Description</th><th>Category</th><th class="num">Amount</th><th>Docs</th></tr></thead>
              <tbody>
                @for (e of d.recentExpenditures; track e.id) {
                  <tr>
                    <td class="mono nowrap">{{ e.txnId }}</td>
                    <td class="nowrap">{{ e.date | date: 'd MMM y' }}</td>
                    <td>{{ e.description }}<div class="muted small">{{ e.payee }}</div></td>
                    <td><span class="chip">{{ e.category }}</span></td>
                    <td class="num">{{ e.amount | crore }}</td>
                    <td>{{ e.documents || '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </div>
    }
  `,
})
export class BudgetDetailPage {
  id = input.required<string>();
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  auth = inject(AuthService);

  data = signal<Detail | null>(null);
  loading = signal(true);
  error = signal('');

  constructor() {
    effect(() => this.load(this.id()));
  }

  async load(id: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get<Detail>(`/budgets/${id}`));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async remove() {
    if (!confirm('Delete this budget allocation? This cannot be undone.')) return;
    try {
      await this.api.delete(`/budgets/${this.id()}`);
      this.toast.success('Budget deleted');
      this.router.navigate(['/budgets']);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  trendChart = computed<ChartConfiguration['data']>(() => {
    const t = this.data()?.trend || [];
    return {
      labels: t.map((p) => p.label),
      datasets: [
        { type: 'bar', label: 'Monthly spend (₹ Cr)', data: t.map((p) => Math.round((p.spent / RUPEES_PER_CRORE) * 100) / 100), backgroundColor: '#93c5fd', borderRadius: 4, yAxisID: 'y' },
        { type: 'line', label: 'Cumulative %', data: t.map((p) => p.cumulativePct), borderColor: '#1d4ed8', tension: 0.25, yAxisID: 'y1', pointRadius: 2 },
        { type: 'line', label: 'Linear target %', data: t.map((p) => p.idealPct), borderColor: '#94a3b8', borderDash: [6, 4], pointRadius: 0, yAxisID: 'y1' },
      ],
    } as ChartConfiguration['data'];
  });
  trendOptions: ChartConfiguration['options'] = {
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: { position: 'left', beginAtZero: true, ticks: { callback: (v) => Number(v).toLocaleString('en-IN') } },
      y1: { position: 'right', beginAtZero: true, suggestedMax: 100, grid: { drawOnChartArea: false }, ticks: { callback: (v) => `${v}%` } },
    },
    plugins: {
      tooltip: {
        callbacks: {
          label: (ctx) => (ctx.dataset.yAxisID === 'y' ? `Spent: ${formatCrore((ctx.parsed.y ?? 0) * RUPEES_PER_CRORE)}` : `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(2)}%`),
        },
      },
    },
  };

  catChart = computed<ChartConfiguration['data']>(() => {
    const c = this.data()?.categories || [];
    return { labels: c.map((x) => x.category), datasets: [{ data: c.map((x) => x.spent / RUPEES_PER_CRORE), backgroundColor: PALETTE, borderColor: '#fff', borderWidth: 2 }] };
  });
  catOptions: ChartConfiguration['options'] = {
    plugins: {
      legend: { position: 'bottom' },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCrore(Number(ctx.parsed) * RUPEES_PER_CRORE)}` } },
    },
  };
}
