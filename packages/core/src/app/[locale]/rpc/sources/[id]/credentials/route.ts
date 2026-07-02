/**
 * POST /rpc/sources/[id]/credentials — store connector credentials in the vault.
 *
 * Body: `{ credentials: { token: string, ... } }` — connector-specific keys
 * (all RevOps connectors read `credentials.token`; googleAds also takes a
 * `developerToken`, ga4/drive/gmail take an OAuth access `token`). The plaintext
 * is AES-GCM encrypted at rest; only ciphertext + dek id hit the DB.
 *
 * Resolves the source slug from the knowledge_source id, ensures a
 * `source_install` exists, and stores the credential against it. Admin-only.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { storeCredentialForSource } from '@/services/SourceCredentialService';
import { getSourceById } from '@/services/SourceSyncService';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; locale: string }> },
) {
  const { orgId, userId, role } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (role !== 'admin') {
    return Response.json({ error: 'Only admins can set source credentials' }, { status: 403 });
  }

  const { id } = await ctx.params;
  const sourceId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceId)) {
    return Response.json({ error: 'Bad source id' }, { status: 400 });
  }

  let body: { credentials?: Record<string, unknown>; displayName?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const creds = body.credentials ?? {};
  const token = typeof creds.token === 'string' ? creds.token.trim() : '';
  if (!token) {
    return Response.json({ error: 'A token is required' }, { status: 400 });
  }

  const source = await getSourceById(orgId, sourceId);
  if (!source) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;

  try {
    const { credentialId } = await storeCredentialForSource({
      orgId,
      sourceSlug: connectorSlug,
      raw: { ...creds, token },
      displayName: body.displayName,
      userId,
      projectId: orgId,
    });
    return Response.json({ ok: true, credentialId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
