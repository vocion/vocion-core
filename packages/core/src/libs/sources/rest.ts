/**
 * REST connector — any bearer-token REST API, queried live, with the
 * endpoints declared by the workspace rather than by this file.
 *
 * Built for a delivery-team workspace that needed live reads and gated writes
 * against its own internal API, and generalised on the way in: the paths, the
 * arguments and the review wording all live in `sources/<slug>.yaml`
 * (`libs/rest/spec.ts`), so every install with an internal API gets the same
 * mechanism and nothing customer-shaped enters core. Each `tools[]` entry
 * becomes one live read tool (`services/agents/tools/restDirect.ts`); each
 * `actions[]` entry is a write reachable only through the `rest.request`
 * action (`libs/actions/rest.ts`), which rides the review queue and the trust
 * ladder like every other connector write.
 *
 * Like Apollo, this connector ingests nothing: there is no roster to mirror
 * and no embedding to keep fresh. Registering it buys the tile on the
 * Connectors page, a place in the vault for the base URL and bearer token
 * (the `rest` credential platform), a slug an agent carries in
 * `connectorSources`, and — through `inspect` — a Test connection button
 * that GETs the declared `healthPath` and reports what came back.
 *
 * `syncless: true` is why the row shows Test connection where a syncing
 * source shows Sync now.
 */

import type { ConnectorCheck, ConnectorInspection } from './inspect';
import type { SourceConnector, SourceContext } from './types';
import type { RestCredentials } from '@/libs/rest/client';
import type { IngestDoc } from '@/services/IngestionService';
import { restCall, restCredentialsOf } from '@/libs/rest/client';
import { restConfigSchema, toolPrefixFor } from '@/libs/rest/spec';
import { InspectInputError } from './inspect';

/**
 * One check's verdict, written for whoever pressed the button.
 * @param key - Stable key for the check.
 * @param label - What it establishes.
 * @param ok - Whether it passed.
 * @param detail - What was observed.
 */
function check(key: string, label: string, ok: boolean, detail: string | null): ConnectorCheck {
  return { key, label, ok, detail };
}

/**
 * GET the health path with the token and report what came back — reachable,
 * accepted, and what the source declares. Nothing is saved.
 * @param input - The credential and the config as typed or as vaulted.
 * @param input.credentials - Base URL and bearer token.
 * @param input.config - The source config, for `healthPath` and the endpoint counts.
 */
export async function inspectRestApi(input: { credentials: RestCredentials; config: Record<string, unknown> }): Promise<ConnectorInspection> {
  const parsed = restConfigSchema.safeParse(input.config);
  const healthPath = parsed.success ? parsed.data.healthPath : '/';
  const result = await restCall({ credentials: input.credentials, method: 'GET', path: healthPath });
  const unreachable = !result.ok && (result.error === 'timeout' || result.error === 'network_error');
  const rejected = !result.ok && (result.error === 'http_401' || result.error === 'http_403');
  const checks: ConnectorCheck[] = [
    check('reachable', `GET ${healthPath} answers`, !unreachable, result.ok ? `Answered ${result.status}.` : result.message),
    check('auth', 'Bearer token accepted', !unreachable && !rejected, rejected ? result.message : (result.ok ? 'The API accepted the token.' : (unreachable ? 'Not established — the API did not answer.' : `The API answered ${(result as { status: number | null }).status ?? 'no status'} — not a token refusal, but check the health path.`))),
  ];
  if (parsed.success) {
    // The prefix is the slug unless the config says otherwise, and no row
    // exists yet when the dialog tests — so only a declared prefix is named.
    const prefix = parsed.data.toolPrefix ? `${toolPrefixFor('', parsed.data)}_` : '<slug>_';
    checks.push(check(
      'declared',
      'Endpoints declared',
      true,
      `${parsed.data.tools.length} read tool${parsed.data.tools.length === 1 ? '' : 's'} (${prefix}…) and ${parsed.data.actions.length} write action${parsed.data.actions.length === 1 ? '' : 's'} (through rest.request).`,
    ));
  } else {
    checks.push(check('declared', 'Endpoints declared', false, 'The stored config does not parse — re-apply the workspace and read the errors it reports.'));
  }
  return {
    reachable: !unreachable,
    authorized: !unreachable && !rejected,
    checks,
    note: unreachable ? null : 'Nothing was saved by this test: the token was used for one GET and dropped.',
    error: unreachable ? result.message : null,
  };
}

export const restConnector: SourceConnector<typeof restConfigSchema> = {
  slug: 'rest',
  name: 'REST API',
  description: 'Any REST API with a bearer token, queried live. Read endpoints declared in the source become agent tools; write endpoints become proposals on the review queue.',
  icon: 'Plug',
  authKind: 'apikey',
  syncless: true,
  configSchema: restConfigSchema,
  inspectNote: 'Sends one GET to the health path with the token and reports the status. Nothing is saved.',

  async inspect({ config, credentials }) {
    const resolved = restCredentialsOf(credentials);
    if (!resolved) {
      throw new InspectInputError('A base URL starting with http:// or https:// and a bearer token are required.');
    }
    return inspectRestApi({ credentials: resolved, config });
  },

  async* sync(_ctx: SourceContext): AsyncIterable<IngestDoc> {
    // A REST source is read live by the agent tools, never mirrored. Yielding
    // nothing keeps the connector contract intact without a document store
    // that would go stale the moment it was written.
  },
};
