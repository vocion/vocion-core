/**
 * The GA4 read behind a `verified · web-analytics` measure — one aggregate
 * number out of the Analytics Data API, for one property, over one window.
 *
 * Two round trips, both on `fetch` so a test can stand in front of them
 * without a network or a credential:
 *
 *   1. mint an access token from the service account (a signed JWT bearer
 *      assertion — Google's server-to-server flow, no user consent);
 *   2. `POST properties/<id>:runReport` with no dimensions, so the report
 *      comes back as a single total row.
 *
 * This is deliberately NOT `libs/sources/ga4.ts`. That connector ingests
 * report ROWS as retrievable documents on the shared `google` OAuth
 * credential, for an agent to read. This one answers a measure: one number,
 * read as a service account the workspace controls, against the property
 * stored with that credential.
 *
 * **Nothing here ever returns 0 for a failure.** Every failure throws, and
 * `services/team-report/provenance.ts` turns the throw into an `error`
 * reading with `value: null`. A caught error that became a zero would put a
 * number on an executive report that no system of record ever said.
 */

import type { WebAnalyticsCredentials } from './credentials';
import { Buffer } from 'node:buffer';
import { createHash, createSign } from 'node:crypto';

/** What a web-analytics measure can count. Mirrors `WEB_ANALYTICS_METRICS`. */
export type WebAnalyticsMetric = 'sessions' | 'users' | 'conversions' | 'signups';

/** The predicates GA4 can apply server-side to the sessions or events counted. */
export type WebAnalyticsFilter = {
  pathPrefix?: string;
  channel?: string;
  event?: string;
};

export type WebAnalyticsQuery = {
  metric: WebAnalyticsMetric;
  filter: WebAnalyticsFilter;
};

/** A half-open instant range `[since, until)` — the measure's own window. */
export type ReportRange = { since: Date; until: Date };

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DATA_API = 'https://analyticsdata.googleapis.com/v1beta';
const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/**
 * The GA4 metric behind each name the schema offers.
 *
 * `users` is `totalUsers` rather than `activeUsers`: a scorecard row called
 * "users" means people who reached the site, not people GA4 judged engaged.
 * `conversions` is `keyEvents`, GA4's name for the same thing since the
 * `conversions` metric was retired. `signups` is a count of ONE named event,
 * which is why the schema makes `filter.event` mandatory for it — there is no
 * universal signup event and guessing one would count the wrong thing
 * silently.
 */
const GA4_METRIC: Record<WebAnalyticsMetric, string> = {
  sessions: 'sessions',
  users: 'totalUsers',
  conversions: 'keyEvents',
  signups: 'eventCount',
};

/** The human name for the number, for the provenance chip. */
export const WEB_ANALYTICS_SOURCE_LABEL = 'Google Analytics';

/**
 * What a reader can say about the reading beyond the number.
 *
 * GA4 reports in whole days in the PROPERTY's own timezone, while a measure
 * window is a half-open range of instants. The days a window covers are
 * therefore an approximation of it, and the most recent day is still being
 * processed for up to 48 hours. Both are true of every GA4 report and neither
 * makes the reading wrong — but a `verified` chip claims a system of record
 * said this, so the claim travels with its own caveat rather than without one.
 */
export const GA4_WINDOW_NOTE
  = 'Google Analytics reports in whole days in the property\'s own timezone, so the window is the days it covers; the most recent day may still be processing.';

/**
 * `YYYY-MM-DD` in UTC.
 * @param d - The instant to take the day of.
 */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The inclusive day range GA4 should report over, for a half-open instant
 * range. `until` is exclusive, so the last day is the day the instant before
 * it falls in — without the step back, a window ending at midnight would pull
 * in a whole extra day.
 * @param range - The measure's window.
 */
export function dayRange(range: ReportRange): { startDate: string; endDate: string } {
  const lastInstant = new Date(Math.max(range.since.getTime(), range.until.getTime() - 1));
  return { startDate: isoDay(range.since), endDate: isoDay(lastInstant) };
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Access tokens, keyed by a digest of the exact credential that minted them.
 *
 * Never keyed by org. A per-org or per-provider cache is how one workspace's
 * token ends up answering another workspace's read; keying on the key itself
 * means a rotated or revoked service account takes effect on the next read
 * with nothing to invalidate, and two workspaces sharing one deployment env
 * var legitimately share one token because it IS one token.
 */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

function credentialDigest(creds: WebAnalyticsCredentials): string {
  return createHash('sha256')
    .update(creds.serviceAccount.clientEmail)
    .update('\0')
    .update(creds.serviceAccount.privateKey)
    .update('\0')
    .update(SCOPE)
    .digest('hex');
}

/** Drop every cached token. Test seam; nothing in production calls it. */
export function resetWebAnalyticsTokenCache(): void {
  tokenCache.clear();
}

/**
 * A signed JWT bearer assertion for the service account.
 *
 * Signing happens in-process with the stored private key; the key itself never
 * leaves this function and never reaches Google. A malformed key throws here,
 * before any request is made.
 * @param creds - The resolved analytics credential.
 * @param now - The clock.
 */
function signAssertion(creds: WebAnalyticsCredentials, now: Date): string {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: creds.serviceAccount.clientEmail,
    scope: SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  let signature: Buffer;
  try {
    signature = signer.sign(creds.serviceAccount.privateKey);
  } catch (cause) {
    // The vendor's message quotes the key material on some failures, so it is
    // logged and replaced rather than passed on.
    console.error('[analytics] the stored Google service-account private key could not sign', cause);
    throw new Error('The stored Google Analytics private key could not be used to sign a request. Re-paste the private_key value from the service account JSON.');
  }
  return `${header}.${claims}.${base64url(signature)}`;
}

/**
 * An access token for the service account, minted or reused.
 * @param creds - The resolved analytics credential.
 * @param now - The clock.
 */
async function accessToken(creds: WebAnalyticsCredentials, now: Date): Promise<string> {
  const digest = credentialDigest(creds);
  const cached = tokenCache.get(digest);
  if (cached && cached.expiresAt > now.getTime() + 5 * 60_000) {
    return cached.token;
  }
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: signAssertion(creds, now),
    }).toString(),
  });
  if (!res.ok) {
    // Google's token errors name the service account; the reason shown to a
    // person says what to fix without echoing the response.
    console.error('[analytics] Google refused a service-account token', { status: res.status });
    throw new Error(res.status === 400
      ? 'Google rejected the stored Analytics service account. Check the client email and private key are from the same, still-active key.'
      : `Google would not issue an Analytics token (HTTP ${res.status}).`);
  }
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('Google returned no access token for the stored Analytics service account.');
  }
  tokenCache.set(digest, {
    token: data.access_token,
    expiresAt: now.getTime() + (data.expires_in ?? 3600) * 1000,
  });
  return data.access_token;
}

