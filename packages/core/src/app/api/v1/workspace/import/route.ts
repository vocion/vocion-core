import { NextResponse } from 'next/server';
import { ARCHIVE_LIMITS, WorkspaceArchiveError } from '@/libs/workspace/archive';
import { applyImport, previewImport, WorkspaceImportError } from '@/services/workspace/WorkspaceImportService';
import { authApi, isErrorResponse, jsonError, requireWorkspaceAdmin } from '../../_shared';

/** Room for the form's other fields and boundaries around the zip. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * POST /api/v1/workspace/import — review an exported workspace against this
 * one, then apply it.
 *
 * A `multipart/form-data` body:
 *
 * - `file` — the zip: an export from `GET /api/v1/workspace/export`, or a
 *   workspace folder zipped (the folder holding `workspace.yaml`, or that
 *   folder's contents).
 * - `replace` — `true` makes the upload the whole workspace: an agent,
 *   mission, automation or workflow it does not ship is retired, and its
 *   trust rules and settings replace these. Omitted, the upload is merged:
 *   what it names is created or updated and nothing it leaves out changes.
 * - `apply` — omitted, nothing is written and the answer is the diff: per
 *   kind, and per resource by name, what would be created, updated or
 *   retired, with the `sha` of what was staged. `true` applies it.
 * - `sha` — required with `apply`: the sha the review answered. When this
 *   workspace changed since, the answer is 409 and nothing is applied.
 *
 * A workspace applied from a folder on this host, or from git by a deploy,
 * would have an import undone by its next apply: the review says so in
 * `blockedBy`, and an apply answers 409.
 *
 * Workspace admins only.
 * @param req - Request.
 */
export async function POST(req: Request) {
  const caller = await authApi(req);
  if (isErrorResponse(caller)) {
    return caller;
  }
  const denied = requireWorkspaceAdmin(caller, 'import a workspace');
  if (denied) {
    return denied;
  }
  // Refused before the body is read: parsing a form buffers all of it.
  const length = Number(req.headers.get('content-length') ?? 0);
  if (length > ARCHIVE_LIMITS.maxArchiveBytes + MULTIPART_OVERHEAD_BYTES) {
    return jsonError('PAYLOAD_TOO_LARGE', `A workspace import may be up to ${ARCHIVE_LIMITS.maxArchiveBytes / (1024 * 1024)} MB.`, 413);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('VALIDATION_FAILED', 'Send the zip as multipart/form-data, in a field named file.', 400);
  }
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return jsonError('VALIDATION_FAILED', 'Send the zip as multipart/form-data, in a field named file.', 400);
  }
  if (file.size > ARCHIVE_LIMITS.maxArchiveBytes) {
    return jsonError('PAYLOAD_TOO_LARGE', `A workspace import may be up to ${ARCHIVE_LIMITS.maxArchiveBytes / (1024 * 1024)} MB.`, 413);
  }
  const replace = form.get('replace') === 'true';
  const apply = form.get('apply') === 'true';
  const sha = form.get('sha');
  if (apply && (typeof sha !== 'string' || sha.length === 0)) {
    return jsonError('VALIDATION_FAILED', 'apply needs the sha the review answered, so what lands is what was reviewed.', 400);
  }
  const upload = new Uint8Array(await file.arrayBuffer());
  try {
    if (!apply) {
      return NextResponse.json(await previewImport(caller.orgId, upload, { replace }));
    }
    const result = await applyImport(caller.orgId, upload, { replace, sha: sha as string, appliedBy: `workspace.import:${caller.actorId}` });
    return NextResponse.json(result);
  } catch (error) {
    return workspaceImportErrorResponse(error);
  }
}

/**
 * An import's refusal as the standard envelope; anything else is rethrown.
 * @param error - What the import threw.
 */
function workspaceImportErrorResponse(error: unknown): NextResponse {
  if (error instanceof WorkspaceArchiveError) {
    return error.code === 'TOO_LARGE'
      ? jsonError('PAYLOAD_TOO_LARGE', error.message, 413)
      : jsonError('VALIDATION_FAILED', error.message, 400);
  }
  if (error instanceof WorkspaceImportError) {
    switch (error.code) {
      case 'INVALID': return jsonError('VALIDATION_FAILED', error.message, 422);
      case 'BLOCKED': return jsonError('IMPORT_BLOCKED', error.message, 409);
      case 'CHANGED': return jsonError('CONFLICT', error.message, 409);
      case 'BUSY': return jsonError('CONFLICT', error.message, 409);
    }
  }
  throw error;
}
