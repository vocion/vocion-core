import type { AutomationRunFilter } from '@/services/AutomationService';

/**
 * The run log's filters, read off the URL.
 *
 * In the URL rather than component state so a filtered log is a link that can
 * be sent to whoever should look at it, and so a reload keeps the view.
 */

const STATUSES = ['running', 'ok', 'error'] as const;
const KINDS = ['workflow', 'mission_check', 'job'] as const;
const INVOKERS = ['schedule', 'test-run'] as const;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s !== '' ? s : undefined;
}

function oneOf<T extends readonly string[]>(v: string | string[] | undefined, allowed: T): T[number] | undefined {
  const s = one(v);
  return s && (allowed as readonly string[]).includes(s) ? (s as T[number]) : undefined;
}

/**
 * Parse `?slug=&status=&kind=&invokedBy=&since=&cursor=` into a filter.
 *
 * Anything unrecognised is dropped rather than passed through, so a hand-edited
 * URL narrows the log or does nothing — it never widens it past the org.
 * @param searchParams - Next's resolved search params.
 * @param overrides - Fixed values the page owns (the per-automation view pins `slug`).
 */
export function parseRunLogQuery(
  searchParams: Record<string, string | string[] | undefined>,
  overrides: Partial<AutomationRunFilter> = {},
): AutomationRunFilter {
  const sinceRaw = one(searchParams.since);
  const since = sinceRaw ? new Date(`${sinceRaw}T00:00:00Z`) : undefined;
  const cursorRaw = Number(one(searchParams.cursor));
  return {
    slug: one(searchParams.slug),
    status: oneOf(searchParams.status, STATUSES),
    kind: oneOf(searchParams.kind, KINDS),
    invokedBy: oneOf(searchParams.invokedBy, INVOKERS),
    since: since && !Number.isNaN(since.getTime()) ? since : undefined,
    cursor: Number.isInteger(cursorRaw) && cursorRaw > 0 ? cursorRaw : undefined,
    limit: 100,
    ...overrides,
  };
}
