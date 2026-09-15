/**
 * POST /rpc/connectors/[slug]/inspect — look at a third-party service with
 * candidate connection details, and report what they open.
 *
 * Body is one of:
 *   `{ config, credentials, ...options }` — values as typed, before any source
 *     row or credential exists. Strapi's Add-source dialog sends its
 *     `collections` list this way; Apollo's Connect dialog sends the key.
 *   `{ sourceId }` — re-test a source that is already connected, using the
 *     credential in the vault. Nothing is re-pasted, so prod can be verified
 *     again after a key rotation or a plan change.
 *
 * The connector decides what an inspection is: the route dispatches to its
 * optional `inspect` hook and passes the result back verbatim, so Strapi keeps
 * its collection pick-list payload while every other connector gets the generic
 * checklist. A connector declaring no hook answers 501, and its dialog falls
 * back to its plain form.
 *
 * Nothing is persisted either way — no source row, no credential, no vault
 * write. The credential is used for the outbound requests and dropped.
 * Admin-only, because it takes a credential and makes the server talk to an
 * arbitrary host.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { InspectInputError } from '@/libs/sources/inspect';
import { getConnector } from '@/libs/sources/registry';
import { getCredentialsForConnector, storedCredentialIdForSource } from '@/services/SourceCredentialService';
import { getSourceById } from '@/services/SourceSyncService';

/** Body keys the route reads itself; everything else is the connector's. */
const ROUTE_KEYS = new Set(['config', 'credentials', 'sourceId']);

export async function POST(
  req: Request,
  ctx: { params: Promise<{ slug: string; locale: string }> },
) {
  const { orgId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can inspect a connector instance' }, { status: 403 });
  }

  const { slug } = await ctx.params;
  const connector = getConnector(slug);
  if (!connector) {
    return Response.json({ error: `Unknown connector: ${slug}` }, { status: 404 });
  }
  if (!connector.inspect) {
    return Response.json({ error: `${slug} does not support inspection` }, { status: 501 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  let config = asRecord(body.config);
  let credentials = asRecord(body.credentials);

  // Re-test path: the credential comes out of the vault rather than the form,
  // so an already-connected source is verified with no re-paste.
  if (body.sourceId !== undefined) {
    const sourceId = Number(body.sourceId);
    if (!Number.isInteger(sourceId)) {
      return Response.json({ error: 'Bad source id' }, { status: 400 });
    }
    const source = await getSourceById(orgId, sourceId);
    if (!source) {
      return Response.json({ error: 'Source not found' }, { status: 404 });
    }
    const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;
    if (connectorSlug !== slug) {
      return Response.json({ error: `That source is a ${connectorSlug} connector, not ${slug}` }, { status: 400 });
    }
    const apiTokenId = await storedCredentialIdForSource(orgId, sourceId);
    let vaulted: Record<string, unknown> | undefined;
    try {
      vaulted = await getCredentialsForConnector({ orgId, connectorSlug, apiTokenId });
    } catch (err) {
      // A credential the source points at but cannot use has its own message,
      // and it is exactly what this test exists to surface.
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
    }
    if (!vaulted) {
      return Response.json({ error: 'No credential is stored for this source yet. Connect it first, then test it.' }, { status: 400 });
    }
    config = { ...source.config, ...config };
    credentials = { ...vaulted, ...credentials };
  }

  const options: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!ROUTE_KEYS.has(key)) {
      options[key] = value;
    }
  }

  try {
    const inspection = await connector.inspect({ config, credentials, options });
    return Response.json({ inspection });
  } catch (err) {
    // Input the connector cannot work with is the operator's to fix, and its
    // message is written for them; anything else is the instance failing.
    if (err instanceof InspectInputError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 502 });
  }
}

/**
 * One body field as a plain record, ignoring anything that is not an object.
 * @param value - The raw field.
 */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
