/**
 * The browser OAuth providers, as data.
 *
 * One descriptor per vendor rather than a branch per vendor: adding Zoom after
 * Google and Slack should be an entry here and nothing else. What differs
 * between them is small and entirely declarative — where consent lives, where
 * the code is exchanged, how scopes are joined, and the handful of extra query
 * parameters each one needs to return a durable refresh token.
 *
 * **The client is the workspace's, not ours.** Every provider here is BYO: the
 * org stores its own `{ clientId, clientSecret }` under API credentials and the
 * consent runs against that. A Vocion-owned app would be one tap instead of a
 * setup step, and it costs a Google verification review for the restricted
 * Gmail scopes — weeks, and not a thing to block this on.
 */

import type { CredentialPlatformId } from '@/libs/platforms/registry';

export type OAuthProvider = {
  /** The stored-credential platform whose `{ clientId, clientSecret }` signs this. */
  platform: CredentialPlatformId;
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  /** How the vendor wants a scope list joined. */
  scopeSeparator: string;
  /**
   * Extra authorize-URL parameters.
   *
   * Google's pair is load-bearing: without `access_type=offline` it returns no
   * refresh token at all, and without `prompt=consent` it returns one only on
   * the very first consent — so a workspace reconnecting gets an access token
   * that dies in an hour and nothing saying why.
   */
  authorizeParams?: Record<string, string>;
  /** Whether the vendor supports PKCE. Sent when it does; harmless when unused. */
  pkce: boolean;
  /**
   * Fields a token response maps into the stored credential, beyond the
   * refresh token. A vendor that returns nothing else has none.
   */
  extraTokenFields?: readonly string[];
};

export const OAUTH_PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    platform: 'google',
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopeSeparator: ' ',
    authorizeParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    pkce: true,
  },
  slack: {
    platform: 'slack',
    label: 'Slack',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopeSeparator: ',',
    pkce: false,
  },
  zoom: {
    platform: 'zoom',
    label: 'Zoom',
    authorizeUrl: 'https://zoom.us/oauth/authorize',
    tokenUrl: 'https://zoom.us/oauth/token',
    scopeSeparator: ' ',
    pkce: true,
  },
};

/**
 * The provider a connector signs in through, or null when it has none.
 *
 * Keyed off the connector's stored-credential platform, so `gmail`, `drive`
 * and `google-calendar` all resolve to the one Google consent — which is the
 * point of doing Google first: one grant covers three connectors.
 * @param platform - The connector's credential platform.
 */
export function providerForPlatform(platform: string | null | undefined): OAuthProvider | null {
  return (platform && OAUTH_PROVIDERS[platform]) || null;
}
