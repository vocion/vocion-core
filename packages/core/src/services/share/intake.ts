/**
 * SHARE TO VOCION — what the phone's share sheet may hand a workspace.
 *
 * The iOS app's share extension posts photos and videos here
 * (`app/api/mobile/share`). Each accepted file becomes the same thing a chat
 * upload becomes: an artifact of kind `file`, authored by the person, in the
 * content-addressed store (design principle 7, one noun). What differs from
 * the chat composer is the intake rule:
 *
 *   - images, PDFs and text files follow `acceptUpload` exactly, so anything
 *     shared can ride into a chat turn as a chip;
 *   - videos are accepted too. No model in the fleet reads a video, so a
 *     video is kept as a workspace file and named in the seeded chat prompt
 *     rather than attached to the turn.
 *
 * `shareOpenPath` is where the app lands the person afterwards: a fresh chat
 * in the workspace they shared to, with the images already in the composer.
 */

import path from 'node:path';
import process from 'node:process';
import { workspaceUrl } from '@/libs/links';
import { acceptUpload, MAX_ATTACHMENTS } from '@/services/chat/attachments';

/** Default ceiling for one shared video. Override with `VOCION_SHARE_MAX_VIDEO_BYTES`. */
export const DEFAULT_MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** How many files one share may carry — the same as one chat message. */
export const MAX_SHARE_FILES = MAX_ATTACHMENTS;

/** The longest note the share sheet may send along. */
export const MAX_SHARE_NOTE_CHARS = 4_000;

const VIDEO_TYPES: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/x-m4v': 'm4v',
};
const VIDEO_EXTS: Record<string, string> = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v' };

export type ShareKind = 'image' | 'document' | 'video';

export type AcceptedShare = { contentType: string; ext: string; kind: ShareKind };

/**
 * The per-video byte ceiling, from the environment when it names a positive
 * integer, else the default. Read on each call so a test or an operator can
 * change it without a restart of anything but the process.
 */
export function maxVideoBytes(): number {
  const raw = Number.parseInt(process.env.VOCION_SHARE_MAX_VIDEO_BYTES ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_VIDEO_BYTES;
}

/**
 * Decide whether a shared file may be kept, and as what. Videos are checked
 * here; everything else is the chat composer's rule, reason text and all.
 * @param file - Name, reported type and size.
 * @param file.name - The filename the phone sent.
 * @param file.type - The reported MIME type.
 * @param file.size - Bytes.
 */
export function acceptShare(file: { name: string; type: string; size: number }): { ok: true; accepted: AcceptedShare } | { ok: false; reason: string } {
  const ext = path.extname(file.name).slice(1).toLowerCase();
  const reported = file.type.split(';')[0]!.trim().toLowerCase();
  const videoType = VIDEO_TYPES[reported] ? reported : VIDEO_EXTS[ext];
  if (videoType) {
    if (file.size <= 0) {
      return { ok: false, reason: `${file.name} is empty.` };
    }
    const cap = maxVideoBytes();
    if (file.size > cap) {
      return { ok: false, reason: `${file.name} is ${mb(file.size)}; a shared video may be up to ${mb(cap)}.` };
    }
    return { ok: true, accepted: { contentType: videoType, ext: VIDEO_TYPES[videoType]!, kind: 'video' } };
  }
  const verdict = acceptUpload(file);
  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason.replace('can be attached', 'and videos (MP4, MOV) can be shared') };
  }
  return { ok: true, accepted: verdict.accepted };
}

function mb(n: number): string {
  return `${Math.round(n / (1024 * 1024))} MB`;
}

/** One kept file, as the share response names it. */
export type SharedItem = { id: number; title: string; kind: ShareKind; contentType: string; bytes: number; url: string };

/**
 * Where the app should open once the share is in: a new chat in the shared
 * workspace, the chat-readable files attached (`?attach=`), and the note —
 * plus a line per video, since a video cannot ride the turn — seeded in the
 * composer (`?prompt=`), never sent. The person decides what to ask.
 * @param opts - What was shared, and where.
 * @param opts.slug - The workspace the files went to.
 * @param opts.items - What was kept.
 * @param opts.note - What the person typed in the share sheet, if anything.
 */
export function shareOpenPath(opts: { slug: string; items: SharedItem[]; note?: string | null }): string {
  const attach = opts.items.filter(i => i.kind !== 'video').map(i => i.id);
  const videos = opts.items.filter(i => i.kind === 'video');
  const lines = [
    opts.note?.trim() ?? '',
    ...videos.map(v => `Shared video: ${v.title} (${v.url})`),
  ].filter(l => l !== '');
  const q = new URLSearchParams({ new: '1' });
  if (attach.length > 0) {
    q.set('attach', attach.join(','));
  }
  if (lines.length > 0) {
    q.set('prompt', lines.join('\n'));
  }
  return workspaceUrl(opts.slug, `/dashboard/chat?${q.toString()}`);
}

/**
 * Read `?attach=12,13` into artifact ids: digits only, de-duplicated, capped
 * at one message's worth. Anything else in the list is dropped, not guessed.
 * @param raw - The query value, if present.
 */
export function parseAttachParam(raw: string | string[] | undefined): number[] {
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const ids = joined.split(',').map(s => s.trim()).filter(s => /^\d{1,12}$/.test(s)).map(Number);
  return [...new Set(ids)].slice(0, MAX_SHARE_FILES);
}
