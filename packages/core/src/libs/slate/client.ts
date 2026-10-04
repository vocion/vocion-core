/**
 * Shared Slate API client — the one place that knows how to talk to Slate
 * (MetaCTO's screen-recording product). The `slate` connector's Test
 * connection goes through it, so the bearer header and the error shaping
 * exist exactly once. Nothing outside `libs/slate/` and the connector names
 * Slate (Chris, 2026-10-03: Slate is a connector, and nothing more, for now).
 *
 * The protocol, as Slate's own API serves it (read from its source, 2026-10-03):
 *
 *   GET   /v1/me                         who the token is (and `paidSeat`)
 *
 * Auth today is a pasted session token (`slt_…`, ~90 days, from Slate's device
 * flow). TODO(oauth): Slate is also an OAuth 2.1 authorization server with
 * PKCE and dynamic client registration — discovery at
 * {@link SLATE_OAUTH_DISCOVERY} names `/oauth/register`, `/oauth/authorize` and
 * `/oauth/token`; the access token is the same `slt_` bearer and the refresh
 * token (`slr_…`) rotates on each use. Vocion has no outbound OAuth-client
 * flow for a connector yet (OAuthService is Vocion AS the server), so the
 * credential bag already carries `refreshToken` / `expiresAt` slots and
 * {@link slateCredentialsFrom} reads them; a refresh step belongs in
 * {@link slateFetchJson} once a connect flow writes them.
 *
 * Errors are DATA, never throws: every failure is a sentence a person acts on,
 * with whether trying again could help.
 */

export const SLATE_API_BASE = 'https://api.slatevideo.com';
export const SLATE_OAUTH_DISCOVERY = `${SLATE_API_BASE}/.well-known/oauth-authorization-server`;

const TIMEOUT_MS = 30_000;

export type SlateCredentials = {
  token: string;
  apiBase: string;
  /** OAuth refresh token (`slr_…`), once a connect flow writes one. Unused until then. */
  refreshToken?: string;
  /** When the access token lapses (ISO), once OAuth writes it. */
  expiresAt?: string;
};

export type SlateFailure = { ok: false; status: number | null; message: string; retryable: boolean };
export type SlateResult<T> = { ok: true; data: T } | SlateFailure;

/** What a fetch looks like to this client, so a test can stand in for the network. */
export type SlateFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
  headers: { get: (name: string) => string | null };
}>;

function origin(raw: unknown, fallback: string): string | null {
  const s = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/\/+$/, '') : fallback;
  return /^https?:\/\/[^\s/]+$/i.test(s) ? s : null;
}

/**
 * The vaulted credential (and the connector's optional API origin), or the
 * reason it cannot be used. `token` is the storage contract with the `slate`
 * platform descriptor in `libs/platforms/registry.ts`.
 * @param values - The decrypted credential bag.
 * @param config - The connector row's config (`apiBase`), when one.
 */
export function slateCredentialsFrom(values?: Record<string, unknown> | null, config?: Record<string, unknown> | null): { ok: true; credentials: SlateCredentials } | { ok: false; message: string } {
  const token = typeof values?.token === 'string' ? values.token.trim() : '';
  if (!token) {
    return { ok: false, message: 'No Slate token is stored for this workspace. Connect Slate on the Connections page with a session token (slt_…).' };
  }
  const apiBase = origin(config?.apiBase, SLATE_API_BASE);
  if (!apiBase) {
    return { ok: false, message: `The Slate API address must be an origin such as ${SLATE_API_BASE}.` };
  }
  return {
    ok: true,
    credentials: {
      token,
      apiBase,
      ...(typeof values?.refreshToken === 'string' ? { refreshToken: values.refreshToken } : {}),
      ...(typeof values?.expiresAt === 'string' ? { expiresAt: values.expiresAt } : {}),
    },
  };
}

const defaultFetch: SlateFetch = (url, init) => fetch(url, init as RequestInit);

async function failureFrom(res: { status: number; text: () => Promise<string> }, what: string): Promise<SlateFailure> {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body) as { message?: unknown; error?: unknown };
      detail = typeof j.message === 'string' ? j.message : typeof j.error === 'string' ? j.error : '';
    } catch {
      detail = body;
    }
  } catch { /* no body */ }
  detail = detail.replace(/\s+/g, ' ').trim().slice(0, 240);
  const said = detail ? ` Slate said: "${detail}"` : '';
  if (res.status === 401) {
    return { ok: false, status: 401, retryable: false, message: `Slate refused the token while trying to ${what}; it may have expired (session tokens last about 90 days). Paste a new one on the Connections page.${said}` };
  }
  if (res.status === 402 || res.status === 403) {
    return { ok: false, status: res.status, retryable: false, message: `Slate would not let this account ${what}.${said}` };
  }
  if (res.status === 404) {
    return { ok: false, status: 404, retryable: false, message: `Slate found nothing to ${what}.${said}` };
  }
  return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500, message: `Slate answered ${res.status} while trying to ${what}.${said}` };
}

/**
 * One JSON call against the Slate API, its failure shaped.
 * @param c - Where and as whom.
 * @param method - The HTTP method.
 * @param path - `/v1/…`.
 * @param what - What the call does, for the failure sentence ("read the account").
 * @param body - A JSON body, when one.
 * @param doFetch - The network.
 */
export async function slateFetchJson<T>(c: SlateCredentials, method: string, path: string, what: string, body?: unknown, doFetch: SlateFetch = defaultFetch): Promise<SlateResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${c.apiBase}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${c.token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return failureFrom(res, what);
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return { ok: false, status: null, retryable: true, message: aborted ? `Slate did not answer within ${TIMEOUT_MS / 1000}s while trying to ${what}.` : `Slate could not be reached to ${what} (${(err as Error)?.message?.slice(0, 160) ?? 'network error'}).` };
  } finally {
    clearTimeout(timer);
  }
}

export type SlateMe = { id?: string; email?: string; name?: string | null; paidSeat?: boolean; orgId?: string | null };

/**
 * Who the token is.
 * @param c - The credential.
 * @param doFetch - The network.
 */
export function readSlateMe(c: SlateCredentials, doFetch?: SlateFetch): Promise<SlateResult<SlateMe>> {
  return slateFetchJson<SlateMe>(c, 'GET', '/v1/me', 'read the account', undefined, doFetch);
}
