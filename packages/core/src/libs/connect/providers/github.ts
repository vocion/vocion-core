/**
 * GitHub, connected by installing this deployment's GitHub App. There is no
 * code exchange: the person picks an organization and repositories on
 * GitHub, GitHub sends them to our Setup URL with `installation_id`, and the
 * installation IS the credential. Tokens are minted from it per hour
 * (`libs/github/app.ts`) and never stored.
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
};

type RepositoryPage = { repositories?: Array<{ full_name: string }> };

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
  async exchange({ query }) {
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
    const config = githubAppConfig();
    if (!config) {
      return { ok: false, reason: 'not_configured' };
    }
    const baseUrl = GITHUB_API_URL;
    const res = await fetch(`${baseUrl}/app/installations/${installationId}`, {
      headers: { ...HEADERS, authorization: `Bearer ${appJwt(config)}` },
    });
    if (!res.ok) {
      return { ok: false, reason: res.status === 404 ? 'installation_not_found' : `installation_unreadable_${res.status}` };
    }
    const installation = (await res.json()) as Installation;
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
