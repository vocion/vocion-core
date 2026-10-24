/** The Routing section's words (ADR 0006): pure, so they test without the page. */
import type { JevKeyStatus } from '@/services/routing/jevKey';

/**
 * The line saying whether routing is on. Pure.
 * @param keys - The key status, or null when it could not be read.
 */
export function routingStatusLine(keys: Pick<JevKeyStatus, 'effective'> & { hint?: string | null } | null): string {
  if (!keys?.effective) {
    return 'Dynamic routing is off: no Jev (TypeSafe) API key is set, so every turn runs its configured model. Set one in System Keys.';
  }
  return `Dynamic routing is on, on the ${keys.effective === 'workspace' ? 'workspace' : 'instance'} key${keys.hint ? ` (${keys.hint})` : ''}.`;
}

/**
 * A share as a percentage, or a dash.
 * @param part - The part.
 * @param whole - The whole.
 */
export function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—';
}

/** What each Jev outcome reads as. */
export const OUTCOME_LABEL: Record<string, string> = {
  used: 'used',
  unsure: 'Jev unsure',
  auth: 'key rejected',
  rate_limited: 'rate limited',
  http_error: 'HTTP error',
  timeout: 'timed out',
  unreachable: 'unreachable',
  bad_response: 'bad answer',
  breaker: 'paused after failures',
  config: 'key unreadable',
  skipped: 'not asked',
  no_key: 'no key',
};

/** Each decision type, as a person reads it. */
export const DECISION_LABEL: Record<string, string> = {
  factory: 'Factory routing',
  turn: 'Agent turn model',
  agent: 'Who answers',
  duplicate: 'Duplicate check',
};

/**
 * The failures cell: the count and the commonest cause. Pure.
 * @param h - One decision type's health.
 * @param h.failed - Failed calls.
 * @param h.byOutcome - Counts by outcome.
 */
export function failuresCell(h: { failed: number; byOutcome: Record<string, number> }): string {
  if (h.failed === 0) {
    return '0';
  }
  const top = ['auth', 'rate_limited', 'http_error', 'timeout', 'unreachable', 'bad_response'].map(o => [o, h.byOutcome[o] ?? 0] as const).sort((a, b) => b[1] - a[1])[0]!;
  return `${h.failed} · ${OUTCOME_LABEL[top[0]]}`;
}

/**
 * Milliseconds as a short latency, or a dash. Pure.
 * @param p50 - Median.
 * @param p95 - 95th percentile.
 */
export function latencyCell(p50: number | null, p95: number | null): string {
  return p50 === null ? '—' : `${Math.round(p50)} / ${Math.round(p95 ?? p50)} ms`;
}
