/**
 * Shared Sentry API client — the one place that knows how to talk to a Sentry
 * organization. The `sentry` connector's Test connection, the agents'
 * `sentry_issues` / `sentry_issue` reads, the product page's open-issue count
 * and the error watch all go through it, so the Bearer header, the region host,
 * the organization addressing and the error shaping exist exactly once.
 *
 * Read-only. Every call is a GET against `<host>/api/0/…`; nothing here
 * resolves, assigns or comments on an issue.
 *
 * Errors are DATA, never throws, as the PostHog and Apollo clients have it: a
 * caller hands the failure on — to the checklist on the Connections page, to a
 * tool's answer — and it says what to do ("the token cannot read this
 * organization") instead of an opaque exception.
 *
 * Auth is a user or internal-integration token with `org:read`, `project:read`
 * and `event:read`, kept with the organization slug and the region host it is
 * spent against (`https://us.sentry.io`, `https://de.sentry.io`, or a
 * self-hosted origin) as the `sentry` credential platform.
 */

export type SentryFailure
  = | { ok: false; error: 'no_sentry_credentials'; message: string }
    | { ok: false; error: 'sentry_unauthorized'; status: 401 | 403; message: string }
    | { ok: false; error: 'sentry_not_found'; status: 404; message: string }
    | { ok: false; error: 'sentry_rate_limited'; status: 429; message: string }
    | { ok: false; error: 'sentry_error'; status: number | null; message: string };

export type SentryResult<T> = { ok: true; data: T; /** Sentry's total for a list (`X-Hits`), when it sent one. */ hits?: number } | SentryFailure;

/** Where a token is spent: one region host, one organization. */
export type SentryCredentials = {
  token: string;
  /** The organization slug, e.g. `northwind`. */
  org: string;
  /** `https://us.sentry.io`, `https://de.sentry.io`, or a self-hosted origin. No trailing slash. */
  host: string;
};

export const SENTRY_US_HOST = 'https://us.sentry.io';
const TIMEOUT_MS = 15_000;

/**
 * Trim a host to an origin: whitespace and trailing slashes off, `/api/0` off
 * when it was pasted with it, scheme required.
 * @param host - The host as typed.
 */
export function normalizeSentryHost(host: string): string | null {
  const trimmed = host.trim().replace(/\/+$/, '').replace(/\/api\/0$/i, '');
  return /^https?:\/\/[^\s/]+$/i.test(trimmed) ? trimmed : null;
}

/**
 * The vaulted credential, or the reason it cannot be used. The three field
 * names are the storage contract with the `sentry` platform descriptor in
 * `libs/platforms/registry.ts`.
 * @param values - The decrypted credential bag.
 */
export function sentryCredentialsFrom(values?: Record<string, unknown> | null): { ok: true; credentials: SentryCredentials } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : '';
  const org = typeof values?.org === 'string' ? values.org.trim() : '';
  const host = normalizeSentryHost(typeof values?.host === 'string' && values.host.trim() ? values.host : SENTRY_US_HOST);
  if (!token) {
    return { ok: false, message: 'No Sentry token is stored for this workspace. Connect Sentry on the Connections page with an auth token, the organization slug and the region host.' };
  }
  if (!/^[\w-]+$/.test(org)) {
    return { ok: false, message: 'The Sentry organization slug is missing or not a slug — it is the part of your Sentry address before .sentry.io.' };
  }
  if (!host) {
    return { ok: false, message: `The Sentry host must be an address such as ${SENTRY_US_HOST}, https://de.sentry.io, or your own install's origin.` };
  }
  return { ok: true, credentials: { token, org, host } };
}

/** What a fetch looks like to this client, so a test can stand in for the network. */
export type SentryFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string>; headers?: { get: (name: string) => string | null } }>;

/**
 * One GET against the Sentry API, its failure shaped.
 * @param c - Where and as whom.
 * @param path - The path after `/api/0`, starting with `/`.
 * @param params - Query parameters; arrays repeat the key.
 * @param doFetch - The network, injected in tests.
 */
