/**
 * Shared GitLab REST v4 client — the one place that knows how to talk to a
 * GitLab instance, gitlab.com or a self-managed host. The `gitlab` source
 * connector (polling), its Test connection probe, the webhook receiver
 * (hydrating a pipeline into a merge request's checks) and the repo family's
 * GitLab provider (`services/repo/providers/gitlab.ts`) all read and write
 * through it, so the auth header, pagination, URL encoding of nested project
 * paths and error shaping exist exactly once.
 *
 * Errors are DATA, never throws, for the reason `libs/github/client.ts` gives:
 * the probe hands a failure straight to the checklist ("403: the token lacks
 * read_api on northwind/platform/api"), and a caller whose contract is
 * throw-on-failure unwraps and throws itself.
 *
 * WHERE GITLAB DIFFERS FROM GITHUB, and what that changes here:
 *
 *   - One host per instance. The web host and the API share an origin
 *     (`https://gitlab.com` and `https://gitlab.com/api/v4`), so a source
 *     stores the instance's base URL once and the API root is derived from it.
 *   - A project path can be nested: `group/subgroup/project`. The API names a
 *     project by its path URL-encoded as ONE segment (`group%2Fsubgroup%2Fproject`),
 *     so every path is encoded by `projectId` and never split on `/`.
 *   - Auth is a personal, project or group access token (`glpat-…`), or the
 *     OAuth access token "Connect with GitLab" holds, all sent as
 *     `Authorization: Bearer`. `read_api` reads; `api` also writes (comments,
 *     approvals, merges, branches). GitLab does not echo a token's scopes on
 *     every response, so the probe asks `/personal_access_tokens/self`.
 *   - A public project answers without a token, which is how the repo
 *     family's live check exercises these request shapes: `token` is optional.
 */

import { fetchRetryingRateLimits } from '@/libs/http/retryAfter';

/** The instance a source names when it names none. */
export const GITLAB_URL = 'https://gitlab.com';

/**
 * A project path as GitLab spells it: two or more segments, each a namespace
 * or the project (`acme/api`, `northwind/platform/api`). GitLab allows letters,
 * digits, `_`, `-` and `.` in a path segment.
 */
export const PROJECT_PATH = /^[\w.-]+(?:\/[\w.-]+)+$/;

export type GitlabFailure = {
  ok: false;
  /** HTTP status, or 0 when the host could not be reached at all. */
  status: number;
  /** One sentence for an operator, carrying GitLab's own message when it sent one. */
  message: string;
};

export type GitlabResult<T> = {
  ok: true;
  data: T;
  status: number;
  /** The `Link` header, for callers walking pages. */
  link: string | null;
} | GitlabFailure;

/** What one request may carry. */
export type GitlabRequest = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  params?: Record<string, string>;
  /** A JSON body, for POST and PUT. */
  body?: unknown;
  /** Read the body as text (a raw file, a diff) instead of JSON. */
  text?: boolean;
  timeoutMs?: number;
};

export type GitlabClient = {
  /** The instance's base URL, e.g. `https://gitlab.com`. */
  baseUrl: string;
  /** The REST root, `<baseUrl>/api/v4`. */
  apiUrl: string;
  request: <T>(path: string, init?: GitlabRequest) => Promise<GitlabResult<T>>;
  get: <T>(path: string, params?: Record<string, string>) => Promise<GitlabResult<T>>;
  /**
   * Walk a paginated list endpoint by its `Link: rel="next"` header (offset
   * and keyset pagination both send one). `stop` is asked after every page;
   * true ends the walk early. `truncated` says the page cap ended it.
   */
  list: <T>(
    path: string,
    params: Record<string, string>,
    opts?: { maxPages?: number; stop?: (page: T[]) => boolean },
  ) => Promise<GitlabResult<T[]> & { truncated?: boolean }>;
};

/**
 * The instance's base URL, normalised: no trailing slash, and no `/api/v4`
 * when a person pasted the API root instead of the instance.
 * @param baseUrl - What the source's config says, or nothing for gitlab.com.
 */
export function normalizeBaseUrl(baseUrl?: string | null): string {
  const trimmed = (baseUrl ?? '').trim().replace(/\/+$/, '').replace(/\/api\/v4$/i, '');
  return trimmed || GITLAB_URL;
}

/**
 * The hostname of an instance, lowercased: `gitlab.com`, `gitlab.northwind.example`.
 * @param baseUrl - The instance's base URL.
 */
export function hostOfBaseUrl(baseUrl?: string | null): string {
  try {
    return new URL(normalizeBaseUrl(baseUrl)).hostname.toLowerCase();
  } catch {
    return 'gitlab.com';
  }
}

