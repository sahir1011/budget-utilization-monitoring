import { Routes } from '@angular/router';
import { authGuard, guestGuard, roleGuard } from './core/auth.service';
import { ShellComponent } from './layout/shell.component';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], title: 'Sign in', loadComponent: () => import('./pages/login.page').then((m) => m.LoginPage) },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', title: 'Dashboard', loadComponent: () => import('./pages/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'budgets', title: 'Budgets', loadComponent: () => import('./pages/budgets.page').then((m) => m.BudgetsPage) },
      {
        path: 'budgets/new',
        title: 'New budget',
        canActivate: [roleGuard('ADMIN', 'FINANCE_OFFICER')],
        loadComponent: () => import('./pages/budget-form.page').then((m) => m.BudgetFormPage),
      },
      { path: 'budgets/:id', title: 'Budget', loadComponent: () => import('./pages/budget-detail.page').then((m) => m.BudgetDetailPage) },
      {
        path: 'budgets/:id/edit',
        title: 'Edit budget',
        canActivate: [roleGuard('ADMIN', 'FINANCE_OFFICER')],
        loadComponent: () => import('./pages/budget-form.page').then((m) => m.BudgetFormPage),
      },
      { path: 'expenditures', title: 'Expenditures', loadComponent: () => import('./pages/expenditures.page').then((m) => m.ExpendituresPage) },
      { path: 'expenditures/new', title: 'Record expenditure', loadComponent: () => import('./pages/expenditure-form.page').then((m) => m.ExpenditureFormPage) },
      { path: 'departments', title: 'Departments', loadComponent: () => import('./pages/departments.page').then((m) => m.DepartmentsPage) },
      { path: 'departments/:id', title: 'Department', loadComponent: () => import('./pages/department-detail.page').then((m) => m.DepartmentDetailPage) },
      { path: 'alerts', title: 'Alerts', loadComponent: () => import('./pages/alerts.page').then((m) => m.AlertsPage) },
      { path: 'reports', title: 'Reports', loadComponent: () => import('./pages/reports.page').then((m) => m.ReportsPage) },
      { path: 'profile', title: 'My profile', loadComponent: () => import('./pages/profile.page').then((m) => m.ProfilePage) },
      {
        path: 'admin/users',
        title: 'Users',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./pages/admin-users.page').then((m) => m.AdminUsersPage),
      },
      {
        path: 'admin/thresholds',
        title: 'Threshold rules',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./pages/admin-thresholds.page').then((m) => m.AdminThresholdsPage),
      },
      {
        path: 'admin/audit-logs',
        title: 'Audit logs',
        canActivate: [roleGuard('ADMIN')],
        loadComponent: () => import('./pages/audit-logs.page').then((m) => m.AuditLogsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
