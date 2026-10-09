import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ALERT_TYPE_LABELS, Alert, AlertStats, AlertType, DeptRef, Paged } from '../core/models';
import { ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

@Component({
  selector: 'app-alerts',
  imports: [FormsModule, RouterLink, DatePipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Alert centre</h1>
        <p>Anomalies raised by the monitoring engine: rule-based thresholds plus statistical spike detection.</p>
      </div>
      @if (auth.canManageBudgets()) {
        <button class="btn btn-outline" (click)="scan()" [disabled]="scanning()">{{ scanning() ? 'Scanning…' : '⟳ Run monitoring scan' }}</button>
      }
    </div>

    @if (stats(); as s) {
      <div class="grid kpis">
        <div class="card kpi danger"><div class="k-label">Unresolved</div><div class="k-value">{{ s.open }}</div><div class="k-sub">{{ s.totalDetected }} detected in total</div></div>
        <div class="card kpi"><div class="k-label">Critical / High</div><div class="k-value">{{ s.bySeverity.CRITICAL }} / {{ s.bySeverity.HIGH }}</div><div class="k-sub">{{ s.bySeverity.MEDIUM }} medium · {{ s.bySeverity.LOW }} low</div></div>
        <div class="card kpi"><div class="k-label">By type (unresolved)</div>
          <div class="k-sub" style="margin-top: 8px">
            @for (t of typeKeys; track t) { @if (s.byType[t]) { <div class="row" style="justify-content: space-between"><span>{{ typeLabels[t] }}</span><b>{{ s.byType[t] }}</b></div> } }
          </div>
        </div>
        <div class="card kpi"><div class="k-label">Avg. response time</div><div class="k-value">{{ s.avgResponseHours === null ? '—' : s.avgResponseHours + ' h' }}</div><div class="k-sub">detection → acknowledgement</div></div>
      </div>
    }

    <div class="card mt">
      <div class="filters">
        <div class="field">
          <label for="status">Status</label>
          <select id="status" class="select sm" [(ngModel)]="status" (ngModelChange)="reload()">
            <option value="UNRESOLVED">Unresolved</option>
            <option value="OPEN">Open</option>
            <option value="ACKNOWLEDGED">Acknowledged</option>
            <option value="RESOLVED">Resolved</option>
            <option value="">All</option>
          </select>
        </div>
        <div class="field">
          <label for="sev">Severity</label>
          <select id="sev" class="select sm" [(ngModel)]="severity" (ngModelChange)="reload()">
            <option value="">All</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MEDIUM">Medium</option><option value="LOW">Low</option>
          </select>
        </div>
        <div class="field">
          <label for="type">Type</label>
          <select id="type" class="select sm" [(ngModel)]="type" (ngModelChange)="reload()">
            <option value="">All</option>
            @for (t of typeKeys; track t) { <option [value]="t">{{ typeLabels[t] }}</option> }
          </select>
        </div>
        @if (!auth.isDeptHead()) {
          <div class="field">
            <label for="dept">Department</label>
            <select id="dept" class="select sm" [(ngModel)]="department" (ngModelChange)="reload()">
              <option value="">All</option>
              @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }}</option> }
            </select>
          </div>
        }
        @if (budget) { <span class="chip">Filtered to one budget <button class="link-btn" (click)="budget = ''; reload()">✕</button></span> }
      </div>

      @if (loading()) {
        <app-loading />
      } @else if (error()) {
        <div class="card-body"><div class="banner error">{{ error() }}</div></div>
      } @else if (!data()?.items?.length) {
        <app-empty text="No alerts match these filters." />
      } @else {
        @for (a of data()!.items; track a.id) {
          <div class="alert-item">
            <div class="bar" [class]="'bar bar-' + a.severity"></div>
            <div class="body">
              <div class="title">{{ a.title }}</div>
              <div class="msg">{{ a.message }}</div>
              <div class="meta">
                <app-sev [value]="a.severity" />
                <app-alert-type [value]="a.type" />
                <span class="badge" [class]="'badge st-' + a.status">{{ a.status }}</span>
                <span class="mono">{{ a.alertId }}</span>
                <span>{{ a.department.code }}</span>
                @if (a.budget) { <a [routerLink]="['/budgets', a.budget.id]" class="mono">{{ a.budget.code }}</a> }
                @if (a.expenditure) { <span class="mono">{{ a.expenditure.txnId }}</span> }
                <span>Detected {{ a.detectedAt | date: 'd MMM y, h:mm a' }}</span>
              </div>
              @if (a.acknowledgedAt) { <div class="meta">Acknowledged by {{ a.acknowledgedBy || '—' }} · {{ a.acknowledgedAt | date: 'd MMM y, h:mm a' }}</div> }
              @if (a.status === 'RESOLVED') { <div class="note">✔ Resolved by {{ a.resolvedBy || 'System' }} {{ a.resolvedAt ? '· ' + (a.resolvedAt | date: 'd MMM y') : '' }} — {{ a.resolutionNote }}</div> }
              @for (n of a.notes; track n.at) { <div class="note">💬 {{ n.text }} <span class="muted">— {{ n.by }}, {{ n.at | date: 'd MMM, h:mm a' }}</span></div> }
              @if (acting()?.id === a.id) {
                <div class="stack mt" style="gap: 8px">
                  <textarea class="input" [(ngModel)]="note" [placeholder]="acting()!.mode === 'resolve' ? 'Resolution note (required): action taken, justification…' : 'Optional note'"></textarea>
                  <div class="row">
                    <button class="btn btn-primary btn-sm" (click)="confirm(a)" [disabled]="acting()!.mode === 'resolve' && !note.trim()">{{ acting()!.mode === 'resolve' ? 'Mark resolved' : acting()!.mode === 'ack' ? 'Acknowledge' : 'Add note' }}</button>
                    <button class="btn btn-ghost btn-sm" (click)="acting.set(null)">Cancel</button>
                  </div>
                </div>
              }
            </div>
            @if (a.status !== 'RESOLVED' && acting()?.id !== a.id) {
              <div class="actions">
                @if (a.status === 'OPEN') { <button class="btn btn-outline btn-xs" (click)="start(a, 'ack')">Acknowledge</button> }
                <button class="btn btn-primary btn-xs" (click)="start(a, 'resolve')">Resolve</button>
                <button class="btn btn-ghost btn-xs" (click)="start(a, 'note')">Add note</button>
              </div>
            }
          </div>
        }
        <div class="pagination">
          <span>{{ data()!.total }} alerts · page {{ page() }} of {{ pages() }}</span>
          <button class="btn btn-outline btn-xs" [disabled]="page() <= 1" (click)="go(page() - 1)">‹ Prev</button>
          <button class="btn btn-outline btn-xs" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next ›</button>
        </div>
      }
    </div>
  `,
})
export class AlertsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  auth = inject(AuthService);

  data = signal<Paged<Alert> | null>(null);
  stats = signal<AlertStats | null>(null);
  departments = signal<DeptRef[]>([]);
  loading = signal(true);
  error = signal('');
  scanning = signal(false);
  page = signal(1);
  pages = signal(1);
  acting = signal<{ id: string; mode: 'ack' | 'resolve' | 'note' } | null>(null);
  note = '';

  typeLabels = ALERT_TYPE_LABELS;
  typeKeys = Object.keys(ALERT_TYPE_LABELS) as AlertType[];

  status = 'UNRESOLVED';
  severity = '';
  type = '';
  department = this.route.snapshot.queryParamMap.get('department') || '';
  budget = this.route.snapshot.queryParamMap.get('budget') || '';

  constructor() {
    if (!this.auth.isDeptHead()) {
      this.api.get<{ items: DeptRef[] }>('/departments').then((r) => this.departments.set(r.items)).catch(() => undefined);
    }
    if (this.budget) this.status = '';
    this.load();
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
      const [list, stats] = await Promise.all([
        this.api.get<Paged<Alert>>('/alerts', { status: this.status, severity: this.severity, type: this.type, department: this.department, budget: this.budget, page: this.page(), limit: 20 }),
        this.api.get<AlertStats>('/alerts/stats'),
      ]);
      this.data.set(list);
      this.stats.set(stats);
      this.pages.set(Math.max(1, Math.ceil(list.total / list.limit)));
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  start(a: Alert, mode: 'ack' | 'resolve' | 'note') {
    this.note = '';
    this.acting.set({ id: a.id, mode });
  }

  async confirm(a: Alert) {
    const mode = this.acting()?.mode;
    try {
      if (mode === 'ack') await this.api.patch(`/alerts/${a.id}/acknowledge`, { note: this.note });
      else if (mode === 'resolve') await this.api.patch(`/alerts/${a.id}/resolve`, { note: this.note });
      else await this.api.post(`/alerts/${a.id}/notes`, { note: this.note });
      this.toast.success(mode === 'ack' ? `${a.alertId} acknowledged` : mode === 'resolve' ? `${a.alertId} resolved` : 'Note added');
      this.acting.set(null);
      this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async scan() {
    this.scanning.set(true);
    try {
      const r = await this.api.post<{ budgetsEvaluated: number; created: number; autoResolved: number }>('/monitoring/run');
      this.toast.success(`Scan complete: ${r.budgetsEvaluated} budgets, ${r.created} new alerts, ${r.autoResolved} auto-resolved.`);
      this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.scanning.set(false);
    }
  }
}
