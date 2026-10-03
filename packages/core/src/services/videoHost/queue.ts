/**
 * THE TRIGGER: when a recording is filed (`services/artifacts/recordings.ts`),
 * and only when the workspace has a video host connected, start one durable
 * publish for it. Never from the factory flow, and never in its way: this
 * returns at once, swallows its own failures (logged), and the filing has
 * already succeeded whatever happens here.
 *
 * A narrated recording is published at once. A raw one waits
 * {@link NARRATION_GRACE_MS} first, so that when a narrated version is made of
 * it, the narrated one is the one uploaded and the raw one is not
 * (`publishRecording` skips a raw recording with a newer narrated twin). The
 * wait is a durable sleep, so a deploy in between does not lose it.
 */

import type { VideoHost } from './host';
import { isNarratedRole } from './publish';

/** How long a raw recording waits for a narrated version before it is published itself. */
export const NARRATION_GRACE_MS = 5 * 60_000;

/** The job every publish runs as (`services/background/catalog.ts`). */
export const VIDEO_HOST_PUBLISH_JOB = 'video-host.publish';

export type QueueDeps = {
  host?: VideoHost | null;
  start?: (id: string, call: { job: string; input: unknown; afterMs?: number }) => Promise<unknown>;
};

/**
 * Queue a filed recording for the org's video host, when it has one.
 * @param input - The filing.
 * @param input.orgId - The workspace.
 * @param input.artifactIds - The artifacts it was filed as; the first names the job, so one filing is one publish.
 * @param input.role - The role it was filed under.
 * @param deps - Seams for tests.
 */
export async function queueRecordingPublish(input: { orgId: string; artifactIds: number[]; role: string | null }, deps: QueueDeps = {}): Promise<{ queued: boolean; reason?: string }> {
  const first = input.artifactIds[0];
  if (first === undefined) {
    return { queued: false, reason: 'nothing was filed' };
  }
  try {
    const host = deps.host === undefined ? await (await import('./host')).videoHost(input.orgId) : deps.host;
    if (!host) {
      return { queued: false, reason: 'no video host is connected' };
    }
    const start = deps.start ?? (async (id: string, call: { job: string; input: unknown; afterMs?: number }) => {
      await import('@/services/background/catalog');
      const { startJob } = await import('@/libs/durable/jobs');
      return startJob(id, call);
    });
    await start(`${VIDEO_HOST_PUBLISH_JOB}-${input.orgId}-${first}`, {
      job: VIDEO_HOST_PUBLISH_JOB,
      input: { orgId: input.orgId, artifactId: first },
      ...(isNarratedRole(input.role) ? {} : { afterMs: NARRATION_GRACE_MS }),
    });
    return { queued: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    try {
      const { logger } = await import('@/libs/Logger');
      logger.warn('recording not queued for the video host', { orgId: input.orgId, artifactIds: input.artifactIds, error: reason });
    } catch { /* logging is best effort */ }
    return { queued: false, reason };
  }
}
