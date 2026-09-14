/**
 * Apollo connector — the capability carrier for the Apollo tool surface, and
 * nothing else.
 *
 * Apollo is queried LIVE at chat time, so this connector ingests no documents:
 * there is no roster to mirror, no embedding to keep fresh, and counting stays
 * with the HubSpot mirror. What registering it buys is everything around the
 * key. An Apollo tile on the Sources picker, a place for the workspace to store
 * the API key in the encrypted vault, a slug an agent carries in
 * `connectorSources`, and — through `inspect` — a Test connection button that
 * reports what this account's Apollo plan actually opens.
 *
 * `syncless: true` is why the row shows Test connection where a syncing source
 * shows Sync now. A Sync button that did nothing would read as a broken source.
 *
 * The entitlement probe below is the reason this ticket could be built without
 * an Apollo key in hand. Three facts the tool surface depends on (is company
 * search open on this plan, is this a master key, what are the real rate-limit
 * header names) are unknowable from documentation alone, so whoever holds the
 * key establishes them from a browser, against prod, for one credit.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { APOLLO_BASE_URL, createApolloClient, keyFromCredentials } from '@/libs/apollo/client';
import { InspectInputError } from './inspect';

const apolloConfigSchema = z.object({
  /** API host override, for a sandbox or a test double. */
  baseUrl: z.string().url().default(APOLLO_BASE_URL),
});

/**
 * The single credit the probe spends, stated in the dialog before the button
 * is pressed. Company search is billed per page and there is no free way to
 * ask whether the plan opens it.
 */
export const APOLLO_PROBE_CREDIT_COST = 1;

/**
 * One check's verdict, written for whoever pressed the button.
 * @param key - Stable key for the check.
 * @param label - What it establishes.
 * @param ok - Whether it passed.
 * @param detail - What was observed, including the vendor's own message.
 */
function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * Run the five-check entitlement probe against one Apollo key.
 *
 * Deliberately NOT probed: enrichment. A match call spends a credit to reveal
 * a real person's contact details, and a synthetic payload proves nothing
 * about entitlement that the auth check has not already proven.
 * @param input - The key to probe with, and the API host to probe against.
 * @param input.apiKey - The Apollo API key, as typed or as vaulted.
 * @param input.baseUrl - API host override.
 */
export async function inspectApolloKey(input: { apiKey: string; baseUrl?: string }): Promise<ConnectorInspection> {
  const client = createApolloClient({ apiKey: input.apiKey, baseUrl: input.baseUrl });
  const checks: ConnectorCheck[] = [];

  // One call answers the first two checks: whether Apollo knows the key, and
  // whether the api_search path is open. The legacy people-search path 403s on
  // lower tiers, which is why only this one is ever used.
  const people = await client.post<{ pagination?: { total_entries?: number } }>(
    '/api/v1/mixed_people/api_search',
    { page: 1, per_page: 1 },
  );
  const keyRejected = !people.ok && people.error === 'apollo_unauthorized' && people.status === 401;
  const unreachable = !people.ok && people.error === 'apollo_error' && people.status === 0;

  checks.push(check(
    'auth',
    'API key accepted',
    !keyRejected && !unreachable,
    people.ok
      ? 'Apollo accepted the key.'
      : (people as { message: string }).message,
  ));
  checks.push(check(
    'people_search',
    'People search (0 credits)',
    people.ok,
    people.ok
      ? `The api_search path is open on this plan. ${people.data.pagination?.total_entries ?? 'An unstated number of'} people match an unfiltered search.`
      : (people as { message: string }).message,
  ));

  // The one credit. Company search is paid-tier only and there is no free way
  // to ask, so a 403 here is a plan fact that two Apollo tools are written to
  // degrade into.
  const companies = await client.post('/api/v1/mixed_companies/search', { page: 1, per_page: 1 });
  checks.push(check(
    'company_search',
    `Company search (spends ${APOLLO_PROBE_CREDIT_COST} credit)`,
    companies.ok,
    companies.ok
      ? 'Paid tier: apollo_search_companies works, at 1 credit per page.'
      : (companies as { message: string }).message,
  ));

  // 200 means a master key and apollo_usage runs live; 403 means it reports
  // from the rate-limit headers instead, and says so.
  const usage = await client.get('/api/v1/usage_stats/api_usage_stats');
  checks.push(check(
    'usage_stats',
    'Usage stats (master key only)',
    usage.ok,
    usage.ok
      ? 'This is a master key, so apollo_usage reports live per-endpoint quota.'
      : `${(usage as { message: string }).message} apollo_usage will report from the rate-limit headers observed on the last call instead.`,
  ));

  // The header names Apollo actually returned, echoed verbatim: the client
  // reads them leniently until a live response confirms which ones exist.
  const snapshot = client.lastRateSnapshot();
  const headerNames = Object.keys(snapshot?.headers ?? {});
  checks.push(check(
    'rate_limit_headers',
    'Rate-limit headers observed',
    headerNames.length > 0,
    headerNames.length > 0
      ? `Apollo returned: ${headerNames.join(', ')}. These are what apollo_usage falls back on.`
      : 'No rate-limit headers were returned on any of the calls above, so apollo_usage can only report live quota (and only with a master key).',
  ));

  const authorized = !keyRejected && !unreachable;
  return {
    reachable: !unreachable,
    authorized,
    checks,
    note: authorized
      ? 'Nothing was saved by this test: no source row, no credential, no vault write. The key was used for these calls and dropped.'
      : null,
    error: unreachable ? (people as { message: string }).message : null,
  };
}

export const apolloConnector: SourceConnector<typeof apolloConfigSchema> = {
  slug: 'apollo',
  name: 'Apollo',
  description: 'Prospecting and contact enrichment, queried live. Net-new people and company search, verified work emails, and saved lists as a staging area.',
  icon: 'Radar',
  authKind: 'apikey',
  syncless: true,
  configSchema: apolloConfigSchema,
  inspectNote: `Runs five checks against Apollo and reports what this key opens. It spends ${APOLLO_PROBE_CREDIT_COST} Apollo credit, on the company-search check; the other four are free. Nothing is saved.`,

  async inspect({ config, credentials }) {
    const apiKey = keyFromCredentials(credentials);
    if (!apiKey) {
      throw new InspectInputError('An Apollo API key is required. Find it in Apollo under Settings → Integrations → API.');
    }
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim() !== ''
      ? config.baseUrl.trim()
      : undefined;
    return inspectApolloKey({ apiKey, baseUrl });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // Apollo is read live by the agent tools, never mirrored. Yielding nothing
    // keeps the connector contract intact without a document store that would
    // go stale the moment it was written.
  },
};
