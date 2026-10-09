/**
 * Slack, OAuth v2. The person installs the app into a workspace and Vocion
 * receives the bot token; nothing is pasted. Scopes are what the `slack`
 * source needs to read channel history and nothing more (docs/guides/slack.md
 * for the bot surface, which is a separate install with its own scopes).
 *
 * The bag stores `token` because that is the key `libs/sources/slack.ts`
 * already reads, so the connector is unchanged by how the token arrived.
 */

import type { ConnectAudience, ConnectProvider } from '../provider';
import type { LoginClient } from '../serverClients';
import { PERSONAL_SLACK_USER_SCOPES } from '@/libs/personal/connections';
import { personalLoginClient, serverLoginClient } from '../serverClients';

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
  /** The person who approved, and their USER token when user scopes were asked for. */
  authed_user?: { id?: string; access_token?: string; scope?: string; token_type?: string };
};

/**
 * The Slack app a login runs on: the one the caller chose
 * (`libs/connect/loginClient.ts`), else this server's env app, else null.
 * @param chosen - The app the caller resolved, if it did.
 * @param audience
 */
function slackApp(chosen?: LoginClient, audience?: ConnectAudience): LoginClient | null {
  return chosen ?? (audience === 'personal' ? personalLoginClient('slack') : serverLoginClient('slack'));
}

/**
 * A person's OWN Slack login: their user token, not a bot's. Slack returns it
 * under `authed_user` when the authorize URL asked for `user_scope`. Stored
 * under `token` like the bot's, with `kind: 'user'` so nothing mistakes it
 * for a workspace install.
 * @param data - Slack's `oauth.v2.access` answer.
 */
function personalGrant(data: AccessResponse): { ok: true; credentials: Record<string, unknown>; displayName: string } | { ok: false; reason: string } {
  const token = data.authed_user?.access_token;
  if (!data.ok || !token) {
    return { ok: false, reason: data.error ?? 'no_token' };
  }
  const teamName = data.team?.name ?? data.team?.id ?? 'workspace';
  return {
    ok: true,
    credentials: {
      token,
      kind: 'user',
      userId: data.authed_user?.id ?? null,
      teamId: data.team?.id ?? null,
      teamName: data.team?.name ?? null,
      scope: data.authed_user?.scope ?? null,
    },
    displayName: `Slack — ${teamName}`,
  };
}

export const slackProvider: ConnectProvider = {
  id: 'slack',
  connectorSlugs: ['slack'],
  label: 'Slack',
  requiredEnv: ['SLACK_CLIENT_ID', 'SLACK_CLIENT_SECRET'],
  configured: () => slackApp() !== null,
  personal: { configured: () => personalLoginClient('slack') !== null },
  authorizeUrl: ({ state, redirectUri, client: chosen, audience }) => {
    const app = slackApp(chosen, audience);
    if (!app) {
      throw new Error('Slack login is not set up: set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET, or save a Slack login app on the Developers page.');
    }
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', app.clientId);
    if (audience === 'personal') {
      // The person's own token: user scopes only, no bot.
      url.searchParams.set('user_scope', PERSONAL_SLACK_USER_SCOPES.join(','));
    } else {
      url.searchParams.set('scope', SLACK_SOURCE_SCOPES.join(','));
    }
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url.toString();
  },
  exchange: async ({ query, redirectUri, client: chosen, audience }) => {
    if (query.error) {
      // Slack's own refusal, e.g. `access_denied` when the person cancels.
      return { ok: false, reason: query.error };
    }
    const code = query.code;
    if (!code) {
      return { ok: false, reason: 'missing_code' };
    }
    const app = slackApp(chosen, audience);
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
    if (audience === 'personal') {
      return personalGrant(data);
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
    return { account: credentials.kind === 'user' ? `You in ${teamName} (Slack)` : `${teamName} (Slack workspace)` };
  },
};