export async function sentryGet<T>(c: SentryCredentials, path: string, params: Record<string, string | number | string[] | undefined | null> = {}, doFetch?: SentryFetch): Promise<SentryResult<T>> {
  const url = new URL(`${c.host}/api/0${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') {
      continue;
    }
    for (const one of Array.isArray(v) ? v : [String(v)]) {
      url.searchParams.append(k, one);
    }
  }
  const f = doFetch ?? (globalThis.fetch as unknown as SentryFetch);
  let res: Awaited<ReturnType<SentryFetch>>;
  try {
    res = await f(url.toString(), { headers: { 'authorization': `Bearer ${c.token}`, 'accept': 'application/json', 'user-agent': 'vocion' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return { ok: false, error: 'sentry_error', status: null, message: `Sentry did not answer at ${c.host}: ${String((err as Error)?.message ?? err).slice(0, 160)}` };
  }
  if (res.ok) {
    const hits = Number(res.headers?.get('x-hits'));
    return { ok: true, data: await res.json() as T, ...(Number.isFinite(hits) && res.headers?.get('x-hits') ? { hits } : {}) };
  }
  const detail = await res.text().then((t) => {
    try {
      const d = JSON.parse(t) as { detail?: unknown };
      return typeof d.detail === 'string' ? d.detail : t;
    } catch {
      return t;
    }
  }).catch(() => '');
  const said = String(detail).replace(/\s+/g, ' ').slice(0, 200);
  if (res.status === 401 || res.status === 403) {
    return { ok: false, error: 'sentry_unauthorized', status: res.status, message: `Sentry refused the token for ${c.org} (HTTP ${res.status}${said ? `: ${said}` : ''}). It needs org:read, project:read and event:read on this organization, at ${c.host}.` };
  }
  if (res.status === 404) {
    return { ok: false, error: 'sentry_not_found', status: 404, message: `Sentry has nothing at ${path} for ${c.org}${said ? ` (${said})` : ''}. Check the organization slug, the project and the region host (${c.host}).` };
  }
  if (res.status === 429) {
    return { ok: false, error: 'sentry_rate_limited', status: 429, message: 'Sentry is rate limiting this token; try again in a minute.' };
  }
  return { ok: false, error: 'sentry_error', status: res.status, message: `Sentry answered HTTP ${res.status}${said ? `: ${said}` : ''}.` };
}

/* ------------------------------------------------------------------ */
/* Shapes, as the tools hand them on                                   */
/* ------------------------------------------------------------------ */

/** One issue, ranked and linked: the short id a person says, and where it opens. */
export type SentryIssue = {
  id: string;
  /** What a person says and searches for, e.g. `NW-API-3`. */
  shortId: string;
  title: string;
  /** Where Sentry says it happens: a route, a function. */
  culprit: string | null;
  url: string;
  level: string | null;
  status: string | null;
  project: string | null;
  /** Events in the window the list was read over (lifetime on a single read). */
  events: number;
  users: number;
  firstSeen: string | null;
  lastSeen: string | null;
  /** The release it was first and last seen in, when read one by one (`issue`). */
  firstRelease?: string | null;
  firstReleaseAt?: string | null;
  lastRelease?: string | null;
};

type RawRelease = { version?: unknown; dateCreated?: unknown } | null | undefined;
type RawIssue = {
  id?: unknown;
  shortId?: unknown;
  title?: unknown;
  culprit?: unknown;
  permalink?: unknown;
  level?: unknown;
  status?: unknown;
  project?: { slug?: unknown } | null;
  count?: unknown;
  userCount?: unknown;
  firstSeen?: unknown;
  lastSeen?: unknown;
  firstRelease?: RawRelease;
  lastRelease?: RawRelease;
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * One raw issue as the tools hand it on.
 * @param raw - What the API returned.
 * @param c - The credential, for the link when the API gave none.
 */
export function issueOf(raw: RawIssue, c: Pick<SentryCredentials, 'org'>): SentryIssue {
  const id = String(raw.id ?? '');
  const out: SentryIssue = {
    id,
    shortId: s(raw.shortId) ?? id,
    title: s(raw.title) ?? '(untitled issue)',
    culprit: s(raw.culprit),
    url: s(raw.permalink) ?? `https://${c.org}.sentry.io/issues/${id}/`,
    level: s(raw.level),
    status: s(raw.status),
    project: s(raw.project?.slug),
    events: n(raw.count),
    users: n(raw.userCount),
    firstSeen: s(raw.firstSeen),
    lastSeen: s(raw.lastSeen),
  };
  if (raw.firstRelease !== undefined || raw.lastRelease !== undefined) {
    out.firstRelease = s(raw.firstRelease?.version);
    out.firstReleaseAt = s(raw.firstRelease?.dateCreated);
    out.lastRelease = s(raw.lastRelease?.version);
  }
  return out;
}

