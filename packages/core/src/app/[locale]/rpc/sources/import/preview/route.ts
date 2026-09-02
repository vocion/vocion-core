/**
 * `/rpc/sources/import/preview` — say what a CSV would create, and write nothing.
 *
 *   POST { kind, csv } → { preview: { rows, summary } } | { error }
 *
 * Separate from the commit route so the dialog can show a per-row verdict
 * before the operator agrees to anything. Running this twice on the same file
 * gives the same answer and leaves the org untouched.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { previewSourceImportForOrg } from '@/services/SourceImportService';
import { readImportRequest } from '../requestBody';

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const request = await readImportRequest(req);
  if (request.error) {
    return Response.json({ error: request.error }, { status: 400 });
  }

  const result = await previewSourceImportForOrg({
    orgId,
    kind: request.kind,
    csvText: request.csvText,
  });
  if (result.error) {
    return Response.json({ error: result.error }, { status: 400 });
  }
  return Response.json({ preview: result.preview });
}
