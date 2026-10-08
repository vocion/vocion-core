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
 *   retired — settings, trust rules and stored files included — with the
 *   review's `sha`. `true` applies it.
 * - `sha` — required with `apply`: the sha the review answered, which covers
 *   every file uploaded and every change listed. When either moved since —
 *   another upload, or this workspace changed — the answer is 409 and nothing
 *   is applied.
 *
 * A workspace applied from a folder on this host, or from git by a deploy,
 * would have an import undone by its next apply: the review says so in
 * `blockedBy`, and an apply answers 409. A field no admin can set in the app —
 * an agent placed on AgentCore, a connector pointed at the server's disk — is
 * named in `refused`, and an apply answers 422.
 *
 * The body may be up to 25 MB and the form around it; a larger one is refused
 * as it streams in, whether or not it says its length.
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
  // Refused before the form is parsed, which buffers all of it: at once by a
  // length the request declares, and otherwise as it streams in (a chunked
  // request declares none).
  const tooLarge = () => jsonError('PAYLOAD_TOO_LARGE', `A workspace import may be up to ${ARCHIVE_LIMITS.maxArchiveBytes / (1024 * 1024)} MB.`, 413);
  const maxBody = ARCHIVE_LIMITS.maxArchiveBytes + MULTIPART_OVERHEAD_BYTES;
  if (Number(req.headers.get('content-length') ?? 0) > maxBody) {
    return tooLarge();
  }
  const body = await readCapped(req, maxBody);
  if (body === null) {
    return tooLarge();
  }
  let form: FormData;
  try {
    form = await new Response(body as BodyInit, { headers: { 'content-type': req.headers.get('content-type') ?? '' } }).formData();
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
 * The request body, read until it passes `max` bytes — null then, with the
 * rest left unread — so no declared or undeclared length can make this
 * process hold more than the limit.
 * @param req - The request.
 * @param max - The most it may hold.
 */
async function readCapped(req: Request, max: number): Promise<Uint8Array | null> {
  if (!req.body) {
    return new Uint8Array();
  }
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
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
      case 'REFUSED': return jsonError('IMPORT_REFUSED', error.message, 422);
      case 'BLOCKED': return jsonError('IMPORT_BLOCKED', error.message, 409);
      case 'CHANGED': return jsonError('CONFLICT', error.message, 409);
      case 'BUSY': return jsonError('CONFLICT', error.message, 409);
    }
  }
  throw error;
}
