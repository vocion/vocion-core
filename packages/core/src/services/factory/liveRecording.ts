/**
 * THE LIVE CHECK'S RECORDINGS, KEPT: when a run's browser closes
 * (`liveBrowser.closeBrowserSession`), each page QA drove was recorded; each
 * recording is kept once by the media store and filed on every request the
 * release shipped and on the release, role `qa-live-video`, captioned
 * "Live check of REL-<n>, <date>" (with the viewport when there is more than
 * one). A recording that cannot be kept is logged and said on each request in
 * one line; it never touches the check's verdict.
 */

import type { Buffer } from 'node:buffer';
import type { SessionRecording } from './liveBrowser';
import { readFile } from 'node:fs/promises';
import { LIVE_VIDEO_ROLE } from '@/libs/factory/liveCheck';
import { logger } from '@/libs/Logger';
import { fileRecording } from '@/services/artifacts/recordings';

/**
 * "Live check of REL-12, 2026-10-03 · phone" — the code when the codes read, the
 * day it was recorded (UTC, an unambiguous date), the viewport when it matters.
 * @param code - The release's code, or null.
 * @param releaseId - The release.
 * @param at - When the recording ended.
 * @param viewport - The viewport, or null when there was only one.
 */
export function liveRecordingCaption(code: string | null, releaseId: number, at: Date, viewport: string | null): string {
  return `Live check of ${code ?? `release #${releaseId}`}, ${at.toISOString().slice(0, 10)}${viewport ? ` · ${viewport}` : ''}`;
}

/**
 * Keep a closed session's recordings and file them.
 * @param orgId - The workspace.
 * @param releaseId - The release the session checked.
 * @param recordings - What the session set aside.
 * @param now - The clock.
 */
export async function keepLiveRecordings(orgId: string, releaseId: number, recordings: SessionRecording[], now: Date = new Date()): Promise<void> {
  if (recordings.length === 0) {
    return;
  }
  const { releaseLines } = await import('./liveCheck');
  const release = await releaseLines(orgId, releaseId);
  const requestIds = release.ok ? release.requestIds : [];
  const { codeForRecord } = await import('@/services/codes');
  const code = await codeForRecord(orgId, releaseId).catch(() => null);
  const several = recordings.length > 1;
  const refused: string[] = [];
  for (const [i, r] of recordings.entries()) {
    let data: Buffer;
    try {
      data = await readFile(r.path);
    } catch (err) {
      refused.push(`the ${r.viewport} recording could not be read (${(err as Error).message.slice(0, 120)})`);
      continue;
    }
    const caption = liveRecordingCaption(code, releaseId, new Date(r.endedAt || now.toISOString()), several ? r.viewport : null);
    const filed = await fileRecording({
      orgId,
      keptUnder: releaseId,
      name: `live-check-${r.viewport}-${i + 1}`,
      data,
      contentType: 'video/webm',
      records: [...requestIds.map(id => ({ id, role: LIVE_VIDEO_ROLE })), { id: releaseId, role: LIVE_VIDEO_ROLE }],
      title: caption,
      caption,
      provenance: { liveCheck: true, releaseId, viewport: r.viewport, signedIn: r.signedIn, environment: r.env, startedAt: r.startedAt, endedAt: r.endedAt },
      author: { kind: 'system', id: 'live-check' },
    });
    if (!filed.ok) {
      refused.push(`the ${r.viewport} recording was not kept: ${filed.reason}`);
    }
  }
  if (refused.length > 0) {
    logger.warn('live check recording not kept', { orgId, releaseId, refused });
    const { noteOnRequest } = await import('./carry');
    for (const requestId of requestIds) {
      await noteOnRequest(orgId, requestId, `The live check of ${code ?? `release #${releaseId}`} ran, and ${refused.join('; ')}.`.slice(0, 500)).catch(() => undefined);
    }
  }
}
