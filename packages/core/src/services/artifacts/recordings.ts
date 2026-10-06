/**
 * FILE A RECORDING: keep a video in the media store (`libs/tools/artifacts/media.ts`)
 * once, and file it as a `file` artifact on every record it belongs to — the
 * feature request first, and the task or release beside it. Each artifact
 * carries the one served URL, so the same bytes are never stored twice.
 *
 * The roles say what the recording IS to the record: `qa-video` for the
 * engineer's own browser tests before merge, `qa-live-video` for QA driving
 * the live product after release (`libs/factory/liveCheck.ts`), and either
 * with `-narrated` for its second pass with a voiceover
 * (`services/artifacts/narrate.ts`). The feature page reads them by role.
 *
 * Every filing raises `recording.filed` once (Chris, 2026-10-03), so a plugin
 * can act on a new recording without polling: the software factory narrates
 * it when the workspace turned that on. A recording carries the moments it
 * shows when its maker logged them (`spec.timeline`: what was done, when, in
 * milliseconds from the recording's start), so a narration is timed to them.
 */

import type { Buffer } from 'node:buffer';
import type { MediaDeps } from '@/libs/tools/artifacts/media';
import type { Author } from '@/services/ArtifactService';
import { NARRATED_SUFFIX } from '@/libs/media/roles';
import { keepMedia } from '@/libs/tools/artifacts/media';

/** The engineer's own browser tests, recorded before merge. */
export const QA_VIDEO_ROLE = 'qa-video';

export { NARRATED_SUFFIX, narratedRole } from '@/libs/media/roles';

/** Raised once per filed recording; payload {@link RecordingFiledPayload}. */
export const RECORDING_FILED = 'recording.filed';

/** Payload of `recording.filed`. Scalars only — `when.filter` compares with `===`. */
export type RecordingFiledPayload = {
  /** The first artifact written (the first record's); its siblings share its `url`. */
  artifactId: number;
  /** Every artifact written, comma-joined. */
  artifactIds: string;
  /** The first record's role, e.g. `qa-live-video`. */
  role: string;
  url: string;
  /** The records it was filed on, comma-joined. */
  recordIds: string;
  /** True for a narrated version (so narrating never narrates itself). */
  narrated: boolean;
};

/** One moment a recording shows: what was done, and when from its start. */
export type TimelineMoment = { atMs: number; what: string; ok?: boolean; detail?: string | null; url?: string | null; evidenceId?: string };

/** The most moments kept on a recording's spec. */
export const MAX_TIMELINE = 120;

export type FiledRecording
  = | { ok: true; url: string; filename: string; bytes: number; store: 's3' | 'disk'; artifactIds: number[] }
    | { ok: false; reason: string; tooLarge?: boolean };

/**
 * Keep the bytes, then write one artifact per record. Never throws: a store
 * refusal comes back as its sentence; an artifact that fails to write is
 * skipped and the rest are still written.
 * @param input - The recording and where it goes.
 * @param input.orgId - The workspace.
 * @param input.keptUnder - The record id its file is kept under (the request, or the release).
 * @param input.name - A few words for the file name.
 * @param input.data - The bytes.
 * @param input.contentType - `video/webm` or `video/mp4`.
 * @param input.records - Each record it is filed on, with its role there.
 * @param input.title - The artifact's title.
 * @param input.caption - The one line under the player.
 * @param input.provenance - Who made it and where.
 * @param input.capturedFrom - The page it was recorded on, when one.
 * @param input.author - Who it is filed as.
 * @param input.timeline - The moments it shows, when logged.
 * @param input.extraSpec - More fields for the spec.
 * @param deps - Seams for tests; `announce` raises `recording.filed`.
 */
export async function fileRecording(input: {
  orgId: string;
  keptUnder: number;
  name: string;
  data: Buffer;
  contentType: string;
  records: Array<{ id: number; role: string }>;
  title: string;
  caption: string;
  provenance?: Record<string, unknown>;
  capturedFrom?: string | null;
  author: Author;
  /** The moments it shows, when its maker logged them. */
  timeline?: TimelineMoment[];
  /** More fields for each artifact's spec (a narration's source and script). */
  extraSpec?: Record<string, unknown>;
}, deps: MediaDeps & {
  announce?: (orgId: string, payload: RecordingFiledPayload) => Promise<void>;
} = {}): Promise<FiledRecording> {
  const kept = await keepMedia({ orgId: input.orgId, recordId: input.keptUnder, name: input.name, data: input.data, contentType: input.contentType }, deps);
  if (!kept.ok) {
    return kept;
  }
  const { createArtifact } = await import('@/services/ArtifactService');
  const caption = input.caption.trim().slice(0, 300) || 'Recording';
  const artifactIds: number[] = [];
  const timeline = (input.timeline ?? [])
    .filter(m => Number.isFinite(m.atMs) && m.atMs >= 0 && m.what)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, MAX_TIMELINE)
    .map(m => ({ ...m, atMs: Math.round(m.atMs), what: m.what.slice(0, 200), ...(m.detail ? { detail: m.detail.slice(0, 300) } : {}) }));
  const seen = new Set<string>();
  for (const r of input.records) {
    const k = `${r.id}:${r.role}`;
    if (seen.has(k)) {
      continue;
    }
    seen.add(k);
    try {
      const { artifact } = await createArtifact({
        orgId: input.orgId,
        kind: 'file',
        title: input.title.trim().slice(0, 120) || caption.slice(0, 120),
        spec: {
          filename: kept.filename,
          contentType: kept.contentType,
          bytes: kept.bytes,
          url: kept.url,
          caption,
          ...(input.capturedFrom ? { capturedFrom: input.capturedFrom.slice(0, 2000) } : {}),
          ...(timeline.length > 0 ? { timeline } : {}),
          ...input.extraSpec,
          provenance: { ...input.provenance, store: kept.store },
        },
        url: kept.url,
        record: { type: 'object', id: String(r.id), role: r.role },
        author: input.author,
        changeSummary: caption.slice(0, 200),
        visibility: 'user',
      });
      artifactIds.push(artifact.id);
    } catch (err) {
      const { logger } = await import('@/libs/Logger');
      logger.warn('recording artifact not written', { orgId: input.orgId, recordId: r.id, role: r.role, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const first = input.records.find(r => artifactIds.length > 0 && r);
  if (artifactIds.length > 0 && first) {
    const payload: RecordingFiledPayload = {
      artifactId: artifactIds[0]!,
      artifactIds: artifactIds.join(','),
      role: first.role,
      url: kept.url,
      recordIds: [...new Set(input.records.map(r => r.id))].join(','),
      narrated: first.role.endsWith(NARRATED_SUFFIX),
    };
    await (deps.announce ?? announceRecording)(input.orgId, payload).catch(async (err) => {
      const { logger } = await import('@/libs/Logger');
      logger.warn('recording.filed not raised', { orgId: input.orgId, artifactId: payload.artifactId, error: err instanceof Error ? err.message : String(err) });
    });
  }
  return { ok: true, url: kept.url, filename: kept.filename, bytes: kept.bytes, store: kept.store, artifactIds };
}

/**
 * Raise `recording.filed` for whatever listens. Deduped on the first artifact.
 * @param orgId - The workspace.
 * @param payload - The filing.
 */
async function announceRecording(orgId: string, payload: RecordingFiledPayload): Promise<void> {
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({ orgId, type: RECORDING_FILED, payload, dedupeKey: `${RECORDING_FILED}:${payload.artifactId}`, invokedBy: `artifact:${payload.artifactId}`, dispatchMode: 'auto' });
}
