/**
 * Slack, OAuth v2. The person installs the app into a workspace and Vocion
 * receives the bot token; nothing is pasted. Scopes are what the `slack`
 * source needs to read channel history and nothing more (docs/guides/slack.md
 * for the bot surface, which is a separate install with its own scopes).
 *
 * The bag stores `token` because that is the key `libs/sources/slack.ts`
 * already reads, so the connector is unchanged by how the token arrived.
 */

import type { ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { serverLoginClient } from '../serverClients';

const AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
const ACCESS_URL = 'https://slack.com/api/oauth.v2.access';

/** Bot scopes the `slack` source reads with. Comma-joined, as Slack expects. */
export const SLACK_SOURCE_SCOPES = ['channels:read', 'channels:history', 'groups:read', 'groups:history'] as const;

type AccessResponse = {
  ok: boolean;
  error?: string;
  access_token?: string;
  token_type?: string;
  scope?: string;
  bot_user_id?: string;
  app_id?: string;
  team?: { id?: string; name?: string };
};

/**
 * The Slack app a login runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 */
function slackApp(chosen?: LoginClient): LoginClient | null {
  return chosen ?? serverLoginClient('slack');
}

export const slackProvider: ConnectProvider = {
  id: 'slack',
  connectorSlugs: ['slack'],
  label: 'Slack',
  requiredEnv: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  configured: () => slackApp() !== null,
  authorizeUrl: ({ state, redirectUri, client: chosen }) => {
    const app = slackApp(chosen);
    if (!app) {
      throw new Error('Slack login is not set up: set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, or save a Slack login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    url.searchParams.set('scope', SLACK_SOURCE_SCOPES.join(','));
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchange: async ({ query, redirectUri, client: chosen }) => {
    if (query.error) {
      // Slack's own refusal, e.g. `access_denied` when the person cancels.
      return { ok: false, reason: query.error };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const app = slackApp(chosen);
    if (!app) {
      return { ok: false, reason: 'not_configured' };
    }
    const body = new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: redirectUri,
    });
    let data: AccessResponse;
    try {
      const res = await fetch(ACCESS_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      data = await res.json() as AccessResponse;
    } catch {
      return { ok: false, reason: 'slack_unreachable' };
    }
    if (!data.ok || !data.access_token) {
      return { ok: false, reason: data.error ?? 'no_token' };
    }
    const teamName = data.team?.name ?? data.team?.id ?? 'workspace';
    return {
      ok: true,
      credentials: {
        token: data.access_token,
        teamId: data.team?.id ?? null,
        teamName: data.team?.name ?? null,
        botUserId: data.bot_user_id ?? null,
        appId: data.app_id ?? null,
        scope: data.scope ?? null,
      },
      displayName: `Slack — ${teamName}`,
    };
  },
  summarize: (credentials) => {
    const teamName = typeof credentials.teamName === 'string' ? credentials.teamName.trim() : '';
    if (!teamName || typeof credentials.token !== 'string') {
      return null;
    }
    return { account: `${teamName} (Slack workspace)` };
  },
};
