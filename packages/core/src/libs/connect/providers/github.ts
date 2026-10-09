/**
 * GitHub, connected by installing this deployment's GitHub App. There is no
 * token exchange for the credential itself: the person picks an organization
 * and repositories on GitHub, GitHub sends them to our Setup URL with
 * `installation_id`, and the installation IS the credential. Tokens are
 * minted from it per hour (`libs/github/app.ts`) and never stored.
 *
 * What IS exchanged is proof that the person completing the callback can see
 * the installation they name. The callback is a browser GET the person
 * controls, installation ids are small sequential integers, and the app JWT
 * can read every installation of the app — so an admin of one workspace
 * could otherwise store another organization's installation and mint tokens
 * over its private repositories. The app has "Request user authorization
 * during installation" on, so the Setup URL also carries a `code`; that code
 * becomes a short-lived user token (`POST /login/oauth/access_token`), the
 * user's own installations are listed with it (`GET /user/installations`),
 * and the named installation must be among them. The user token is used for
 * that one read and dropped.
 *
 * `setup_action` says how they got here: `install` and `update` carry an id
 * to keep; `request` means an organization member asked an owner to approve
 * and nothing exists yet; `cancel` is a person changing their mind.
 *
 * A person's OWN GitHub (`audience: 'personal'`, Personal connectors) is a
 * different flow on the same callback: the person authorizes an OAuth client
 * as themselves (`personalLoginClient('github')`: `GITHUB_PERSONAL_CLIENT_*`,
 * else the GitHub App's own client) and the user token IS the credential,
 * stored for their assistant's reads. A GitHub App's user token may expire
 * and carry a refresh token; both are kept (`libs/personal/github.ts` renews).
 */

import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { appJwt, GITHUB_APP_ENV, githubAppConfig, installationToken } from '@/libs/github/app';
import { GITHUB_API_URL, nextPageUrl } from '@/libs/github/client';
import { PERSONAL_GITHUB_SCOPES } from '@/libs/personal/connections';
import { personalLoginClient } from '../serverClients';

type Installation = {
  id: number;
  account?: { login?: string; type?: string } | null;
  repository_selection?: string;
  permissions?: Record<string, string>;
  suspended_at?: string | null;
};

type RepositoryPage = { repositories?: Array<{ full_name: string }> };
type UserInstallationsPage = { installations?: Array<{ id: number }> };

const HEADERS = {
  'accept': 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  'user-agent': 'vocion-github-app',
};

/**
 * Every repository the installation was granted, by full name, walking pages
 * of 100. A failure returns what was read so far rather than nothing: the
 * list is informational (Test connection compares it to `config.repos`).
 * @param token - An installation token.
 * @param baseUrl - API host.
 */
export async function installationRepositories(token: string, baseUrl: string): Promise<string[]> {
  const names: string[] = [];
  let url: string | null = `${baseUrl}/installation/repositories?per_page=100`;
  for (let page = 0; url && page < 20; page += 1) {
    const res = await fetch(url, { headers: { ...HEADERS, authorization: `Bearer ${token}` } });
    if (!res.ok) {
      break;
    }
    const body = (await res.json()) as RepositoryPage;
    names.push(...(body.repositories ?? []).map(repo => repo.full_name));
    url = nextPageUrl(res.headers.get('link'));
  }
  return names;
}

/**
 * The `code` GitHub appended to the Setup URL, as a user access token. Null
 * when GitHub refused it; the reason is never surfaced past "refused".
 * @param code - The temporary code from the callback query.
 * @param redirectUri - The callback URL the code was issued for.
 * @param config - The app's OAuth client pair.
 * @param config.clientId
 * @param config.clientSecret
 */
async function userTokenFromCode(code: string, redirectUri: string, config: { clientId: string; clientSecret: string }): Promise<string | null> {
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': 'vocion-github-app' },
    body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    return null;
  }
  const body = (await res.json()) as { access_token?: string; error?: string };
  return typeof body.access_token === 'string' && body.access_token !== '' && !body.error ? body.access_token : null;
}

