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
 */

import type { ConnectProvider } from '../provider';
import { appJwt, GITHUB_APP_ENV, githubAppConfig, installationToken } from '@/libs/github/app';
import { GITHUB_API_URL, nextPageUrl } from '@/libs/github/client';

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
async function installationRepositories(token: string, baseUrl: string): Promise<string[]> {
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
 * here only for a person who is a member of the account it is on.
 * @param userToken - The short-lived user token.
 * @param installationId - The installation the callback named.
 * @param baseUrl - API host.
 */
async function userCanSeeInstallation(userToken: string, installationId: string, baseUrl: string): Promise<boolean> {
  let url: string | null = `${baseUrl}/user/installations?per_page=100`;
  for (let page = 0; url && page < 20; page += 1) {
    const res = await fetch(url, { headers: { ...HEADERS, authorization: `Bearer ${userToken}` } });
    if (!res.ok) {
      return false;
    }
    const body = (await res.json()) as UserInstallationsPage;
    if ((body.installations ?? []).some(inst => String(inst.id) === installationId)) {
      return true;
    }
    url = nextPageUrl(res.headers.get('link'));
  }
  return false;
}

export const githubProvider: ConnectProvider = {
  id: 'github',
  connectorSlugs: ['github'],
  label: 'GitHub',
  requiredEnv: GITHUB_APP_ENV,
  configured: () => githubAppConfig() !== null,
  authorizeUrl({ state }) {
    const config = githubAppConfig();
    const slug = config?.slug ?? '';
    return `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
  },
  async exchange({ query, redirectUri }) {
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
    if (!(await userCanSeeInstallation(userToken, installationId, baseUrl))) {
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
};
