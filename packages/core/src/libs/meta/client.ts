/**
 * The Meta Marketing API (Graph API), as the Meta Ads connector reads it.
 *
 * Facts this file depends on (developers.facebook.com/docs/marketing-api):
 *
 *   - Every call is `https://graph.facebook.com/<version>/<node>`; the token
 *     goes in `Authorization: Bearer`, never in the URL, so no logged URL
 *     carries it. Paging follows `paging.cursors.after` as `after=`, rather
 *     than `paging.next`, whose URL can carry the token.
 *   - An ad account is `act_<id>`; `?fields=name,currency,account_status`.
 *   - Budgets (`daily_budget`, `lifetime_budget`) are strings in the
 *     currency's minor unit: divide by 100, except for the offset-1
 *     currencies (CLP, COP, CRC, HUF, ISK, IDR, JPY, KRW, PYG, TWD, VND).
 *     Insights `spend` is already in currency units.
 *   - Errors are `{ error: { message, type, code, error_subcode } }`: 190 is
 *     a bad token, 10 / 200–299 a missing permission, 4 / 17 / 32 / 613 /
 *     80000–80014 throttling.
 *   - A status change is `POST /<campaign or ad set id>` with `status=PAUSED|ACTIVE`
 *     and needs `ads_management`.
 */

export const META_GRAPH_BASE = 'https://graph.facebook.com';

/** Currencies whose budget values are whole units (offset 1), per Meta's currency table. */
const OFFSET_ONE = new Set(['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']);

/**
 * A budget as Meta stores it (minor units), in currency units.
 * @param value - The `daily_budget` / `lifetime_budget` string.
 * @param currency - The account currency.
 */
export function budgetUnits(value: unknown, currency: string | null): number | null {
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n) || n <= 0) {
    return null;
  }
  return currency && OFFSET_ONE.has(currency.toUpperCase()) ? n : n / 100;
}

/**
 * An ad account id as the Graph API addresses it: `act_<digits>`.
 * @param id - As typed: with or without the prefix.
 */
export function actId(id: string): string {
  const digits = id.trim().replace(/^act_/i, '');
  if (!/^\d+$/.test(digits)) {
    throw new Error(`"${id}" is not a Meta ad account id; it is act_ followed by digits, from Ads Manager's account menu.`);
  }
  return `act_${digits}`;
}

export type MetaFailure = { ok: false; status: number; code: number | null; message: string };
export type MetaResult<T> = { ok: true; data: T } | MetaFailure;

type GraphError = { message?: string; code?: number; error_subcode?: number; type?: string };

const THROTTLE_CODES = new Set([4, 17, 32, 613]);
const RETRY_AFTER_MS = 2000;

function isThrottle(code: number | null): boolean {
  return code !== null && (THROTTLE_CODES.has(code) || (code >= 80000 && code <= 80014));
}

/**
 * A sentence for a refused call. Meta's own message is kept for codes that
 * name a field or an id the person can fix, never the token.
 * @param status - HTTP status.
 * @param error - Meta's error object.
 */
function failureMessage(status: number, error: GraphError | null): string {
  const code = error?.code ?? null;
  if (status === 0) {
    return 'Meta could not be reached.';
  }
  if (code === 190) {
    return 'Meta refused the access token: it has expired, was revoked, or is not a system user token. Generate a new one in Business settings → System users.';
  }
  if (code === 10 || (code !== null && code >= 200 && code < 300)) {
    return 'Meta says this token lacks the permission for that. Reading needs ads_read and the ad account assigned to the system user; pausing and resuming also need ads_management.';
  }
  if (isThrottle(code)) {
    return 'Meta is throttling this ad account right now (too many calls). Try again in a few minutes.';
  }
  if (code === 100) {
    return `Meta did not accept that request: ${error?.message ?? 'an invalid parameter'}`;
  }
  return `Meta answered HTTP ${status}${code !== null ? ` (error ${code})` : ''}.`;
}

/**
 * One call to the Graph API. Throttling (a 429, a 5xx, or a throttle code)
 * is retried once after a pause; anything else comes back as a sentence.
 * @param input - The call.
 * @param input.token - The system user token.
 * @param input.version - The Graph API version, e.g. v23.0.
 * @param input.path - The node and edge, e.g. `act_123/campaigns`.
 * @param input.params - Query parameters (GET) or form fields (POST).
 * @param input.method - GET (default) or POST.
 * @param input.doFetch - The network, injected in tests.
 * @param input.pauseMs - The pause before the retry, injected in tests.
 */
export async function metaCall<T>(input: { token: string; version: string; path: string; params?: Record<string, string>; method?: 'GET' | 'POST'; doFetch?: typeof fetch; pauseMs?: number }): Promise<MetaResult<T>> {
  const doFetch = input.doFetch ?? fetch;
  const params = new URLSearchParams(input.params ?? {});
  const post = input.method === 'POST';
  const url = `${META_GRAPH_BASE}/${input.version}/${input.path}${!post && params.size > 0 ? `?${params}` : ''}`;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(url, {
        method: post ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${input.token}`, accept: 'application/json', ...(post ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        ...(post ? { body: params.toString() } : {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return { ok: false, status: 0, code: null, message: failureMessage(0, null) };
    }
    const body = await response.json().catch(() => null) as { error?: GraphError } | null;
    const error = body?.error ?? null;
    if (response.ok && !error) {
      return { ok: true, data: body as T };
    }
    const code = error?.code ?? null;
    if (attempt === 0 && (response.status === 429 || response.status >= 500 || isThrottle(code))) {
      await new Promise(resolve => setTimeout(resolve, input.pauseMs ?? RETRY_AFTER_MS));
      continue;
    }
    return { ok: false, status: response.status, code, message: failureMessage(response.status, error) };
  }
}

/**
 * The system user token in a stored credential, or why there is none.
 * @param bag - The decrypted credential bag.
 */
export function metaTokenFrom(bag: Record<string, unknown> | null | undefined): { ok: true; token: string } | { ok: false; message: string } {
  const token = typeof bag?.token === 'string' ? bag.token.trim() : '';
  return token ? { ok: true, token } : { ok: false, message: 'No Meta system user token is stored. Paste one on the Connectors page.' };
}
