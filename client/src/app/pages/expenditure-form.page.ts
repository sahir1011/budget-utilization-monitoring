import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { API_BASE, ApiService, errorMessage } from '../core/api.service';
import { Budget, EXPENSE_CATEGORIES } from '../core/models';
import { CrorePipe, PctPipe, croreInputToRupees, fileSize, istDate } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

const MAX_FILE = 2 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.csv,.xls,.xlsx,.docx';

@Component({
  selector: 'app-expenditure-form',
  imports: [FormsModule, RouterLink, CrorePipe, PctPipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <div class="crumbs"><a routerLink="/expenditures">Expenditures</a> / Record</div>
        <h1>Record expenditure</h1>
        <p>Every transaction immediately updates utilisation and is checked by the monitoring engine.</p>
      </div>
    </div>

    @if (loading()) {
      <app-loading />
    } @else {
      <div class="grid cols-3">
        <form class="card" (ngSubmit)="save()" #f="ngForm">
          <div class="card-body form-grid">
            <div class="field full">
              <label for="budget">Budget head *</label>
              <select id="budget" class="select" name="budget" [(ngModel)]="budgetId" required (ngModelChange)="selectBudget($event)">
                <option value="" disabled>Select an active budget</option>
                @for (b of budgets(); track b.id) {
                  <option [value]="b.id">{{ b.department.code }} · {{ b.code }} – {{ b.title }}</option>
                }
              </select>
              @if (!budgets().length) { <span class="err">No active budgets available for FY {{ fy.selected() }}.</span> }
            </div>
            <div class="field">
              <label for="amount">Amount *</label>
              <div class="input-group">
                <span class="addon">₹</span>
                <input id="amount" class="input" name="amount" inputmode="decimal" [(ngModel)]="amountCrore" required placeholder="0.00" />
                <span class="addon">crore</span>
              </div>
              @if (amountCrore && !amount()) { <span class="err">Enter a positive amount with at most 2 decimals.</span> }
              @else if (amount()) { <span class="hint">= ₹{{ amount()!.toLocaleString('en-IN') }}</span> }
            </div>
            <div class="field">
              <label for="date">Transaction date *</label>
              <input id="date" type="date" class="input" name="date" [(ngModel)]="date" required [min]="minDate()" [max]="maxDate()" />
            </div>
            <div class="field">
              <label for="cat">Expense category *</label>
              <select id="cat" class="select" name="category" [(ngModel)]="category" required>
                <option value="" disabled>Select category</option>
                @for (c of categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="ref">Sanction / bill reference</label>
              <input id="ref" class="input" name="referenceNo" [(ngModel)]="referenceNo" maxlength="120" placeholder="e.g. F.No. 11/2026-Bud/SO-14" />
            </div>
            <div class="field full">
              <label for="desc">Description *</label>
              <input id="desc" class="input" name="description" [(ngModel)]="description" required maxlength="500" />
            </div>
            <div class="field full">
              <label for="payee">Payee / implementing agency</label>
              <input id="payee" class="input" name="payee" [(ngModel)]="payee" maxlength="200" />
            </div>
            <div class="field full">
              <label for="docs">Supporting documents</label>
              <input id="docs" type="file" class="input" style="padding-top: 6px" multiple [accept]="accept" (change)="pickFiles($event)" />
              <span class="hint">Up to 3 files, 2 MB each: PDF, PNG, JPG, CSV, XLS(X) or DOCX (sanction orders, bills, utilisation certificates).</span>
              @for (fl of files(); track fl.name) { <span class="small">📎 {{ fl.name }} <span class="muted">({{ size(fl.size) }})</span></span> }
              @if (fileError()) { <span class="err">{{ fileError() }}</span> }
            </div>
            @if (error()) { <div class="banner error full">{{ error() }}</div> }
            <div class="form-actions full">
              <a class="btn btn-outline" routerLink="/expenditures">Cancel</a>
              <button class="btn btn-primary" type="submit" [disabled]="saving() || !f.valid || !amount() || !!fileError()">{{ saving() ? 'Saving…' : 'Record transaction' }}</button>
            </div>
          </div>
        </form>

        <div class="card">
          <div class="card-head"><h2>Budget position</h2></div>
          @if (selected(); as b) {
            <div class="card-body stack">
              <div><div class="muted small">Budget</div><b>{{ b.title }}</b><div class="mono small muted">{{ b.code }}</div></div>
              <dl class="dl">
                <dt>Allocated</dt><dd>{{ b.allocatedAmount | crore }}</dd>
                <dt>Spent</dt><dd>{{ b.metrics.spent | crore }}</dd>
                <dt>Balance</dt><dd>{{ b.metrics.remaining | crore }}</dd>
                <dt>Time elapsed</dt><dd>{{ b.metrics.timeElapsed | pct }}</dd>
              </dl>
              <div><div class="muted small">Current utilisation</div><app-util-bar [value]="b.metrics.utilization" [time]="b.metrics.timeElapsed" /></div>
              @if (amount()) {
                <div><div class="muted small">After this transaction</div><app-util-bar [value]="afterPct()" [time]="b.metrics.timeElapsed" /></div>
                @if (afterPct() > 100) {
                  <div class="banner error">This transaction takes spending above the approved allocation. It will be recorded and flagged as <b>overspending</b>.</div>
                } @else if (afterPct() >= 90) {
                  <div class="banner warn">Spending will reach {{ afterPct() | pct }} of the allocation.</div>
                }
              }
            </div>
          } @else {
            <app-empty text="Select a budget to see its current position." />
          }
        </div>
      </div>
    }
  `,
})
export class ExpenditureFormPage implements OnInit {
  private api = inject(ApiService);
  private http = inject(HttpClient);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private toast = inject(ToastService);
  fy = inject(FyService);

  budgets = signal<Budget[]>([]);
  selected = signal<Budget | null>(null);
  files = signal<File[]>([]);
  fileError = signal('');
  loading = signal(true);
  saving = signal(false);
  error = signal('');
  categories = EXPENSE_CATEGORIES;
  accept = ACCEPT;
  size = fileSize;

  budgetId = '';
  amountCrore = '';
  date = istDate();
  category = '';
  description = '';
  payee = '';
  referenceNo = '';

  amount = () => croreInputToRupees(this.amountCrore);
  afterPct = () => {
    const b = this.selected();
    const a = this.amount();
    return b && a ? Math.round(((b.metrics.spent + a) / b.allocatedAmount) * 10000) / 100 : 0;
  };
  minDate = computed(() => (this.selected() ? istDate(this.selected()!.periodStart) : ''));
  maxDate = computed(() => {
    const end = this.selected() ? istDate(this.selected()!.periodEnd) : undefined;
    const today = istDate();
    return end && end < today ? end : today;
  });

  async ngOnInit() {
    try {
      const preselect = this.route.snapshot.queryParamMap.get('budget');
      const r = await this.api.get<{ items: Budget[] }>('/budgets', { status: 'ACTIVE' });
      const items = r.items;
      // Most recent FY first, then by code.
      items.sort((a, b) => (a.financialYear === b.financialYear ? a.code.localeCompare(b.code) : a.financialYear < b.financialYear ? 1 : -1));
      this.budgets.set(items);
      if (preselect) this.selectBudget(preselect);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  selectBudget(id: string) {
    this.budgetId = id;
    const b = this.budgets().find((x) => x.id === id) || null;
    this.selected.set(b);
    if (b) {
      const d = this.date;
      if (d < this.minDate() || d > this.maxDate()) this.date = this.maxDate();
    }
  }

  pickFiles(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const list = Array.from(input.files || []);
    this.fileError.set('');
    if (list.length > 3) this.fileError.set('Select at most 3 files.');
    const big = list.find((f) => f.size > MAX_FILE);
    if (big) this.fileError.set(`${big.name} is larger than 2 MB.`);
    this.files.set(list);
  }

  async save() {
    const amount = this.amount();
    if (!amount || !this.selected()) return;
    this.saving.set(true);
    this.error.set('');
    const fd = new FormData();
    fd.append('budget', this.budgetId);
    fd.append('amount', String(amount));
    fd.append('category', this.category);
    fd.append('date', this.date);
    fd.append('description', this.description);
    if (this.payee) fd.append('payee', this.payee);
    if (this.referenceNo) fd.append('referenceNo', this.referenceNo);
    for (const f of this.files()) fd.append('documents', f, f.name);
    try {
      const res = await firstValueFrom(
        this.http.post<{ txnId: string; monitoring: { created: number } | null }>(`${API_BASE}/expenditures`, fd)
      );
      const created = res.monitoring?.created ?? 0;
      this.toast.success(`${res.txnId} recorded.` + (created ? ` Monitoring raised ${created} new alert${created > 1 ? 's' : ''}.` : ''));
      this.router.navigate(['/budgets', this.budgetId]);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
