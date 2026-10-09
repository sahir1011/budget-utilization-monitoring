import { Pipe, PipeTransform } from '@angular/core';

export const RUPEES_PER_CRORE = 10_000_000;

const crFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Rupees -> "₹ 1,23,456.78 Cr" */
export function formatCrore(rupees: number | null | undefined, withUnit = true): string {
  if (rupees === null || rupees === undefined || Number.isNaN(rupees)) return '—';
  const s = crFmt.format(rupees / RUPEES_PER_CRORE);
  return withUnit ? `₹ ${s} Cr` : s;
}

/** Compact: ₹ 7.85 L Cr / ₹ 63,500 Cr / ₹ 42.5 L */
export function formatCompact(rupees: number | null | undefined): string {
  if (rupees === null || rupees === undefined) return '—';
  const crore = rupees / RUPEES_PER_CRORE;
  const abs = Math.abs(crore);
  if (abs >= 100_000) return `₹ ${(crore / 100_000).toFixed(2)} L Cr`;
  if (abs >= 1) return `₹ ${intFmt.format(Math.round(crore))} Cr`;
  return `₹ ${(rupees / 100_000).toFixed(2)} L`;
}

/** "12.34" crore string -> integer rupees (₹1 lakh precision). Returns null when invalid. */
export function croreInputToRupees(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const lakh = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  const rupees = lakh * 100_000;
  return rupees > 0 && Number.isSafeInteger(rupees) ? rupees : null;
}

export function rupeesToCroreInput(rupees: number): string {
  return (rupees / RUPEES_PER_CRORE).toFixed(2);
}

@Pipe({ name: 'crore' })
export class CrorePipe implements PipeTransform {
  transform(v: number | null | undefined, withUnit = true): string {
    return formatCrore(v, withUnit);
  }
}

@Pipe({ name: 'compact' })
export class CompactPipe implements PipeTransform {
  transform(v: number | null | undefined): string {
    return formatCompact(v);
  }
}

@Pipe({ name: 'pct' })
export class PctPipe implements PipeTransform {
  transform(v: number | null | undefined, digits = 1): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '—';
    return `${v.toFixed(digits)}%`;
  }
}

@Pipe({ name: 'label' })
export class LabelPipe implements PipeTransform {
  transform(v: string | null | undefined, map?: Record<string, string>): string {
    if (!v) return '';
    if (map && map[v]) return map[v];
    return v.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

const IST_OFFSET_MS = 330 * 60 * 1000;

/** YYYY-MM-DD calendar date in India Standard Time (budget periods are defined in IST). */
export function istDate(value: string | Date = new Date()): string {
  return new Date(new Date(value).getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function currentFinancialYear(d = new Date()): string {
  const [y, m] = istDate(d).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
