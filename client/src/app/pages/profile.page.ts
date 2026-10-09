import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ROLE_LABELS } from '../core/models';
import { ToastService } from '../core/ui.service';

@Component({
  selector: 'app-profile',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head"><div class="titles"><h1>My profile</h1><p>Account details and password.</p></div></div>
    <div class="grid cols-2">
      @if (auth.user(); as u) {
        <div class="card card-body">
          <dl class="dl">
            <dt>Name</dt><dd>{{ u.name }}</dd>
            <dt>Email</dt><dd>{{ u.email }}</dd>
            <dt>Role</dt><dd><span class="badge" [class]="'badge role-' + u.role">{{ roleLabels[u.role] }}</span></dd>
            <dt>Department</dt><dd>{{ u.department ? u.department.name : 'All departments' }}</dd>
            <dt>Last sign-in</dt><dd>{{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM y, h:mm a') : '—' }}</dd>
          </dl>
          <p class="muted small mt">
            @switch (u.role) {
              @case ('ADMIN') { You can manage users, departments, budgets, threshold rules and view audit logs. }
              @case ('FINANCE_OFFICER') { You can create and revise budgets, record and correct expenditure for every department, manage alerts and run monitoring scans. }
              @default { You can view your department's budgets, record expenditure against them, and respond to your department's alerts. }
            }
          </p>
        </div>
      }
      <form class="card" (ngSubmit)="change()">
        <div class="card-head"><h2>Change password</h2></div>
        <div class="card-body stack">
          <div class="field"><label for="cur">Current password</label><input id="cur" class="input" type="password" name="cur" [(ngModel)]="current" autocomplete="current-password" required /></div>
          <div class="field"><label for="np">New password</label><input id="np" class="input" type="password" name="np" [(ngModel)]="next" autocomplete="new-password" required /><span class="hint">At least 8 characters with letters and numbers.</span></div>
          <div class="field"><label for="cp">Confirm new password</label><input id="cp" class="input" type="password" name="cp" [(ngModel)]="confirm" autocomplete="new-password" required />
            @if (confirm && confirm !== next) { <span class="err">Passwords do not match.</span> }
          </div>
          <div class="form-actions"><button class="btn btn-primary" type="submit" [disabled]="busy() || !current || next.length < 8 || next !== confirm">Update password</button></div>
        </div>
      </form>
    </div>
  `,
})
export class ProfilePage {
  auth = inject(AuthService);
  private api = inject(ApiService);
  private toast = inject(ToastService);
  roleLabels = ROLE_LABELS;
  busy = signal(false);
  current = '';
  next = '';
  confirm = '';

  async change() {
    this.busy.set(true);
    try {
      await this.api.post('/auth/change-password', { currentPassword: this.current, newPassword: this.next });
      this.toast.success('Password updated');
      this.current = this.next = this.confirm = '';
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
