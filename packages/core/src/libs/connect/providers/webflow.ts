/**
 * "Log in with Webflow" for the Webflow connector: a Webflow Data API (v2)
 * OAuth app. The person picks the sites Vocion may reach on Webflow's consent
 * screen; the access token reads those sites and their CMS, and writes CMS
 * items (`cms:write`), which is how a page is saved as a draft post.
 *
 * Webflow's OAuth tokens do not expire (they last until the person or the
 * site revokes the app), so this is not a LoginGrant and there is nothing to
 * refresh. The bag stores `token`, the key a pasted site API token is stored
 * under too, so the connector and publishing read either the same way, and
 * beside it the sites the login reaches (ids, names, addresses), so the
 * connector card can name them and publishing finds the login for a site.
 */

import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { siteUrlOf, webflowClient } from '@/libs/webflow/api';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://webflow.com/oauth/authorize';
const TOKEN_URL = 'https://api.webflow.com/oauth/access_token';

/**
 * The scopes the login asks for: the sites it may read, and their CMS read and
 * written. No `sites:write`: a post goes live by publishing its item, which
 * `cms:write` covers, never by publishing the whole site.
 */
export const WEBFLOW_LOGIN_SCOPES = ['sites:read', 'cms:read', 'cms:write'] as const;

/**
 * A short, safe refusal reason from the callback's `error` param.
 * @param error - The raw `error` query param.
 */
function safeRefusalReason(error: string): string {
  return /^[\w.-]{1,64}$/.test(error) ? error : 'authorization_refused';
}

/**
 * The Webflow app a login runs on: the one the caller chose, else this server's env app.
 * @param chosen - The app the caller resolved, if it did.
 */
function webflowApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('webflow');
}

/** A site the login reaches, as the bag keeps it. */
type GrantedSite = { id: string; name: string; url: string };

/**
 * The sites a bag says its login reaches.
 * @param credentials - The bag.
 */
export function grantedSitesOf(credentials: Record<string, unknown>): GrantedSite[] {
  const sites = Array.isArray(credentials.sites) ? credentials.sites : [];
  return sites.filter((s): s is GrantedSite => Boolean(s) && typeof (s as GrantedSite).id === 'string' && typeof (s as GrantedSite).name === 'string');
}

/** Webflow Data API login (connector `webflow`). */
export const webflowProvider: ConnectProvider = {
  id: 'webflow',
  connectorSlugs: ['webflow'],
  label: 'Webflow',
  requiredEnv: ['WEBFLOW_CLIENT_ID', 'WEBFLOW_CLIENT_SECRET'],
  configured: () => webflowApp() !== null,

  authorizeUrl: ({ state, redirectUri, client: chosen }) => {
    const app = webflowApp(chosen);
    if (!app) {
      throw new Error('Webflow login is not set up: set WEBFLOW_CLIENT_ID and WEBFLOW_CLIENT_SECRET.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', WEBFLOW_LOGIN_SCOPES.join(' '));
    url.searchParams.set('state', state);
    return url.toString();
  },

  exchange: async ({ query, redirectUri, client: chosen }) => {
    if (query.error) {
      return { ok: false, reason: safeRefusalReason(query.error) };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const app = webflowApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    let body: Record<string, unknown>;
    try {
      body = await postTokenRequest({
        vendor: 'Webflow',
        url: TOKEN_URL,
        encoding: 'form',
        params: { client_id: app.clientId, client_secret: app.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri },
      });
    } catch (error) {
      const reason = error instanceof TokenRequestError ? error.code : 'token_exchange_failed';
      logger.warn('Webflow login token exchange failed', { reason });
      return { ok: false, reason };
    }
    const token = typeof body.access_token === 'string' && body.access_token ? body.access_token : null;
    if (!token) {
      return { ok: false, reason: 'no_token' };
    }
    // Which sites it reaches, by name, for the connector card and for finding the login a site publishes with.
    const api = webflowClient(token);
    const [grant, sites] = await Promise.all([api.introspect().catch(() => null), api.listSites().catch(() => [])]);
    const granted = sites.filter(s => !grant || grant.siteIds.length === 0 || grant.siteIds.includes(s.id)).map(s => ({ id: s.id, name: s.displayName, url: siteUrlOf(s) }));
    const scope = typeof body.scope === 'string' ? body.scope : grant?.scope ?? WEBFLOW_LOGIN_SCOPES.join(' ');
    return {
      ok: true,
      credentials: { token, scope, sites: granted, siteIds: granted.map(s => s.id), workspaceIds: grant?.workspaceIds ?? [] },
      displayName: `Webflow — ${granted.length === 1 ? granted[0]!.name : `${granted.length} sites`}`,
    };
  },

  summarize: (credentials) => {
    if (typeof credentials.token !== 'string' || !Array.isArray(credentials.sites)) {
      return null;
    }
    const sites = grantedSitesOf(credentials);
    const workspace = Array.isArray(credentials.workspaceIds) && typeof credentials.workspaceIds[0] === 'string' ? credentials.workspaceIds[0] : null;
    return {
      account: sites.length === 1 ? `${sites[0]!.name} (Webflow site)` : workspace ? `Webflow workspace ${workspace}` : `${sites.length} Webflow sites`,
      granted: { label: 'Sites', items: sites.map(s => `${s.name} · ${s.url.replace(/^https:\/\//, '')}`), note: 'Only the sites picked on Webflow\'s consent screen. Log in again to add one.' },
    };
  },
};
