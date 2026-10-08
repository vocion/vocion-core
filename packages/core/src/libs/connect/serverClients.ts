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
    // The multi-tenant Entra app the deployment already signs people in with
    // (`libs/identity/signInProviders.ts`): one app registration, with the
    // connect callback added to its redirect URIs and the Graph permissions
    // the Microsoft 365 connectors ask for.
    case 'microsoft':
      return { clientId: Env.AUTH_MICROSOFT_ENTRA_ID_ID?.trim(), clientSecret: Env.AUTH_MICROSOFT_ENTRA_ID_SECRET?.trim() };
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
