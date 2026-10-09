import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { CompactPipe, CrorePipe, PctPipe } from '../core/format';
import { FyService, ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

interface DeptRow {
  id: string; code: string; name: string; description?: string; active: boolean;
  heads: { name: string; email: string }[];
  allocated: number; spent: number; remaining: number; utilization: number; budgetCount: number; avgRiskScore: number; openAlerts: number;
}

@Component({
  selector: 'app-departments',
  imports: [FormsModule, RouterLink, CrorePipe, CompactPipe, PctPipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Departments</h1>
        <p>Department-wise financial position for FY {{ fy.selected() }}{{ timeElapsed() !== null ? ' · ' + timeElapsed()!.toFixed(1) + '% of the year elapsed' : '' }}.</p>
      </div>
      @if (auth.isAdmin()) {
        <button class="btn btn-primary" (click)="openForm()">+ Add department</button>
      }
    </div>

    @if (loading()) {
      <app-loading />
    } @else if (error()) {
      <div class="banner error">{{ error() }}</div>
    } @else {
      <div class="card">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr><th>Department</th><th>Head(s)</th><th class="num">Budgets</th><th class="num">Allocated</th><th class="num">Spent</th><th>Utilisation</th><th class="num">Open alerts</th><th class="text-right">Avg risk</th>@if (auth.isAdmin()) {<th></th>}</tr>
            </thead>
            <tbody>
              @for (d of rows(); track d.id) {
                <tr>
                  <td class="title-cell">
                    <a [routerLink]="['/departments', d.id]"><b>{{ d.code }}</b> · {{ d.name }}</a>
                    @if (!d.active) { <span class="badge st-CLOSED">Inactive</span> }
                    <div class="sub">{{ d.description }}</div>
                  </td>
                  <td class="small">@for (h of d.heads; track h.email) { <div>{{ h.name }}</div> } @empty { <span class="muted">Unassigned</span> }</td>
                  <td class="num">{{ d.budgetCount }}</td>
                  <td class="num">{{ d.allocated | compact }}</td>
                  <td class="num">{{ d.spent | compact }}</td>
                  <td><app-util-bar [value]="d.utilization" [time]="timeElapsed()" /></td>
                  <td class="num">@if (d.openAlerts) { <a [routerLink]="['/alerts']" [queryParams]="{ department: d.id }" class="badge s-CRITICAL">{{ d.openAlerts }}</a> } @else { 0 }</td>
                  <td class="text-right"><app-risk [value]="d.avgRiskScore" /></td>
                  @if (auth.isAdmin()) {
                    <td class="nowrap"><button class="btn btn-ghost btn-xs" (click)="openForm(d)">Edit</button></td>
                  }
                </tr>
              }
            </tbody>
            <tfoot>
              <tr><td colspan="3">Total</td><td class="num">{{ total().allocated | crore }}</td><td class="num">{{ total().spent | crore }}</td><td colspan="4">{{ total().utilization | pct: 2 }}</td></tr>
            </tfoot>
          </table>
        </div>
      </div>
    }

    @if (editing(); as e) {
      <div class="modal-backdrop" (click)="editing.set(null)">
        <form class="card modal" (click)="$event.stopPropagation()" (ngSubmit)="saveDept()">
          <div class="card-head"><h2>{{ e.id ? 'Edit department' : 'Add department' }}</h2><button type="button" class="btn btn-ghost btn-sm" (click)="editing.set(null)">✕</button></div>
          <div class="card-body stack">
            <div class="field"><label for="dcode">Code *</label><input id="dcode" class="input mono" name="code" [(ngModel)]="e.code" [disabled]="!!e.id" required maxlength="12" /></div>
            <div class="field"><label for="dname">Name *</label><input id="dname" class="input" name="name" [(ngModel)]="e.name" required maxlength="150" /></div>
            <div class="field"><label for="ddesc">Description</label><textarea id="ddesc" class="input" name="description" [(ngModel)]="e.description"></textarea></div>
            @if (e.id) { <label class="check"><input type="checkbox" name="active" [(ngModel)]="e.active" /> Active</label> }
            <div class="form-actions">
              <button type="button" class="btn btn-outline" (click)="editing.set(null)">Cancel</button>
              <button class="btn btn-primary" type="submit" [disabled]="!e.code || !e.name">Save</button>
            </div>
          </div>
        </form>
      </div>
    }
  `,
})
export class DepartmentsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);
  fy = inject(FyService);

  rows = signal<DeptRow[]>([]);
  loading = signal(true);
  error = signal('');
  timeElapsed = signal<number | null>(null);
  editing = signal<{ id?: string; code: string; name: string; description: string; active: boolean } | null>(null);
  total = signal({ allocated: 0, spent: 0, utilization: 0 });

  constructor() {
    effect(() => this.load(this.fy.selected()));
  }

  async load(fy: string) {
    this.loading.set(true);
    this.error.set('');
    try {
      const [r, dash] = await Promise.all([
        this.api.get<{ items: DeptRow[] }>('/departments', { fy }),
        this.api.get<{ timeElapsed: number }>('/dashboard', { fy }),
      ]);
      this.rows.set(r.items);
      this.timeElapsed.set(dash.timeElapsed);
      const allocated = r.items.reduce((a, d) => a + d.allocated, 0);
      const spent = r.items.reduce((a, d) => a + d.spent, 0);
      this.total.set({ allocated, spent, utilization: allocated ? Math.round((spent / allocated) * 10000) / 100 : 0 });
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openForm(d?: DeptRow) {
    this.editing.set(d ? { id: d.id, code: d.code, name: d.name, description: d.description || '', active: d.active } : { code: '', name: '', description: '', active: true });
  }

  async saveDept() {
    const e = this.editing();
    if (!e) return;
    try {
      if (e.id) await this.api.patch(`/departments/${e.id}`, { name: e.name, description: e.description, active: e.active });
      else await this.api.post('/departments', { code: e.code, name: e.name, description: e.description });
      this.toast.success('Department saved');
      this.editing.set(null);
      this.load(this.fy.selected());
    } catch (err) {
      this.toast.error(errorMessage(err));
    }
  }
}
