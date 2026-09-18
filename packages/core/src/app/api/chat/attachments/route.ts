import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { jsonError } from '@/app/api/v1/_shared';
import { clerkAuth } from '@/libs/Auth';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { createArtifact } from '@/services/ArtifactService';
import { acceptUpload, attachmentFromArtifact, extractText, MAX_ATTACHMENTS, uploadSpec } from '@/services/chat/attachments';
import { getConversation } from '@/services/ConversationService';

/**
 * `POST /api/chat/attachments` — put files into the next chat turn.
 *
 * Multipart, `file` fields (several allowed), optional `conversation_id`.
 * Each accepted file becomes an artifact of kind `file` authored by the
 * person — a row, a version, an authenticated URL, a place in the artifacts
 * list — saved through the same store the agent's own files use. A PDF or
 * text file is read ONCE here and its text stored on the row, so the turn
 * that carries it never re-parses the bytes. The response is the chips the
 * composer shows; the message that follows names the ids, and the stream
 * route files them under that message.
 *
 * Session auth only: this is the dashboard's composer, not the public API.
 * @param req - The multipart request.
 */
export async function POST(req: Request) {
  const { userId, orgId } = await clerkAuth();
  if (!userId || !orgId) {
    return jsonError('UNAUTHORIZED', 'Missing or invalid credentials', 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('BAD_REQUEST', 'Expected multipart form data with one or more `file` fields', 400);
  }
  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
  if (files.length === 0) {
    return jsonError('BAD_REQUEST', 'No files: send one or more `file` fields', 400);
  }
  if (files.length > MAX_ATTACHMENTS) {
    return jsonError('BAD_REQUEST', `At most ${MAX_ATTACHMENTS} files per message`, 400);
  }

  // The thread, when it already exists — an upload before the first turn
  // has none, and the stream route files it later.
  const rawConv = form.get('conversation_id');
  let conversationId: number | null = null;
  if (typeof rawConv === 'string' && /^\d+$/.test(rawConv)) {
    const conv = await getConversation({ orgId, id: Number(rawConv) });
    conversationId = conv?.id ?? null;
  }

  const refused: string[] = [];
  const attachments = [];
  for (const file of files) {
    const verdict = acceptUpload({ name: file.name, type: file.type, size: file.size });
    if (!verdict.ok) {
      refused.push(verdict.reason);
      continue;
    }
    const { contentType, ext, kind } = verdict.accepted;
    const data = Buffer.from(await file.arrayBuffer());
    const saved = await saveArtifact({ orgId, data, ext, contentType });
    let text: string | undefined;
    if (kind === 'document') {
      try {
        text = await extractText(data, contentType);
      } catch (err) {
        // A file whose text cannot be read is still attached; the model is
        // told it could not be read rather than handed nothing silently.
        console.warn(`[chat/attachments] could not extract text from ${file.name}: ${(err as Error).message}`);
        text = '';
      }
    }
    const { artifact } = await createArtifact({
      orgId,
      conversationId,
      kind: 'file',
      title: file.name,
      spec: uploadSpec({ filename: saved.filename, originalName: file.name, contentType, bytes: saved.bytes, url: saved.url, ...(text !== undefined ? { text } : {}) }),
      url: saved.url,
      author: { kind: 'human', id: userId },
      // A person's upload is something a person would open again.
      visibility: 'user',
      changeSummary: 'Uploaded',
    });
    attachments.push(attachmentFromArtifact(artifact));
  }

  if (attachments.length === 0) {
    return jsonError('UNSUPPORTED_MEDIA_TYPE', refused.join(' '), 415, { refused });
  }
  return NextResponse.json({ attachments, refused }, { status: 201 });
}
