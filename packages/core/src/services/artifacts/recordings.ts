/**
 * FILE A RECORDING: keep a video in the media store (`libs/tools/artifacts/media.ts`)
 * once, and file it as a `file` artifact on every record it belongs to — the
 * feature request first, and the task or release beside it. Each artifact
 * carries the one served URL, so the same bytes are never stored twice.
 *
 * The roles say what the recording IS to the record: `qa-video` for the
 * engineer's own browser tests before merge, `qa-live-video` for QA driving
 * the live product after release (`libs/factory/liveCheck.ts`). The feature
 * page reads them by role.
 */

import type { Buffer } from 'node:buffer';
import type { MediaDeps } from '@/libs/tools/artifacts/media';
import type { Author } from '@/services/ArtifactService';
import { keepMedia } from '@/libs/tools/artifacts/media';

/** The engineer's own browser tests, recorded before merge. */
export const QA_VIDEO_ROLE = 'qa-video';

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
 * @param deps - Seams for tests.
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
}, deps: MediaDeps = {}): Promise<FiledRecording> {
  const kept = await keepMedia({ orgId: input.orgId, recordId: input.keptUnder, name: input.name, data: input.data, contentType: input.contentType }, deps);
  if (!kept.ok) {
    return kept;
  }
  const { createArtifact } = await import('@/services/ArtifactService');
  const caption = input.caption.trim().slice(0, 300) || 'Recording';
  const artifactIds: number[] = [];
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
  return { ok: true, url: kept.url, filename: kept.filename, bytes: kept.bytes, store: kept.store, artifactIds };
}
