import { Component, computed, input } from '@angular/core';
import { ALERT_TYPE_LABELS, AlertType, HEALTH_LABELS, Health, Severity } from '../core/models';

/** Utilisation bar with a marker showing how much of the period has elapsed. */
@Component({
  selector: 'app-util-bar',
  template: `
    <div class="util" [title]="tooltip()">
      <div class="util-track">
        <div class="util-fill" [class]="'util-fill ' + tone()" [style.width.%]="fill()"></div>
        @if (time() !== null) {
          <div class="util-marker" [style.left.%]="markerPos()"></div>
        }
      </div>
      @if (showLabel()) {
        <span class="util-label">{{ value().toFixed(1) }}%</span>
      }
    </div>
  `,
})
export class UtilBarComponent {
  value = input.required<number>();
  time = input<number | null>(null);
  showLabel = input(true);
  fill = computed(() => Math.min(100, Math.max(0, this.value())));
  markerPos = computed(() => Math.min(100, Math.max(0, this.time() ?? 0)));
  tone = computed(() => {
    const v = this.value();
    const t = this.time();
    if (v > 100) return 'danger';
    if (t !== null && t >= 70 && v < 40) return 'danger';
    if (v >= 90) return 'warn';
    if (t !== null && t - v > 30) return 'warn';
    return 'ok';
  });
  tooltip = computed(() => `Utilised ${this.value().toFixed(2)}%` + (this.time() !== null ? ` • Time elapsed ${this.time()!.toFixed(1)}%` : ''));
}

@Component({
  selector: 'app-health',
  template: `<span class="badge" [class]="'badge h-' + value()">{{ labels[value()] }}</span>`,
})
export class HealthBadgeComponent {
  value = input.required<Health>();
  labels = HEALTH_LABELS;
}

@Component({
  selector: 'app-sev',
  template: `<span class="badge" [class]="'badge s-' + value()">{{ value() }}</span>`,
})
export class SeverityBadgeComponent {
  value = input.required<Severity>();
}

@Component({
  selector: 'app-alert-type',
  template: `<span class="chip">{{ labels[value()] || value() }}</span>`,
})
export class AlertTypeComponent {
  value = input.required<AlertType>();
  labels = ALERT_TYPE_LABELS;
}

@Component({
  selector: 'app-risk',
  template: `<span class="risk" [class]="'risk r-' + level()" [title]="'Risk score ' + value() + '/100'">{{ value() }}</span>`,
})
export class RiskComponent {
  value = input.required<number>();
  level = computed(() => (this.value() >= 75 ? 'critical' : this.value() >= 50 ? 'high' : this.value() >= 25 ? 'moderate' : 'low'));
}

@Component({
  selector: 'app-empty',
  template: `<div class="empty"><div class="empty-icon">∅</div><p>{{ text() }}</p></div>`,
})
export class EmptyComponent {
  text = input('Nothing to show yet.');
}

@Component({
  selector: 'app-loading',
  template: `<div class="loading"><span class="spinner"></span> Loading…</div>`,
})
export class LoadingComponent {}

export const WIDGETS = [UtilBarComponent, HealthBadgeComponent, SeverityBadgeComponent, AlertTypeComponent, RiskComponent, EmptyComponent, LoadingComponent];
