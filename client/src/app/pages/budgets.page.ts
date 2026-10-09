import { Component, computed, effect, inject, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Budget, DeptRef, HEALTH_LABELS } from '../core/models';
import { CrorePipe, PctPipe } from '../core/format';
import { FyService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

@Component({
  selector: 'app-budgets',
  imports: [FormsModule, RouterLink, TitleCasePipe, CrorePipe, PctPipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Budget allocations</h1>
        <p>Allocation, expenditure and live utilisation for every budget head in FY {{ fy.selected() }}.</p>
      </div>
      @if (auth.canManageBudgets()) {
        <a class="btn btn-primary" routerLink="/budgets/new">+ New allocation</a>
      }
    </div>

    <div class="card">
      <div class="filters">
        <div class="field" style="flex: 1; min-width: 200px">
          <label for="q">Search</label>
          <input id="q" class="input sm" placeholder="Code or title" [(ngModel)]="q" (keyup.enter)="load()" />
        </div>
        @if (!auth.isDeptHead()) {
          <div class="field">
            <label for="dept">Department</label>
            <select id="dept" class="select sm" [(ngModel)]="department" (ngModelChange)="load()">
              <option value="">All departments</option>
              @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }} – {{ d.name }}</option> }
            </select>
          </div>
        }
        <div class="field">
          <label for="health">Health</label>
          <select id="health" class="select sm" [(ngModel)]="health" (ngModelChange)="load()">
            <option value="">Any</option>
            @for (h of healthKeys; track h) { <option [value]="h">{{ healthLabels[h] }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="status">Status</label>
          <select id="status" class="select sm" [(ngModel)]="status" (ngModelChange)="load()">
            <option value="">Any</option>
            <option value="ACTIVE">Active</option>
            <option value="FROZEN">Frozen</option>
            <option value="CLOSED">Closed</option>
          </select>
        </div>
        <div class="field">
          <label for="sort">Sort by</label>
          <select id="sort" class="select sm" [(ngModel)]="sort" (ngModelChange)="load()">
            <option value="">Department / code</option>
            <option value="risk">Risk score</option>
            <option value="utilization">Utilisation</option>
            <option value="allocated">Allocation</option>
          </select>
        </div>
        <button class="btn btn-outline btn-sm" (click)="load()">Apply</button>
      </div>

      @if (loading()) {
        <app-loading />
      } @else if (error()) {
        <div class="card-body"><div class="banner error">{{ error() }}</div></div>
      } @else if (!items().length) {
        <app-empty text="No budgets match these filters." />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Budget head</th><th>Dept</th><th>Period</th>
                <th class="num">Allocated</th><th class="num">Spent</th>
                <th>Utilisation <span class="muted" title="Black marker = share of period elapsed">▮</span></th>
                <th>Health</th><th class="text-right">Risk</th>
              </tr>
            </thead>
            <tbody>
              @for (b of items(); track b.id) {
                <tr class="clickable" (click)="open(b)">
                  <td class="title-cell">
                    <a [routerLink]="['/budgets', b.id]" (click)="$event.stopPropagation()">{{ b.title }}</a>
                    <div class="sub mono">{{ b.code }} · {{ b.expenditureType | titlecase }}
                      @if (b.status !== 'ACTIVE') { · <span class="badge" [class]="'badge st-' + b.status">{{ b.status }}</span> }
                    </div>
                  </td>
                  <td>{{ b.department.code }}</td>
                  <td class="nowrap">{{ b.periodType === 'QUARTERLY' ? 'Q' + b.quarter : 'Annual' }}</td>
                  <td class="num">{{ b.allocatedAmount | crore }}</td>
                  <td class="num">{{ b.metrics.spent | crore }}</td>
                  <td><app-util-bar [value]="b.metrics.utilization" [time]="b.metrics.timeElapsed" /></td>
                  <td><app-health [value]="b.metrics.health" /></td>
                  <td class="text-right"><app-risk [value]="b.metrics.riskScore" /></td>
                </tr>
              }
            </tbody>
            <tfoot>
              <tr>
                <td colspan="3">{{ items().length }} budget heads</td>
                <td class="num">{{ totals().allocated | crore }}</td>
                <td class="num">{{ totals().spent | crore }}</td>
                <td colspan="3">{{ totals().utilization | pct: 2 }} utilised</td>
              </tr>
            </tfoot>
          </table>
        </div>
      }
    </div>
  `,
})
export class BudgetsPage {
  private api = inject(ApiService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);
  fy = inject(FyService);

  items = signal<Budget[]>([]);
  departments = signal<DeptRef[]>([]);
  loading = signal(true);
  error = signal('');
  healthLabels = HEALTH_LABELS;
  healthKeys = Object.keys(HEALTH_LABELS) as (keyof typeof HEALTH_LABELS)[];

  q = '';
  department = this.route.snapshot.queryParamMap.get('department') || '';
  health = this.route.snapshot.queryParamMap.get('health') || '';
  status = '';
  sort = '';

  totals = computed(() => {
    const allocated = this.items().reduce((a, b) => a + b.allocatedAmount, 0);
    const spent = this.items().reduce((a, b) => a + b.metrics.spent, 0);
    return { allocated, spent, utilization: allocated ? Math.round((spent / allocated) * 10000) / 100 : 0 };
  });

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
      const r = await this.api.get<{ items: Budget[] }>('/budgets', {
        fy: this.fy.selected(), q: this.q, department: this.department, health: this.health, status: this.status, sort: this.sort,
      });
      this.items.set(r.items);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  open(b: Budget) {
    this.router.navigate(['/budgets', b.id]);
  }
}
