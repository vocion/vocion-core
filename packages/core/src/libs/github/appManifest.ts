/**
 * THE APP, DESCRIBED TO GITHUB (backlog 053). GitHub's app-manifest flow:
 * Vocion posts a manifest to github.com, the person clicks Create, GitHub
 * redirects back with a one-hour `code`, and Vocion trades the code for the
 * app's id, private key, webhook secret and client secret
 * (`POST /app-manifests/{code}/conversions`). Nobody copies a key by hand.
 *
 * Everything the app needs to know about this deployment is written here once
 * from its public origin: where webhooks go, where the person returns after
 * creating it and after installing it.
 *
 * Also here: the two calls that prove a person may bind an installation to a
 * workspace. The install callback carries an `installation_id` anyone could
 * type, so it is never trusted by itself: the person signs in to GitHub
 * through the app (`/login/oauth/authorize`), and the installation must be
 * among those GitHub says they can reach (`GET /user/installations`).
 */

import { APP_EVENTS, APP_PERMISSIONS } from './appAuth';
import { GITHUB_API_URL } from './client';

export const GITHUB_WEB_URL = 'https://github.com';

/** GitHub caps an app's name at 34 characters. */
const NAME_MAX = 34;

/**
 * Where GitHub sends each round trip back, from the deployment's public origin.
 * @param origin
 */
export function appUrls(origin: string) {
  const base = origin.replace(/\/+$/, '');
  return {
    webhook: `${base}/api/webhooks/github-app`,
    manifestCallback: `${base}/api/v1/connections/github/manifest/callback`,
    installCallback: `${base}/api/v1/connections/github/install/callback`,
  };
}

/**
 * The default name: "Vocion" and the host, which is what makes it unique on
 * github.com (names are global) and tells an org owner which deployment it is.
 * @param origin - The deployment's public origin.
 */
export function defaultAppName(origin: string): string {
  let host = origin;
  try {
    host = new URL(origin).host;
  } catch {}
  return `Vocion ${host}`.slice(0, NAME_MAX).trim();
}

/**
 * The manifest GitHub creates the app from.
 * @param input - The deployment.
 * @param input.origin - Its public origin.
 * @param input.name - The app's name; `defaultAppName` when omitted.
 */
export function buildAppManifest(input: { origin: string; name?: string }) {
  const urls = appUrls(input.origin);
  return {
    name: (input.name?.trim() || defaultAppName(input.origin)).slice(0, NAME_MAX),
    url: input.origin.replace(/\/+$/, ''),
    description: 'Vocion reads pull requests and checks, re-runs failed jobs, updates and merges pull requests on the repositories you choose.',
    hook_attributes: { url: urls.webhook, active: true },
    redirect_url: urls.manifestCallback,
    // One return address for both: GitHub sends a person here after an
    // install (setup_url) and after the identity check (callback_urls).
    callback_urls: [urls.installCallback],
    setup_url: urls.installCallback,
    setup_on_update: true,
    request_oauth_on_install: false,
    // Public so an org owner of any account can install it (Meta-CTO and
    // vocion are two); an installation nobody bound to a workspace does nothing.
    public: true,
    default_permissions: APP_PERMISSIONS,
    default_events: [...APP_EVENTS],
  };
}

/**
 * The page GitHub creates the app on, for a personal account or an organization.
 * @param state - The signed state.
 * @param org - The organization that will own the app; the person's own account when empty.
 */
export function manifestPostUrl(state: string, org?: string | null): string {
  const owner = org?.trim();
  const path = owner ? `/organizations/${encodeURIComponent(owner)}/settings/apps/new` : '/settings/apps/new';
  return `${GITHUB_WEB_URL}${path}?state=${encodeURIComponent(state)}`;
}

/** What the manifest conversion returns, in the fields Vocion keeps. */
export type ManifestConversion = {
  id: number;
  slug: string;
  name: string;
  client_id: string;
  client_secret: string;
  webhook_secret: string | null;
  pem: string;
  html_url?: string;
  owner?: { login?: string } | null;
  permissions?: Record<string, string>;
  events?: string[];
};

/**
 * Trade the one-hour code for the app's credentials. Unauthenticated by
 * GitHub's design: the code is the credential.
 * @param code - The `code` GitHub redirected back with.
 * @param fetchImpl - Injected for tests.
 */
export async function convertManifest(code: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; app: ManifestConversion } | { ok: false; status: number; message: string }> {
  const res = await fetchImpl(`${GITHUB_API_URL}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion-github-app' },
    signal: AbortSignal.timeout(20_000),
  }).catch((err: Error) => ({ ok: false, status: 0, text: async () => err.message }) as unknown as Response);
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    let message = text.slice(0, 200);
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? message;
    } catch {}
    return { ok: false, status: res.status, message: `GitHub did not hand over the new app (${res.status}): ${message}. A code lasts an hour and works once; create the app again from Connections.` };
  }
  return { ok: true, app: JSON.parse(text) as ManifestConversion };
}

/**
 * The GitHub sign-in that proves who is binding an installation.
 * @param input - The app and the round trip.
 * @param input.clientId - The app's client id.
 * @param input.redirectUri - The install callback.
 * @param input.state - The signed state.
 */
export function userAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(`${GITHUB_WEB_URL}/login/oauth/authorize`);
  u.searchParams.set('client_id', input.clientId);
  u.searchParams.set('redirect_uri', input.redirectUri);
  u.searchParams.set('state', input.state);
  return u.toString();
}

/**
 * The installations of THIS app a person can reach, by their user-to-server
 * token from the sign-in above. The token is used for this one read and dropped.
 * @param input - The exchange.
 * @param input.clientId - The app's client id.
 * @param input.clientSecret - The app's client secret.
 * @param input.code - The sign-in's code.
 * @param input.redirectUri - The same redirect the sign-in used.
 * @param input.fetchImpl - Injected for tests.
 */
export async function installationsThePersonCanReach(input: { clientId: string; clientSecret: string; code: string; redirectUri: string; fetchImpl?: typeof fetch }): Promise<{ ok: true; installations: Array<{ id: number; account: string }> } | { ok: false; message: string }> {
  const doFetch = input.fetchImpl ?? fetch;
  const tokenRes = await doFetch(`${GITHUB_WEB_URL}/login/oauth/access_token`, {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': 'vocion-github-app' },
    body: JSON.stringify({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  const tokenBody = tokenRes?.ok ? await tokenRes.json().catch(() => ({})) as { access_token?: string; error_description?: string } : {};
  if (!tokenBody.access_token) {
    return { ok: false, message: `GitHub did not confirm who you are${tokenBody.error_description ? `: ${tokenBody.error_description}` : ''}. Start the connection again from Connections.` };
  }
  const installations: Array<{ id: number; account: string }> = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await doFetch(`${GITHUB_API_URL}/user/installations?per_page=100&page=${page}`, {
      headers: { 'authorization': `Bearer ${tokenBody.access_token}`, 'accept': 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'vocion-github-app' },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res?.ok) {
      break;
    }
    const data = await res.json() as { installations?: Array<{ id: number; account?: { login?: string } }> };
    const batch = data.installations ?? [];
    installations.push(...batch.map(i => ({ id: i.id, account: i.account?.login ?? '' })));
    if (batch.length < 100) {
      break;
    }
  }
  return { ok: true, installations };
}
