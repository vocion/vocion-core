/**
 * How a briefing number is spelled. One place, so the page, the markdown and
 * the mail cannot disagree about whether a pipeline is `$3.52M` or
 * `$3,520,000`.
 *
 * The delta rule from `docs/specs/briefing-v2.md` §5 lives here too: a metric
 * with a previous value renders `Open pipeline $3.52M ↑ $210K`; a metric
 * without one renders `Open pipeline $3.52M` and nothing else. There is no
 * code path that prints `↑ $0` for a first brief, because there is no branch
 * that reads a missing `previous` as zero.
 */

import type { BriefingMetric } from './document';

const ARROW = { up: '↑', down: '↓', flat: '·' } as const;

/**
 * A number in its unit. `usd` is compact above a thousand — a briefing is
 * read, not audited.
 * @param value - The number.
 * @param unit - `usd` | `pct` | `days` | anything else (plain count).
 */
export function formatValue(value: number, unit?: string): string {
  switch (unit) {
    case 'usd': {
      const abs = Math.abs(value);
      if (abs >= 1_000_000) {
        return `$${trimZeros((value / 1_000_000).toFixed(2))}M`;
      }
      if (abs >= 1_000) {
        return `$${trimZeros((value / 1_000).toFixed(1))}K`;
      }
      return `$${Math.round(value).toLocaleString('en-US')}`;
    }
    case 'pct':
      return `${trimZeros(value.toFixed(1))}%`;
    case 'days':
      return `${trimZeros(value.toFixed(1))}d`;
    default:
      return Number.isInteger(value) ? value.toLocaleString('en-US') : trimZeros(value.toFixed(2));
  }
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/**
 * The delta clause, or the empty string. Empty is the honest answer on a
 * first brief and on any metric whose key the prior brief did not carry.
 * @param m - The metric.
 */
export function formatDelta(m: BriefingMetric): string {
  if (m.previous === undefined || m.delta === undefined || m.direction === undefined) {
    return '';
  }
  if (m.direction === 'flat') {
    return 'no change';
  }
  return `${ARROW[m.direction]} ${formatValue(Math.abs(m.delta), m.unit)}`;
}

/**
 * "Open pipeline $3.52M ↑ $210K"* — or, when the source could not be read,
 * "Weighted forecast unavailable · Why?"*, whose detail stays behind a
 * disclosure (spec §7).
 * @param m - The metric.
 */
export function formatMetric(m: BriefingMetric): string {
  if (m.value === null) {
    return m.unavailable ? `${m.unavailable.headline} · Why?` : m.label;
  }
  const delta = formatDelta(m);
  return `${m.label} ${formatValue(m.value, m.unit)}${delta ? ` ${delta}` : ''}`;
}

/**
 * The one line under the date: every metric, joined. This is the whole of
 * "3 to 5 metrics with deltas".
 * @param metrics - The metrics, already capped.
 */
export function metricsLine(metrics: BriefingMetric[]): string {
  return metrics.map(formatMetric).join(' · ');
}

/**
 * "$3.52M", for a card's amount.
 * @param amount - The amount.
 * @param currency - ISO code, when it is not USD.
 */
export function formatAmount(amount: number | null, currency: string | null): string {
  if (amount === null) {
    return '';
  }
  return currency && currency.toUpperCase() !== 'USD' ? `${formatValue(amount)} ${currency.toUpperCase()}` : formatValue(amount, 'usd');
}