/**
 * Whether the installation is among the ones the user can see, read with
 * the user's own token. Walks pages of 100; GitHub lists an installation
 * here only for a person who is a member of the account it is on. A GitHub
 * outage is not a refusal of ownership, so a 5xx (anything but 403/404)
 * answers `unavailable` and the person is told to try again.
 * @param userToken - The short-lived user token.
 * @param installationId - The installation the callback named.
 * @param baseUrl - API host.
 */
async function userCanSeeInstallation(userToken: string, installationId: string, baseUrl: string): Promise<'yes' | 'no' | 'unavailable'> {
  let url: string | null = `${baseUrl}/user/installations?per_page=100`;
  for (let page = 0; url && page < 20; page += 1) {
    const res = await fetch(url, { headers: { ...HEADERS, authorization: `Bearer ${userToken}` } });
    if (!res.ok) {
      return res.status === 403 || res.status === 404 ? 'no' : 'unavailable';
    }
    const body = (await res.json()) as UserInstallationsPage;
    if ((body.installations ?? []).some(inst => String(inst.id) === installationId)) {
      return 'yes';
    }
    url = nextPageUrl(res.headers.get('link'));
  }
  return 'no';
}

/**
 * When a user token stops being good, five minutes early, as the stored
 * logins say it (`loginGrant.grantExpiresAt`, not imported: it reaches the
 * database, and this provider is read by pages that do not).
 * @param expiresIn - GitHub's `expires_in`, seconds; eight hours when absent.
 */
function expiresAtOf(expiresIn: unknown): string {
  const seconds = typeof expiresIn === 'number' && expiresIn > 0 ? expiresIn : 8 * 3600;
  return new Date(Date.now() + seconds * 1000 - 5 * 60 * 1000).toISOString();
}

/**
 * A person's own GitHub login: the code traded for their user token, and the
 * login it belongs to. GitHub's refusal stays a short code.
 * @param input - The callback's query, its URL and the client it ran on.
 * @param input.query - The callback's query.
 * @param input.redirectUri - The callback URL the code was issued for.
 * @param input.client - The OAuth client the login ran on.
 */
async function personalExchange(input: { query: Record<string, string>; redirectUri: string; client: LoginClient | null }): Promise<
  | { ok: true; credentials: Record<string, unknown>; displayName: string }
  | { ok: false; reason: string }
> {
  if (input.query.error) {
    return { ok: false, reason: /^[\w.-]{1,64}$/.test(input.query.error) ? input.query.error : 'login_refused' };
  }
  const code = (input.query.code ?? '').trim();
  if (!code) {
    return { ok: false, reason: 'missing_code' };
  }
  if (!input.client) {
    return { ok: false, reason: 'not_configured' };
  }
  const res = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'accept': 'application/json', 'content-type': 'application/json', 'user-agent': 'vocion-github-app' },
    body: JSON.stringify({ client_id: input.client.clientId, client_secret: input.client.clientSecret, code, redirect_uri: input.redirectUri }),
  });
  if (!res.ok) {
    return { ok: false, reason: 'code_refused' };
  }
  const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error?: string };
  if (typeof body.access_token !== 'string' || !body.access_token || body.error) {
    return { ok: false, reason: 'code_refused' };
  }
  const me = await fetch(`${GITHUB_API_URL}/user`, { headers: { ...HEADERS, authorization: `Bearer ${body.access_token}` } });
  if (!me.ok) {
    return { ok: false, reason: 'github_unavailable' };
  }
  const login = ((await me.json()) as { login?: string }).login;
  if (!login) {
    return { ok: false, reason: 'no_login' };
  }
  return {
    ok: true,
    credentials: {
      token: body.access_token,
      kind: 'user',
      login,
      scope: body.scope ?? null,
      // A GitHub App's user token expires (8h) and comes with a refresh token; an OAuth app's does not.
      ...(typeof body.refresh_token === 'string' && body.refresh_token
        ? { refreshToken: body.refresh_token, expiresAt: expiresAtOf(body.expires_in) }
        : {}),
    },
    displayName: `GitHub — ${login}`,
  };
}

