import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { errorMessage } from '../core/api.service';
import { AuthService } from '../core/auth.service';

// Demo accounts created by the seed script (server/seed/data.js). Shown so evaluators can explore each role.
const DEMO_ACCOUNTS = [
  { label: 'Administrator', email: 'admin@example.com', password: 'Admin@12345' },
  { label: 'Finance Officer', email: 'finance@example.com', password: 'Finance@12345' },
  { label: 'Dept. Head – Jal Shakti', email: 'head.mojs@example.com', password: 'Head@12345' },
  { label: 'Dept. Head – Defence', email: 'head.mod@example.com', password: 'Head@12345' },
];

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <div class="login-page">
      <section class="login-hero">
        <div>
          <div class="brand" style="padding: 0">
            <div class="brand-mark">₹</div>
            <div>
              <div class="brand-name">Budget Utilization Monitor</div>
              <div class="brand-sub">AI-based monitoring system</div>
            </div>
          </div>
          <h1>Real-time visibility into how public funds are being used.</h1>
          <p class="lead">Track allocations against expenditure across ministries and schemes, and catch under-utilisation, overspending and irregular spending early.</p>
          <div class="hero-points">
            <div><span class="dot">◔</span><span><b>Live utilisation</b>: utilisation % against time elapsed for every budget head.</span></div>
            <div><span class="dot">⚑</span><span><b>Anomaly detection</b>: rule-based checks plus robust statistical spike detection and risk scoring.</span></div>
            <div><span class="dot">⎙</span><span><b>Accountability</b>: role-based access, audit trail and downloadable PDF/CSV reports.</span></div>
          </div>
        </div>
        <p class="small" style="color: #94a3b8">Reference data: Union Budget of India 2026-27 (BE) and 2025-26 (BE/RE), via PRS Legislative Research.</p>
      </section>

      <section class="login-panel">
        <div class="login-card">
          <h1>Sign in</h1>
          <p class="muted" style="margin-top: 6px">Use your official account credentials.</p>
          <form class="stack mt" (ngSubmit)="submit()" autocomplete="on">
            <div class="field">
              <label for="email">Email</label>
              <input id="email" class="input" type="email" name="email" [(ngModel)]="email" required autocomplete="username" />
            </div>
            <div class="field">
              <label for="password">Password</label>
              <input id="password" class="input" type="password" name="password" [(ngModel)]="password" required autocomplete="current-password" />
            </div>
            @if (error()) {
              <div class="banner error">{{ error() }}</div>
            }
            <button class="btn btn-primary" type="submit" [disabled]="busy() || !email || !password">
              {{ busy() ? 'Signing in…' : 'Sign in' }}
            </button>
          </form>

          <div class="demo-accounts card card-body">
            <h3>Demo accounts</h3>
            <p class="muted small">Click to fill in the credentials for a role.</p>
            @for (a of demo; track a.email) {
              <button type="button" class="btn btn-outline btn-sm" (click)="fill(a.email, a.password)">
                <span>{{ a.label }}</span><span class="muted small">{{ a.email }}</span>
              </button>
            }
          </div>
        </div>
      </section>
    </div>
  `,
})
export class LoginPage {
  private auth = inject(AuthService);
  private router = inject(Router);
  email = '';
  password = '';
  busy = signal(false);
  error = signal('');
  demo = DEMO_ACCOUNTS;

  fill(email: string, password: string) {
    this.email = email;
    this.password = password;
    this.error.set('');
  }

  async submit() {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.login(this.email.trim(), this.password);
      this.router.navigate(['/dashboard']);
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
