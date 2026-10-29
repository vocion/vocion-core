/**
 * Words a dashboard is read in, shared by the card (client) and the
 * Dashboards page (server). Pure.
 */

import type { DashboardStat } from './spec';
import type { StatDelta } from '@/components/patterns/StatRow';
import type { ValueFormat } from '@/libs/charts/format';
import { formatValue, valueFormatOf } from '@/libs/charts/format';

/**
 * "Oct 29, 2026" from an ISO date or date-time; the raw text when it is not one.
 * @param iso - The `asOf`.
 */
export function asOfLabel(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return iso.length > 10 ? `${date}, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : date;
}

/**
 * The person's own words for a refresh: sent as their turn, so their own
 * connections are read and it runs as their action.
 * @param title - The dashboard's title.
 * @param id - Its artifact id.
 */
export function refreshAsk(title: string, id: number): string {
  return `Refresh the dashboard "${title}" (artifact #${id}) with current numbers, following its refresh method.`;
}

export function statFormat(s: Pick<DashboardStat, 'format' | 'currency' | 'unit'>): ValueFormat {
  return valueFormatOf({ format: s.format, currency: s.currency, unit: s.unit });
}

/**
 * The figure as it reads: "$454.3K", "31%", "1 / 5", or "Not read".
 * @param s - The figure.
 */
export function statValue(s: DashboardStat): string {
  if (s.display) {
    return s.display;
  }
  if (s.value === null) {
    return 'Not read';
  }
  return headline(s.value, statFormat(s), s.compact !== false);
}

/**
 * A headline figure keeps one more digit than a chart tick: "$454.3k", not
 * "$454k" — the number is the point of the tile, not a gridline.
 * @param v - The value.
 * @param f - Its format.
 * @param compact - Abbreviate thousands and millions.
 */
function headline(v: number, f: ValueFormat, compact: boolean): string {
  const abs = Math.abs(v);
  if (!compact || abs < 1000 || f.kind === 'percent') {
    return formatValue(v, f, compact);
  }
  const [n, suffix] = abs >= 1e9 ? [abs / 1e9, 'B'] : abs >= 1e6 ? [abs / 1e6, 'M'] : [abs / 1e3, 'k'];
  const text = `${Number(n.toPrecision(4))}${suffix}`;
  const sign = v < 0 ? '−' : '';
  switch (f.kind) {
    case 'currency':
      return `${sign}${f.symbol}${text}`;
    case 'unit':
      return `${sign}${text} ${f.unit}`;
    default:
      return `${sign}${text}`;
  }
}

/**
 * How the figure moved, coloured by whether the move is good news.
 * @param s - The figure.
 */
export function statDelta(s: DashboardStat): StatDelta | null {
  const d = s.delta;
  if (!d) {
    return null;
  }
  const direction = d.value < 0 ? 'down' : 'up';
  const better = d.better ?? 'up';
  const tone = better === 'neither' || d.value === 0 ? 'neutral' : better === direction ? 'pass' : 'fail';
  const fmt = d.format ? valueFormatOf({ format: d.format, currency: s.currency }) : statFormat(s);
  return { value: formatValue(Math.abs(d.value), fmt, s.compact !== false), direction, tone, against: d.against };
}
