/** Formatting helpers shared by the adoption views. */

export const formatPercent = (v: number | null): string =>
  v == null ? '—' : `${Math.round(v * 100)}%`;

export const formatCount = (v: number): string => v.toLocaleString();

/** "3d ago" style relative timestamp; '—' for never. */
export function formatAgo(d: Date | string | null): string {
  if (!d) {
    return '—';
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  const ms = Date.now() - date.getTime();
  if (ms < 0) {
    return 'now';
  }
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 60) {
    return `${days}d ago`;
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Median decision latency etc. — humanize a millisecond duration. */
export function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '—';
  }
  if (ms < 1000) {
    return '<1s';
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.round(s / 60);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.round(m / 60);
  if (h < 48) {
    return `${h}h`;
  }
  return `${Math.round(h / 24)}d`;
}

/** Delta vs the previous period, rendered as a signed percentage. */
export function formatDelta(current: number, previous: number): { text: string; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0) {
    return current > 0 ? { text: 'new', direction: 'up' } : { text: '—', direction: 'flat' };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) {
    return { text: '±0%', direction: 'flat' };
  }
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, direction: pct > 0 ? 'up' : 'down' };
}
