import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { Budget, DeptRef } from '../core/models';
import { CrorePipe, croreInputToRupees, currentFinancialYear, istDate, rupeesToCroreInput } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { LoadingComponent } from '../shared/widgets';

interface BudgetForm {
  code: string;
  title: string;
  department: string;
  financialYear: string;
  periodType: 'ANNUAL' | 'QUARTERLY';
  quarter: number | null;
  amountCrore: string;
  allocationDate: string;
  expenditureType: 'REVENUE' | 'CAPITAL';
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  description: string;
  source: string;
  revisionReason: string;
}

@Component({
  selector: 'app-budget-form',
  imports: [FormsModule, RouterLink, CrorePipe, LoadingComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <div class="crumbs"><a routerLink="/budgets">Budgets</a> / {{ id() ? 'Edit' : 'New allocation' }}</div>
        <h1>{{ id() ? 'Edit budget allocation' : 'Create budget allocation' }}</h1>
        <p>Allocations are recorded in ₹ crore (up to 2 decimals = ₹1 lakh precision) and stored as exact rupee values.</p>
      </div>
    </div>

    @if (loading()) {
      <app-loading />
    } @else {
      <form class="card" (ngSubmit)="save()" #f="ngForm">
        <div class="card-body form-grid">
          <div class="field">
            <label for="code">Budget code *</label>
            <input id="code" class="input mono" name="code" [(ngModel)]="form.code" required pattern="[A-Za-z0-9-]{3,40}" placeholder="e.g. MOE-SS-2627" />
            <span class="hint">3-40 letters, digits or hyphens. Must be unique.</span>
          </div>
          <div class="field">
            <label for="title">Scheme / budget head *</label>
            <input id="title" class="input" name="title" [(ngModel)]="form.title" required maxlength="200" />
          </div>
          <div class="field">
            <label for="department">Department *</label>
            <select id="department" class="select" name="department" [(ngModel)]="form.department" required [disabled]="locked()">
              <option value="" disabled>Select department</option>
              @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }} – {{ d.name }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="fy">Financial year *</label>
            <select id="fy" class="select" name="financialYear" [(ngModel)]="form.financialYear" required [disabled]="locked()">
              @for (y of fyOptions; track y) { <option [value]="y">{{ y }}</option> }
            </select>
          </div>
          <div class="field">
            <label for="ptype">Allocation period *</label>
            <select id="ptype" class="select" name="periodType" [(ngModel)]="form.periodType" [disabled]="locked()">
              <option value="ANNUAL">Annual (1 Apr – 31 Mar)</option>
              <option value="QUARTERLY">Quarterly</option>
            </select>
          </div>
          @if (form.periodType === 'QUARTERLY') {
            <div class="field">
              <label for="quarter">Quarter *</label>
              <select id="quarter" class="select" name="quarter" [(ngModel)]="form.quarter" required [disabled]="locked()">
                <option [ngValue]="1">Q1 (Apr – Jun)</option>
                <option [ngValue]="2">Q2 (Jul – Sep)</option>
                <option [ngValue]="3">Q3 (Oct – Dec)</option>
                <option [ngValue]="4">Q4 (Jan – Mar)</option>
              </select>
            </div>
          }
          <div class="field">
            <label for="amount">Allocated amount *</label>
            <div class="input-group">
              <span class="addon">₹</span>
              <input id="amount" class="input" name="amount" inputmode="decimal" [(ngModel)]="form.amountCrore" required placeholder="0.00" />
              <span class="addon">crore</span>
            </div>
            @if (form.amountCrore && amountRupees() === null) {
              <span class="err">Enter a positive amount with at most 2 decimals.</span>
            } @else if (amountRupees()) {
              <span class="hint">= ₹{{ amountRupees()!.toLocaleString('en-IN') }}</span>
            }
          </div>
          <div class="field">
            <label for="adate">Allocation date *</label>
            <input id="adate" type="date" class="input" name="allocationDate" [(ngModel)]="form.allocationDate" required />
          </div>
          <div class="field">
            <label for="etype">Expenditure type</label>
            <select id="etype" class="select" name="expenditureType" [(ngModel)]="form.expenditureType">
              <option value="REVENUE">Revenue</option>
              <option value="CAPITAL">Capital</option>
            </select>
          </div>
          @if (id()) {
            <div class="field">
              <label for="status">Status</label>
              <select id="status" class="select" name="status" [(ngModel)]="form.status">
                <option value="ACTIVE">Active – open for expenditure</option>
                <option value="FROZEN">Frozen – no new expenditure, excluded from monitoring</option>
                <option value="CLOSED">Closed – period completed</option>
              </select>
            </div>
          }
          @if (amountChanged()) {
            <div class="field full">
              <label for="reason">Reason for revising the allocation *</label>
              <input id="reason" class="input" name="revisionReason" [(ngModel)]="form.revisionReason" required placeholder="e.g. Supplementary Demand for Grants (1st batch) approved" />
              <span class="hint">Previous allocation {{ original()?.allocatedAmount | crore }}. The revision is kept in the budget history and audit log.</span>
            </div>
          }
          <div class="field full">
            <label for="desc">Description</label>
            <textarea id="desc" class="input" name="description" [(ngModel)]="form.description" maxlength="2000"></textarea>
          </div>
          <div class="field full">
            <label for="source">Source / sanction reference</label>
            <input id="source" class="input" name="source" [(ngModel)]="form.source" maxlength="500" placeholder="e.g. Expenditure Budget 2026-27, Demand No. 28" />
          </div>
          @if (locked()) {
            <div class="banner info full">Department and period are locked because expenditure has already been recorded against this budget.</div>
          }
          @if (error()) { <div class="banner error full">{{ error() }}</div> }
          <div class="form-actions full">
            <a class="btn btn-outline" [routerLink]="id() ? ['/budgets', id()] : ['/budgets']">Cancel</a>
            <button class="btn btn-primary" type="submit" [disabled]="saving() || !f.valid || !amountRupees()">{{ saving() ? 'Saving…' : id() ? 'Save changes' : 'Create allocation' }}</button>
          </div>
        </div>
      </form>
    }
  `,
})
export class BudgetFormPage implements OnInit {
  id = input<string>();
  private api = inject(ApiService);
  private router = inject(Router);
  private toast = inject(ToastService);
  private fy = inject(FyService);

  departments = signal<DeptRef[]>([]);
  original = signal<Budget | null>(null);
  locked = signal(false);
  loading = signal(true);
  saving = signal(false);
  error = signal('');

  fyOptions = (() => {
    const cur = Number(currentFinancialYear().slice(0, 4));
    return [cur - 1, cur, cur + 1].map((y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`).reverse();
  })();

  form: BudgetForm = {
    code: '', title: '', department: '', financialYear: this.fy.selected(), periodType: 'ANNUAL', quarter: null,
    amountCrore: '', allocationDate: istDate(), expenditureType: 'REVENUE', status: 'ACTIVE',
    description: '', source: '', revisionReason: '',
  };

  amountRupees = () => croreInputToRupees(this.form.amountCrore);
  amountChanged = () => !!this.original() && this.amountRupees() !== null && this.amountRupees() !== this.original()!.allocatedAmount;

  async ngOnInit() {
    try {
      const depts = await this.api.get<{ items: DeptRef[] }>('/departments');
      this.departments.set(depts.items);
      if (!this.fyOptions.includes(this.form.financialYear)) this.fyOptions.push(this.form.financialYear);
      const id = this.id();
      if (id) {
        const res = await this.api.get<{ budget: Budget }>(`/budgets/${id}`);
        const b = res.budget;
        this.original.set(b);
        this.locked.set(b.metrics.transactionCount > 0);
        if (!this.fyOptions.includes(b.financialYear)) this.fyOptions.push(b.financialYear);
        this.form = {
          code: b.code, title: b.title, department: b.department.id, financialYear: b.financialYear, periodType: b.periodType,
          quarter: b.quarter ?? null, amountCrore: rupeesToCroreInput(b.allocatedAmount), allocationDate: istDate(b.allocationDate),
          expenditureType: b.expenditureType, status: b.status, description: b.description || '', source: b.source || '', revisionReason: '',
        };
      }
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async save() {
    const amount = this.amountRupees();
    if (!amount) return;
    this.saving.set(true);
    this.error.set('');
    const body: Record<string, unknown> = {
      code: this.form.code, title: this.form.title, allocatedAmount: amount, allocationDate: this.form.allocationDate,
      expenditureType: this.form.expenditureType, description: this.form.description, source: this.form.source,
    };
    if (!this.locked()) {
      Object.assign(body, { department: this.form.department, financialYear: this.form.financialYear, periodType: this.form.periodType, quarter: this.form.periodType === 'QUARTERLY' ? this.form.quarter : null });
    }
    try {
      let saved: Budget;
      if (this.id()) {
        body['status'] = this.form.status;
        if (this.amountChanged()) body['revisionReason'] = this.form.revisionReason;
        saved = await this.api.patch<Budget>(`/budgets/${this.id()}`, body);
        this.toast.success('Budget updated');
      } else {
        saved = await this.api.post<Budget>('/budgets', body);
        this.toast.success('Budget allocation created');
      }
      this.router.navigate(['/budgets', saved.id]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
