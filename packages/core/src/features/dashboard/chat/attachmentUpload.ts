import type { ChatAttachment } from './types';

/**
 * The browser half of attaching a file: shrink a large image, post the files,
 * hand back the chips. Kept out of the hook so it is a plain function the
 * composer's tests can stub.
 */

/** Images longer than this on a side are scaled down before upload — the vendors read nothing finer. */
export const MAX_IMAGE_SIDE = 2000;
/** And images under this size are sent as they are; re-encoding a small PNG only loses quality. */
const SHRINK_ABOVE_BYTES = 1_500_000;

/**
 * Scale an image down to `MAX_IMAGE_SIDE` when it is both large and big;
 * returns the file untouched otherwise, or when the browser cannot decode it
 * (the server then applies its own size limit and says so).
 * @param file - The picked image.
 */
export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < SHRINK_ABOVE_BYTES || typeof createImageBitmap !== 'function') {
    return file;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.9));
    if (!blob) {
      return file;
    }
    const name = type === 'image/jpeg' ? `${file.name.replace(/\.(png|webp|jpe?g)$/i, '')}.jpg` : file.name;
    return new File([blob], name, { type });
  } catch {
    return file;
  }
}

export type UploadResult = { attachments: ChatAttachment[]; refused: string[] };

/**
 * Post files to `/api/chat/attachments` and return the chips. A refused file
 * comes back as a sentence in `refused`; a transport failure throws.
 * @param files - What the person picked, dropped or pasted.
 * @param conversationId - The thread, when it already exists.
 */
export async function uploadAttachments(files: File[], conversationId: number | null): Promise<UploadResult> {
  const form = new FormData();
  for (const f of files) {
    form.append('file', await shrinkImage(f), f.name);
  }
  if (conversationId !== null) {
    form.append('conversation_id', String(conversationId));
  }
  const resp = await fetch('/api/chat/attachments', { method: 'POST', body: form });
  const body = await resp.json().catch(() => null) as { attachments?: ChatAttachment[]; refused?: string[]; error?: { message?: string; details?: { refused?: string[] } } } | null;
  if (resp.status === 415 && body?.error) {
    return { attachments: [], refused: body.error.details?.refused ?? [body.error.message ?? 'Those files cannot be attached.'] };
  }
  if (!resp.ok || !body) {
    throw new Error(body?.error?.message ?? `Upload failed (HTTP ${resp.status})`);
  }
  return { attachments: body.attachments ?? [], refused: body.refused ?? [] };
}
