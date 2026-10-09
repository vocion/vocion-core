/**
 * The vendor OAuth apps this server holds in its env (#1080), one per connect
 * provider whose login is a plain client ID and secret. A workspace can bring
 * its own app instead (`loginClient.ts`); the server's is the fallback, and
 * the only app a login made before workspace apps existed can refresh with.
 *
 * A leaf on purpose: the providers, the refresh and the login-app lookup all
 * read it, so it imports nothing at runtime from `libs/connect`.
 */
import type { ConnectProviderId } from './provider';
import process from 'node:process';
import { Env } from '@/libs/Env';

/**
 * A vendor OAuth app's client, and whose app it is: the workspace's own
 * (saved on the Developers page) or the server's env. The owner decides
 * which sentence a refused client ends with, since the fix is in a
 * different place for each.
 */
export type LoginClient = { clientId: string; clientSecret: string; owner: 'workspace' | 'server' };

/**
 * The client ID and secret the server's env holds for a provider, either
 * possibly unset. GitHub and PostHog have no pair here: GitHub's login is a
 * GitHub App, and PostHog's client is a document this server publishes.
 * Atlassian reads `process.env` directly, trimmed, as `libs/atlassian/oauth.ts`
 * always has.
 * @param provider - The connect provider.
 */
function serverClientPair(provider: ConnectProviderId): { clientId?: string; clientSecret?: string } {
  switch (provider) {
    case 'slack':
      return { clientId: Env.SLACK_CLIENT_ID, clientSecret: Env.SLACK_CLIENT_SECRET };
    case 'atlassian':
      return { clientId: process.env.ATLASSIAN_CLIENT_ID?.trim(), clientSecret: process.env.ATLASSIAN_CLIENT_SECRET?.trim() };
    case 'google':
      return { clientId: Env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: Env.GOOGLE_OAUTH_CLIENT_SECRET };
    case 'hubspot':
      return { clientId: Env.HUBSPOT_CLIENT_ID, clientSecret: Env.HUBSPOT_CLIENT_SECRET };
    case 'notion':
      return { clientId: Env.NOTION_CLIENT_ID, clientSecret: Env.NOTION_CLIENT_SECRET };
    case 'zoom':
      return { clientId: Env.ZOOM_CLIENT_ID, clientSecret: Env.ZOOM_CLIENT_SECRET };
    case 'apollo':
      return { clientId: Env.APOLLO_CLIENT_ID, clientSecret: Env.APOLLO_CLIENT_SECRET };
    case 'quickbooks':
      return { clientId: Env.QUICKBOOKS_CLIENT_ID, clientSecret: Env.QUICKBOOKS_CLIENT_SECRET };
    case 'xero':
      return { clientId: Env.XERO_CLIENT_ID, clientSecret: Env.XERO_CLIENT_SECRET };
    case 'gusto':
      return { clientId: Env.GUSTO_CLIENT_ID, clientSecret: Env.GUSTO_CLIENT_SECRET };
    case 'linkedin':
      return { clientId: Env.LINKEDIN_CLIENT_ID, clientSecret: Env.LINKEDIN_CLIENT_SECRET };
    default:
      return {};
  }
}

/**
 * The server's own app for a provider, or null when its env holds only half
 * of one or none.
 * @param provider - The connect provider.
 */
export function serverLoginClient(provider: ConnectProviderId): LoginClient | null {
  const { clientId, clientSecret } = serverClientPair(provider);
  return clientId && clientSecret ? { clientId, clientSecret, owner: 'server' } : null;
}

/**
 * The env pairs a person's OWN connection may run on, in the order to try
 * them (docs/guides/personal-connections.md). A dedicated personal app comes
 * first, so an install can put personal mail on an Internal-type Google app
 * while shared sources use another; then the sign-in app (Google), then the
 * workspace connectors' app. A provider with no personal connection has none.
 * @param provider - The connect provider.
 */
function personalClientPairs(provider: ConnectProviderId): Array<{ clientId?: string; clientSecret?: string }> {
  switch (provider) {
    case 'google':
      return [
        { clientId: Env.GOOGLE_PERSONAL_CLIENT_ID, clientSecret: Env.GOOGLE_PERSONAL_CLIENT_SECRET },
        { clientId: Env.AUTH_GOOGLE_ID, clientSecret: Env.AUTH_GOOGLE_SECRET },
        serverClientPair('google'),
      ];
    case 'slack':
      return [
        { clientId: Env.SLACK_PERSONAL_CLIENT_ID, clientSecret: Env.SLACK_PERSONAL_CLIENT_SECRET },
        serverClientPair('slack'),
      ];
    case 'github':
      return [
        { clientId: Env.GITHUB_PERSONAL_CLIENT_ID, clientSecret: Env.GITHUB_PERSONAL_CLIENT_SECRET },
        { clientId: Env.GITHUB_APP_CLIENT_ID, clientSecret: Env.GITHUB_APP_CLIENT_SECRET },
      ];
    default:
      return [];
  }
}

/** The env vars that set up the first-choice personal app, for "needs …" sentences. */
export const PERSONAL_CLIENT_ENV: Partial<Record<ConnectProviderId, readonly string[]>> = {
  google: ['GOOGLE_PERSONAL_CLIENT_ID', 'GOOGLE_PERSONAL_CLIENT_SECRET'],
  slack: ['SLACK_PERSONAL_CLIENT_ID', 'SLACK_PERSONAL_CLIENT_SECRET'],
  github: ['GITHUB_PERSONAL_CLIENT_ID', 'GITHUB_PERSONAL_CLIENT_SECRET'],
};

/**
 * The app a person's own connection runs on: the first complete pair of
 * {@link personalClientPairs}, or null when the server has none.
 * @param provider - The connect provider.
 */
export function personalLoginClient(provider: ConnectProviderId): LoginClient | null {
  for (const { clientId, clientSecret } of personalClientPairs(provider)) {
    if (clientId && clientSecret) {
      return { clientId, clientSecret, owner: 'server' };
    }
  }
  return null;
}

/**
 * Every app this server's env holds for a provider — the connectors' app and
 * each personal one — without duplicates. A refresh looks the login's
 * recorded client up among these, since a refresh token works only with the
 * app that issued it (`loginClientForGrant`).
 * @param provider - The connect provider.
 */
export function serverLoginClients(provider: ConnectProviderId): LoginClient[] {
  const out: LoginClient[] = [];
  for (const { clientId, clientSecret } of [serverClientPair(provider), ...personalClientPairs(provider)]) {
    if (clientId && clientSecret && !out.some(c => c.clientId === clientId)) {
      out.push({ clientId, clientSecret, owner: 'server' });
    }
  }
  return out;
}
