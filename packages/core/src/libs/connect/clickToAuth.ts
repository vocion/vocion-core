/**
 * CLICK TO AUTH, ALWAYS (Chris, 2026-10-25: "I want to be able to click to
 * auth. Always. Any connector."). Every connector whose vendor offers a login
 * connects with one click; pasting a key is the advanced path behind it. The
 * connectors below have no login in Vocion, each with the reason, and
 * `clickToAuth.test.ts` fails on a key-only connector missing from this list.
 * `vendorHasLogin` marks the ones whose vendor does have a login: follow-ups.
 */
export const KEY_ONLY_CONNECTORS: Readonly<Record<string, { reason: string; vendorHasLogin: boolean }>> = {
  // The vendor issues keys only: a key is the way in.
  'strapi': { reason: 'Strapi issues API tokens per installation; there is no hosted login.', vendorHasLogin: false },
  'rest': { reason: 'A generic REST source: whatever the API takes, usually a key or a header.', vendorHasLogin: false },
  'elevenlabs': { reason: 'ElevenLabs issues API keys only.', vendorHasLogin: false },
  'bill': { reason: 'BILL\'s API signs in with a developer key and an API user, not OAuth.', vendorHasLogin: false },
  'redshift': { reason: 'Redshift connects with a database user or IAM credentials.', vendorHasLogin: false },
  'mixpanel': { reason: 'Mixpanel exports with a service account; it has no OAuth for data access.', vendorHasLogin: false },
  'amplitude': { reason: 'Amplitude exports with an API key and secret.', vendorHasLogin: false },
  'granola': { reason: 'Granola\'s public API takes an API key; its OAuth login belongs to its MCP server, which connects as an MCP source.', vendorHasLogin: false },
  'mcp': { reason: 'An MCP server signs in through its own OAuth, discovered when it is added (`/api/connect/mcp/start`), or takes a header key.', vendorHasLogin: false },
  // The vendor has a login Vocion has not built yet: a key works today, and
  // each of these is a follow-up to give it a login like the rest.
  'meta-ads': { reason: 'Meta has Facebook Login for the Marketing API; Vocion has no Meta login yet.', vendorHasLogin: true },
  'sentry': { reason: 'Sentry offers OAuth through an integration app; Vocion has no Sentry login yet.', vendorHasLogin: true },
  'slate': { reason: 'Slate\'s MCP server signs in with OAuth; the REST connector takes a key until it gets the same login.', vendorHasLogin: true },
  'stripe': { reason: 'Stripe Connect has OAuth for platforms; for a company\'s own account a restricted key is Stripe\'s own advice.', vendorHasLogin: true },
  'netsuite': { reason: 'NetSuite supports OAuth 2.0; Vocion has no NetSuite login yet.', vendorHasLogin: true },
  'ramp': { reason: 'Ramp\'s API supports OAuth; Vocion has no Ramp login yet.', vendorHasLogin: true },
  'rippling': { reason: 'Rippling has OAuth for partner apps; Vocion has no Rippling login yet.', vendorHasLogin: true },
  'workday': { reason: 'Workday supports OAuth API clients; Vocion connects with an integration system user today.', vendorHasLogin: true },
  'snowflake': { reason: 'Snowflake OAuth needs a security integration in each account; Vocion connects with a key pair today.', vendorHasLogin: true },
  'bigquery': { reason: 'BigQuery could ride the Google login (bigquery scope); Vocion connects with a service account today.', vendorHasLogin: true },
  'databricks': { reason: 'Databricks supports OAuth; Vocion connects with a personal access token today.', vendorHasLogin: true },
};

/**
 * What an admin must do before a vendor's login works on this server, in
 * words, for the note under a login button that is not set up yet.
 * @param option - The connector's connect option (`connectOptionFor`).
 * @param option.label - The vendor's name, e.g. "LinkedIn".
 * @param option.requiredEnv - The server settings the login needs.
 * @param option.bringYourOwnApp - Whether a workspace may save its own login app.
 */
export function loginSetupNote(option: { label: string; requiredEnv: readonly string[]; bringYourOwnApp: boolean }): string {
  const server = option.requiredEnv.length > 0 ? `the server's ${option.requiredEnv.join(' and ')}` : 'a login app on the server';
  return option.bringYourOwnApp
    ? `Signing in with ${option.label} isn't set up here yet. An admin saves ${option.label}'s login app on the Developers page (or sets ${server}), then this button signs you in.`
    : `Signing in with ${option.label} isn't set up here yet. An admin sets ${server}, then this button signs you in.`;
}
