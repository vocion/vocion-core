/**
 * The Google Ads API (REST), as Vocion reads and writes it.
 *
 * Facts this file depends on (developers.google.com/google-ads/api):
 *
 *   - Every call is `https://googleads.googleapis.com/<version>/customers/<id>/…`
 *     with the OAuth access token in `Authorization: Bearer` (scope
 *     `https://www.googleapis.com/auth/adwords`). A customer id is ten digits;
 *     the dashed form an advertiser sees (`119-937-1525`) is accepted here.
 *   - A login that reaches the account through a manager account sends that
 *     manager's id as `login-customer-id`.
 *   - DEVELOPER TOKENS ARE RETIRED. Since 2026-09-09 API access is decided by
 *     the Google Cloud project that owns the OAuth client (Test, Explorer,
 *     Basic, Standard), applied for in Cloud Console → Google Ads API
 *     Overview. A `developer-token` header is optional and ignored; this
 *     client sends one only when a credential still carries it.
 *   - Reads are GAQL through `googleAds:search`, paged by `nextPageToken`.
 *     Writes are `googleAds:mutate` with `mutateOperations`; `validateOnly`
 *     checks the whole batch without applying it, and a batch is atomic
 *     unless `partialFailure` is set (never here).
 *   - Money is in micros (1,000,000 per currency unit).
 *   - Errors are `{ error: { message, details: [{ errors: [{ errorCode, message }] }] } }`.
 */

export const GOOGLE_ADS_API_VERSION = 'v23';

/** The named reads `services/ads/googleReports.ts` runs, light enough for a tool schema to import. */
export const GOOGLE_ADS_REPORTS = ['campaigns', 'campaign_daily', 'keywords', 'search_terms', 'ads', 'conversions', 'budget_pacing'] as const;
export type GoogleAdsReport = typeof GOOGLE_ADS_REPORTS[number];
export const GOOGLE_ADS_BASE = 'https://googleads.googleapis.com';

/** Where the call goes and as whom. */
export type GoogleAdsAccess = {
  accessToken: string;
  /** The advertiser account, ten digits. */
  customerId: string;
  /** The manager account the login reaches it through, when it does. */
  loginCustomerId?: string | null;
  /** A retired developer token a credential still carries; sent, and ignored by Google. */
  developerToken?: string | null;
  /** `https://googleads.googleapis.com/v23` unless a source pins another. */
  baseUrl?: string | null;
};

/** Google refused or failed a call; `message` is a sentence a person can act on. */
export class GoogleAdsError extends Error {
  constructor(message: string, public readonly status: number, public readonly codes: string[] = []) {
    super(message);
    this.name = 'GoogleAdsError';
  }
}

/**
 * A customer id as the API addresses it: ten digits, no dashes.
 * @param id - As typed: `119-937-1525` or `1199371525`.
 */
export function customerDigits(id: string): string {
  const digits = id.replace(/[\s-]/g, '');
  if (!/^\d{10}$/.test(digits)) {
    throw new Error(`"${id}" is not a Google Ads customer id; it is ten digits, shown as 123-456-7890 at the top of Google Ads.`);
  }
  return digits;
}

/**
 * An amount in micros, as currency units.
 * @param micros - The API's micros value (a string or number).
 */
export function microsToUnits(micros: unknown): number {
  const n = Number(micros ?? 0);
  return Number.isFinite(n) ? n / 1_000_000 : 0;
}

/**
 * Currency units as micros, rounded to the cent Google bills in.
 * @param units - Dollars (or the account's currency).
 */
export function unitsToMicros(units: number): number {
  return Math.round(units * 100) * 10_000;
}

/**
 * A GAQL string literal: single-quoted, with backslashes and quotes escaped,
 * so a name or a search term from a person can never end the literal.
 * @param value - The raw text.
 */
export function gaqlString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, '\\\'')}'`;
}

/**
 * A date for a GAQL `segments.date` comparison; refuses anything but YYYY-MM-DD.
 * @param value - The date.
 */
export function gaqlDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`"${value}" is not a date (YYYY-MM-DD).`);
  }
  return `'${value}'`;
}

type FailureBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: Array<{ errors?: Array<{ errorCode?: Record<string, string>; message?: string }> }>;
  };
};

/**
 * The sentence for a refused call: Google's own messages, with the fix named
 * for the refusals a person can do something about.
 * @param status - The HTTP status.
 * @param body - The parsed error body, when there was one.
 */
