/**
 * `/rpc/sources` — list + create source connectors.
 *
 *   GET  → { sources, connectors }
 *           - `sources`: this org's configured rows, each with its latest sync run
 *           - `connectors`: built-in picker tiles (web, drive, ...)
 *   POST → create a new source row from { kind, slug?, configJson, startSyncing? }
 *           (admins only); it starts syncing unless `startSyncing` is false.
 *
 * The Sources page reads `GET` to populate the table; the
 * Add-Source dialog posts here.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { grantSummaryForSource } from '@/libs/connect/summary';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { startSourceSyncing } from '@/services/connect/newSourceSync';
import { credentialStatusForOrg } from '@/services/SourceCredentialService';
import { addSource, chunkCountsForOrg, documentCountsForOrg, latestSyncStateForOrg, listSources } from '@/services/SourceSyncService';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sources = await listSources(orgId);
  const credStatus = await credentialStatusForOrg(orgId);
  const docCounts = await documentCountsForOrg(orgId);
  const chunkCounts = await chunkCountsForOrg(orgId);
  const syncState = await latestSyncStateForOrg(orgId);
  const connectorBySlug = new Map(listConnectors().map(c => [c.slug, c]));
  // Decorate each source with its connector's auth requirement, whether a live
  // credential is stored, the object type it pulls, and how many documents it
  // has ingested — so the Sources page shows what each connector actually
  // pulled without a second round-trip. `authKind: 'none'` (e.g. web) needs no credential.
  const withStatus = await Promise.all(sources.map(async (s) => {
    const connectorSlug = (s.config?._connector as string | undefined) ?? s.slug;
    const authKind = connectorBySlug.get(connectorSlug)?.authKind ?? 'none';
    // This row's own stored credential first, then the org's OAuth grant for
    // the connector. A connector naming a credential is the only one whose
    // status is per-row; a grant's status is the same for every row of a kind.
    const st = credStatus.bySourceId[s.id] ?? credStatus.byConnectorSlug[connectorSlug];
    const connected = authKind === 'none' ? true : (st?.connected ?? false);
    // Whose account the grant is on and what it granted, by name — only for a
    // row a vendor flow connected, and only once it is connected. The card
    // shows it so a listed repository the installation never covered is
    // visible without a Test connection.
    const grant = authKind === 'oauth' && connected
      ? await grantSummaryForSource({ orgId, sourceSlug: s.slug, connectorSlug })
      : null;
    return {
      ...s,
      authKind,
      objectType: (s.config?.objectType as string | undefined) ?? null,
      documentCount: docCounts[s.id] ?? 0,
      // Size in retrieval terms: a document count says little when one PDF is
      // 400 chunks. Shown in the connected row's detail.
      chunkCount: chunkCounts[s.id] ?? 0,
      credentialConnected: connected,
      credentialUpdatedAt: st?.updatedAt ?? null,
      grant,
      // Why a credential cannot be used, when there is one that cannot. The
      // page needs this to tell "nobody has connected this yet" apart from
      // "somebody revoked the key this connector points at".
      credentialBroken: st?.broken ?? null,
      // The stored-credential platform this connector authenticates with, or
      // null when it uses an OAuth grant or needs no credential. Setup offers
      // the workspace's existing credentials for this platform.
      credentialPlatform: platformForConnectorSlug(connectorSlug)?.id ?? null,
      // A sync-less source has no run to start, so its row offers Test
      // connection where a syncing source offers Sync now. `inspectable` says
      // whether there is anything for that button to call.
      syncless: connectorBySlug.get(connectorSlug)?.syncless === true,
      inspectable: typeof connectorBySlug.get(connectorSlug)?.inspect === 'function',
      inspectNote: connectorBySlug.get(connectorSlug)?.inspectNote ?? null,
      // The last run's state, so the page can show a sync it did not start —
      // another tab's, the scheduler's, or one still going after a reload.
      sync: syncState[s.id] ?? null,
    };
  }));
  const connectors = listConnectors().map(c => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    authKind: c.authKind,
    credentialPlatform: platformForConnectorSlug(c.slug)?.id ?? null,
    syncless: c.syncless === true,
    inspectable: typeof c.inspect === 'function',
    // The scopes the third party must grant, when the connector knows them —
    // the page marks the ones a failed run named as missing.
    requiredScopes: c.requiredScopes ? [...c.requiredScopes] : null,
  }));
  return Response.json({ sources: withStatus, connectors });
}

export async function POST(req: Request) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // A new source reads a vendor's data into the workspace and syncs it every
  // hour, so adding one is an admin's call, as it is on every other way in
  // (the login, the chat card, the credential form).
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can add a source' }, { status: 403 });
  }
  let body: {
    kind?: string;
    slug?: string;
    configJson?: Record<string, unknown>;
    /**
     * False when the caller stores the source's credential next: the first
     * sync then waits for it (`POST /rpc/sources/:id/start-syncing`) instead
     * of starting with no credential and being skipped.
     */
    startSyncing?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }
  if (!body.kind || !body.configJson) {
    return Response.json({ error: 'Missing kind or configJson' }, { status: 400 });
  }
  try {
    const created = await addSource({
      orgId,
      kind: body.kind,
      slug: body.slug,
      configJson: body.configJson,
    });
    if (body.startSyncing === false) {
      return Response.json({ source: created, firstSync: null });
    }
    // Like a source saved by logging in, it gets its schedules and starts reading now.
    const firstSync = await startSourceSyncing({ orgId, sourceId: created.id, sourceSlug: created.slug, connectorSlug: body.kind });
    return Response.json({ source: created, firstSync });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
