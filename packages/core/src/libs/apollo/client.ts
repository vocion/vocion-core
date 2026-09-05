/**
 * Shared Apollo API client — the one place that knows how to talk to
 * api.apollo.io. Every Apollo agent tool and the Sources-page entitlement
 * probe consume it, so the `x-api-key` header, rate-limit handling and error
 * shaping exist exactly once.
 *
 * Errors are DATA, never throws, exactly as the HubSpot client has it: a tool
 * hands the failure object straight back to the model, which can then say
 * "this Apollo plan does not include company search" instead of eating an
 * opaque exception.
 *
 * Two things HubSpot's client has no need for live here:
 *
 *   - **429 / Retry-After.** Apollo's per-minute allowance is small and it
 *     asks for an exact wait. `libs/http/retryAfter.ts` honours it.
 *   - **Rate-limit header capture.** Apollo stamps per-minute/hour/day usage
 *     on every response. `apollo_usage` reads that cache when the master-key
 *     endpoint is closed, so the guardrail degrades to observed fact rather
 *     than to a guess. Header NAMES are read leniently across the plausible
 *     variants: the probe on the Sources page is what confirms which ones this
 *     account actually returns.
 */

import { fetchRetryingRateLimits, retryAfterMs } from '@/libs/http/retryAfter';

export type ApolloFailure
  = | { ok: false; error: 'no_apollo_credentials'; message: string }
    | { ok: false; error: 'apollo_unauthorized'; status: number; message: string }
  /** The endpoint exists but this Apollo plan does not open it (company search, usage stats). */
    | { ok: false; error: 'plan_tier_unavailable'; endpoint: string; message: string }
    | { ok: false; error: 'apollo_rate_limited'; retry_after_seconds: number | null; message: string }
    | { ok: false; error: 'apollo_error'; status: number; message: string };

export type ApolloResult<T> = { ok: true; data: T } | ApolloFailure;

/** Per-minute / hour / day usage, as Apollo stamps it on a response. */
export type ApolloRateSnapshot = {
  /** Header name to value, verbatim, for every rate-limit header the response carried. */
  headers: Record<string, string>;
  minute: { used: number | null; limit: number | null };
  hourly: { used: number | null; limit: number | null };
  daily: { used: number | null; limit: number | null };
  /** When this snapshot was taken. */
  observedAt: string;
  /** The path whose response it came off. */
  path: string;
};

export type ApolloClient = {
  get: <T>(path: string, params?: Record<string, string>) => Promise<ApolloResult<T>>;
  post: <T>(path: string, body: unknown) => Promise<ApolloResult<T>>;
  /** The most recent rate-limit headers this client observed, or null if it has made no call. */
  lastRateSnapshot: () => ApolloRateSnapshot | null;
  baseUrl: string;
};

export const APOLLO_BASE_URL = 'https://api.apollo.io';

/**
 * The vaulted API key, whichever field name the vault entry used.
 * @param credentials - The decrypted credential bag for the apollo source.
 */
export function keyFromCredentials(credentials?: Record<string, unknown>): string | undefined {
  const key = credentials?.token ?? credentials?.apiKey ?? credentials?.api_key;
  return typeof key === 'string' && key.trim() !== '' ? key.trim() : undefined;
}

export function noApolloCredentials(detail?: string): ApolloFailure {
  return {
    ok: false,
    error: 'no_apollo_credentials',
    message: detail ?? 'No Apollo API key is stored in the vault for this workspace. Connect the apollo source on the Sources page (Add connector → Apollo → paste the key) before calling live Apollo tools.',
  };
}

/**
 * Endpoints only a paid or master key opens. A 403 on one of these is a plan
 * fact, not a bug, and is named as such so the model reports the limit rather
 * than retrying into it.
 */
