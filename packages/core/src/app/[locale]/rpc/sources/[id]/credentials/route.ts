/**
 * POST /rpc/sources/[id]/credentials — store connector credentials in the vault.
 *
 * Body: `{ credentials: {...} }` — connector-specific keys, driven by
 * `CRED_FIELDS[connectorSlug].fields` (most connectors read a single
 * `token`; google-ads also needs `developerToken`; zoom needs
 * `accountId`/`clientId`/`clientSecret`; jira needs `email`/`apiToken`).
 * The plaintext is AES-GCM encrypted at rest; only ciphertext + dek id hit
 * the DB.
 *
 * Resolves the source slug from the knowledge_source id, ensures a
 * `source_install` exists, and stores the credential against it. Admin-only.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { validateCredentialSubmission } from '@/libs/sources/credentialFields';
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

  const source = await getSourceById(orgId, sourceId);
  if (!source) {
    return Response.json({ error: 'Source not found' }, { status: 404 });
  }
  const connectorSlug = (source.config?._connector as string | undefined) ?? source.slug;

  const { trimmed, missingKey } = validateCredentialSubmission(connectorSlug, body.credentials ?? {});
  if (missingKey) {
    return Response.json({ error: `"${missingKey}" is required` }, { status: 400 });
  }

  try {
    const { credentialId } = await storeCredentialForSource({
      orgId,
      sourceSlug: connectorSlug,
      raw: { ...body.credentials, ...trimmed },
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
