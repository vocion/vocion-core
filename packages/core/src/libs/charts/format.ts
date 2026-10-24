/**
 * Numbers on a chart: the y ticks and the value format. Pure.
 */

import type { ChartSpec } from './spec';

/**
 * Round y ticks from 0 to the first round value at or above `max`, so no
 * mark rises past the axis.
 * @param max - The largest value drawn.
 * @param count - About how many intervals.
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) {
    return [0];
  }
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; ticks.length === 0 || ticks[ticks.length - 1]! < max - step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

/**
 * Ticks for a domain that may dip below zero (a waterfall with a loss).
 * @param min - The smallest value drawn (≤ 0 to include the baseline).
 * @param max - The largest.
 */
export function niceDomain(min: number, max: number): number[] {
  if (min >= 0) {
    return niceTicks(max);
  }
  const span = Math.max(max, 0) - min;
  const up = niceTicks(span);
  const step = up.length > 1 ? up[1]! - up[0]! : span || 1;
  const lo = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = lo; ticks.length === 0 || ticks[ticks.length - 1]! < max - step * 0.001; v += step) {
    ticks.push(Math.round(v * 1e6) / 1e6);
  }
  return ticks;
}

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', CAD: '$', AUD: '$', EUR: '€', GBP: '£', JPY: '¥' };

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  const scaled = abs >= 1e9 ? [v / 1e9, 'B'] : abs >= 1e6 ? [v / 1e6, 'M'] : abs >= 1e3 ? [v / 1e3, 'k'] : [v, ''];
  const [n, suffix] = scaled as [number, string];
  const digits = Math.abs(n) >= 100 || suffix === '' ? 0 : Math.abs(n) >= 10 ? 1 : 2;
  const text = suffix === '' && !Number.isInteger(n) ? (Math.round(n * 100) / 100).toString() : String(Number(n.toFixed(digits)));
  return `${text}${suffix}`;
}

/** How a spec's values read: currency, percent, a noun unit, or a bare number. */
export type ValueFormat = { kind: 'currency'; symbol: string } | { kind: 'percent' } | { kind: 'unit'; unit: string } | { kind: 'number' };

/**
 * The format a spec's values take, reading the legacy `unit` ("$", "%", "deals").
 * @param spec - The chart.
 */
export function valueFormatOf(spec: Pick<ChartSpec, 'format' | 'currency' | 'unit'>): ValueFormat {
  if (spec.format === 'currency' || spec.unit === '$') {
    return { kind: 'currency', symbol: CURRENCY_SYMBOL[(spec.currency ?? 'USD').toUpperCase()] ?? `${(spec.currency ?? 'USD').toUpperCase()} ` };
  }
  if (spec.format === 'percent' || spec.unit === '%') {
    return { kind: 'percent' };
  }
  if (spec.unit) {
    return { kind: 'unit', unit: spec.unit };
  }
  return { kind: 'number' };
}

/**
 * One value as a chart says it: "$4.3M", "18%", "12 deals". Compact by default.
 * @param v - The value.
 * @param f - The format.
 * @param compact - Abbreviate thousands and millions.
 */
export function formatValue(v: number, f: ValueFormat, compact = true): string {
  const sign = v < 0 ? '−' : '';
  const n = compact ? compactNumber(Math.abs(v)) : Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
  switch (f.kind) {
    case 'currency':
      return `${sign}${f.symbol}${n}`;
    case 'percent':
      return `${sign}${n}%`;
    case 'unit':
      return `${sign}${n} ${f.unit}`;
    default:
      return `${sign}${n}`;
  }
}
