import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { AlertStats, ROLE_LABELS } from '../core/models';
import { FyService } from '../core/ui.service';

interface NavItem { path: string; label: string; icon: string; admin?: boolean; badge?: boolean }

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  template: `
    <div class="shell">
      <aside class="sidebar" [class.open]="menuOpen()">
        <div class="brand">
          <div class="brand-mark">₹</div>
          <div>
            <div class="brand-name">Budget Utilization Monitor</div>
            <div class="brand-sub">AI-based monitoring system</div>
          </div>
        </div>
        <nav class="nav">
          <div class="nav-section">Monitoring</div>
          @for (item of mainNav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="active" (click)="menuOpen.set(false)">
              <span class="ico">{{ item.icon }}</span> {{ item.label }}
              @if (item.badge && openAlerts() > 0) {
                <span class="count">{{ openAlerts() }}</span>
              }
            </a>
          }
          @if (auth.isAdmin()) {
            <div class="nav-section">Administration</div>
            @for (item of adminNav; track item.path) {
              <a [routerLink]="item.path" routerLinkActive="active" (click)="menuOpen.set(false)">
                <span class="ico">{{ item.icon }}</span> {{ item.label }}
              </a>
            }
          }
        </nav>
        <div class="sidebar-foot">Data: Union Budget 2026-27 (BE) &amp; 2025-26 (BE/RE)</div>
      </aside>

      <div class="main">
        <header class="topbar">
          <button class="btn btn-ghost btn-sm menu-btn" (click)="menuOpen.set(!menuOpen())" aria-label="Toggle menu">☰</button>
          <div class="row">
            <label class="muted small" for="fy">Financial year</label>
            <select id="fy" class="select sm" style="width: 120px" [ngModel]="fy.selected()" (ngModelChange)="fy.select($event)">
              @for (y of fy.years(); track y) {
                <option [value]="y">FY {{ y }}</option>
              }
            </select>
          </div>
          <div class="spacer"></div>
          @if (auth.user(); as u) {
            <a class="user-chip" routerLink="/profile" title="My profile">
              <div class="avatar">{{ initials() }}</div>
              <div class="user-meta">
                <div class="n">{{ u.name }}</div>
                <div class="r">{{ roleLabels[u.role] }}{{ u.department ? ' · ' + u.department.code : '' }}</div>
              </div>
            </a>
          }
          <button class="btn btn-outline btn-sm" (click)="auth.logout()">Sign out</button>
        </header>
        <main class="content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  fy = inject(FyService);
  private api = inject(ApiService);
  private router = inject(Router);

  menuOpen = signal(false);
  openAlerts = signal(0);
  roleLabels = ROLE_LABELS;
  initials = computed(() => (this.auth.user()?.name || '?').split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]).join('').toUpperCase());

  mainNav: NavItem[] = [
    { path: '/dashboard', label: 'Dashboard', icon: '◧' },
    { path: '/budgets', label: 'Budgets', icon: '▤' },
    { path: '/expenditures', label: 'Expenditures', icon: '⇄' },
    { path: '/departments', label: 'Departments', icon: '▦' },
    { path: '/alerts', label: 'Alerts', icon: '⚑', badge: true },
    { path: '/reports', label: 'Reports', icon: '⎙' },
  ];
  adminNav: NavItem[] = [
    { path: '/admin/users', label: 'Users & Roles', icon: '☺' },
    { path: '/admin/thresholds', label: 'Threshold Rules', icon: '⚙' },
    { path: '/admin/audit-logs', label: 'Audit Logs', icon: '☰' },
  ];

  ngOnInit() {
    this.fy.load();
    this.auth.refreshProfile().catch(() => undefined);
    this.refreshAlertCount();
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.refreshAlertCount());
  }

  private async refreshAlertCount() {
    try {
      const s = await this.api.get<AlertStats>('/alerts/stats');
      this.openAlerts.set(s.open);
    } catch {
      /* non-critical */
    }
  }
}
