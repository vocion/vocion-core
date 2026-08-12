/**
 * Credential field metadata the connect-credential dialog renders per
 * connector, keyed by the connector's real registry slug (not a
 * hand-guessed camelCase variant — a mismatch here silently falls back to
 * a single generic "Token" field, which is exactly the bug this fixes for
 * `google-ads` and `zoom`).
 *
 * `credentialFields.test.ts` asserts every registered connector with
 * `authKind !== 'none'` has an entry here.
 */

export type CredField = {
  key: string;
  label: string;
  type?: 'text' | 'password';
};

export type CredSpec = {
  help: string;
  fields: CredField[];
};

export const CRED_FIELDS: Record<string, CredSpec> = {
  'hubspot': {
    help: 'HubSpot → Settings → Integrations → Private Apps. Needs crm.objects read (+ write for gated updates).',
    fields: [{ key: 'token', label: 'Private-app token', type: 'password' }],
  },
  'jira': {
    help: 'An Atlassian API token from id.atlassian.com, paired with the account email that created it.',
    fields: [
      { key: 'email', label: 'Account email', type: 'text' },
      { key: 'apiToken', label: 'API token', type: 'password' },
    ],
  },
  'google-ads': {
    help: 'A Google Ads OAuth access token, plus the developer token for your Ads manager account.',
    fields: [
      { key: 'token', label: 'OAuth access token', type: 'password' },
      { key: 'developerToken', label: 'Developer token', type: 'text' },
    ],
  },
  'ga4': {
    help: 'A Google OAuth access token with analytics.readonly.',
    fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
  },
  'gmail': {
    help: 'A Google OAuth access token with gmail.readonly. (Full OAuth sign-in flow is coming; paste a token to start.)',
    fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
  },
  'google-calendar': {
    help: 'A Google OAuth access token with calendar.readonly.',
    fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
  },
  'granola': {
    help: 'A Granola API token.',
    fields: [{ key: 'token', label: 'API token', type: 'password' }],
  },
  'slack': {
    help: 'Slack app → OAuth & Permissions → Bot User OAuth Token (xoxb-…).',
    fields: [{ key: 'token', label: 'Bot / user token', type: 'password' }],
  },
  'drive': {
    help: 'A Google OAuth access token with drive.readonly.',
    fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
  },
  'zoom': {
    help: 'A Zoom Server-to-Server OAuth app (Zoom Marketplace → Build App) — account id + its client id/secret.',
    fields: [
      { key: 'accountId', label: 'Account ID', type: 'text' },
      { key: 'clientId', label: 'Client ID', type: 'text' },
      { key: 'clientSecret', label: 'Client secret', type: 'password' },
    ],
  },
};