const PLAN_GATED: Array<{ match: RegExp; endpoint: string; message: string }> = [
  {
    match: /mixed_companies\/search/,
    endpoint: 'company_search',
    message: 'Apollo refused company search (403). That endpoint is paid-tier only, so this workspace\'s Apollo plan does not include it. People search and enrichment are unaffected — report the limit rather than retrying.',
  },
  {
    match: /usage_stats\/api_usage_stats/,
    endpoint: 'usage_stats',
    message: 'Apollo refused the usage-stats endpoint (403). It requires a MASTER API key; this key is not one. Quota can still be reported from the rate-limit headers observed on the last call.',
  },
];

/**
 * Shape a non-OK response into a named failure.
 * @param res - The response Apollo sent.
 * @param path - The path it answered, used to name a plan-gated endpoint.
 */
async function shapeFailure(res: Response, path: string): Promise<ApolloFailure> {
  const text = await res.text().catch(() => '');
  if (res.status === 401) {
    return {
      ok: false,
      error: 'apollo_unauthorized',
      status: 401,
      message: `Apollo rejected the API key (401): ${text.slice(0, 300) || 'no message returned'}. Check the key on the Sources page — Test connection reports whether it is valid.`,
    };
  }
  if (res.status === 403) {
    const gated = PLAN_GATED.find(entry => entry.match.test(path));
    if (gated) {
      return { ok: false, error: 'plan_tier_unavailable', endpoint: gated.endpoint, message: gated.message };
    }
    return {
      ok: false,
      error: 'apollo_unauthorized',
      status: 403,
      message: `Apollo refused this call (403): ${text.slice(0, 300) || 'no message returned'}. The key is valid but this plan does not open this endpoint.`,
    };
  }
  if (res.status === 429) {
    const waitMs = retryAfterMs(res.headers);
    return {
      ok: false,
      error: 'apollo_rate_limited',
      retry_after_seconds: waitMs === null ? null : Math.ceil(waitMs / 1000),
      message: `Apollo rate limit reached (429)${waitMs === null ? '' : `; it asked for ${Math.ceil(waitMs / 1000)}s`}. This is a quota fact, not a failure of the query — say so and try again later rather than re-running now.`,
    };
  }
  return {
    ok: false,
    error: 'apollo_error',
    status: res.status,
    message: `Apollo API error ${res.status}: ${text.slice(0, 500)}`,
  };
}

/**
 * Rate-limit header names Apollo is documented or observed to use, per window.
 *
 * Read leniently and case-insensitively: which of these an account actually
 * returns is one of the facts the Sources-page probe exists to establish, and
 * guessing one name would mean `apollo_usage` silently reporting nothing.
 */
const RATE_HEADER_CANDIDATES = {
  minute: {
    used: ['x-minute-requests-left', 'x-rate-limit-minute-used', 'x-minute-usage'],
    limit: ['x-rate-limit-minute', 'x-minute-requests-limit'],
  },
  hourly: {
    used: ['x-hourly-requests-left', 'x-rate-limit-hourly-used', 'x-hourly-usage'],
    limit: ['x-rate-limit-hourly', 'x-hourly-requests-limit'],
  },
  daily: {
    used: ['x-daily-requests-left', 'x-rate-limit-daily-used', 'x-daily-usage'],
    limit: ['x-rate-limit-daily', 'x-daily-requests-limit'],
  },
} as const;

/** Any header whose name looks like rate-limit state, kept verbatim. */
const RATE_HEADER_SHAPE = /^x-(?:minute|hourly|daily|rate-limit|ratelimit)/i;

/**
 * Read one number off a header bag, trying each candidate name in order.
 * @param headers - Lowercased header name to value.
 * @param names - Candidate names, most likely first.
 */
function firstNumber(headers: Record<string, string>, names: readonly string[]): number | null {
  for (const name of names) {
    const raw = headers[name];
    if (raw !== undefined && raw !== '' && Number.isFinite(Number(raw))) {
      return Number(raw);
    }
  }
  return null;
}

/**
 * The rate-limit state a response carried, or null when it carried none.
 * @param res - The response to read.
 * @param path - The path it answered, recorded on the snapshot.
 */
