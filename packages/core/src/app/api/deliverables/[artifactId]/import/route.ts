import type { NextRequest } from 'next/server';
import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { ArtifactError } from '@/services/ArtifactService';
import { DeckEditError } from '@/services/decks/DeckEngine';
import { AdapterFileError, importDeckPptx, importDocumentDocx, MAX_IMPORT_BYTES } from '@/services/deliverables/adapters';
import { deliverableFor, noStore, refuse } from '../_shared';

export const maxDuration = 300;

/**
 * `POST /api/deliverables/:artifactId/import` — the pane's "Upload a new
 * version". Multipart: `file` (a .pptx for a deck, a .docx for a document)
 * and optional `baseVersion` (the version the file was downloaded at).
 *
 * The file's kind is read from its BYTES (a zip holding PowerPoint's or Word's
 * main part), never from its name or declared type. It comes back as one new
 * version through the engine (re-rendered, re-audited), with the import
 * report: `{ ok: true, version, report, receipt }`. A file that changes
 * nothing writes nothing and answers with the current version.
 *
 * Refusals are `{ ok: false, reason, diff? }`: 409 with the slide-by-slide (or
 * sheet-by-sheet) `diff` when `baseVersion` is stale; 413 over 50 MB; 415 for
 * the wrong kind of file; 422 when the merged result cannot be written.
 * @param req - The multipart request.
 * @param ctx - The route params.
 * @param ctx.params - `{ artifactId }`.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await ctx.params;
  const found = await deliverableFor(req, artifactId);
  if (found instanceof NextResponse) {
    return found;
  }
  const { orgId, author, row } = found;
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_IMPORT_BYTES + 1024 * 1024) {
    return refuse(413, `That file is too large; an upload can be at most ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return refuse(400, 'Send the file as multipart form data in a `file` field.');
  }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !('arrayBuffer' in file)) {
    return refuse(400, `No file: send the ${row.kind === 'deck' ? '.pptx' : '.docx'} in a \`file\` field.`);
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return refuse(413, `That file is ${Math.round(file.size / 1024 / 1024)} MB; an upload can be at most ${MAX_IMPORT_BYTES / 1024 / 1024} MB.`);
  }
  const rawBase = form.get('baseVersion');
  let baseVersion: number | undefined;
  if (typeof rawBase === 'string' && rawBase.trim() !== '') {
    if (!/^\d{1,9}$/.test(rawBase.trim())) {
      return refuse(400, 'baseVersion must be a version number.');
    }
    baseVersion = Number(rawBase.trim());
  }
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const res = row.kind === 'deck'
      ? await importDeckPptx(orgId, row.id, buf, { baseVersion, author })
      : await importDocumentDocx(orgId, row.id, buf, { baseVersion, author });
    if (res.status === 'stale') {
      return refuse(409, `This ${row.kind} changed in Vocion since v${baseVersion} (it is at v${res.currentVersion}). Download it again and redo the change on top.`, { diff: res.diff, currentVersion: res.currentVersion });
    }
    return NextResponse.json({ ok: true, version: res.version, changed: res.status === 'written', report: res.report, receipt: res.receipt }, { status: 200, headers: noStore });
  } catch (err) {
    if (err instanceof AdapterFileError) {
      return refuse(err.code === 'TOO_LARGE' ? 413 : err.code === 'WRONG_KIND' ? 415 : 404, err.message);
    }
    if (err instanceof ArtifactError) {
      return refuse(err.code === 'CONFLICT' ? 409 : err.code === 'NOT_FOUND' ? 404 : 422, `The file could not be brought back: ${err.message}.`);
    }
    if (err instanceof DeckEditError) {
      return refuse(422, `The file could not be brought back: ${err.message}.`);
    }
    console.error('[deliverables/import] failed', row.id, err);
    return refuse(422, 'The file could not be read. Is it a file this deliverable was exported to, saved without errors?');
  }
}
