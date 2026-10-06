/**
 * "Log in with Notion" for the Notion connector: a public Notion integration.
 *
 * The person picks the pages to share on Notion's consent screen and Vocion
 * receives the workspace bot token. The bag stores `token` because that is the
 * key `libs/sources/notion.ts` already reads, so the connector is unchanged by
 * how the token arrived. It is deliberately not a LoginGrant: Notion documents
 * no `expires_in`, so there is no expiry to refresh against. The refresh token
 * (when Notion sends one) is kept for later, not used by the sync.
 *
 * Notion needs no settings after login: what syncs is what the person shared.
 */

import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { logger } from '@/libs/Logger';
import { DEFAULT_NOTION_VERSION } from '@/libs/sources/notionVersion';
import { serverLoginClient } from '../serverClients';
import { postTokenRequest, TokenRequestError } from '../tokenRequest';

const AUTHORIZE_URL = 'https://api.notion.com/v1/oauth/authorize';
const TOKEN_URL = 'https://api.notion.com/v1/oauth/token';

/**
 * A short, safe refusal reason from the callback's `error` param: Notion's
 * OAuth code (`access_denied`), never free text that could echo input.
 * @param error - The raw `error` query param.
 */
function safeRefusalReason(error: string): string {
  return /^[\w.-]{1,64}$/.test(error) ? error : 'authorization_refused';
}

/**
 * Read a string field from a token response, or null when absent or empty.
 * @param body - The parsed token response.
 * @param key - The field name.
 */
function textField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The Notion app a login runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function notionApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('notion');
}

/** Notion public-integration login (connector `notion`). */
export const notionProvider: ConnectProvider = {
  id: 'notion',
  connectorSlugs: ['notion'],
  label: 'Notion',
  requiredEnv: ['NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET'],
  configured: () => notionApp() !== null,

  authorizeUrl: ({ state, redirectUri, client: chosen }) => {
    const app = notionApp(chosen);
    if (!app) {
      throw new Error('Notion login is not set up: set NOTION_CLIENT_ID and NOTION_CLIENT_SECRET, or save a Notion login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('owner', 'user');
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
    const app = notionApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    let body: Record<string, unknown>;
    try {
      body = await postTokenRequest({
        vendor: 'Notion',
        url: TOKEN_URL,
        encoding: 'json',
        params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
        basicAuth: { clientId: app.clientId, clientSecret: app.clientSecret },
        // Notion's API reference marks this header required on the token endpoint.
        extraHeaders: { 'Notion-Version': DEFAULT_NOTION_VERSION },
      });
    } catch (error) {
      const reason = error instanceof TokenRequestError ? error.code : 'token_exchange_failed';
      logger.warn('Notion login token exchange failed', { reason });
      return { ok: false, reason };
    }
    const token = textField(body, 'access_token');
    if (!token) {
      return { ok: false, reason: 'no_token' };
    }
    const workspaceName = textField(body, 'workspace_name');
    const workspaceId = textField(body, 'workspace_id');
    const refreshToken = textField(body, 'refresh_token');
    return {
      ok: true,
      credentials: {
        token,
        ...(refreshToken ? { refreshToken } : {}),
        workspaceId,
        workspaceName,
        botId: textField(body, 'bot_id'),
      },
      displayName: `Notion — ${workspaceName ?? workspaceId ?? 'workspace'}`,
    };
  },

  summarize: (credentials) => {
    const workspaceName = typeof credentials.workspaceName === 'string' ? credentials.workspaceName.trim() : '';
    if (typeof credentials.workspaceId !== 'string' || !credentials.workspaceId || typeof credentials.token !== 'string') {
      return null;
    }
    return { account: `${workspaceName || credentials.workspaceId} (Notion workspace)` };
  },
};