type Ga4DimensionFilter = { filter: { fieldName: string; stringFilter: { matchType: string; value: string } } };

/**
 * The `dimensionFilter` for a query's filter keys, or undefined for no filter.
 *
 * Every predicate is ANDed: a measure that names both a path prefix and a
 * channel means "that traffic, from that channel", never either.
 * @param filter - The measure's declared filter.
 */
export function dimensionFilterFor(filter: WebAnalyticsFilter): { andGroup: { expressions: Ga4DimensionFilter[] } } | undefined {
  const expressions: Ga4DimensionFilter[] = [];
  if (filter.pathPrefix !== undefined) {
    // The session's LANDING page, not any page in it: "traffic that arrived at
    // /docs" is the question a scorecard row asks, and it is the one GA4 can
    // answer without double-counting a session across several pages.
    expressions.push({ filter: { fieldName: 'landingPagePlusQueryString', stringFilter: { matchType: 'BEGINS_WITH', value: filter.pathPrefix } } });
  }
  if (filter.channel !== undefined) {
    expressions.push({ filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { matchType: 'EXACT', value: filter.channel } } });
  }
  if (filter.event !== undefined) {
    expressions.push({ filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: filter.event } } });
  }
  return expressions.length === 0 ? undefined : { andGroup: { expressions } };
}

/**
 * The request body `runReport` is called with — exported so a test can assert
 * the shape without a network.
 * @param query - The measure's declared query.
 * @param range - The measure's window.
 */
export function reportRequest(query: WebAnalyticsQuery, range: ReportRange): Record<string, unknown> {
  const dimensionFilter = dimensionFilterFor(query.filter);
  return {
    dateRanges: [dayRange(range)],
    // No dimensions: one totals row is the whole answer, and a dimensionless
    // report cannot be truncated by GA4's row limit into a partial sum.
    metrics: [{ name: GA4_METRIC[query.metric] }],
    ...(dimensionFilter === undefined ? {} : { dimensionFilter }),
    limit: 1,
  };
}

type Ga4Response = { rows?: Array<{ metricValues?: Array<{ value?: string }> }> };

/**
 * Run one web-analytics report and return the single number it produces.
 *
 * **Zero is a real answer here and only here**: an empty `rows` array means
 * GA4 ran the query and nothing matched, which is a measured zero. Every other
 * outcome — no credential, a refused token, an HTTP error, an unparseable
 * figure — throws, so the report can show a state instead of a number.
 * @param creds - The resolved analytics credential, from `resolveWebAnalyticsCredentials`.
 * @param query - The measure's declared query.
 * @param range - The measure's window.
 * @param now - The clock.
 */
export async function runWebAnalyticsReport(
  creds: WebAnalyticsCredentials,
  query: WebAnalyticsQuery,
  range: ReportRange,
  now: Date = new Date(),
): Promise<number> {
  const token = await accessToken(creds, now);
  const res = await fetch(`${DATA_API}/properties/${encodeURIComponent(creds.propertyId)}:runReport`, {
    method: 'POST',
    headers: { 'authorization': `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(reportRequest(query, range)),
  });
  if (!res.ok) {
    console.error('[analytics] GA4 runReport failed', { status: res.status });
    throw new Error(reportErrorMessage(res.status));
  }
  const body = (await res.json()) as Ga4Response;
  const raw = body.rows?.[0]?.metricValues?.[0]?.value;
  if (raw === undefined) {
    // No rows at all: the query ran and matched nothing.
    return body.rows === undefined || body.rows.length === 0 ? 0 : failUnreadable();
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : failUnreadable();
}

function failUnreadable(): never {
  throw new Error('Google Analytics returned a report this measure could not read.');
}

/**
 * What to tell a person about an HTTP failure, without echoing a response
 * body that carries the property id and the service account's address.
 * @param status - The HTTP status GA4 answered with.
 */
function reportErrorMessage(status: number): string {
  switch (status) {
    case 401:
      return 'Google Analytics refused the stored credential. The service account key may have been rotated or disabled.';
    case 403:
      return 'The stored service account is not allowed to read this Google Analytics property. Grant it the Viewer role on the property.';
    case 404:
      return 'Google Analytics has no property with the stored property ID.';
    case 429:
      return 'Google Analytics is rate-limiting this workspace; the reading will be available again shortly.';
    default:
      return `Google Analytics could not answer this measure (HTTP ${status}).`;
  }
}
