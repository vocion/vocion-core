/**
 * Number and time formatting for the team report — one place, so every
 * figure on the page and the member detail reads the same way.
 */

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
  return n.toLocaleString();
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
 * Seconds between two instants as "6m" / "1h 12m" / "40s".
 * @param from
 * @param to
 */
export function duration(from: Date | null, to: Date | null): string {
  if (!from || !to) {
    return '—';
  }
  const s = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * The window label the chips and copy use.
 * @param window - Report window id.
 */
export function windowLabel(window: '24h' | '7d' | 'all'): string {
  return window === '24h' ? 'Last 24 hours' : window === '7d' ? 'Last 7 days' : 'All time';
}
