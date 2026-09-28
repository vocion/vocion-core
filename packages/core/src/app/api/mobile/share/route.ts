import type { SharedItem } from '@/services/share/intake';
import { Buffer } from 'node:buffer';
import { NextResponse } from 'next/server';
import { jsonError } from '@/app/api/v1/_shared';
import { auth } from '@/libs/Auth';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { createArtifact } from '@/services/ArtifactService';
import { extractText, uploadSpec } from '@/services/chat/attachments';
import { resolveProjectForUser } from '@/services/ProjectService';
import { acceptShare, MAX_SHARE_FILES, MAX_SHARE_NOTE_CHARS, shareOpenPath } from '@/services/share/intake';

/**
 * `POST /api/mobile/share` — Share to Vocion, from the iOS share sheet.
 *
 * Multipart: `workspace` (slug, required), one or more `file` fields
 * (images, videos, PDFs, text), optional `note`. The workspace is named
 * explicitly rather than read from the "last active" cookie: the share sheet
 * has its own picker, and a share must land where the person pointed it.
 * The slug is resolved inside the caller's own account, so naming another
 * tenant's workspace is the same 404 as naming one that does not exist.
 *
 * Every kept file is a `file` artifact filed under `shared/`, authored by the
 * person (`services/share/intake.ts`). The response carries `openPath`, the
 * chat the app opens next, with the images already attached.
 *
 * This path is excluded from the proxy matcher (`src/proxy.ts`): a request the
 * proxy sees has its body cut at Next's 10 MB clone limit, and a phone video
 * is routinely larger. The proxy does nothing for `/api/*` anyway.
 * @param req - The multipart request.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return jsonError('UNAUTHORIZED', 'Sign in to Vocion first', 401);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError('BAD_REQUEST', 'Expected multipart form data with a `workspace` and one or more `file` fields', 400);
  }

  const slug = form.get('workspace');
  if (typeof slug !== 'string' || slug.trim() === '') {
    return jsonError('BAD_REQUEST', 'Name the workspace to share to (`workspace`)', 400);
  }
  const project = await resolveProjectForUser(userId, { slug: slug.trim() });
  if (!project) {
    return jsonError('NOT_FOUND', 'No such workspace', 404);
  }
  const orgId = project.id;

  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
  if (files.length === 0) {
    return jsonError('BAD_REQUEST', 'Nothing to share: send one or more `file` fields', 400);
  }
  if (files.length > MAX_SHARE_FILES) {
    return jsonError('BAD_REQUEST', `At most ${MAX_SHARE_FILES} files per share`, 400);
  }
  const rawNote = form.get('note');
  const note = typeof rawNote === 'string' ? rawNote.slice(0, MAX_SHARE_NOTE_CHARS) : null;

  const refused: string[] = [];
  const items: SharedItem[] = [];
  for (const file of files) {
    const verdict = acceptShare({ name: file.name, type: file.type, size: file.size });
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
        console.warn(`[mobile/share] could not extract text from ${file.name}: ${(err as Error).message}`);
        text = '';
      }
    }
    const { artifact } = await createArtifact({
      orgId,
      kind: 'file',
      title: file.name,
      spec: uploadSpec({ filename: saved.filename, originalName: file.name, contentType, bytes: saved.bytes, url: saved.url, ...(text !== undefined ? { text } : {}) }),
      url: saved.url,
      folder: 'shared',
      author: { kind: 'human', id: userId },
      visibility: 'user',
      changeSummary: 'Shared from iOS',
    });
    items.push({ id: artifact.id, title: artifact.title, kind, contentType, bytes: saved.bytes, url: `/api/artifacts/${artifact.id}` });
  }

  if (items.length === 0) {
    return jsonError('UNSUPPORTED_MEDIA_TYPE', refused.join(' '), 415, { refused });
  }
  return NextResponse.json(
    {
      workspace: { slug: project.slug, name: project.name },
      items,
      refused,
      openPath: shareOpenPath({ slug: project.slug, items, note }),
    },
    { status: 201 },
  );
}
