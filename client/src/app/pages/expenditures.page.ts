import { Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Budget, DeptRef, EXPENSE_CATEGORIES, Expenditure, Paged } from '../core/models';
import { CrorePipe, fileSize } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

@Component({
  selector: 'app-expenditures',
  imports: [FormsModule, RouterLink, DatePipe, CrorePipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Expenditure transactions</h1>
        <p>Every payment recorded against a budget head, with supporting documents. FY {{ fy.selected() }}.</p>
      </div>
      <a class="btn btn-primary" routerLink="/expenditures/new" [queryParams]="budget ? { budget } : {}">+ Record expenditure</a>
    </div>

    <div class="card">
      <div class="filters">
        <div class="field" style="flex: 1; min-width: 200px">
          <label for="q">Search</label>
          <input id="q" class="input sm" placeholder="Txn ID, description, payee, reference" [(ngModel)]="q" (keyup.enter)="reload()" />
        </div>
        @if (!auth.isDeptHead()) {
          <div class="field">
            <label for="dept">Department</label>
            <select id="dept" class="select sm" [(ngModel)]="department" (ngModelChange)="onDeptChange()">
              <option value="">All</option>
              @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }}</option> }
            </select>
          </div>
        }
        <div class="field" style="max-width: 260px">
          <label for="budget">Budget</label>
          <select id="budget" class="select sm" [(ngModel)]="budget" (ngModelChange)="reload()">
            <option value="">All budgets</option>
            @for (b of budgets(); track b.id) { <option [value]="b.id">{{ b.code }} – {{ b.title }}</option> }
          </select>
        </div>
        <div class="field">
          <label for="cat">Category</label>
          <select id="cat" class="select sm" [(ngModel)]="category" (ngModelChange)="reload()">
            <option value="">All</option>
            @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
          </select>
        </div>
        <div class="field"><label for="from">From</label><input id="from" type="date" class="input sm" [(ngModel)]="from" (change)="reload()" /></div>
        <div class="field"><label for="to">To</label><input id="to" type="date" class="input sm" [(ngModel)]="to" (change)="reload()" /></div>
        <button class="btn btn-outline btn-sm" (click)="reload()">Apply</button>
      </div>

      @if (loading()) {
        <app-loading />
      } @else if (error()) {
        <div class="card-body"><div class="banner error">{{ error() }}</div></div>
      } @else if (!data()?.items?.length) {
        <app-empty text="No transactions match these filters." />
      } @else {
        <div class="card-body" style="padding-bottom: 0">
          <p class="muted"><b style="color: var(--text)">{{ data()!.total.toLocaleString('en-IN') }}</b> transactions totalling <b style="color: var(--text)">{{ data()!.totalAmount | crore }}</b></p>
        </div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Txn ID</th><th>Date</th><th>Budget</th><th>Description</th><th>Category</th><th class="num">Amount</th><th>Documents</th>@if (auth.canManageBudgets()) {<th></th>}</tr></thead>
            <tbody>
              @for (e of data()!.items; track e.id) {
                <tr>
                  <td class="mono nowrap">{{ e.txnId }}</td>
                  <td class="nowrap">{{ e.date | date: 'd MMM y' }}</td>
                  <td><a [routerLink]="['/budgets', e.budget.id]" class="mono small">{{ e.budget.code }}</a><div class="muted small">{{ e.department.code }}</div></td>
                  <td>{{ e.description }}<div class="muted small">{{ e.payee }}{{ e.referenceNo ? ' · Ref ' + e.referenceNo : '' }}</div></td>
                  <td><span class="chip">{{ e.category }}</span></td>
                  <td class="num">{{ e.amount | crore }}</td>
                  <td>
                    @for (doc of e.documents; track doc.id) {
                      <div><button class="link-btn small" (click)="download(doc.id, doc.filename)">📎 {{ doc.filename }}</button> <span class="muted small">{{ size(doc.size) }}</span></div>
                    } @empty { <span class="muted small">—</span> }
                  </td>
                  @if (auth.canManageBudgets()) {
                    <td><button class="btn btn-ghost btn-xs" (click)="remove(e)" title="Delete transaction">Delete</button></td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <span>Page {{ page() }} of {{ pages() }}</span>
          <button class="btn btn-outline btn-xs" [disabled]="page() <= 1" (click)="go(page() - 1)">‹ Prev</button>
          <button class="btn btn-outline btn-xs" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next ›</button>
        </div>
      }
    </div>
  `,
})
export class ExpendituresPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);
  fy = inject(FyService);

  data = signal<(Paged<Expenditure> & { totalAmount: number }) | null>(null);
  departments = signal<DeptRef[]>([]);
  budgets = signal<Budget[]>([]);
  loading = signal(true);
  error = signal('');
  page = signal(1);
  pages = signal(1);
  categories = EXPENSE_CATEGORIES;

  q = '';
  department = '';
  budget = this.route.snapshot.queryParamMap.get('budget') || '';
  category = '';
  from = '';
  to = '';

  constructor() {
    if (!this.auth.isDeptHead()) {
      this.api.get<{ items: DeptRef[] }>('/departments').then((r) => this.departments.set(r.items)).catch(() => undefined);
    }
    effect(() => {
      const fy = this.fy.selected();
      this.loadBudgets(fy);
      this.page.set(1);
      this.load();
    });
  }

  async loadBudgets(fy: string) {
    try {
      const r = await this.api.get<{ items: Budget[] }>('/budgets', { fy, department: this.department });
      this.budgets.set(r.items);
    } catch {
      /* filter list is optional */
    }
  }

  onDeptChange() {
    this.budget = '';
    this.loadBudgets(this.fy.selected());
    this.reload();
  }

  reload() {
    this.page.set(1);
    this.load();
  }

  go(p: number) {
    this.page.set(p);
    this.load();
  }

  async load() {
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await this.api.get<Paged<Expenditure> & { totalAmount: number }>('/expenditures', {
        fy: this.fy.selected(), q: this.q, department: this.department, budget: this.budget, category: this.category,
        from: this.from, to: this.to, page: this.page(), limit: 25,
      });
      this.data.set(r);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  size = fileSize;

  async download(id: string, name: string) {
    try {
      await this.api.download(`/documents/${id}`, undefined, name);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async remove(e: Expenditure) {
    if (!confirm(`Delete transaction ${e.txnId}? Utilisation and alerts for ${e.budget.code} will be recalculated.`)) return;
    try {
      await this.api.delete(`/expenditures/${e.id}`);
      this.toast.success(`${e.txnId} deleted`);
      this.load();
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }
}
