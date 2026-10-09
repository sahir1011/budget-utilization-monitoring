import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { ApiService } from './api.service';
import { Role, User } from './models';

const TOKEN_KEY = 'bums.token';
const USER_KEY = 'bums.user';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable (private mode) – session lives in memory only */
  }
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private api = inject(ApiService);
  private router = inject(Router);

  readonly token = signal<string | null>(read(TOKEN_KEY));
  readonly user = signal<User | null>(this.restoreUser());
  readonly isLoggedIn = computed(() => !!this.token() && !!this.user());
  readonly role = computed(() => this.user()?.role ?? null);
  readonly isAdmin = computed(() => this.role() === 'ADMIN');
  readonly canManageBudgets = computed(() => this.role() === 'ADMIN' || this.role() === 'FINANCE_OFFICER');
  readonly isDeptHead = computed(() => this.role() === 'DEPARTMENT_HEAD');

  private restoreUser(): User | null {
    const raw = read(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as User;
    } catch {
      return null;
    }
  }

  hasRole(...roles: Role[]): boolean {
    const r = this.role();
    return !!r && roles.includes(r);
  }

  async login(email: string, password: string): Promise<void> {
    const res = await this.api.post<{ token: string; user: User }>('/auth/login', { email, password });
    this.token.set(res.token);
    this.user.set(res.user);
    write(TOKEN_KEY, res.token);
    write(USER_KEY, JSON.stringify(res.user));
  }

  async refreshProfile(): Promise<void> {
    if (!this.token()) return;
    const res = await this.api.get<{ user: User }>('/auth/me');
    this.user.set(res.user);
    write(USER_KEY, JSON.stringify(res.user));
  }

  logout(redirect = true): void {
    this.token.set(null);
    this.user.set(null);
    write(TOKEN_KEY, null);
    write(USER_KEY, null);
    if (redirect) this.router.navigate(['/login']);
  }
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && token && !req.url.endsWith('/auth/login')) auth.logout();
      return throwError(() => err);
    })
  );
};

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? true : inject(Router).createUrlTree(['/login']);
};

export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isLoggedIn() ? inject(Router).createUrlTree(['/dashboard']) : true;
};

export const roleGuard = (...roles: Role[]): CanActivateFn => () => {
  const auth = inject(AuthService);
  return auth.hasRole(...roles) ? true : inject(Router).createUrlTree(['/dashboard']);
};