/**
 * A project path as the API's `:id` segment: the whole path, URL-encoded, so
 * `northwind/platform/api` is `northwind%2Fplatform%2Fapi`.
 * @param path - The project path.
 */
export function projectId(path: string): string {
  return encodeURIComponent(path.trim().replace(/^\/+|\/+$/g, '').replace(/\.git$/, ''));
}

/**
 * Whether a string is a project path (`group/project`, any depth).
 * @param path - The candidate.
 */
export function isProjectPath(path: string): boolean {
  return PROJECT_PATH.test(path.trim());
}

/**
 * GitLab's own words for a failure. GitLab answers `{ message }` (a string,
 * or an object of field errors) or `{ error, error_description }`.
 * @param status - HTTP status.
 * @param bodyText - Raw response body.
 */
function messageFor(status: number, bodyText: string): string {
  let detail = bodyText.slice(0, 300);
  try {
    const body = JSON.parse(bodyText) as { message?: unknown; error?: unknown; error_description?: unknown };
    const said = body.message ?? body.error_description ?? body.error;
    if (typeof said === 'string' && said !== '') {
      detail = said;
    } else if (said && typeof said === 'object') {
      detail = JSON.stringify(said).slice(0, 300);
    }
  } catch {
    // Not JSON: the slice above is the best we have.
  }
  if (status === 401) {
    return `GitLab rejected the token (401): ${detail}`;
  }
  if (status === 403) {
    return `GitLab refused the call (403): ${detail}. Writes need a token with the api scope; reads need read_api.`;
  }
  if (status === 404) {
    // GitLab answers 404, not 403, for a private project the token cannot see.
    return `GitLab answered 404: ${detail}. A private project the token was not granted also answers 404.`;
  }
  return `GitLab answered ${status}: ${detail}`;
}

/**
 * The URL in a `Link: <…>; rel="next"` header, or null on the last page.
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
 * A client bound to one instance and, when given, one token.
 * @param opts - Token and instance.
 * @param opts.token - A personal, project or group access token; omitted for a public read.
 * @param opts.baseUrl - The instance, `https://gitlab.com` when omitted.
 * @param opts.maxRetries - How many 429 answers to ride out per request.
 */
export function createGitlabClient(opts: { token?: string | null; baseUrl?: string | null; maxRetries?: number }): GitlabClient {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);
  const apiUrl = `${baseUrl}/api/v4`;
  // Bearer carries every kind GitLab issues: a personal, project or group
  // access token and an OAuth access token from "Connect with GitLab".
  const auth: Record<string, string> = opts.token ? { authorization: `Bearer ${opts.token}` } : {};

  function urlFor(path: string, params?: Record<string, string>): string {
    const url = new URL(path.startsWith('http') ? path : `${apiUrl}${path.startsWith('/') ? path : `/${path}`}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  async function send<T>(url: string, init: GitlabRequest = {}): Promise<GitlabResult<T>> {
    const method = init.method ?? 'GET';
    const headers: Record<string, string> = { ...auth, 'user-agent': 'vocion-gitlab-source', 'accept': init.text ? '*/*' : 'application/json' };
    if (init.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let res: Response;
    try {
      res = await fetchRetryingRateLimits(url, {
        method,
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(init.timeoutMs ?? 30_000),
      }, { maxRetries: opts.maxRetries ?? 3 });
    } catch (err) {
      return { ok: false, status: 0, message: `GitLab could not be reached at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, status: res.status, message: messageFor(res.status, text) };
    }
    let data: T;
    if (res.status === 204 || method === 'HEAD') {
      data = undefined as T;
    } else if (init.text) {
      data = (await res.text()) as T;
    } else {
      const text = await res.text();
      data = (text ? JSON.parse(text) : undefined) as T;
    }
    return { ok: true, data, status: res.status, link: res.headers.get('link') };
  }

  return {
    baseUrl,
    apiUrl,
    request: <T>(path: string, init?: GitlabRequest) => send<T>(urlFor(path, init?.params), init),
    get: <T>(path: string, params?: Record<string, string>) => send<T>(urlFor(path, params)),
    async list<T>(path: string, params: Record<string, string>, listOpts?: { maxPages?: number; stop?: (page: T[]) => boolean }) {
      const maxPages = listOpts?.maxPages ?? 10;
      const items: T[] = [];
      let url: string | null = urlFor(path, { per_page: '100', ...params });
      let page = 0;
      for (; url && page < maxPages; page += 1) {
        const res: GitlabResult<T[]> = await send<T[]>(url);
        if (!res.ok) {
          return res;
        }
        items.push(...(res.data ?? []));
        if (listOpts?.stop?.(res.data ?? [])) {
          url = null;
          break;
        }
        url = nextPageUrl(res.link);
      }
      return { ok: true as const, data: items, status: 200, link: null, truncated: url !== null };
    },
  };
}
