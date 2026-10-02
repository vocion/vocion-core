/**
 * "Connect with Atlassian" for the Jira connector — OAuth 2.0 (3LO).
 *
 * The person consents once for their Atlassian account; the grant stores an
 * access token, the rotating refresh token, and every Jira Cloud site the
 * token reaches. `libs/sources/jira.ts` picks the site by the source's
 * `baseUrl` at sync time, so one consent can serve several Jira sources.
 */

import type { ConnectProvider } from '../provider';
import type { AtlassianSite } from '@/libs/atlassian/oauth';
import {
  ATLASSIAN_AUTHORIZE_URL,
  ATLASSIAN_ENV,
  atlassianClient,
  exchangeAuthorizationCode,
  expiresAtFrom,
  JIRA_READ_SCOPES,
  listAccessibleSites,
} from '@/libs/atlassian/oauth';

export const atlassianProvider: ConnectProvider = {
  id: 'atlassian',
  connectorSlugs: ['jira'],
  label: 'Atlassian',
  requiredEnv: ATLASSIAN_ENV,
  configured: () => atlassianClient() !== null,

  authorizeUrl({ state, redirectUri }) {
    const client = atlassianClient();
    if (!client) {
      // The start route checks `configured()` first; this is the backstop, so
      // an unconfigured deployment never sends a person to a URL with an empty
      // client id that Atlassian would refuse with a message about us.
      throw new Error(`Atlassian OAuth is not configured — set ${ATLASSIAN_ENV.join(' and ')}.`);
    }
    const url = new URL(ATLASSIAN_AUTHORIZE_URL);
    url.searchParams.set('audience', 'api.atlassian.com');
    url.searchParams.set('client_id', client.clientId);
    url.searchParams.set('scope', JIRA_READ_SCOPES.join(' '));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('prompt', 'consent');
    return url.toString();
  },

  async exchange({ query, redirectUri }) {
    if (query.error) {
      // Atlassian's own reason (`access_denied` when the person declined), never the code.
      return { ok: false, reason: query.error_description ?? query.error };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    let token: Awaited<ReturnType<typeof exchangeAuthorizationCode>>;
    try {
      token = await exchangeAuthorizationCode({ code, redirectUri });
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'token_exchange_failed' };
    }
    let sites: Awaited<ReturnType<typeof listAccessibleSites>>;
    try {
      sites = await listAccessibleSites(token.access_token);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : 'accessible_resources_failed' };
    }
    if (sites.length === 0) {
      return { ok: false, reason: 'This Atlassian account reaches no Jira Cloud site. Sign in with an account that is a member of the site the source names.' };
    }
    if (!token.refresh_token) {
      return { ok: false, reason: 'Atlassian returned no refresh token. The app must request the offline_access scope.' };
    }
    const single = sites.length === 1 ? sites[0] : undefined;
    return {
      ok: true,
      credentials: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: expiresAtFrom(token.expires_in),
        scope: token.scope ?? JIRA_READ_SCOPES.join(' '),
        sites,
        ...(single ? { cloudId: single.id } : {}),
      },
      displayName: single ? `Atlassian — ${single.name}` : `Atlassian — ${sites.length} sites`,
    };
  },
  summarize: (credentials) => {
    if (typeof credentials.refreshToken !== 'string' || !Array.isArray(credentials.sites)) {
      return null;
    }
    const sites = credentials.sites
      .map((site) => {
        const s = site as Partial<AtlassianSite> | null;
        return s && typeof s.url === 'string' && s.url ? s.url.replace(/^https?:\/\//, '') : null;
      })
      .filter((url): url is string => url !== null);
    if (sites.length === 0) {
      return null;
    }
    const chosen = typeof credentials.cloudId === 'string'
      ? (credentials.sites as Array<Partial<AtlassianSite>>).find(site => site.id === credentials.cloudId)?.url?.replace(/^https?:\/\//, '')
      : undefined;
    return {
      account: chosen ?? sites[0]!,
      ...(sites.length > 1 ? { granted: { label: 'Sites', items: sites } } : {}),
    };
  },
};
