import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DeptRef, DeptSummary, Summary, TrendPoint } from '../core/models';
import { CrorePipe, PctPipe } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

const REPORTS = [
  { type: 'department-summary', title: 'Department-wise financial summary', desc: 'Allocation, expenditure, balance and utilisation per department.' },
  { type: 'budgets', title: 'Budget utilisation register', desc: 'Every budget head with utilisation, time elapsed, health and risk score.' },
  { type: 'expenditures', title: 'Expenditure transactions', desc: 'All transactions with dates, categories, references and amounts.' },
  { type: 'alerts', title: 'Anomaly & alert register', desc: 'Every alert raised, with severity, status and details.' },
  { type: 'monthly-trend', title: 'Monthly expenditure trend', desc: 'Month-wise spend, cumulative utilisation and linear target.' },
];

@Component({
  selector: 'app-reports',
  imports: [FormsModule, RouterLink, CrorePipe, PctPipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Reports</h1>
        <p>Department-wise financial summaries and downloadable reports (PDF / CSV) for FY {{ fy.selected() }}.</p>
      </div>
      @if (!auth.isDeptHead()) {
        <div class="field" style="min-width: 240px">
          <label for="dept">Scope</label>
          <select id="dept" class="select" [(ngModel)]="department" (ngModelChange)="load()">
            <option value="">All departments</option>
            @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }} – {{ d.name }}</option> }
          </select>
        </div>
      }
    </div>

    <div class="grid cols-3eq">
      @for (r of reports; track r.type) {
        <div class="card card-body stack" style="gap: 10px">
          <h2>{{ r.title }}</h2>
          <p class="muted small" style="flex: 1">{{ r.desc }}</p>
          <div class="row">
            <button class="btn btn-primary btn-sm" (click)="download(r.type, 'pdf')" [disabled]="busy() === r.type + 'pdf'">{{ busy() === r.type + 'pdf' ? 'Preparing…' : '⤓ PDF' }}</button>
            <button class="btn btn-outline btn-sm" (click)="download(r.type, 'csv')" [disabled]="busy() === r.type + 'csv'">{{ busy() === r.type + 'csv' ? 'Preparing…' : '⤓ CSV' }}</button>
          </div>
        </div>
      }
    </div>

    @if (loading()) {
      <app-loading />
    } @else if (error()) {
      <div class="banner error mt">{{ error() }}</div>
    } @else if (summary(); as s) {
      <div class="card mt">
        <div class="card-head"><h2>Department-wise financial summary</h2><span class="muted small">₹ crore</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Department</th><th class="num">Budgets</th><th class="num">Allocated</th><th class="num">Spent</th><th class="num">Balance</th><th>Utilisation</th><th class="num">Overspent</th><th class="num">Under-utilised / lagging</th></tr></thead>
            <tbody>
              @for (d of departmentsSummary(); track d.department.id) {
                <tr>
                  <td><a [routerLink]="['/departments', d.department.id]"><b>{{ d.department.code }}</b></a> · {{ d.department.name }}</td>
                  <td class="num">{{ d.budgetCount }}</td>
                  <td class="num">{{ d.allocated | crore: false }}</td>
                  <td class="num">{{ d.spent | crore: false }}</td>
                  <td class="num">{{ d.remaining | crore: false }}</td>
                  <td><app-util-bar [value]="d.utilization" /></td>
                  <td class="num">{{ d.overspentCount }}</td>
                  <td class="num">{{ d.underUtilizedCount }}</td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr><td>Total</td><td class="num">{{ s.budgetCount }}</td><td class="num">{{ s.allocated | crore: false }}</td><td class="num">{{ s.spent | crore: false }}</td><td class="num">{{ s.remaining | crore: false }}</td><td>{{ s.utilization | pct: 2 }}</td><td colspan="2"></td></tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div class="card mt">
        <div class="card-head"><h2>Monthly expenditure</h2><span class="muted small">₹ crore</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Month</th><th class="num">Transactions</th><th class="num">Spent</th><th class="num">Cumulative</th><th class="num">Cumulative %</th><th class="num">Linear target %</th></tr></thead>
            <tbody>
              @for (t of trend(); track t.month) {
                <tr>
                  <td>{{ t.label }}</td>
                  <td class="num">{{ t.transactions }}</td>
                  <td class="num">{{ t.spent | crore: false }}</td>
                  <td class="num">{{ t.cumulative | crore: false }}</td>
                  <td class="num">{{ t.cumulativePct | pct: 2 }}</td>
                  <td class="num muted">{{ t.idealPct | pct: 1 }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    }
  `,
})
export class ReportsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);
  fy = inject(FyService);

  reports = REPORTS;
  departments = signal<DeptRef[]>([]);
  summary = signal<Summary | null>(null);
  departmentsSummary = signal<DeptSummary[]>([]);
  trend = signal<TrendPoint[]>([]);
  loading = signal(true);
  error = signal('');
  busy = signal('');
  department = this.route.snapshot.queryParamMap.get('department') || '';

  constructor() {
    if (!this.auth.isDeptHead()) {
      this.api.get<{ items: DeptRef[] }>('/departments').then((r) => this.departments.set(r.items)).catch(() => undefined);
    }
    effect(() => {
      this.fy.selected();
      this.load();
    });
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await this.api.get<{ summary: Summary; departments: DeptSummary[]; trend: TrendPoint[] }>('/reports/summary', { fy: this.fy.selected(), department: this.department });
      this.summary.set(r.summary);
      this.departmentsSummary.set(r.departments);
      this.trend.set(r.trend);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async download(type: string, format: 'pdf' | 'csv') {
    this.busy.set(type + format);
    try {
      await this.api.download('/reports/export', { type, format, fy: this.fy.selected(), department: this.department }, `${type}.${format}`);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set('');
    }
  }
}
