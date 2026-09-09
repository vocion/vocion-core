import type { AutomationRunFilter } from '@/services/AutomationService';

/**
 * The run-log query string, validated once for both endpoints (all
 * automations, and one automation's).
 *
 * An unrecognised value is an error rather than a silently dropped filter: a
 * caller who asks for `status=faled` must not be handed every fire and read it
 * as "nothing failed".
 */

const STATUSES = ['running', 'ok', 'error'] as const;
const KINDS = ['workflow', 'mission_check', 'job'] as const;
const INVOKERS = ['schedule', 'test-run'] as const;

type Parsed = { value: AutomationRunFilter } | { error: string };

/**
 * @param params - The request's search params.
 * @param overrides - Values the route pins (the per-slug endpoint pins `slug`).
 */
export function runFilterFromSearchParams(
  params: URLSearchParams,
  overrides: Partial<AutomationRunFilter> = {},
): Parsed {
  const filter: AutomationRunFilter = { limit: 50 };

  const slug = params.get('slug');
  if (slug) {
    filter.slug = slug;
  }

  for (const [key, allowed] of [['status', STATUSES], ['kind', KINDS], ['invokedBy', INVOKERS]] as const) {
    const raw = params.get(key);
    if (raw === null || raw === '') {
      continue;
    }
    if (!(allowed as readonly string[]).includes(raw)) {
      return { error: `\`${key}\` must be one of ${allowed.join(', ')}` };
    }
    Object.assign(filter, { [key]: raw });
  }

  for (const key of ['since', 'until'] as const) {
    const raw = params.get(key);
    if (raw === null || raw === '') {
      continue;
    }
    const at = new Date(raw);
    if (Number.isNaN(at.getTime())) {
      return { error: `\`${key}\` must be an ISO date or datetime` };
    }
    filter[key] = at;
  }

  for (const key of ['limit', 'cursor'] as const) {
    const raw = params.get(key);
    if (raw === null || raw === '') {
      continue;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
      return { error: `\`${key}\` must be a positive integer` };
    }
    filter[key] = n;
  }

  return { value: { ...filter, ...overrides } };
}
