/**
 * THE LIVE CHECK'S RECORDINGS, KEPT: when a run's browser closes
 * (`liveBrowser.closeBrowserSession`), each page QA drove was recorded; each
 * recording is kept once by the media store and filed on every request the
 * release shipped and on the release, role `qa-live-video`, captioned
 * "Live check of REL-<n>, <date>" (with the viewport when there is more than
 * one). A recording that cannot be kept is logged and said on each request in
 * one line; it never touches the check's verdict.
 *
 * A demo tab's recording (Chris, 2026-10-03: the feature demo, "the happy
 * path, end to end", for a product manager) is filed on its one request as
 * `feature-demo`, captioned "Feature demo of FE-<n>, <date>", with what QA
 * said while it ran as its `script` — each line at its moment, with the time
 * it takes to say — so the narration speaks those words at those moments.
 */

import type { Buffer } from 'node:buffer';
import type { SessionRecording } from './liveBrowser';
import { readFile } from 'node:fs/promises';
import { DEMO_VIDEO_ROLE, LIVE_VIDEO_ROLE } from '@/libs/factory/liveCheck';
import { logger } from '@/libs/Logger';
import { spokenMs } from '@/libs/media/narration';
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
 * "Feature demo of FE-12, 2026-10-04" — the request's code when it reads, the day it was shown,
 * the viewport when there was more than one demo of it.
 * @param code - The request's code, or null.
 * @param requestId - The request.
 * @param at - When the demo ended.
 * @param viewport - The viewport, or null when there was only one.
 */
export function demoRecordingCaption(code: string | null, requestId: number, at: Date, viewport: string | null): string {
  return `Feature demo of ${code ?? `request #${requestId}`}, ${at.toISOString().slice(0, 10)}${viewport ? ` · ${viewport}` : ''}`;
}

/**
 * The said lines as a recording's script: each with when it starts and the time it takes to say.
 * @param said - What was said, when.
 */
export function demoScript(said: ReadonlyArray<{ atMs: number; text: string }>): Array<{ atMs: number; endMs: number; text: string }> {
  return said.map(l => ({ atMs: Math.round(l.atMs), endMs: Math.round(l.atMs) + spokenMs(l.text), text: l.text.slice(0, 400) }));
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
  const checks = recordings.filter(r => r.purpose !== 'demo');
  const demos = recordings.filter(r => r.purpose === 'demo');
  const several = checks.length > 1;
  const refused: string[] = [];
  const read = async (r: SessionRecording, what: string): Promise<Buffer | null> => {
    try {
      return await readFile(r.path);
    } catch (err) {
      refused.push(`the ${r.viewport} ${what} could not be read (${(err as Error).message.slice(0, 120)})`);
      return null;
    }
  };
  for (const [i, r] of checks.entries()) {
    const data = await read(r, 'recording');
    if (!data) {
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
      timeline: r.timeline,
      author: { kind: 'system', id: 'live-check' },
    });
    if (!filed.ok) {
      refused.push(`the ${r.viewport} recording was not kept: ${filed.reason}`);
    }
  }
  // THE FEATURE DEMO: one request's, filed on that request alone, its said lines as the script.
  for (const [i, r] of demos.entries()) {
    const requestId = r.requestId;
    if (requestId === null) {
      refused.push(`a ${r.viewport} demo names no request, so it was not kept`);
      continue;
    }
    const data = await read(r, 'demo');
    if (!data) {
      continue;
    }
    const requestCode = await codeForRecord(orgId, requestId).catch(() => null);
    const ofRequest = demos.filter(x => x.requestId === requestId).length > 1 ? r.viewport : null;
    const caption = demoRecordingCaption(requestCode, requestId, new Date(r.endedAt || now.toISOString()), ofRequest);
    const filed = await fileRecording({
      orgId,
      keptUnder: requestId,
      name: `feature-demo-${r.viewport}-${i + 1}`,
      data,
      contentType: 'video/webm',
      records: [{ id: requestId, role: DEMO_VIDEO_ROLE }],
      title: caption,
      caption,
      provenance: { liveCheck: true, demo: true, releaseId, viewport: r.viewport, signedIn: r.signedIn, environment: r.env, startedAt: r.startedAt, endedAt: r.endedAt },
      timeline: r.timeline,
      extraSpec: r.script.length > 0 ? { script: demoScript(r.script) } : undefined,
      author: { kind: 'system', id: 'live-check' },
    });
    if (!filed.ok) {
      refused.push(`the ${r.viewport} demo of ${requestCode ?? `request #${requestId}`} was not kept: ${filed.reason}`);
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
