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

/** Where a person is sent, and what comes back, for one vendor. */
export type ConnectProvider = {
  /** Provider id: the URL segment and the connector slug(s) it serves. */
  id: 'slack' | 'atlassian' | 'github';
  /** Connector slugs this provider connects (`jira` for atlassian; `slack`; `github`). */
  connectorSlugs: readonly string[];
  /** Human label for the button: "Connect with Slack". */
  label: string;
  /** Env var names the deployment must set; missing ones make `configured()` false. */
  requiredEnv: readonly string[];
  /** Whether the deployment has what it needs. Never throws. */
  configured: () => boolean;
  /**
   * The vendor URL to send the person to. `state` is the opaque signed state
   * (already base64url); `redirectUri` is this deployment's callback for the
   * provider. Never logs either.
   */
  authorizeUrl: (input: { state: string; redirectUri: string }) => string;
  /**
   * Turn the callback's query into the credential bag to store, or a refusal.
   * `query` is every query param of the callback request. Vendors differ:
   * Slack/Atlassian carry `code`; GitHub carries `installation_id` + `setup_action`.
   */
  exchange: (input: { query: Record<string, string>; redirectUri: string }) => Promise<
    | { ok: true; credentials: RawCredentials; displayName: string }
    | { ok: false; reason: string }
  >;
  /**
   * The non-secret account of a stored grant, for the connector card. Reads
   * only what `exchange` stored beside the token; null when the bag is not
   * one this provider stored (a pasted token, an older grant). Never throws.
   */
  summarize: (credentials: RawCredentials) => GrantSummary | null;
};
