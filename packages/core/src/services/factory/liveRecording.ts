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
import { planStitch, stitchTakes } from '@/libs/media/stitch';
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

/** A demo as filed: a tab's take, or several tabs' takes stitched into one story. */
export type DemoTake = SessionRecording & { tabs: number };

/**
 * ONE STORY, ONE VIDEO (Chris, 2026-10-05): the demos of one request told across several tabs
 * (a sender signed in, a visitor signed out) are stitched into one video in the order the lines
 * were said (`libs/media/stitch.ts`), so the feature page and the share card lead with the whole
 * story, not the half narrated last. Takes of the same request and viewport are stitched; a
 * story that could not be stitched is kept as its takes, each said why. Never throws.
 * @param demos - The session's demo recordings.
 * @param stitch - The cut, for tests.
 */
export async function mergeDemoTakes(demos: readonly SessionRecording[], stitch: typeof stitchTakes = stitchTakes): Promise<{ takes: DemoTake[]; refused: string[] }> {
  const groups = new Map<string, SessionRecording[]>();
  for (const r of demos) {
    const key = `${r.requestId ?? 'none'}|${r.viewport}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const takes: DemoTake[] = [];
  const refused: string[] = [];
  for (const group of groups.values()) {
    const ordered = [...group].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    const plan = ordered.length > 1 ? planStitch(ordered) : null;
    if (!plan) {
      takes.push(...ordered.map(r => ({ ...r, tabs: 1 })));
      continue;
    }
    const first = ordered[0]!;
    const out = `${first.path.replace(/\.[^./]+$/, '')}-story.webm`;
    const cut = await stitch(ordered, plan, out);
    if (!cut.ok) {
      refused.push(`the ${first.viewport} demo of request #${first.requestId} was kept as ${ordered.length} takes: ${cut.reason}`);
      takes.push(...ordered.map(r => ({ ...r, tabs: 1 })));
      continue;
    }
    takes.push({
      ...first,
      path: cut.path,
      // The story's clock: from the first take's start, to the end of what was stitched.
      startedAt: first.startedAt,
      endedAt: new Date(Date.parse(first.startedAt) + plan.durationMs).toISOString(),
      script: plan.script,
      timeline: plan.timeline as SessionRecording['timeline'],
      tabs: ordered.length,
    });
  }
  return { takes, refused };
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
  const merged = await mergeDemoTakes(recordings.filter(r => r.purpose === 'demo'));
  const demos = merged.takes;
  const several = checks.length > 1;
  const refused: string[] = [...merged.refused];
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
      provenance: { liveCheck: true, demo: true, releaseId, viewport: r.viewport, signedIn: r.tabs > 1 ? 'both' : r.signedIn, environment: r.env, startedAt: r.startedAt, endedAt: r.endedAt, tabs: r.tabs },
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
