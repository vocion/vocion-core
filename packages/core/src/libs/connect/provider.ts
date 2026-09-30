import type { RawCredentials } from '@/services/SourceCredentialService';

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
};
