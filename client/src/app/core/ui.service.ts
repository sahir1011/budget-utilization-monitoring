import { Injectable, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { currentFinancialYear } from './format';

export interface Toast { id: number; kind: 'success' | 'error' | 'info'; text: string }

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(text: string, kind: Toast['kind'] = 'info', ms = 4500) {
    const id = ++this.seq;
    this.toasts.update((t) => [...t, { id, kind, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
  success(text: string) { this.show(text, 'success'); }
  error(text: string) { this.show(text, 'error', 7000); }
  dismiss(id: number) { this.toasts.update((t) => t.filter((x) => x.id !== id)); }
}

const FY_KEY = 'bums.fy';

/** Globally selected financial year, shared by every page. */
@Injectable({ providedIn: 'root' })
export class FyService {
  private api = inject(ApiService);
  readonly years = signal<string[]>([]);
  readonly selected = signal<string>(this.restore());

  private restore(): string {
    try {
      return localStorage.getItem(FY_KEY) || currentFinancialYear();
    } catch {
      return currentFinancialYear();
    }
  }

  select(fy: string) {
    this.selected.set(fy);
    try { localStorage.setItem(FY_KEY, fy); } catch { /* ignore */ }
  }

  async load() {
    try {
      const res = await this.api.get<{ items: string[] }>('/budgets/financial-years');
      const current = currentFinancialYear();
      const years = Array.from(new Set([...res.items, current])).sort().reverse();
      this.years.set(years);
      if (!years.includes(this.selected())) this.select(res.items.includes(current) || !res.items.length ? current : res.items[0]);
    } catch {
      this.years.set([this.selected()]);
    }
  }
}
