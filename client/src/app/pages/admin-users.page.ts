import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { DeptRef, ROLE_LABELS, Role, User } from '../core/models';
import { ToastService } from '../core/ui.service';
import { WIDGETS } from '../shared/widgets';

interface UserForm { id?: string; name: string; email: string; role: Role; department: string; password: string; active: boolean }

@Component({
  selector: 'app-admin-users',
  imports: [FormsModule, DatePipe, ...WIDGETS],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Users &amp; roles</h1>
        <p>Role-based access: Administrators manage everything; Finance Officers manage budgets and expenditure across departments; Department Heads see and record only their own department.</p>
      </div>
      <button class="btn btn-primary" (click)="openForm()">+ Add user</button>
    </div>

    <div class="card">
      <div class="filters">
        <div class="field" style="flex: 1"><label for="q">Search</label><input id="q" class="input sm" [(ngModel)]="q" (keyup.enter)="load()" placeholder="Name or email" /></div>
        <div class="field">
          <label for="role">Role</label>
          <select id="role" class="select sm" [(ngModel)]="role" (ngModelChange)="load()">
            <option value="">All roles</option>
            @for (r of roles; track r) { <option [value]="r">{{ roleLabels[r] }}</option> }
          </select>
        </div>
      </div>
      @if (loading()) {
        <app-loading />
      } @else {
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th><th>Last login</th><th></th></tr></thead>
            <tbody>
              @for (u of users(); track u.id) {
                <tr>
                  <td><b>{{ u.name }}</b></td>
                  <td>{{ u.email }}</td>
                  <td><span class="badge" [class]="'badge role-' + u.role">{{ roleLabels[u.role] }}</span></td>
                  <td>{{ u.department ? u.department.code + ' – ' + u.department.name : '—' }}</td>
                  <td><span class="badge" [class]="u.active ? 'badge st-ACTIVE' : 'badge st-CLOSED'">{{ u.active ? 'Active' : 'Inactive' }}</span></td>
                  <td class="nowrap small">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM y, h:mm a') : 'Never' }}</td>
                  <td class="nowrap">
                    <button class="btn btn-ghost btn-xs" (click)="openForm(u)">Edit</button>
                    <button class="btn btn-ghost btn-xs" (click)="resetFor.set(u); newPassword = ''">Reset password</button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (form(); as f) {
      <div class="modal-backdrop" (click)="form.set(null)">
        <form class="card modal" (click)="$event.stopPropagation()" (ngSubmit)="save()">
          <div class="card-head"><h2>{{ f.id ? 'Edit user' : 'Add user' }}</h2><button type="button" class="btn btn-ghost btn-sm" (click)="form.set(null)">✕</button></div>
          <div class="card-body stack">
            <div class="field"><label for="uname">Full name *</label><input id="uname" class="input" name="name" [(ngModel)]="f.name" required /></div>
            <div class="field"><label for="uemail">Email *</label><input id="uemail" class="input" type="email" name="email" [(ngModel)]="f.email" required [disabled]="!!f.id" /></div>
            <div class="field">
              <label for="urole">Role *</label>
              <select id="urole" class="select" name="role" [(ngModel)]="f.role">
                @for (r of roles; track r) { <option [value]="r">{{ roleLabels[r] }}</option> }
              </select>
            </div>
            <div class="field">
              <label for="udept">Department {{ f.role === 'DEPARTMENT_HEAD' ? '*' : '(optional)' }}</label>
              <select id="udept" class="select" name="department" [(ngModel)]="f.department">
                <option value="">— None —</option>
                @for (d of departments(); track d.id) { <option [value]="d.id">{{ d.code }} – {{ d.name }}</option> }
              </select>
              @if (f.role === 'DEPARTMENT_HEAD' && !f.department) { <span class="err">Department Heads must be mapped to a department.</span> }
            </div>
            @if (!f.id) {
              <div class="field"><label for="upw">Initial password *</label><input id="upw" class="input" type="password" name="password" [(ngModel)]="f.password" required autocomplete="new-password" /><span class="hint">At least 8 characters with letters and numbers.</span></div>
            } @else {
              <label class="check"><input type="checkbox" name="active" [(ngModel)]="f.active" [disabled]="f.id === auth.user()?.id" /> Account active</label>
            }
            <div class="form-actions">
              <button type="button" class="btn btn-outline" (click)="form.set(null)">Cancel</button>
              <button class="btn btn-primary" type="submit" [disabled]="!f.name || !f.email || (f.role === 'DEPARTMENT_HEAD' && !f.department) || (!f.id && !f.password)">Save</button>
            </div>
          </div>
        </form>
      </div>
    }

    @if (resetFor(); as u) {
      <div class="modal-backdrop" (click)="resetFor.set(null)">
        <form class="card modal" (click)="$event.stopPropagation()" (ngSubmit)="resetPassword(u)">
          <div class="card-head"><h2>Reset password · {{ u.name }}</h2></div>
          <div class="card-body stack">
            <div class="field"><label for="npw">New password</label><input id="npw" class="input" type="password" name="pw" [(ngModel)]="newPassword" autocomplete="new-password" /><span class="hint">At least 8 characters with letters and numbers.</span></div>
            <div class="form-actions"><button type="button" class="btn btn-outline" (click)="resetFor.set(null)">Cancel</button><button class="btn btn-primary" type="submit" [disabled]="newPassword.length < 8">Reset</button></div>
          </div>
        </form>
      </div>
    }
  `,
})
export class AdminUsersPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  auth = inject(AuthService);

  users = signal<User[]>([]);
  departments = signal<DeptRef[]>([]);
  loading = signal(true);
  form = signal<UserForm | null>(null);
  resetFor = signal<User | null>(null);
  newPassword = '';
  roles: Role[] = ['ADMIN', 'FINANCE_OFFICER', 'DEPARTMENT_HEAD'];
  roleLabels = ROLE_LABELS;
  q = '';
  role = '';

  constructor() {
    this.api.get<{ items: DeptRef[] }>('/departments').then((r) => this.departments.set(r.items)).catch(() => undefined);
    this.load();
  }

  async load() {
    this.loading.set(true);
    try {
      const r = await this.api.get<{ items: User[] }>('/users', { q: this.q, role: this.role });
      this.users.set(r.items);
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openForm(u?: User) {
    this.form.set(
      u
        ? { id: u.id, name: u.name, email: u.email, role: u.role, department: u.department?.id || '', password: '', active: u.active ?? true }
        : { name: '', email: '', role: 'DEPARTMENT_HEAD', department: '', password: '', active: true }
    );
  }

  async save() {
    const f = this.form();
    if (!f) return;
    try {
      if (f.id) await this.api.patch(`/users/${f.id}`, { name: f.name, role: f.role, department: f.department || null, active: f.active });
      else await this.api.post('/users', { name: f.name, email: f.email, role: f.role, department: f.department || null, password: f.password });
      this.toast.success('User saved');
      this.form.set(null);
      this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  async resetPassword(u: User) {
    try {
      await this.api.post(`/users/${u.id}/reset-password`, { password: this.newPassword });
      this.toast.success(`Password reset for ${u.email}`);
      this.resetFor.set(null);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }
}
