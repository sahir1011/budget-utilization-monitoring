import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { ChartConfiguration } from 'chart.js';
import { ApiService, errorMessage } from '../core/api.service';
import { AlertStats, CategorySlice, Health, Metrics, Summary, TrendPoint } from '../core/models';
import { CompactPipe, CrorePipe, PctPipe, RUPEES_PER_CRORE, formatCrore } from '../core/format';
import { FyService } from '../core/ui.service';
import { ChartComponent, PALETTE } from '../shared/chart.component';
import { WIDGETS } from '../shared/widgets';

interface DeptDetail {
  department: { id: string; code: string; name: string; description?: string; active: boolean };
  financialYear: string;
  summary: Summary;
  budgets: { id: string; code: string; title: string; status: string; periodType: string; quarter?: number; expenditureType: string; metrics: Metrics }[];
  trend: TrendPoint[];
  categories: CategorySlice[];
  alerts: AlertStats;
  heads: { name: string; email: string; active: boolean }[];
}

@Component({
  selector: 'app-department-detail',
  imports: [RouterLink, CrorePipe, CompactPipe, PctPipe, ChartComponent, ...WIDGETS],
  template: `
    @if (loading() && !data()) {
      <app-loading />
    } @else if (error()) {
      <div class="banner error">{{ error() }}</div>
    } @else if (data(); as d) {
      <div class="page-head">
        <div class="titles">
          <div class="crumbs"><a routerLink="/departments">Departments</a> / {{ d.department.code }}</div>
          <h1>{{ d.department.name }}</h1>
          <p>{{ d.department.description }}</p>
        </div>
        <a class="btn btn-outline" [routerLink]="['/alerts']" [queryParams]="{ department: d.department.id }">Alerts ({{ d.alerts.open }})</a>
        <a class="btn btn-primary" [routerLink]="['/reports']" [queryParams]="{ department: d.department.id }">Reports</a>
      </div>

      <div class="grid kpis">
        <div class="card kpi accent"><div class="k-label">Allocated · FY {{ d.financialYear }}</div><div class="k-value">{{ d.summary.allocated | compact }}</div><div class="k-sub">{{ d.summary.budgetCount }} budget heads</div></div>
        <div class="card kpi ok"><div class="k-label">Spent</div><div class="k-value">{{ d.summary.spent | compact }}</div><div class="k-sub">Balance {{ d.summary.remaining | compact }}</div></div>
        <div class="card kpi"><div class="k-label">Utilisation</div><div class="k-value">{{ d.summary.utilization | pct: 2 }}</div></div>
        <div class="card kpi danger"><div class="k-label">Open alerts</div><div class="k-value">{{ d.alerts.open }}</div><div class="k-sub">{{ d.alerts.bySeverity.CRITICAL }} critical · {{ d.alerts.bySeverity.HIGH }} high</div></div>
        <div class="card kpi"><div class="k-label">Department head</div><div class="k-value" style="font-size: 15px">@for (h of d.heads; track h.email) { <div>{{ h.name }}</div> } @empty { <span class="muted">Unassigned</span> }</div></div>
      </div>

      <div class="grid cols-2 mt">
        <div class="card">
          <div class="card-head"><h2>Utilisation by budget head</h2><span class="muted small">%</span></div>
          <div class="card-body"><app-chart type="bar" [data]="budgetChart()" [options]="budgetOptions()" [height]="chartHeight()" /></div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Monthly expenditure</h2><span class="muted small">₹ crore</span></div>
          <div class="card-body"><app-chart type="bar" [data]="trendChart()" [options]="trendOptions" [height]="chartHeight()" /></div>
        </div>
      </div>

      <div class="card mt">
        <div class="card-head"><h2>Budget heads</h2></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Budget head</th><th class="num">Allocated</th><th class="num">Spent</th><th class="num">Balance</th><th>Utilisation</th><th>Health</th><th class="text-right">Risk</th></tr></thead>
            <tbody>
              @for (b of d.budgets; track b.id) {
                <tr>
                  <td class="title-cell"><a [routerLink]="['/budgets', b.id]">{{ b.title }}</a><div class="sub mono">{{ b.code }}</div></td>
                  <td class="num">{{ b.metrics.allocated | crore }}</td>
                  <td class="num">{{ b.metrics.spent | crore }}</td>
                  <td class="num">{{ b.metrics.remaining | crore }}</td>
                  <td><app-util-bar [value]="b.metrics.utilization" [time]="b.metrics.timeElapsed" /></td>
                  <td><app-health [value]="b.metrics.health" /></td>
                  <td class="text-right"><app-risk [value]="b.metrics.riskScore" /></td>
                </tr>
              } @empty {
                <tr><td colspan="7"><app-empty text="No budgets for this department in the selected year." /></td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>

      @if (d.categories.length) {
        <div class="card mt">
          <div class="card-head"><h2>Expenditure by category</h2></div>
          <div class="card-body"><app-chart type="doughnut" [data]="catChart()" [options]="catOptions" [height]="260" /></div>
        </div>
      }
    }
  `,
})
export class DepartmentDetailPage {
  id = input.required<string>();
  private api = inject(ApiService);
  fy = inject(FyService);

