/**
 * Google Search Console — what a site already gets from Google search: the
 * queries it shows for, the pages that show, and the clicks, impressions,
 * CTR and average position of each, by date range. Free, and the client's
 * own numbers rather than an estimate.
 *
 * Two calls (Search Console API v1, `webmasters.readonly`): the properties a
 * login can read (`sites.list`) and Search Analytics (`searchAnalytics.query`).
 * A property is a domain (`sc-domain:example.com`) or a URL prefix
 * (`https://www.example.com/`). Pure HTTP and shaping: the access token comes
 * from the caller.
 */

const API = 'https://www.googleapis.com/webmasters/v3';

/** The most rows one Search Analytics call returns. */
export const SEARCH_CONSOLE_MAX_ROWS = 25_000;

/** Search Console's data runs about two days behind. */
export const SEARCH_CONSOLE_LAG_DAYS = 2;

export type SearchConsoleSite = { siteUrl: string; permissionLevel: string };

export type SearchConsoleDimension = 'query' | 'page' | 'country' | 'device' | 'date';

export type SearchConsoleFilter = {
  dimension: 'query' | 'page' | 'country' | 'device';
  operator: 'contains' | 'equals' | 'notContains' | 'notEquals' | 'includingRegex' | 'excludingRegex';
  expression: string;
};

export type SearchConsoleRow = {
  /** One value per dimension asked, in order. */
  keys: string[];
  clicks: number;
  impressions: number;
  /** 0–1. */
  ctr: number;
  /** Average position, 1 = top. */
  position: number;
};

export type SearchConsoleReport = {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchConsoleDimension[];
  rows: SearchConsoleRow[];
};

/** A refusal from Google, with its status, in words a person can act on. */
export class SearchConsoleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'SearchConsoleError';
    this.status = status;
  }
}

/**
 * Words for a refused call.
 * @param status - HTTP status.
 * @param said - Google's own message.
 * @param siteUrl - The property, when one was asked.
 */
export function searchConsoleRefusal(status: number, said: string, siteUrl?: string): string {
  const words = said ? ` Google said: "${said.slice(0, 200)}".` : '';
  if (status === 401) {
    return `The Google login for Search Console has expired or was revoked.${words} Reconnect Search Console.`;
  }
  if (status === 403) {
    return `This Google login cannot read ${siteUrl ? `the Search Console property ${siteUrl}` : 'Search Console'}.${words} The account needs access to the property in Search Console (Settings → Users and permissions), or the login needs Search Console access: reconnect Search Console.`;
  }
  return `Search Console failed (HTTP ${status}).${words}`;
}

async function call<T>(accessToken: string, url: string, init: RequestInit, siteUrl?: string): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'authorization': `Bearer ${accessToken}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let said = '';
    try {
      said = String((JSON.parse(body) as { error?: { message?: unknown } }).error?.message ?? '');
    } catch {
      said = body.slice(0, 200);
    }
    throw new SearchConsoleError(res.status, searchConsoleRefusal(res.status, said, siteUrl));
  }
  return (await res.json()) as T;
}

/**
 * The properties a login can read, verified ones only, domains first.
 * @param accessToken - A Google access token with `webmasters.readonly`.
 */
export async function listSearchConsoleSites(accessToken: string): Promise<SearchConsoleSite[]> {
  const data = await call<{ siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }>(accessToken, `${API}/sites`, { method: 'GET' });
  return sitesOf(data);
}

/**
 * `sites.list` in a plain shape: unverified properties left out (they read
 * no data), domain properties first, then A–Z. Pure.
 * @param data - Google's response.
 * @param data.siteEntry - The properties.
 */
export function sitesOf(data: { siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }> }): SearchConsoleSite[] {
  return (data.siteEntry ?? [])
    .filter((s): s is { siteUrl: string; permissionLevel: string } => typeof s.siteUrl === 'string' && Boolean(s.siteUrl) && s.permissionLevel !== 'siteUnverifiedUser')
    .map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel ?? 'unknown' }))
    .sort((a, b) => Number(b.siteUrl.startsWith('sc-domain:')) - Number(a.siteUrl.startsWith('sc-domain:')) || a.siteUrl.localeCompare(b.siteUrl));
}

/**
 * How a property is named to a person: "example.com (whole domain)" or the
 * URL prefix as is.
 * @param siteUrl - The property.
 */
export function propertyLabel(siteUrl: string): string {
  return siteUrl.startsWith('sc-domain:') ? `${siteUrl.slice('sc-domain:'.length)} (whole domain)` : siteUrl;
}

/**
 * A date range Search Console can answer: `days` days ending two days ago
 * (its data lags), or the dates given.
 * @param input - Dates or a length.
 * @param input.startDate - YYYY-MM-DD.
 * @param input.endDate - YYYY-MM-DD.
 * @param input.days - How many days back, when no dates are given (default 28).
 * @param now - Today.
 */
export function searchConsoleRange(input: { startDate?: string; endDate?: string; days?: number }, now: Date = new Date()): { startDate: string; endDate: string } {
  const day = 24 * 60 * 60 * 1000;
  const end = input.endDate ?? new Date(now.getTime() - SEARCH_CONSOLE_LAG_DAYS * day).toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(480, input.days ?? 28));
  const start = input.startDate ?? new Date(new Date(`${end}T00:00:00Z`).getTime() - (days - 1) * day).toISOString().slice(0, 10);
  return { startDate: start, endDate: end };
}

/**
 * Search Analytics rows in a plain shape: CTR as a share, position to one
 * decimal. Pure.
 * @param data - Google's response.
 * @param data.rows - The rows.
 */
export function rowsOf(data: { rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }): SearchConsoleRow[] {
  return (data.rows ?? []).map(r => ({
    keys: r.keys ?? [],
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: Math.round((r.ctr ?? 0) * 10_000) / 10_000,
    position: Math.round((r.position ?? 0) * 10) / 10,
  }));
}

/**
 * Clicks, impressions, CTR and position for a property, by the dimensions
 * asked, most clicks first.
 * @param accessToken - A Google access token with `webmasters.readonly`.
 * @param input - What to read.
 * @param input.siteUrl - The property.
 * @param input.startDate - YYYY-MM-DD.
 * @param input.endDate - YYYY-MM-DD.
 * @param input.dimensions - What the rows are broken down by.
 * @param input.filters - Filters, all of which must hold.
 * @param input.rowLimit - How many rows (at most 25,000).
 * @param input.searchType - Web results (default), images, video or news.
 */
export async function querySearchConsole(accessToken: string, input: {
  siteUrl: string;
  startDate: string;
  endDate: string;
  dimensions: SearchConsoleDimension[];
  filters?: SearchConsoleFilter[];
  rowLimit?: number;
  searchType?: 'web' | 'image' | 'video' | 'news';
}): Promise<SearchConsoleReport> {
  const body = {
    startDate: input.startDate,
    endDate: input.endDate,
    dimensions: input.dimensions,
    type: input.searchType ?? 'web',
    rowLimit: Math.max(1, Math.min(SEARCH_CONSOLE_MAX_ROWS, input.rowLimit ?? 100)),
    ...(input.filters?.length ? { dimensionFilterGroups: [{ groupType: 'and', filters: input.filters }] } : {}),
  };
  const data = await call<{ rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }> }>(
    accessToken,
    `${API}/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`,
    { method: 'POST', body: JSON.stringify(body) },
    input.siteUrl,
  );
  return { siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: input.dimensions, rows: rowsOf(data) };
}
