import type { LoginClient } from './serverClients';
import type { RawCredentials } from '@/services/SourceCredentialService';

/**
 * What a stored grant is on, said so a person can check it against the
 * source without opening the vendor: the account the person connected, and
 * the things that account granted, by name. Built from the credential bag
 * on the server; carries no token, id or secret, so it may cross to the
 * browser and sit on the connector card.
 */
export type GrantSummary = {
  /** The account the grant is on: "The-NocoCompany (organization)", "Metacto (Slack workspace)", "metacto.atlassian.net". */
  account: string;
  /** What the account granted, when the vendor enumerates it: repositories, sites. Names only. */
  granted?: {
    /** What the names are: "Repositories", "Sites". */
    label: string;
    items: string[];
    /** One line the reader needs beside the list, e.g. that the grant covers every repository, now and later. */
    note?: string;
  };
};

/** Every vendor a person can log in to. The id is the URL segment of the start and callback routes. */
export type ConnectProviderId = 'slack' | 'atlassian' | 'github' | 'google' | 'hubspot' | 'notion' | 'zoom' | 'posthog' | 'apollo' | 'quickbooks' | 'xero' | 'gusto' | 'linkedin';

/**
 * Whose login it is. `workspace` (the default) is an admin connecting a
 * system for a shared workspace; `personal` is a person connecting their OWN
 * account for their own assistant (`libs/personal/connections.ts`), which may
 * ask the vendor for different access (a Slack user token, Gmail drafts) and
 * run on a different app (`personalLoginClient`).
 */
export type ConnectAudience = 'workspace' | 'personal';

/** Where a person is sent, and what comes back, for one vendor. */
export type ConnectProvider = {
  /** Provider id: the URL segment and the connector slug(s) it serves. */
  id: ConnectProviderId;
  /** Connector slugs this provider connects (`jira` for atlassian; `slack`; `github`). */
  connectorSlugs: readonly string[];
  /** Human label for the button: "Connect with Slack". */
  label: string;
  /** Env var names the deployment must set; missing ones make `configured()` false. */
  requiredEnv: readonly string[];
  /** Whether the deployment has what it needs. Never throws. */
  configured: () => boolean;
  /**
   * When true, the login uses PKCE: the start sends an S256 `codeChallenge`
   * and the callback sends the matching `codeVerifier`. Both are derived from
   * the signed state (`pkceVerifierFor`), so nothing is stored in between.
   * PostHog requires it; a provider with a client secret may skip it.
   */
  pkce?: boolean;
  /**
   * The vendor URL to send the person to. `state` is the opaque signed state
   * (already base64url); `redirectUri` is this deployment's callback for the
   * provider; `connector` is the connector the login is for, so a provider
   * serving several (Google) asks only for that connector's access. `client`
   * is the app the login runs on (`loginClient.ts`: the workspace's own, else
   * the server's); a provider that takes a client ID and secret falls back to
   * the server's env app when it is left out. Never logs any of them.
   */
  authorizeUrl: (input: { state: string; redirectUri: string; connector: string; codeChallenge?: string; client?: LoginClient; audience?: ConnectAudience }) => string;
  /**
   * Turn the callback's query into the credential bag to store, or a refusal.
   * `query` is every query param of the callback request. Vendors differ:
   * Slack/Atlassian carry `code`; GitHub carries `installation_id` + `setup_action`;
   * Sentry carries `code` + `installationId`. `codeVerifier` is set when `pkce` is.
   * `client` is the same app `authorizeUrl` sent the person to.
   */
  exchange: (input: { query: Record<string, string>; redirectUri: string; codeVerifier?: string; client?: LoginClient; audience?: ConnectAudience }) => Promise<
    | { ok: true; credentials: RawCredentials; displayName: string }
    | { ok: false; reason: string }
  >;
  /**
   * The non-secret account of a stored grant, for the connector card. Reads
   * only what `exchange` stored beside the token; null when the bag is not
   * one this provider stored (a pasted token, an older grant). Never throws.
   */
  summarize: (credentials: RawCredentials) => GrantSummary | null;
  /**
   * For a provider serving several connectors with different access (Google):
   * why a stored login of this provider cannot serve `connectorSlug`, in a
   * sentence for the person, or null when it can. Saving a source that keeps
   * the stored login is refused with that sentence, rather than syncing into a
   * "missing scope" error. Absent: every stored login serves every connector.
   */
  missingAccessFor?: (credentials: RawCredentials, connectorSlug: string, audience?: ConnectAudience) => string | null;
  /**
   * Whether this provider can make a person's OWN login (`audience:
   * 'personal'`). Absent: it cannot, and the personal gate refuses it.
   */
  personal?: {
    /** Whether the server has an app for it (`personalLoginClient`). Never throws. */
    configured: () => boolean;
  };
};
