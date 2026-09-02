/**
 * `/rpc/sources/import` — create many sources from an uploaded CSV.
 *
 *   POST { kind, csv } → { created, preview } | { error }
 *
 * The file is re-read and re-judged here rather than trusting the verdicts the
 * preview handed the browser, so the only thing a caller controls is the file.
 * Rows that are not importable are reported back untouched alongside the ones
 * that were created — a partial outcome is always visible, never silent.
 */

import { clerkAuth as auth } from '@/libs/Auth';
import { commitSourceImportForOrg } from '@/services/SourceImportService';
import { SourceSlugTakenError } from '@/services/SourceSyncService';
import { readImportRequest } from './requestBody';

export async function POST(req: Request) {
  const { orgId } = await auth();
  if (!orgId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const request = await readImportRequest(req);
  if (request.error) {
    return Response.json({ error: request.error }, { status: 400 });
  }

  try {
    const result = await commitSourceImportForOrg({
      orgId,
      kind: request.kind,
      csvText: request.csvText,
    });
    if (result.error) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ created: result.created, preview: result.preview });
  } catch (error) {
    // A slug taken between the preview and the write — another tab, or a
    // second import of the same file racing this one. Nothing was created.
    if (error instanceof SourceSlugTakenError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 400 });
  }
}
