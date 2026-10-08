/**
 * VERIFY A CONNECTION before the walk-through moves on ("Connect your
 * systems"): a test call, then the first sync's preview — "Found 1,284 deals".
 *
 * The test call is the connector's own `inspect`, run against the stored
 * credential (the vault's, never one the browser sends back), when the
 * connector declares one. The preview is the source's first sync as it lands:
 * the documents it has stored, counted in the noun the connector declares
 * (`recordNoun`, documents otherwise). A sync still reading answers `reading`
 * with the count so far, and the flow keeps going rather than waiting on it —
 * it finishes in the background (principle 13).
 *
 * Everything is keyed on the one workspace. Nothing the vendor or the vault
 * produced is logged or returned verbatim except the person-worded reasons the
 * connectors already write for the Connectors page.
 */

import type { ConnectVerification } from '@/libs/connect/systemsPlan';
import { scriptedVerification } from '@/libs/connect/scripted';
import { foundLine } from '@/libs/connect/systemsPlan';
import { logger } from '@/libs/Logger';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { isConnectorInspection } from '@/libs/sources/inspect';
import { getConnector } from '@/libs/sources/registry';
import { getCredentialsForConnector, storedCredentialIdForSource } from '@/services/SourceCredentialService';
import { documentCountsForOrg, latestSyncStateForOrg, listSources } from '@/services/SourceSyncService';
import { connectorHasLiveSource } from './createSourceOnLogin';

const DOCUMENTS = { one: 'document', other: 'documents' };

/**
 * The noun a connector's documents are counted in.
 * @param connector - Connector slug.
 * @param config - The source's config.
 */
function nounFor(connector: string, config: Record<string, unknown>): { one: string; other: string } {
  try {
    return getConnector(connector)?.recordNoun?.(config) ?? DOCUMENTS;
  } catch {
    return DOCUMENTS;
  }
}

/**
 * The connector's own test call against the stored credential, or null when
 * it declares none. A failed check is the verification's failure.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 * @param source - The source to test.
 * @param source.id - Its id.
 * @param source.config - Its config.
 */
async function testCall(orgId: string, connector: string, source: { id: number; config: Record<string, unknown> }): Promise<{ ok: true; checks: string[] } | { ok: false; reason: string } | null> {
  const known = getConnector(connector);
  if (!known?.inspect) {
    return null;
  }
  try {
    const apiTokenId = await storedCredentialIdForSource(orgId, source.id);
    const credentials = await getCredentialsForConnector({ orgId, connectorSlug: connector, apiTokenId });
    if (!credentials) {
      return { ok: false, reason: 'No login or key is stored for it.' };
    }
    const result = await known.inspect({ config: source.config, credentials, options: {}, savedSource: { orgId, sourceId: source.id } });
    if (!isConnectorInspection(result)) {
      return { ok: true, checks: [] };
    }
    if (result.error || !result.reachable || !result.authorized) {
      const failed = result.checks.find(c => !c.ok);
      return { ok: false, reason: result.error ?? failed?.detail ?? failed?.label ?? 'The test call was refused.' };
    }
    return { ok: true, checks: result.checks.filter(c => c.ok).map(c => c.label) };
  } catch (error) {
    // The cause stays in the log, by name only; the person gets a sentence.
    logger.warn('connect-systems: the test call failed', { orgId, connector, errorName: error instanceof Error ? error.name : typeof error });
    return { ok: false, reason: 'The test call did not answer. Try again in a moment.' };
  }
}

/**
 * Whether the newest source of this connector works, and what its first sync found.
 * @param orgId - The workspace.
 * @param connector - Connector slug.
 */
export async function verifyConnection(orgId: string, connector: string): Promise<ConnectVerification> {
  const sources = (await listSources(orgId)).filter(s => connectorOfSource(s) === connector);
  const source = sources.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const name = getConnector(connector)?.name ?? connector;
  if (!source) {
    return { state: 'missing', reason: `${name} has no source in this workspace yet.` };
  }
  if (!(await connectorHasLiveSource(orgId, connector))) {
    return { state: 'failed', reason: `${name} has no live login or key: it was revoked or has expired.` };
  }
  const noun = nounFor(connector, source.config);
  const scripted = scriptedVerification(connector);
  if (scripted) {
    return scripted.ok ? { state: 'verified', preview: foundLine(scripted.count, noun), checks: scripted.checks } : { state: 'failed', reason: scripted.reason };
  }
  const test = await testCall(orgId, connector, source);
  if (test && !test.ok) {
    return { state: 'failed', reason: test.reason };
  }
  const checks = test?.checks ?? [];
  if (getConnector(connector)?.syncless) {
    return { state: 'verified', preview: null, checks };
  }
  const [runs, counts] = await Promise.all([latestSyncStateForOrg(orgId), documentCountsForOrg(orgId)]);
  const run = runs[source.id];
  const count = counts[source.id] ?? 0;
  if (!run || run.status === 'running') {
    return { state: 'reading', preview: count > 0 ? foundLine(count, noun) : null };
  }
  if (run.status === 'failed') {
    return { state: 'failed', reason: run.error ?? 'Its first sync failed.' };
  }
  return { state: 'verified', preview: foundLine(count, noun), checks };
}