export type IssueQuery = {
  /** Project slug. */
  project?: string | null;
  environment?: string | null;
  /** Only issues seen in this release. */
  release?: string | null;
  /** Only issues FIRST seen in this release — what a deploy introduced. */
  firstRelease?: string | null;
  /** Sentry's own period: `1h`, `24h`, `14d`. Default 24h. */
  statsPeriod?: string | null;
  /** `unresolved` (default), `resolved`, or `all`. */
  status?: 'unresolved' | 'resolved' | 'all';
  limit?: number;
};

/**
 * Issues ranked by events in the window, newest activity breaking ties.
 * @param c - Where and as whom.
 * @param q - What to read.
 * @param doFetch - The network, injected in tests.
 */
export async function listIssues(c: SentryCredentials, q: IssueQuery, doFetch?: SentryFetch): Promise<SentryResult<SentryIssue[]>> {
  const terms = [
    q.status === 'all' ? null : `is:${q.status ?? 'unresolved'}`,
    q.project ? `project:${q.project}` : null,
    q.release ? `release:${q.release}` : null,
    q.firstRelease ? `firstRelease:${q.firstRelease}` : null,
  ].filter(Boolean);
  const res = await sentryGet<RawIssue[]>(c, `/organizations/${c.org}/issues/`, {
    query: terms.join(' '),
    environment: q.environment ?? undefined,
    statsPeriod: q.statsPeriod ?? '24h',
    sort: 'freq',
    limit: Math.min(Math.max(Math.trunc(q.limit ?? 10), 1), 50),
  }, doFetch);
  if (!res.ok) {
    return res;
  }
  return { ok: true, data: (Array.isArray(res.data) ? res.data : []).map(i => issueOf(i, c)), ...(res.hits !== undefined ? { hits: res.hits } : {}) };
}

/**
 * One issue, by its numeric id or its short id (`NW-API-3`), with the
 * releases it was first and last seen in.
 * @param c - Where and as whom.
 * @param id - The id or short id.
 * @param doFetch - The network, injected in tests.
 */
export async function readIssue(c: SentryCredentials, id: string, doFetch?: SentryFetch): Promise<SentryResult<SentryIssue>> {
  const res = await sentryGet<RawIssue>(c, `/organizations/${c.org}/issues/${encodeURIComponent(id.trim())}/`, {}, doFetch);
  return res.ok ? { ok: true, data: issueOf(res.data, c) } : res;
}

/** One frame of a stack trace, as a person maps it to a file. */
export type SentryFrame = { file: string | null; line: number | null; column: number | null; function: string | null; module: string | null; inApp: boolean };
export type SentryException = { type: string | null; value: string | null; frames: SentryFrame[] };

/** The latest event of an issue: what broke, where, on which request and release. */
export type SentryEvent = {
  eventId: string;
  at: string | null;
  release: string | null;
  environment: string | null;
  exceptions: SentryException[];
  /** The last breadcrumbs before it, oldest first. */
  breadcrumbs: Array<{ at: string | null; category: string | null; level: string | null; message: string | null }>;
  request: { method: string | null; url: string | null; status: number | null } | null;
  tags: Record<string, string>;
};