export function rateSnapshotFrom(res: Response, path: string): ApolloRateSnapshot | null {
  const headers: Record<string, string> = {};
  res.headers?.forEach?.((value, name) => {
    if (RATE_HEADER_SHAPE.test(name)) {
      headers[name.toLowerCase()] = value;
    }
  });
  if (Object.keys(headers).length === 0) {
    return null;
  }
  return {
    headers,
    minute: {
      used: firstNumber(headers, RATE_HEADER_CANDIDATES.minute.used),
      limit: firstNumber(headers, RATE_HEADER_CANDIDATES.minute.limit),
    },
    hourly: {
      used: firstNumber(headers, RATE_HEADER_CANDIDATES.hourly.used),
      limit: firstNumber(headers, RATE_HEADER_CANDIDATES.hourly.limit),
    },
    daily: {
      used: firstNumber(headers, RATE_HEADER_CANDIDATES.daily.used),
      limit: firstNumber(headers, RATE_HEADER_CANDIDATES.daily.limit),
    },
    observedAt: new Date().toISOString(),
    path,
  };
}

/**
 * The latest snapshot per org, so `apollo_usage` can answer from observed
 * headers when the master-key endpoint is closed. In-process only, and
 * deliberately: this is a cache of something already reported, never a store
 * of record, and a cold process simply says it has seen no call yet.
 */
const lastSnapshotByOrg = new Map<string, ApolloRateSnapshot>();

export function recordRateSnapshot(orgId: string, snapshot: ApolloRateSnapshot | null): void {
  if (snapshot) {
    lastSnapshotByOrg.set(orgId, snapshot);
  }
}

export function observedRateSnapshot(orgId: string): ApolloRateSnapshot | null {
  return lastSnapshotByOrg.get(orgId) ?? null;
}

/** Test seam: forget every observed snapshot. */
export function resetObservedRateSnapshots(): void {
  lastSnapshotByOrg.clear();
}

/**
 * A client for one Apollo API key.
 * @param opts - How to reach Apollo.
 * @param opts.apiKey - The workspace's vaulted Apollo API key.
 * @param opts.baseUrl - Override for the API host, for tests.
 * @param opts.orgId - Org whose observed rate-limit snapshot this client updates.
 * @param opts.apiKey
 * @param opts.baseUrl
 * @param opts.orgId
 */
export function createApolloClient(opts: { apiKey: string; baseUrl?: string; orgId?: string }): ApolloClient {
  const baseUrl = opts.baseUrl ?? APOLLO_BASE_URL;
  const headers = {
    'x-api-key': opts.apiKey,
    'content-type': 'application/json',
    'accept': 'application/json',
    // Apollo caches aggressively on some endpoints; the tools read live.
    'cache-control': 'no-cache',
  };
  let latest: ApolloRateSnapshot | null = null;

  async function request<T>(method: 'GET' | 'POST', path: string, params?: Record<string, string>, body?: unknown): Promise<ApolloResult<T>> {
    const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
    let res: Response;
    try {
      res = await fetchRetryingRateLimits(`${baseUrl}${path}${qs}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (err) {
      return { ok: false, error: 'apollo_error', status: 0, message: `Apollo request failed before a response: ${(err as Error).message}` };
    }
    const snapshot = rateSnapshotFrom(res, path);
    if (snapshot) {
      latest = snapshot;
      if (opts.orgId) {
        recordRateSnapshot(opts.orgId, snapshot);
      }
    }
    if (!res.ok) {
      return shapeFailure(res, path);
    }
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch (err) {
      return { ok: false, error: 'apollo_error', status: res.status, message: `Apollo returned a body that is not JSON: ${(err as Error).message}` };
    }
  }

  return {
    baseUrl,
    get: (path, params) => request('GET', path, params),
    post: (path, body) => request('POST', path, undefined, body),
    lastRateSnapshot: () => latest,
  };
}
