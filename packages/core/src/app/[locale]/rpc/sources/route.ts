/**
 * `/rpc/sources` — list + create source connectors.
 *
 *   GET  → { sources, connectors }
 *           - `sources`: this org's configured rows
 *           - `connectors`: built-in picker tiles (web, drive, ...)
 *   POST → create a new source row from { kind, slug?, configJson }.
 *
 * The Sources page reads `GET` to populate the table; the
 * Add-Source dialog posts here.
 */

import { auth } from '@clerk/nextjs/server';
import { listConnectors } from '@/libs/sources/registry';
import { addSource, listSources } from '@/services/SourceSyncService';

export async function GET() {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const sources = await listSources(orgId);
  const connectors = listConnectors().map(c => ({
    slug: c.slug,
    name: c.name,
    description: c.description,
    icon: c.icon,
    authKind: c.authKind,
  }));
  return Response.json({ sources, connectors });
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