export function failureMessage(status: number, body: FailureBody | null): { message: string; codes: string[] } {
  const errors = body?.error?.details?.flatMap(d => d.errors ?? []) ?? [];
  const codes = errors.flatMap(e => Object.values(e.errorCode ?? {}));
  const messages = [...new Set(errors.map(e => e.message).filter((m): m is string => Boolean(m)))];
  const said = messages.length > 0 ? messages.slice(0, 3).join(' ') : (body?.error?.message ?? `Google Ads answered ${status}.`);
  if (messages.some(m => /only approved for use with test accounts/i.test(m))) {
    return { codes, message: `${said} An admin applies for Explorer access (granted automatically in most cases) on the Google Ads API Overview page of the Google Cloud project that owns this login's OAuth client.` };
  }
  if (status === 401 || codes.includes('OAUTH_TOKEN_INVALID') || codes.includes('OAUTH_TOKEN_EXPIRED')) {
    return { codes, message: `Google Ads did not accept the login (${status}). An admin connects Google Ads again on the Connectors page.` };
  }
  if (codes.includes('USER_PERMISSION_DENIED') || codes.includes('CUSTOMER_NOT_ENABLED')) {
    return { codes, message: `${said} The Google account this login belongs to needs access to that Ads account, or the manager account id is missing.` };
  }
  if (status === 429 || codes.includes('RESOURCE_EXHAUSTED')) {
    return { codes, message: 'Google Ads is limiting how often this project calls it. Try again in a few minutes.' };
  }
  return { codes, message: said };
}

async function call<T>(access: GoogleAdsAccess, path: string, body: unknown): Promise<T> {
  const base = (access.baseUrl ?? `${GOOGLE_ADS_BASE}/${GOOGLE_ADS_API_VERSION}`).replace(/\/+$/, '');
  const headers: Record<string, string> = {
    'authorization': `Bearer ${access.accessToken}`,
    'content-type': 'application/json',
  };
  if (access.loginCustomerId) {
    headers['login-customer-id'] = customerDigits(access.loginCustomerId);
  }
  if (access.developerToken) {
    headers['developer-token'] = access.developerToken;
  }
  const res = await fetch(`${base}/customers/${customerDigits(access.customerId)}/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    let parsed: FailureBody | null = null;
    try {
      parsed = await res.json() as FailureBody;
    } catch {
      // Not JSON: the status alone says it.
    }
    const { message, codes } = failureMessage(res.status, parsed);
    throw new GoogleAdsError(message, res.status, codes);
  }
  return await res.json() as T;
}

/**
 * Every row a GAQL query returns, following `nextPageToken` up to `maxRows`.
 * @param access - The account and login.
 * @param query - GAQL, built from fixed text and `gaqlString`/`gaqlDate` values only.
 * @param maxRows - Stop after this many rows (default 10,000).
 */
export async function adsSearch<Row = Record<string, unknown>>(access: GoogleAdsAccess, query: string, maxRows = 10_000): Promise<Row[]> {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  do {
    const page = await call<{ results?: Row[]; nextPageToken?: string }>(access, 'googleAds:search', { query, ...(pageToken ? { pageToken } : {}) });
    rows.push(...(page.results ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken && rows.length < maxRows);
  return rows.slice(0, maxRows);
}

export type MutateResponse = { mutateOperationResponses?: Array<Record<string, { resourceName?: string } | undefined>> };

/**
 * Apply a batch of `mutateOperations` atomically, or only check it.
 * @param access - The account and login.
 * @param operations - The operations, in the API's JSON shape.
 * @param opts - Options.
 * @param opts.validateOnly - Check the batch; change nothing.
 */
export async function adsMutate(access: GoogleAdsAccess, operations: unknown[], opts: { validateOnly?: boolean } = {}): Promise<MutateResponse> {
  if (operations.length === 0) {
    return { mutateOperationResponses: [] };
  }
  return call<MutateResponse>(access, 'googleAds:mutate', { mutateOperations: operations, validateOnly: Boolean(opts.validateOnly) });
}

/**
 * Check a batch, then apply it: Google's own validation runs over every
 * operation before anything changes, so a batch it would refuse halfway is
 * refused whole, with its sentence.
 * @param access - The account and login.
 * @param operations - The operations.
 */
export async function adsValidateThenMutate(access: GoogleAdsAccess, operations: unknown[]): Promise<MutateResponse> {
  await adsMutate(access, operations, { validateOnly: true });
  return adsMutate(access, operations);
}

/**
 * The resource names a mutate created, in operation order.
 * @param response - What `adsMutate` returned.
 */
export function createdNames(response: MutateResponse): string[] {
  return (response.mutateOperationResponses ?? []).map(r => Object.values(r).find(v => v?.resourceName)?.resourceName ?? '').filter(Boolean);
}

/**
 * The account in Google Ads' own UI.
 * @param customerId - The account.
 * @param campaignId - A campaign in it, when the link is to one.
 */
export function adsUiUrl(customerId: string, campaignId?: string | null): string {
  const ocid = customerDigits(customerId);
  return campaignId
    ? `https://ads.google.com/aw/overview?__e=${ocid}&campaignId=${encodeURIComponent(campaignId)}`
    : `https://ads.google.com/aw/overview?__e=${ocid}`;
}
