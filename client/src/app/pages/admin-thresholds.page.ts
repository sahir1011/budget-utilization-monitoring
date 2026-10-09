import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, errorMessage } from '../core/api.service';
import { ToastService } from '../core/ui.service';
import { LoadingComponent } from '../shared/widgets';

interface Thresholds {
  underUtilization: { enabled: boolean; utilizationBelowPct: number; timeElapsedAbovePct: number };
  overspending: { enabled: boolean; warningPct: number; warningTimeElapsedBelowPct: number; criticalPct: number };
  spike: { enabled: boolean; modifiedZScore: number; medianMultiplier: number; minHistory: number; singleTxnShareOfAllocationPct: number };
  inactivity: { enabled: boolean; days: number };
  paceDeviation: { enabled: boolean; minTimeElapsedPct: number; lagPctPoints: number; projectedOverPct: number };
  highValueUnspentCrore: number;
}

@Component({
  selector: 'app-admin-thresholds',
  imports: [FormsModule, DatePipe, LoadingComponent],
  template: `
    <div class="page-head">
      <div class="titles">
        <h1>Threshold rules</h1>
        <p>Configure the monitoring engine. Saving re-evaluates every budget immediately, raising or auto-resolving alerts.</p>
        @if (updatedAt()) { <p class="small">Last changed {{ updatedAt() | date: 'd MMM y, h:mm a' }} by {{ updatedBy() }}</p> }
      </div>
      <button class="btn btn-outline" (click)="restoreDefaults()" [disabled]="!t()">Restore defaults</button>
    </div>

    @if (!t()) {
      <app-loading />
    } @else {
      <form class="stack" (ngSubmit)="save()">
        @if (t(); as t) {
          <div class="grid cols-2">
            <div class="card">
              <div class="card-head"><h2>Under-utilisation</h2><label class="check"><input type="checkbox" name="uu" [(ngModel)]="t.underUtilization.enabled" /> Enabled</label></div>
              <div class="card-body form-grid">
                <div class="field"><label>Utilisation below (%)</label><input class="input" type="number" min="0" max="100" name="uu1" [(ngModel)]="t.underUtilization.utilizationBelowPct" /></div>
                <div class="field"><label>After time elapsed (%)</label><input class="input" type="number" min="0" max="100" name="uu2" [(ngModel)]="t.underUtilization.timeElapsedAbovePct" /></div>
                <p class="muted small full">Flags budgets with less than {{ t.underUtilization.utilizationBelowPct }}% used after {{ t.underUtilization.timeElapsedAbovePct }}% of the period. Severity escalates when the unspent balance exceeds ₹{{ t.highValueUnspentCrore.toLocaleString('en-IN') }} crore.</p>
                <div class="field"><label>High-value unspent (₹ crore)</label><input class="input" type="number" min="0" name="hv" [(ngModel)]="t.highValueUnspentCrore" /></div>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><h2>Overspending / threshold breach</h2><label class="check"><input type="checkbox" name="os" [(ngModel)]="t.overspending.enabled" /> Enabled</label></div>
              <div class="card-body form-grid">
                <div class="field"><label>Critical above (% of allocation)</label><input class="input" type="number" min="0" name="os1" [(ngModel)]="t.overspending.criticalPct" /></div>
                <div class="field"><label>Warning at (% of allocation)</label><input class="input" type="number" min="0" name="os2" [(ngModel)]="t.overspending.warningPct" /></div>
                <div class="field"><label>…while time elapsed below (%)</label><input class="input" type="number" min="0" max="100" name="os3" [(ngModel)]="t.overspending.warningTimeElapsedBelowPct" /></div>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><h2>Spending spikes (statistical)</h2><label class="check"><input type="checkbox" name="sp" [(ngModel)]="t.spike.enabled" /> Enabled</label></div>
              <div class="card-body form-grid">
                <div class="field"><label>Modified z-score above</label><input class="input" type="number" step="0.1" min="0" name="sp1" [(ngModel)]="t.spike.modifiedZScore" /></div>
                <div class="field"><label>And ≥ × median transaction</label><input class="input" type="number" step="0.1" min="0" name="sp2" [(ngModel)]="t.spike.medianMultiplier" /></div>
                <div class="field"><label>Minimum prior transactions</label><input class="input" type="number" min="2" name="sp3" [(ngModel)]="t.spike.minHistory" /></div>
                <div class="field"><label>Single txn above (% of allocation)</label><input class="input" type="number" min="0" name="sp4" [(ngModel)]="t.spike.singleTxnShareOfAllocationPct" /></div>
                <p class="muted small full">Each transaction is compared with the budget's earlier transactions using the robust median / MAD z-score, so one outlier cannot hide another.</p>
              </div>
            </div>
            <div class="card">
              <div class="card-head"><h2>Dormant funds &amp; pace deviation</h2></div>
              <div class="card-body form-grid">
                <label class="check full"><input type="checkbox" name="in" [(ngModel)]="t.inactivity.enabled" /> Inactivity rule enabled</label>
                <div class="field"><label>No expenditure for (days)</label><input class="input" type="number" min="1" name="in1" [(ngModel)]="t.inactivity.days" /></div>
                <div></div>
                <label class="check full"><input type="checkbox" name="pd" [(ngModel)]="t.paceDeviation.enabled" /> Pace-deviation rule enabled</label>
                <div class="field"><label>Lag beyond (percentage points)</label><input class="input" type="number" min="0" name="pd1" [(ngModel)]="t.paceDeviation.lagPctPoints" /></div>
                <div class="field"><label>Projected utilisation above (%)</label><input class="input" type="number" min="0" name="pd2" [(ngModel)]="t.paceDeviation.projectedOverPct" /></div>
                <div class="field"><label>Start after time elapsed (%)</label><input class="input" type="number" min="0" max="100" name="pd3" [(ngModel)]="t.paceDeviation.minTimeElapsedPct" /></div>
              </div>
            </div>
          </div>
        }
        <div class="form-actions"><button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving & re-scanning…' : 'Save rules & re-scan' }}</button></div>
      </form>
    }
  `,
})
export class AdminThresholdsPage {
  private api = inject(ApiService);
  private toast = inject(ToastService);
  t = signal<Thresholds | null>(null);
  defaults: Thresholds | null = null;
  updatedAt = signal<string | null>(null);
  updatedBy = signal<string | null>(null);
  saving = signal(false);

  constructor() {
    this.load();
  }

  async load() {
    try {
      const r = await this.api.get<{ value: Thresholds; defaults: Thresholds; updatedAt: string | null; updatedBy: string | null }>('/settings/thresholds');
      this.t.set(r.value);
      this.defaults = r.defaults;
      this.updatedAt.set(r.updatedAt);
      this.updatedBy.set(r.updatedBy);
    } catch (e) {
      this.toast.error(errorMessage(e));
    }
  }

  restoreDefaults() {
    if (this.defaults) this.t.set(JSON.parse(JSON.stringify(this.defaults)));
  }

  async save() {
    this.saving.set(true);
    try {
      const r = await this.api.put<{ monitoring: { budgetsEvaluated: number; created: number; autoResolved: number } }>('/settings/thresholds', this.t());
      this.toast.success(`Rules saved. Re-scan: ${r.monitoring.created} new alerts, ${r.monitoring.autoResolved} auto-resolved.`);
      await this.load();
    } catch (e) {
      this.toast.error(errorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
