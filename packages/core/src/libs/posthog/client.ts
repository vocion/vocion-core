/**
 * Shared PostHog API client — the one place that knows how to talk to a
 * PostHog project. The `posthog` connector's sync and Test connection consume
 * it, so the Bearer header, the host + project addressing, 429 handling and
 * error shaping exist exactly once.
 *
 * Errors are DATA, never throws, as the HubSpot and Apollo clients have it: a
 * caller hands the failure object on — to the checklist on the Sources page, or
 * to the sync run's error — and it names what to do ("this is the public
 * project token, not a personal key") instead of an opaque exception.
 *
 * Auth is a PERSONAL API key (`phx_…`), sent as `Authorization: Bearer`. The
 * project token that ships in a customer's app (`phc_…`) is public and can only
 * send events; it reads nothing, so it is refused before any call is made.
 */

import { fetchRetryingRateLimits, retryAfterMs } from '@/libs/http/retryAfter';

export type PosthogFailure
  = | { ok: false; error: 'no_posthog_credentials'; message: string }
    | { ok: false; error: 'posthog_unauthorized'; status: 401 | 403; message: string }
    | { ok: false; error: 'posthog_not_found'; status: 404; message: string }
    | { ok: false; error: 'posthog_rate_limited'; retry_after_seconds: number | null; message: string }
    | { ok: false; error: 'posthog_error'; status: number; message: string };

export type PosthogResult<T> = { ok: true; data: T } | PosthogFailure;

/** Where a personal API key is spent: one host, one numeric project. */
export type PosthogCredentials = {
  apiKey: string;
  /** `https://us.posthog.com`, `https://eu.posthog.com`, or a self-hosted origin. No trailing slash. */
  host: string;
  projectId: string;
};

export type PosthogClient = {
  get: <T>(path: string, params?: Record<string, string>) => Promise<PosthogResult<T>>;
  post: <T>(path: string, body: unknown) => Promise<PosthogResult<T>>;
  /**
   * Run one query through `POST /api/projects/{id}/query/` — the Query API
   * every read here goes through, HogQL or a typed query node.
   */
  query: <T>(query: Record<string, unknown>) => Promise<PosthogResult<T>>;
  /**
   * Run a HogQL statement with placeholder-bound values (`{name}` in the
   * statement, `values.name` here), so no caller ever builds a string literal
   * out of an event name or a product code.
   */
  hogql: (statement: string, values?: Record<string, unknown>) => Promise<PosthogResult<HogqlResponse>>;
  credentials: PosthogCredentials;
};

/** What the Query API returns for a HogQL statement. */
export type HogqlResponse = {
  columns?: string[];
  results?: unknown[][];
  hogql?: string;
};

export const POSTHOG_US_HOST = 'https://us.posthog.com';
export const POSTHOG_EU_HOST = 'https://eu.posthog.com';

/** Personal API keys carry this prefix; the public project token carries `phc_`. */
const PERSONAL_KEY = /^phx_[\w-]{8,}$/i;
const PROJECT_TOKEN = /^phc_/i;

/**
 * Why a pasted key cannot be used, in a sentence for the person who pasted it,
 * or null when it looks like a personal API key.
 * @param apiKey - The key as typed or as vaulted.
 */
export function describeKeyProblem(apiKey: string): string | null {
  if (PROJECT_TOKEN.test(apiKey)) {
    return 'That is the project token (phc_…) — the public key an app uses to SEND events. It cannot read anything. Paste a personal API key (phx_…) from PostHog → Settings → Personal API keys.';
  }
  if (!PERSONAL_KEY.test(apiKey)) {
    return 'That does not look like a PostHog personal API key — one starts with "phx_". Create one in PostHog → Settings → Personal API keys.';
  }
  return null;
}

/**
 * Trim a host to an origin the client can prefix paths with: whitespace and
 * trailing slashes off, scheme required.
 * @param host - The host as typed.
 */
export function normalizeHost(host: string): string | null {
  const trimmed = host.trim().replace(/\/+$/, '');
  return /^https?:\/\/\S+$/i.test(trimmed) ? trimmed : null;
}

/**
 * The vaulted credential, or null with the reason it cannot be used.
 *
 * The three field names are the storage contract with the `posthog` platform
 * descriptor in `libs/platforms/registry.ts`.
 * @param credentials - The decrypted credential bag for the posthog source.
 */
