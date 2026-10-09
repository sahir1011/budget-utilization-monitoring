import { Component, inject, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { ROLE_LABELS, Role } from '../core/models';
import { ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

interface Log {
  id: string; action: string; entity: string; entityId?: string; summary: string;
  changes?: Record<string, { from: unknown; to: unknown }>; userName?: string; userRole?: Role; ip?: string; at: string;
}

@Component({
  selector: 'app-audit-logs',
  imports: [FormsModule, DatePipe, JsonPipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Audit logs</h1>
        <p>Append-only trail of financial changes, sign-ins, exports and configuration updates, with field-level before/after values.</p>
      </div>
    </div>
    <div class="card">
      <div class="filters">
        <div class="field" style="flex: 1"><label for="q">Search</label><input id="q" class="input sm" [(ngModel)]="q" (keyup.enter)="reload()" placeholder="Summary or user" /></div>
        <div class="field">
          <label for="entity">Entity</label>
          <select id="entity" class="select sm" [(ngModel)]="entity" (ngModelChange)="reload()"><option value="">All</option>@for (e of entities(); track e) { <option [value]="e">{{ e }}</option> }</select>
        </div>
        <div class="field">
          <label for="action">Action</label>
          <select id="action" class="select sm" [(ngModel)]="action" (ngModelChange)="reload()"><option value="">All</option>@for (a of actions(); track a) { <option [value]="a">{{ a }}</option> }</select>
        </div>
        <div class="field"><label for="from">From</label><input id="from" type="date" class="input sm" [(ngModel)]="from" (change)="reload()" /></div>
        <div class="field"><label for="to">To</label><input id="to" type="date" class="input sm" [(ngModel)]="to" (change)="reload()" /></div>
      </div>
      @if (loading()) {
        <app-loading />
      } @else if (!items().length) {
        <app-empty text="No audit entries match these filters." />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Entity</th><th>Summary</th><th></th></tr></thead>
            <tbody>
              @for (l of items(); track l.id) {
                <tr>
                  <td class="nowrap small">{{ l.at | date: 'd MMM y, h:mm:ss a' }}</td>
                  <td class="small">{{ l.userName || 'System' }}@if (l.userRole) {<div class="muted">{{ roleLabels[l.userRole] }}</div>}</td>
                  <td><span class="chip">{{ l.action }}</span></td>
                  <td class="small">{{ l.entity }}</td>
                  <td>{{ l.summary }}
                    @if (open() === l.id && l.changes) {
                      <table class="table mt" style="font-size: 12px">
                        <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
                        <tbody>
                          @for (c of entries(l.changes); track c[0]) {
                            <tr><td class="mono">{{ c[0] }}</td><td class="mono">{{ c[1].from | json }}</td><td class="mono">{{ c[1].to | json }}</td></tr>
                          }
                        </tbody>
                      </table>
                      <div class="muted small">IP {{ l.ip }} · record {{ l.entityId }}</div>
                    }
                  </td>
                  <td>@if (l.changes && entries(l.changes).length) { <button class="btn btn-ghost btn-xs" (click)="open.set(open() === l.id ? null : l.id)">{{ open() === l.id ? 'Hide' : 'Changes' }}</button> }</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="pagination">
          <span>{{ total() }} entries · page {{ page() }} of {{ pages() }}</span>
          <button class="btn btn-outline btn-xs" [disabled]="page() <= 1" (click)="go(page() - 1)">‹ Prev</button>
          <button class="btn btn-outline btn-xs" [disabled]="page() >= pages()" (click)="go(page() + 1)">Next ›</button>
        </div>
      }
    </div>
  `,
})
export class AuditLogsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  items = signal<Log[]>([]);
  entities = signal<string[]>([]);
  actions = signal<string[]>([]);
  total = signal(0);
  page = signal(1);
  pages = signal(1);
  loading = signal(true);
  open = signal<string | null>(null);
  roleLabels = ROLE_LABELS;
  q = '';
  entity = '';
  action = '';
  from = '';
  to = '';

  constructor() {
    this.load();
  }

  entries(c: Record<string, { from: unknown; to: unknown }>) {
    return Object.entries(c);
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
    try {
      const r = await this.api.get<{ items: Log[]; total: number; limit: number; entities: string[]; actions: string[] }>('/audit-logs', {
        q: this.q, entity: this.entity, action: this.action, from: this.from, to: this.to, page: this.page(), limit: 30,
      });
      this.items.set(r.items);
      this.total.set(r.total);
      this.entities.set(r.entities);
      this.actions.set(r.actions);
      this.pages.set(Math.max(1, Math.ceil(r.total / r.limit)));
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
