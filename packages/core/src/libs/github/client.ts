/**
 * Shared GitHub REST client — the one place that knows how to talk to
 * api.github.com. The `github` source connector (polling), its Test
 * connection probe and the webhook receiver (hydrating a check suite into a
 * pull request) all read through it, so auth headers, pagination and error
 * shaping exist exactly once.
 *
 * Errors are DATA, never throws: the probe hands a failure straight to the
 * checklist ("403 — the token lacks pull_requests:read on acme/api"), and the
 * connector, whose sync contract is throw-on-failure, unwraps and throws
 * itself.
 *
 * Auth: a fine-grained personal access token (`github_pat_…`), a classic PAT
 * (`ghp_…`) or a GitHub App installation token (`ghs_…`) in
 * `credentials.token`, sent as `Authorization: Bearer`. Which one it is
 * changes what a failure can say — a classic token echoes its scopes in
 * `x-oauth-scopes`, a fine-grained one names the permission it was missing in
 * `x-accepted-github-permissions` — so both headers are kept on the result.
 */

import { fetchRetryingRateLimits } from '@/libs/http/retryAfter';

export const GITHUB_API_URL = 'https://api.github.com';

/** The REST API version pinned on every request, so a payload rename upstream cannot surprise the mapper. */
const GITHUB_API_VERSION = '2022-11-28';

export type GithubFailure = {
  ok: false;
  /** HTTP status, or 0 when the host could not be reached at all. */
  status: number;
  /** One sentence for an operator, carrying GitHub's own message when it sent one. */
  message: string;
  /** Fine-grained tokens: the permission GitHub says the call needed, e.g. `pull_requests=read`. */
  acceptedPermissions: string | null;
};

export type GithubResult<T> = {
  ok: true;
  data: T;
  status: number;
  /** Classic tokens only: the scopes GitHub says this token carries. Null for fine-grained and installation tokens. */
  oauthScopes: string | null;
  /** The `Link` header, for callers walking pages. */
  link: string | null;
} | GithubFailure;

export type GithubClient = {
  get: <T>(path: string, params?: Record<string, string>) => Promise<GithubResult<T>>;
  /**
   * Walk a paginated list endpoint. `stop` is asked after every page with
   * the items so far and the page just fetched; returning true ends the walk
   * early (the poller stops at the first item older than its watermark).
   */
  list: <T>(
    path: string,
    params: Record<string, string>,
    opts?: { maxPages?: number; stop?: (page: T[]) => boolean },
  ) => Promise<GithubResult<T[]>>;
  baseUrl: string;
};

/**
 * The vaulted token, whichever field name the vault entry used. The `github`
 * platform descriptor stores it under `token`; `accessToken` is accepted for
 * a credential written by an OAuth flow.
 * @param credentials - The decrypted credential bag, when any.
 */
export function tokenFromCredentials(credentials?: Record<string, unknown>): string | undefined {
  const token = credentials?.token ?? credentials?.accessToken;
  return typeof token === 'string' && token.trim() !== '' ? token.trim() : undefined;
}

/**
 * `owner/name` split into its halves, or null when the string is not one.
 * @param repo - A repository as the config spells it, e.g. `acme/api`.
 */
export function splitRepo(repo: string): { owner: string; name: string } | null {
  const match = /^([\w.-]+)\/([\w.-]+)$/.exec(repo.trim());
  return match ? { owner: match[1]!, name: match[2]! } : null;
}

function failure(status: number, message: string, headers?: Headers): GithubFailure {
  return {
    ok: false,
    status,
    message,
    acceptedPermissions: headers?.get('x-accepted-github-permissions') ?? null,
  };
}

/**
 * GitHub's own words for a failure, when the body carried them.
 * @param status - HTTP status.
 * @param bodyText - Raw response body.
 */
function messageFor(status: number, bodyText: string): string {
  let detail = bodyText.slice(0, 300);
  try {
    const body = JSON.parse(bodyText) as { message?: string };
    if (typeof body.message === 'string' && body.message !== '') {
      detail = body.message;
    }
  } catch {
    // Not JSON — the slice above is the best we have.
  }
  if (status === 401) {
    return `GitHub rejected the token (401): ${detail}`;
  }
  if (status === 403) {
    return `GitHub refused the call (403): ${detail}`;
  }
  if (status === 404) {
    // GitHub answers 404, not 403, for a private repository the token cannot
    // see, so "not found" here usually means "not granted".
    return `GitHub answered 404: ${detail}. A private repository the token was not granted access to also answers 404.`;
  }
  return `GitHub answered ${status}: ${detail}`;
}

/**
 * The `page=N` URL in a `Link: <…>; rel="next"` header, or null on the last page.
 * @param link - The raw `Link` header.
 */
export function nextPageUrl(link: string | null): string | null {
  if (!link) {
    return null;
  }
  for (const part of link.split(',')) {
    const match = /<([^>]+)>;\s*rel="next"/.exec(part.trim());
    if (match) {
      return match[1]!;
    }
  }
  return null;
}

/**
 * A client bound to one token and one API host.
 * @param opts - Token and host.
 * @param opts.token - The access token, sent as a Bearer header.
 * @param opts.baseUrl - API host override, for GitHub Enterprise Server or a test double.
 * @param opts.maxRetries - How many 429/secondary-rate-limit answers to ride out per request.
 */
export function createGithubClient(opts: { token: string; baseUrl?: string; maxRetries?: number }): GithubClient {
  const baseUrl = (opts.baseUrl ?? GITHUB_API_URL).replace(/\/+$/, '');
  const headers = {
    'authorization': `Bearer ${opts.token}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': GITHUB_API_VERSION,
    'user-agent': 'vocion-github-source',
  };

  async function request<T>(url: string): Promise<GithubResult<T>> {
    let res: Response;
    try {
      res = await fetchRetryingRateLimits(url, { headers }, { maxRetries: opts.maxRetries ?? 3 });
    } catch (err) {
      return failure(0, `GitHub could not be reached at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return failure(res.status, messageFor(res.status, text), res.headers);
    }
    // 204 (no content) has no body to parse; the caller asked for nothing.
    const data = res.status === 204 ? (undefined as T) : ((await res.json()) as T);
    return {
      ok: true,
      data,
      status: res.status,
      oauthScopes: res.headers.get('x-oauth-scopes'),
      link: res.headers.get('link'),
    };
  }

  function urlFor(path: string, params?: Record<string, string>): string {
    const url = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  return {
    baseUrl,
    get: <T>(path: string, params?: Record<string, string>) => request<T>(urlFor(path, params)),
    async list<T>(path: string, params: Record<string, string>, listOpts?: { maxPages?: number; stop?: (page: T[]) => boolean }): Promise<GithubResult<T[]>> {
      const maxPages = listOpts?.maxPages ?? 10;
      const items: T[] = [];
      let url: string | null = urlFor(path, { per_page: '100', ...params });
      let oauthScopes: string | null = null;
      for (let page = 0; url && page < maxPages; page += 1) {
        const res: GithubResult<T[]> = await request<T[]>(url);
        if (!res.ok) {
          return res;
        }
        oauthScopes = res.oauthScopes ?? oauthScopes;
        items.push(...res.data);
        if (listOpts?.stop?.(res.data)) {
          break;
        }
        url = nextPageUrl(res.link);
      }
      return { ok: true, data: items, status: 200, oauthScopes, link: null };
    },
  };
}
