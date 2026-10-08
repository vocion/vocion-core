/**
 * The LinkedIn Marketing API, as the LinkedIn Ads connector reads it.
 *
 * Versioned endpoints under `https://api.linkedin.com/rest`, every call with
 * `LinkedIn-Version: YYYYMM` and `X-Restli-Protocol-Version: 2.0.0`, so
 * query values use Rest.li 2.0 encoding: `List(…)` and `(key:value)` tuples
 * with URNs percent-encoded inside them. Facts this file depends on
 * (learn.microsoft.com/linkedin/marketing, version 202609):
 *
 *   - `GET /adAccounts/{id}` — name, currency, status.
 *   - `GET /adAccounts/{id}/adCampaignGroups?q=search` and
 *     `/adCampaigns?q=search`, filtered by `search=(status:(values:List(…)))`
 *     and paged by `pageSize` (≤ 1000) / `pageToken` with
 *     `metadata.nextPageToken`.
 *   - `GET /adAnalytics?q=analytics&pivot=…&timeGranularity=DAILY|ALL&dateRange=(start:(…),end:(…))`
 *     with an `accounts=`, `campaignGroups=` or `campaigns=` facet and an
 *     explicit `fields=` list; no pagination, at most 15,000 elements.
 *     `costInLocalCurrency` is a decimal string.
 *
 * Read-only. The token is never put in a URL or a log line.
 */

/** The Marketing API's versioned base. */
export const LINKEDIN_API_BASE = 'https://api.linkedin.com/rest';
/** The Marketing API version every call names (YYYYMM). LinkedIn keeps each for about a year. */
export const LINKEDIN_API_VERSION = '202609';

/**
 * The headers every Marketing API call carries.
 * @param token - The access token.
 */
export function linkedinHeaders(token: string): Record<string, string> {
  return {
    'authorization': `Bearer ${token}`,
    'accept': 'application/json',
    'linkedin-version': LINKEDIN_API_VERSION,
    'x-restli-protocol-version': '2.0.0',
  };
}

export type LinkedinFailure = { ok: false; status: number; message: string };
export type LinkedinResult<T> = { ok: true; data: T } | LinkedinFailure;

type Fetch = typeof fetch;

const RETRY_AFTER_MS = 2000;

/**
 * A person-readable sentence for a refused call, without echoing the body.
 * @param status - The HTTP status.
 * @param body - LinkedIn's error body, when there is one.
 */
function failureMessage(status: number, body: unknown): string {
  const code = typeof (body as { code?: unknown } | null)?.code === 'string' ? (body as { code: string }).code : null;
  if (status === 401) {
    return 'LinkedIn refused the access token: it has expired or was revoked. Log in with LinkedIn again, or paste a new token.';
  }
  if (status === 403) {
    return `LinkedIn says this token may not read that${code ? ` (${code})` : ''}. It needs r_ads and r_ads_reporting, and the member needs a role on the ad account.`;
  }
  if (status === 404) {
    return 'LinkedIn found no such ad account, campaign group or campaign. Check the ad account id on the source.';
  }
  if (status === 429) {
    return 'LinkedIn is throttling this app right now (too many requests). Try again in a few minutes, or ask for a shorter range.';
  }
  if (status === 0) {
    return 'LinkedIn could not be reached.';
  }
  return `LinkedIn answered HTTP ${status}${code ? ` (${code})` : ''}.`;
}

/**
 * One GET against the Marketing API. A 429 or 5xx is retried once after a
 * pause; anything else comes back as a sentence.
 * @param token - The access token.
 * @param pathAndQuery - The path under `/rest`, with its already-encoded query.
 * @param doFetch - The network, injected in tests.
 * @param pauseMs - The pause before the one retry, injected in tests.
 */
export async function linkedinGet<T>(token: string, pathAndQuery: string, doFetch: Fetch = fetch, pauseMs = RETRY_AFTER_MS): Promise<LinkedinResult<T>> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await doFetch(`${LINKEDIN_API_BASE}${pathAndQuery}`, { headers: linkedinHeaders(token), signal: AbortSignal.timeout(30_000) });
    } catch {
      return { ok: false, status: 0, message: failureMessage(0, null) };
    }
    if ((response.status === 429 || response.status >= 500) && attempt === 0) {
      await new Promise(resolve => setTimeout(resolve, pauseMs));
      continue;
    }
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      return { ok: false, status: response.status, message: failureMessage(response.status, body) };
    }
    return { ok: true, data: body as T };
  }
}

/**
 * A URN as Rest.li 2.0 wants it inside a query value: percent-encoded.
 * @param kind - `sponsoredAccount`, `sponsoredCampaignGroup` or `sponsoredCampaign`.
 * @param id - The numeric id.
 */
export function urn(kind: 'sponsoredAccount' | 'sponsoredCampaignGroup' | 'sponsoredCampaign', id: string): string {
  return encodeURIComponent(`urn:li:${kind}:${id}`);
}

/**
 * The numeric id at the end of a URN (`urn:li:sponsoredCampaign:123` → `123`),
 * or the value itself when it is not one.
 * @param value - A URN or an id.
 */
export function idOfUrn(value: unknown): string {
  const s = String(value ?? '');
  return s.slice(s.lastIndexOf(':') + 1);
}

/**
 * A Rest.li date range from two `YYYY-MM-DD` days, inclusive.
 * @param from - First day.
 * @param to - Last day.
 */
export function restliDateRange(from: string, to: string): string {
  const part = (day: string) => {
    const [year, month, d] = day.split('-').map(Number);
    return `(year:${year},month:${month},day:${d})`;
  };
  return `(start:${part(from)},end:${part(to)})`;
}

/**
 * The day a Rest.li date object names, as `YYYY-MM-DD`.
 * @param date - `{ year, month, day }`.
 */
export function dayOf(date: { year?: number; month?: number; day?: number } | undefined): string | null {
  if (!date?.year || !date.month || !date.day) {
    return null;
  }
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/**
 * The token a stored LinkedIn credential calls with, without refreshing: a
 * pasted `token`, or a login's `accessToken` while it is good. A login with a
 * refresh token is renewed by the caller first (`usableLoginGrant`).
 * @param bag - The decrypted credential bag.
 * @param now - The clock.
 */
export function linkedinTokenFrom(bag: Record<string, unknown> | null | undefined, now: number = Date.now()): { ok: true; token: string } | { ok: false; message: string } {
  if (!bag) {
    return { ok: false, message: 'No LinkedIn credential is stored. Log in with LinkedIn or paste an access token on the Connectors page.' };
  }
  if (typeof bag.token === 'string' && bag.token.trim()) {
    return { ok: true, token: bag.token.trim() };
  }
  if (typeof bag.accessToken === 'string' && bag.accessToken) {
    const expiresAt = typeof bag.expiresAt === 'string' ? Date.parse(bag.expiresAt) : Number.NaN;
    if (!Number.isNaN(expiresAt) && expiresAt <= now) {
      return { ok: false, message: 'The LinkedIn login has expired, and LinkedIn issued this app no refresh token. Log in with LinkedIn again.' };
    }
    return { ok: true, token: bag.accessToken };
  }
  return { ok: false, message: 'The stored LinkedIn credential holds no access token. Log in with LinkedIn again, or paste a token.' };
}
