/**
 * The Sources UI's per-connector presentation metadata — everything the
 * Add-Source and Connect-credential dialogs need to render, keyed by the
 * connector's real registry slug. Deliberately separate from
 * `SourceConnector` (`types.ts`): that type is the sync-execution contract
 * consumed by `SourceSyncService` and Temporal activities, and has no
 * business carrying UI-only concerns like labels and help text.
 *
 * One entry per connector means "add a connector" now touches this file
 * plus the connector's own `configSchema`/`sync()` file — not a third,
 * separately-drifting map. `uiFields.test.ts` asserts every registered
 * connector has an entry (`web` excepted — see its comment below) and that
 * every `configFields` key exists on the connector's real `configSchema`.
 */

import type { SourceConfigField } from './configFields';

export type CredField = {
  key: string;
  label: string;
  type?: 'text' | 'password';
};

export type CredSpec = {
  help: string;
  fields: CredField[];
};

export type ConnectorUiFields = {
  /** Add-Source dialog inputs, matched to the connector's `configSchema`. */
  configFields: SourceConfigField[];
  /** Connect-credential dialog inputs, for connectors with `authKind !== 'none'`. */
  credentials?: CredSpec;
};

export const UI_FIELDS: Record<string, ConnectorUiFields> = {
  'web': {
    // Bespoke urls/crawl UI in AddSourceDialog covers this connector directly —
    // one flat field standing in for the real (urls | crawl) union, kept mainly
    // so uiFields.test.ts can still assert this connector against a schema.
    configFields: [
      { key: 'urls', label: 'URLs', type: 'stringArray', help: 'Comma-separated. Leave blank and use crawl mode instead.' },
    ],
  },
  'local-files': {
    configFields: [
      { key: 'directory', label: 'Directory', type: 'text', required: true, help: 'Relative to WORKSPACE_PATH, or absolute.' },
      { key: 'extensions', label: 'File extensions', type: 'stringArray', default: ['.md', '.txt'], help: 'Comma-separated, e.g. .md, .txt' },
    ],
  },
  'file-import': {
    // fieldMapping/csvOptions are advanced — left off the form, schema defaults apply.
    configFields: [
      { key: 'path', label: 'File path', type: 'text', required: true, help: 'Relative to WORKSPACE_PATH, or absolute.' },
      { key: 'format', label: 'Format', type: 'select', options: ['auto', 'jsonl', 'csv', 'json'], default: 'auto' },
    ],
  },
  'hubspot': {
    configFields: [
      { key: 'objectType', label: 'Object type', type: 'select', options: ['contacts', 'deals', 'companies'], default: 'contacts' },
      { key: 'baseUrl', label: 'API base URL', type: 'url', default: 'https://api.hubapi.com', help: 'Override only for EU data residency or testing.' },
    ],
    credentials: {
      help: 'HubSpot → Settings → Integrations → Private Apps. Needs crm.objects read (+ write for gated updates).',
      fields: [{ key: 'token', label: 'Private-app token', type: 'password' }],
    },
  },
  'jira': {
    // notDoneStatuses is advanced — left off the form, schema default ([]) applies.
    configFields: [
      { key: 'baseUrl', label: 'Jira site URL', type: 'url', required: true, placeholder: 'https://acme.atlassian.net' },
      { key: 'projectKeys', label: 'Project keys', type: 'stringArray', required: true, help: 'Comma-separated, e.g. ENG, OPS' },
      { key: 'doneWindowDays', label: 'Done-issue window (days)', type: 'number', default: 90 },
      { key: 'includeDescription', label: 'Include issue description', type: 'boolean', default: true },
    ],
    credentials: {
      help: 'An Atlassian API token from id.atlassian.com, paired with the account email that created it.',
      fields: [
        { key: 'email', label: 'Account email', type: 'text' },
        { key: 'apiToken', label: 'API token', type: 'password' },
      ],
    },
  },
  'google-ads': {
    configFields: [
      { key: 'customerId', label: 'Customer ID', type: 'text', required: true },
      { key: 'loginCustomerId', label: 'Manager (MCC) account ID', type: 'text', help: 'Only when the token authenticates through a manager account.' },
    ],
    credentials: {
      help: 'A Google Ads OAuth access token, plus the developer token for your Ads manager account.',
      fields: [
        { key: 'token', label: 'OAuth access token', type: 'password' },
        { key: 'developerToken', label: 'Developer token', type: 'text' },
      ],
    },
  },
  'ga4': {
    // dimensions/metrics/limit are advanced — left off the form, schema defaults apply.
    configFields: [
      { key: 'propertyId', label: 'GA4 property ID', type: 'text', required: true },
    ],
    credentials: {
      help: 'A Google OAuth access token with analytics.readonly.',
      fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
    },
  },
  'gmail': {
    configFields: [
      { key: 'query', label: 'Gmail search query', type: 'text', default: 'in:inbox', help: 'Any Gmail search syntax, e.g. from:client.com' },
    ],
    credentials: {
      help: 'A Google OAuth access token with gmail.readonly. (Full OAuth sign-in flow is coming; paste a token to start.)',
      fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
    },
  },
  'google-calendar': {
    configFields: [
      { key: 'calendarId', label: 'Calendar ID', type: 'text', default: 'primary' },
      { key: 'pastDays', label: 'Days back', type: 'number', default: 30 },
      { key: 'futureDays', label: 'Days ahead', type: 'number', default: 60 },
    ],
    credentials: {
      help: 'A Google OAuth access token with calendar.readonly.',
      fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
    },
  },
  'granola': {
    configFields: [
      { key: 'pastDays', label: 'Days back', type: 'number', default: 60 },
    ],
    credentials: {
      help: 'A Granola API token.',
      fields: [{ key: 'token', label: 'API token', type: 'password' }],
    },
  },
  'slack': {
    configFields: [
      { key: 'channel', label: 'Channel ID', type: 'text', required: true, placeholder: 'C0123ABCD' },
    ],
    credentials: {
      help: 'Slack app → OAuth & Permissions → Bot User OAuth Token (xoxb-…).',
      fields: [{ key: 'token', label: 'Bot / user token', type: 'password' }],
    },
  },
  'drive': {
    configFields: [
      { key: 'query', label: 'Drive query', type: 'text', default: 'trashed = false', help: 'Drive API v3 query syntax.' },
    ],
    credentials: {
      help: 'A Google OAuth access token with drive.readonly.',
      fields: [{ key: 'token', label: 'OAuth access token', type: 'password' }],
    },
  },
  'zoom': {
    // apiBaseUrl/authBaseUrl are advanced — left off the form, schema defaults apply.
    configFields: [
      { key: 'pastDays', label: 'Days back', type: 'number', default: 30 },
      { key: 'users', label: 'Restrict to users (emails)', type: 'stringArray', help: 'Leave empty to sync every active user company-wide.' },
    ],
    credentials: {
      help: 'A Zoom Server-to-Server OAuth app (Zoom Marketplace → Build App) — account id + its client id/secret.',
      fields: [
        { key: 'accountId', label: 'Account ID', type: 'text' },
        { key: 'clientId', label: 'Client ID', type: 'text' },
        { key: 'clientSecret', label: 'Client secret', type: 'password' },
      ],
    },
  },
};

/**
 * Validate a raw credential submission against a connector's real field
 * list — not a hardcoded `token` key, which would reject zoom's
 * accountId/clientId/clientSecret and jira's email/apiToken outright even
 * though they're exactly what those connectors read from `ctx.credentials`.
 * Unknown connectors (no UI_FIELDS entry) fall back to requiring `token`.
 * @param connectorSlug - the real connector slug (e.g. 'zoom', 'google-ads')
 * @param raw - the request body's `credentials` object, unvalidated
 */
export function validateCredentialSubmission(
  connectorSlug: string,
  raw: Record<string, unknown>,
): { trimmed: Record<string, string>; missingKey: string | null } {
  const requiredKeys = UI_FIELDS[connectorSlug]?.credentials?.fields.map(f => f.key) ?? ['token'];
  const trimmed: Record<string, string> = {};
  for (const key of requiredKeys) {
    trimmed[key] = typeof raw[key] === 'string' ? raw[key].trim() : '';
  }
  const missingKey = requiredKeys.find(key => !trimmed[key]) ?? null;
  return { trimmed, missingKey };
}
