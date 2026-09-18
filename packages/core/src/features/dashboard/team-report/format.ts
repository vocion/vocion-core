/**
 * Number and time formatting for the team report — one place, so every
 * figure on the page, the member detail and the lineage sheet reads the
 * same way.
 */

import type { MeasureWindow } from '@/services/team-report';

/**
 * Cents → dollars. Two decimals under $100, whole dollars above (a report
 * about $480 of spend does not need the cents).
 * @param cents - USD cents.
 */
export function usd(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 100) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/**
 * Auto-compact count: 1,284 / 12.9K / 4.2M.
 * @param n - The value.
 */
export function compact(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 10_000) {
    return `${(n / 1_000).toFixed(1)}K`;
  }
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

/**
 * 0..1 → "42%". Sub-1% shows "<1%" rather than rounding to nothing.
 * @param share - A ratio.
 */
export function pct(share: number): string {
  if (share > 0 && share < 0.01) {
    return '<1%';
  }
  return `${Math.round(share * 100)}%`;
}

/**
 * A measure reading in its unit: `$` → dollars, `%` → a percentage (a value
 * at or under 1 is read as a ratio), anything else → compact + unit.
 * @param value - The reading.
 * @param unit - The measure's unit, when declared.
 */
export function measureValue(value: number, unit: string | undefined): string {
  if (unit === '$') {
    return usd(value * 100);
  }
  if (unit === '%') {
    return value <= 1 ? pct(value) : `${Math.round(value)}%`;
  }
  return unit ? `${compact(value)} ${unit}` : compact(value);
}

/**
 * Relative time — "3m ago", "2h ago", "5d ago" — or a short date past a month.
 * @param at - The instant.
 * @param now - The clock.
 */
export function ago(at: Date | null, now: Date = new Date()): string {
  if (!at) {
    return '—';
  }
  const s = Math.max(0, Math.round((now.getTime() - at.getTime()) / 1000));
  if (s < 60) {
    return 'just now';
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)}m ago`;
  }
  if (s < 86_400) {
    return `${Math.floor(s / 3600)}h ago`;
  }
  if (s < 30 * 86_400) {
    return `${Math.floor(s / 86_400)}d ago`;
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * An age, without "ago": "24m", "3h 12m", "5d".
 * @param at - The instant.
 * @param now - The clock.
 */
export function age(at: Date | null, now: Date = new Date()): string {
  return at ? durationMs(now.getTime() - at.getTime()) : '—';
}

/**
 * Milliseconds as "40s" / "6m" / "1h 12m" / "3d 4h".
 * @param ms
 */
export function durationMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  if (h < 48) {
    return m % 60 === 0 ? `${h}h` : `${h}h ${m % 60}m`;
  }
  const d = Math.floor(h / 24);
  return h % 24 === 0 ? `${d}d` : `${d}d ${h % 24}h`;
}

/**
 * Seconds between two instants as "6m" / "1h 12m" / "40s".
 * @param from
 * @param to
 */
export function duration(from: Date | null, to: Date | null): string {
  if (!from || !to) {
    return '—';
  }
  return durationMs(to.getTime() - from.getTime());
}

/**
 * The window label the chips and copy use.
 * @param window - Report or measure window id.
 */
export function windowLabel(window: '24h' | '7d' | '30d' | MeasureWindow): string {
  switch (window) {
    case '24h': return 'Last 24 hours';
    case '7d': return 'Last 7 days';
    case '30d': return 'Last 30 days';
    case 'quarter': return 'This quarter';
  }
}

/**
 * "weekly", "daily", "monthly", "quarterly" — for "80% of weekly target".
 * @param window - Measure window.
 */
export function windowAdjective(window: MeasureWindow): string {
  switch (window) {
    case '24h': return 'daily';
    case '7d': return 'weekly';
    case '30d': return '30-day';
    case 'quarter': return 'quarterly';
  }
}