export function credentialsFrom(
  credentials?: Record<string, unknown>,
): { ok: true; credentials: PosthogCredentials } | { ok: false; message: string } {
  const apiKey = typeof credentials?.apiKey === 'string' ? credentials.apiKey.trim() : '';
  const rawHost = typeof credentials?.host === 'string' ? credentials.host : '';
  const projectId = typeof credentials?.projectId === 'string' || typeof credentials?.projectId === 'number'
    ? String(credentials.projectId).trim()
    : '';
  if (!apiKey) {
    return { ok: false, message: 'No PostHog personal API key is stored for this source. Connect it on the Connectors page (PostHog → Connect) with a personal API key, the host and the project id.' };
  }
  const keyProblem = describeKeyProblem(apiKey);
  if (keyProblem) {
    return { ok: false, message: keyProblem };
  }
  const host = normalizeHost(rawHost);
  if (!host) {
    return { ok: false, message: `The PostHog host must be a URL such as ${POSTHOG_US_HOST} or ${POSTHOG_EU_HOST}, or your own install's origin.` };
  }
  if (!/^\d+$/.test(projectId)) {
    return { ok: false, message: 'The PostHog project id must be the numeric id from Settings → Project (the number in the URL after /project/).' };
  }
  return { ok: true, credentials: { apiKey, host, projectId } };
}

export function noPosthogCredentials(detail?: string): PosthogFailure {
  return {
    ok: false,
    error: 'no_posthog_credentials',
    message: detail ?? 'No PostHog personal API key is stored for this workspace. Connect the posthog source on the Connectors page before reading from PostHog.',
  };
}

/**
 * Shape a non-OK response into a named failure.
 * @param res - The response PostHog sent.
 * @param path - The path it answered, so a 404 can say what was not found.
 */
async function shapeFailure(res: Response, path: string): Promise<PosthogFailure> {
  const text = await res.text().catch(() => '');
  const detail = text.slice(0, 300) || 'no message returned';
  if (res.status === 401) {
    return {
      ok: false,
      error: 'posthog_unauthorized',
      status: 401,
      message: `PostHog rejected the personal API key (401): ${detail}. The key may have been deleted or rotated — Test connection on the Connectors page reports whether it is valid.`,
    };
  }
  if (res.status === 403) {
    return {
      ok: false,
      error: 'posthog_unauthorized',
      status: 403,
      message: `PostHog refused this call (403): ${detail}. The key is valid but lacks a read scope for it — give it query:read and event_definition:read on this project, or access to the project itself.`,
    };
  }
  if (res.status === 404) {
    return {
      ok: false,
      error: 'posthog_not_found',
      status: 404,
      message: `PostHog has nothing at ${path} (404). Usually a wrong project id, or a host in the other region (US keys do not read EU projects). ${detail}`,
    };
  }
  if (res.status === 429) {
    const waitMs = retryAfterMs(res.headers);
    return {
      ok: false,
      error: 'posthog_rate_limited',
      retry_after_seconds: waitMs === null ? null : Math.ceil(waitMs / 1000),
      message: `PostHog rate limit reached (429)${waitMs === null ? '' : `; it asked for ${Math.ceil(waitMs / 1000)}s`}. A quota fact, not a failure of the query — try again later rather than re-running now.`,
    };
  }
  return {
    ok: false,
    error: 'posthog_error',
    status: res.status,
    message: `PostHog API error ${res.status} on ${path}: ${text.slice(0, 500)}`,
  };
}

/**
 * Build a client for one project.
 *
 * Built per call, never cached: a rotated key takes effect on the next call
 * and no org can be handed another org's client.
 * @param credentials - The key, host and project to spend it against.
 */
export function createPosthogClient(credentials: PosthogCredentials): PosthogClient {
  const host = credentials.host.replace(/\/+$/, '');
  const headers = {
    'authorization': `Bearer ${credentials.apiKey}`,
    'content-type': 'application/json',
    'accept': 'application/json',
  };

  async function request<T>(path: string, init: RequestInit): Promise<PosthogResult<T>> {
    const url = `${host}${path}`;
    let res: Response;
    try {
      res = await fetchRetryingRateLimits(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } }, { maxRetries: 3 });
    } catch (error) {
      return {
        ok: false,
        error: 'posthog_error',
        status: 0,
        message: `Could not reach PostHog at ${host}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (!res.ok) {
      return shapeFailure(res, path);
    }
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch (error) {
      return {
        ok: false,
        error: 'posthog_error',
        status: res.status,
        message: `PostHog returned a body that is not JSON on ${path}: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  const projectPath = `/api/projects/${encodeURIComponent(credentials.projectId)}`;

  return {
    credentials: { ...credentials, host },
    get: (path, params) => {
      const qs = params ? `?${new URLSearchParams(params).toString()}` : '';
      return request(`${path}${qs}`, { method: 'GET' });
    },
    post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
    query: query => request(`${projectPath}/query/`, { method: 'POST', body: JSON.stringify({ query }) }),
    hogql: (statement, values) => request<HogqlResponse>(`${projectPath}/query/`, {
      method: 'POST',
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query: statement, ...(values ? { values } : {}) } }),
    }),
  };
}

/**
 * The project-scoped path prefix, for callers that address other project
 * endpoints (event definitions, the project itself).
 * @param projectId - The numeric project id.
 */
export function projectPath(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}
