/**
 * `/rpc/sources` — list + create source connectors.
 *
 *   GET  → { sources, connectors }
 *           - `sources`: this org's configured rows, each with its latest sync run
 *           - `connectors`: built-in picker tiles (web, drive, ...)
 *   POST → create a new source row from { kind, slug?, configJson }.
 *
 * The Sources page reads `GET` to populate the table; the
 * Add-Source dialog posts here.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { platformForConnectorSlug } from '@/libs/platforms/registry';
import { listConnectors } from '@/libs/sources/registry';
import { credentialStatusForOrg } from '@/services/SourceCredentialService';
import { addSource, documentCountsForOrg, latestSyncStateForOrg, listSources } from '@/services/SourceSyncService';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sources = await listSources(orgId);
  const credStatus = await credentialStatusForOrg(orgId);
  const docCounts = await documentCountsForOrg(orgId);
  const syncState = await latestSyncStateForOrg(orgId);
  const connectorBySlug = new Map(listConnectors().map(c => [c.slug, c]));
  // Decorate each source with its connector's auth requirement, whether a live
  // credential is stored, the object type it pulls, and how many documents it
  // has ingested — so the Sources page shows what each connector actually
  // pulled without a second round-trip. `authKind: 'none'` (e.g. web) needs no credential.
  const withStatus = sources.map((s) => {
    const connectorSlug = (s.config?._connector as string | undefined) ?? s.slug;
    const authKind = connectorBySlug.get(connectorSlug)?.authKind ?? 'none';
    const st = credStatus[connectorSlug];
    return {
      ...s,
      authKind,
      objectType: (s.config?.objectType as string | undefined) ?? null,
      documentCount: docCounts[s.id] ?? 0,
      credentialConnected: authKind === 'none' ? true : (st?.connected ?? false),
      credentialUpdatedAt: st?.updatedAt ?? null,
      // Why a credential cannot be used, when there is one that cannot. The
      // page needs this to tell "nobody has connected this yet" apart from
      // "somebody revoked the key this connector points at".
      credentialBroken: st?.broken ?? null,
      // The stored-credential platform this connector authenticates with, or
      // null when it uses an OAuth grant or needs no credential. Setup offers
      // the workspace's existing credentials for this platform.
      credentialPlatform: platformForConnectorSlug(connectorSlug)?.id ?? null,
      // The last run's state, so the page can show a sync it did not start —
      // another tab's, the scheduler's, or one still going after a reload.
      sync: syncState[s.id] ?? null,
    };
  });
  const connectors = listConnectors().map(c => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    authKind: c.authKind,
    credentialPlatform: platformForConnectorSlug(c.slug)?.id ?? null,
  }));
  return Response.json({ sources: withStatus, connectors });
}

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { kind?: string; slug?: string; configJson?: Record<string, unknown> };
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
    return Response.json({ source: created });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 400 });
  }
}