export const githubProvider: ConnectProvider = {
  id: 'github',
  connectorSlugs: ['github'],
  label: 'GitHub',
  requiredEnv: GITHUB_APP_ENV,
  configured: () => githubAppConfig() !== null,
  personal: { configured: () => personalLoginClient('github') !== null },
  authorizeUrl({ state, redirectUri, client, audience }) {
    if (audience === 'personal') {
      const app = client ?? personalLoginClient('github');
      if (!app) {
        throw new Error('GitHub login for a person is not set up: set GITHUB_PERSONAL_CLIENT_ID and GITHUB_PERSONAL_CLIENT_SECRET.');
      }
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', app.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', PERSONAL_GITHUB_SCOPES.join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('allow_signup', 'false');
      return url.toString();
    }
    const config = githubAppConfig();
    const slug = config?.slug ?? '';
    return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
  },
  async exchange({ query, redirectUri, client, audience }) {
    if (audience === 'personal') {
      return personalExchange({ query, redirectUri, client: client ?? personalLoginClient('github') });
    }
    const action = query.setup_action ?? 'install';
    if (action === 'request') {
      return { ok: false, reason: 'installation_requested' };
    }
    if (action === 'cancel') {
      return { ok: false, reason: 'cancelled' };
    }
    const installationId = (query.installation_id ?? '').trim();
    if (!/^\d+$/.test(installationId)) {
      return { ok: false, reason: 'missing_installation' };
    }
    const code = (query.code ?? '').trim();
    if (code === '') {
      return { ok: false, reason: 'missing_code' };
    }
    const config = githubAppConfig();
    if (!config) {
      return { ok: false, reason: 'not_configured' };
    }
    const baseUrl = GITHUB_API_URL;

    const userToken = await userTokenFromCode(code, redirectUri, config);
    if (!userToken) {
      return { ok: false, reason: 'code_refused' };
    }
    const visible = await userCanSeeInstallation(userToken, installationId, baseUrl);
    if (visible === 'unavailable') {
      return { ok: false, reason: 'github_unavailable' };
    }
    if (visible === 'no') {
      return { ok: false, reason: 'installation_not_yours' };
    }

    const res = await fetch(`${baseUrl}/app/installations/${installationId}`, {
      headers: { ...HEADERS, authorization: `Bearer ${appJwt(config)}` },
    });
    if (!res.ok) {
      return { ok: false, reason: res.status === 404 ? 'installation_not_found' : `installation_unreadable_${res.status}` };
    }
    const installation = (await res.json()) as Installation;
    if (installation.suspended_at) {
      return { ok: false, reason: 'installation_suspended' };
    }
    const account = installation.account?.login ?? 'unknown';
    let repositories: string[] = [];
    try {
      repositories = await installationRepositories(await installationToken(installationId, { baseUrl }), baseUrl);
    } catch {
      // The installation is real; the repository list is a convenience.
    }
    return {
      ok: true,
      credentials: {
        installationId,
        account,
        accountType: installation.account?.type ?? 'unknown',
        repositorySelection: installation.repository_selection ?? 'unknown',
        repositories,
        permissions: installation.permissions ?? {},
      },
      displayName: `GitHub — ${account}`,
    };
  },
  summarize: (credentials) => {
    if (credentials.kind === 'user') {
      const login = typeof credentials.login === 'string' ? credentials.login.trim() : '';
      return login && typeof credentials.token === 'string' ? { account: `${login} (GitHub)` } : null;
    }
    const account = typeof credentials.account === 'string' ? credentials.account.trim() : '';
    if (!account || typeof credentials.installationId !== 'string') {
      return null;
    }
    const kind = typeof credentials.accountType === 'string' ? credentials.accountType.toLowerCase() : '';
    const repositories = Array.isArray(credentials.repositories)
      ? credentials.repositories.filter((r): r is string => typeof r === 'string' && r.length > 0)
      : [];
    const everything = credentials.repositorySelection === 'all';
    return {
      account: kind === 'organization' || kind === 'user' ? `${account} (${kind})` : account,
      granted: {
        label: 'Repositories',
        items: repositories,
        note: everything
          ? 'The app was granted every repository on the account, now and later; this list is what it saw when it connected.'
          : undefined,
      },
    };
  },
};