type RawFrame = { filename?: unknown; absPath?: unknown; lineNo?: unknown; colNo?: unknown; function?: unknown; module?: unknown; inApp?: unknown };
type RawEntry = { type?: unknown; data?: { values?: unknown[]; method?: unknown; url?: unknown } };
type RawEvent = { eventID?: unknown; dateCreated?: unknown; release?: { version?: unknown } | null; tags?: Array<{ key?: unknown; value?: unknown }>; entries?: RawEntry[] };

/** How much of an exception message is kept: the first lines say what broke. */
const VALUE_MAX = 1200;
const BREADCRUMBS_KEPT = 8;
const FRAMES_KEPT = 25;

/**
 * The raw event as the tools hand it on.
 * @param raw - What the API returned.
 */
export function eventOf(raw: RawEvent): SentryEvent {
  const tags: Record<string, string> = {};
  for (const t of raw.tags ?? []) {
    const k = s(t.key);
    const v = s(t.value);
    if (k && v) {
      tags[k] = v;
    }
  }
  const entries = raw.entries ?? [];
  const exceptions: SentryException[] = [];
  for (const e of entries.filter(x => x.type === 'exception')) {
    for (const v of (e.data?.values ?? []) as Array<{ type?: unknown; value?: unknown; stacktrace?: { frames?: RawFrame[] } | null }>) {
      const frames = (v.stacktrace?.frames ?? []).map(f => ({
        file: s(f.filename) ?? s(f.absPath),
        line: typeof f.lineNo === 'number' ? f.lineNo : null,
        column: typeof f.colNo === 'number' ? f.colNo : null,
        function: s(f.function),
        module: s(f.module),
        inApp: f.inApp === true,
      }));
      exceptions.push({ type: s(v.type), value: s(v.value)?.slice(0, VALUE_MAX) ?? null, frames: frames.slice(-FRAMES_KEPT) });
    }
  }
  const crumbs = entries.find(x => x.type === 'breadcrumbs')?.data?.values as Array<{ timestamp?: unknown; category?: unknown; level?: unknown; message?: unknown }> | undefined;
  const req = entries.find(x => x.type === 'request')?.data;
  const status = Number(tags.status_code);
  return {
    eventId: String(raw.eventID ?? ''),
    at: s(raw.dateCreated),
    release: s(raw.release?.version) ?? tags.release ?? null,
    environment: tags.environment ?? null,
    exceptions,
    breadcrumbs: (crumbs ?? []).slice(-BREADCRUMBS_KEPT).map(b => ({ at: s(b.timestamp), category: s(b.category), level: s(b.level), message: s(b.message)?.slice(0, 300) ?? null })),
    request: req || tags.url ? { method: s(req?.method), url: s(req?.url) ?? tags.url ?? null, status: Number.isFinite(status) && status > 0 ? status : null } : null,
    tags,
  };
}

/**
 * The latest event of an issue, in one environment when named.
 * @param c - Where and as whom.
 * @param id - The issue's numeric id.
 * @param environment - Only events from this environment.
 * @param doFetch - The network, injected in tests.
 */
export async function latestEvent(c: SentryCredentials, id: string, environment?: string | null, doFetch?: SentryFetch): Promise<SentryResult<SentryEvent>> {
  const res = await sentryGet<RawEvent>(c, `/organizations/${c.org}/issues/${encodeURIComponent(id)}/events/latest/`, { environment: environment ?? undefined }, doFetch);
  return res.ok ? { ok: true, data: eventOf(res.data) } : res;
}

/** Events per issue inside a window, from Discover. */
export type IssueCount = { issueId: string; shortId: string; title: string | null; events: number; firstAt: string | null; lastAt: string | null; release?: string | null };