  data = signal<DeptDetail | null>(null);
  loading = signal(true);
  error = signal('');

  constructor() {
    effect(() => this.load(this.id(), this.fy.selected()));
  }

  async load(id: string, fy: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await this.api.get<DeptDetail>(`/departments/${id}`, { fy }));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  chartHeight = computed(() => Math.max(260, (this.data()?.budgets.length || 0) * 34));

  budgetChart = computed<ChartConfiguration['data']>(() => {
    const b = this.data()?.budgets || [];
    const color: Record<Health, string> = { ON_TRACK: '#10b981', AHEAD: '#8b5cf6', LAGGING: '#f59e0b', UNDER_UTILIZED: '#f97316', OVERSPENT: '#ef4444' };
    return {
      labels: b.map((x) => (x.title.length > 34 ? x.title.slice(0, 32) + '…' : x.title)),
      datasets: [
        { label: 'Utilisation %', data: b.map((x) => x.metrics.utilization), backgroundColor: b.map((x) => color[x.metrics.health]), borderRadius: 4 },
        { label: 'Time elapsed %', data: b.map((x) => x.metrics.timeElapsed), backgroundColor: '#e2e8f0', borderRadius: 4 },
      ],
    };
  });
  budgetOptions = computed<ChartConfiguration['options']>(() => ({
    indexAxis: 'y',
    scales: { x: { beginAtZero: true, suggestedMax: 100, ticks: { callback: (v) => `${v}%` } } },
    plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${Number(ctx.parsed.x).toFixed(2)}%` } } },
  }));

  trendChart = computed<ChartConfiguration['data']>(() => {
    const t = this.data()?.trend || [];
    return { labels: t.map((p) => p.label), datasets: [{ label: 'Spent', data: t.map((p) => p.spent / RUPEES_PER_CRORE), backgroundColor: '#3b82f6', borderRadius: 4 }] };
  });
  trendOptions: ChartConfiguration['options'] = {
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => formatCrore((ctx.parsed.y ?? 0) * RUPEES_PER_CRORE) } } },
    scales: { y: { beginAtZero: true, ticks: { callback: (v) => Number(v).toLocaleString('en-IN') } } },
  };

  catChart = computed<ChartConfiguration['data']>(() => {
    const c = this.data()?.categories || [];
    return { labels: c.map((x) => x.category), datasets: [{ data: c.map((x) => x.spent / RUPEES_PER_CRORE), backgroundColor: PALETTE, borderColor: '#fff', borderWidth: 2 }] };
  });
  catOptions: ChartConfiguration['options'] = {
    plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCrore(Number(ctx.parsed) * RUPEES_PER_CRORE)}` } } },
  };
}
