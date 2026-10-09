import { Component, ElementRef, OnDestroy, effect, input, viewChild } from '@angular/core';
import Chart from 'chart.js/auto';
import type { ChartConfiguration, ChartType } from 'chart.js';

// Shared palette (validated for contrast on white, colour-blind friendly ordering).
export const PALETTE = ['#2563eb', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b', '#0ea5e9', '#a855f7'];

Chart.defaults.font.family = "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#475569';
Chart.defaults.plugins.legend.labels.boxWidth = 12;
Chart.defaults.plugins.legend.labels.boxHeight = 12;
Chart.defaults.maintainAspectRatio = false;

@Component({
  selector: 'app-chart',
  template: `<div class="chart-box" [style.height.px]="height()"><canvas #canvas></canvas></div>`,
  styles: [`.chart-box { position: relative; width: 100%; }`],
})
export class ChartComponent implements OnDestroy {
  type = input.required<ChartType>();
  data = input.required<ChartConfiguration['data']>();
  options = input<ChartConfiguration['options']>({});
  height = input(280);

  private canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;
  private chartType?: ChartType;

  constructor() {
    effect(() => {
      const type = this.type();
      const data = this.data();
      const options = this.options();
      const el = this.canvas().nativeElement;
      if (this.chart && this.chartType === type) {
        this.chart.data = data;
        this.chart.options = options as never;
        this.chart.update();
      } else {
        this.chart?.destroy();
        this.chart = new Chart(el, { type, data, options } as ChartConfiguration);
        this.chartType = type;
      }
    });
  }

  ngOnDestroy() {
    this.chart?.destroy();
  }
}