/**
 * Error events per issue between two instants, most first — the windowed
 * count the issue list cannot give (its `count` is over a stats period).
 * @param c - Where and as whom.
 * @param q - What to count.
 * @param q.project - Project slug.
 * @param q.environment - One environment.
 * @param q.release - One release.
 * @param q.byRelease - Split each issue's count by release.
 * @param q.start - From (inclusive).
 * @param q.end - To.
 * @param q.limit - How many issues.
 * @param doFetch - The network, injected in tests.
 */
export async function countErrors(c: SentryCredentials, q: { project?: string | null; environment?: string | null; release?: string | null; byRelease?: boolean; start: Date; end: Date; limit?: number }, doFetch?: SentryFetch): Promise<SentryResult<IssueCount[]>> {
  const query = ['event.type:error', q.project ? `project:${q.project}` : null, q.release ? `release:${q.release}` : null].filter(Boolean).join(' ');
  const fields = ['issue', 'title', 'count()', 'min(timestamp)', 'max(timestamp)', ...(q.byRelease ? ['release'] : [])];
  const res = await sentryGet<{ data?: Array<Record<string, unknown>> }>(c, `/organizations/${c.org}/events/`, {
    field: fields,
    query,
    environment: q.environment ?? undefined,
    start: q.start.toISOString().replace(/\.\d{3}Z$/, ''),
    end: q.end.toISOString().replace(/\.\d{3}Z$/, ''),
    utc: 'true',
    sort: '-count',
    per_page: Math.min(Math.max(Math.trunc(q.limit ?? 20), 1), 100),
    project: '-1',
  }, doFetch);
  if (!res.ok) {
    return res;
  }
  return {
    ok: true,
    data: (res.data.data ?? []).map(row => ({
      issueId: String(row['issue.id'] ?? ''),
      shortId: s(row.issue) ?? String(row['issue.id'] ?? ''),
      title: s(row.title),
      events: n(row['count()']),
      firstAt: s(row['min(timestamp)']),
      lastAt: s(row['max(timestamp)']),
      ...(q.byRelease ? { release: s(row.release) } : {}),
    })),
  };
}

/**
 * The organization itself — the first read of Test connection.
 * @param c - Where and as whom.
 * @param doFetch - The network, injected in tests.
 */
export async function readOrganization(c: SentryCredentials, doFetch?: SentryFetch): Promise<SentryResult<{ slug: string; name: string | null; url: string | null }>> {
  const res = await sentryGet<{ slug?: unknown; name?: unknown; links?: { organizationUrl?: unknown } }>(c, `/organizations/${c.org}/`, {}, doFetch);
  return res.ok ? { ok: true, data: { slug: s(res.data.slug) ?? c.org, name: s(res.data.name), url: s(res.data.links?.organizationUrl) } } : res;
}

/**
 * The organization's projects, by slug.
 * @param c - Where and as whom.
 * @param doFetch - The network, injected in tests.
 */
export async function listProjects(c: SentryCredentials, doFetch?: SentryFetch): Promise<SentryResult<Array<{ slug: string; id: string; platform: string | null }>>> {
  const res = await sentryGet<Array<{ slug?: unknown; id?: unknown; platform?: unknown }>>(c, `/organizations/${c.org}/projects/`, {}, doFetch);
  return res.ok ? { ok: true, data: (Array.isArray(res.data) ? res.data : []).map(p => ({ slug: String(p.slug ?? ''), id: String(p.id ?? ''), platform: s(p.platform) })).filter(p => p.slug) } : res;
}

/**
 * Where a project's issues open in Sentry, for a person: the organization's
 * own address, filtered to the project and environment.
 * @param ref - The project.
 * @param ref.org - Organization slug.
 * @param ref.project - Project slug.
 * @param ref.environment - Environment, when one.
 */
export function projectIssuesUrl(ref: { org: string; project: string; environment?: string | null }): string {
  const q = new URLSearchParams({ query: `is:unresolved project:${ref.project}`, statsPeriod: '24h' });
  if (ref.environment) {
    q.set('environment', ref.environment);
  }
  return `https://${ref.org}.sentry.io/issues/?${q.toString()}`;
}
