/**
 * A RUNNER TARGET TAKES THE NEXT RUN (backlog 052). The installation's runners claim across every
 * workspace on it, so a new workspace builds on the installation's fleet with nothing to set up.
 *
 * Which run: the oldest queued engineering run (`kind: worker`) that has waited at least the
 * target's `claimAfterSeconds`. That wait is what makes the on-box runner a backup: the cloud
 * target is started at dispatch and claims at once, and a run the cloud never picked up is taken
 * on the box after two minutes. A run id pins the claim to that run (a target started for it).
 * Each candidate is claimed through `claimWorkerRun`, so the lease, the budget refusal and the
 * workspace pause behave exactly as they do for a workspace's own worker; a candidate another
 * runner took first, or that is over budget, is passed over for the next.
 */

import type { RunnerTarget } from '@/libs/runners/config';
import type { RepoCredential } from '@/services/runners/repoCredential';
import type { WorkerRun } from '@/services/WorkerRunService';
import { and, asc, eq, isNull, lte } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { workerRunSchema } from '@/models/Schema';
import { repoCredentialFor } from '@/services/runners/repoCredential';
import { signRunToken } from '@/services/runners/runToken';
import { claimWorkerRun, WorkerRunError } from '@/services/WorkerRunService';
import { WorkspacePausedError } from '@/services/workspacePause';

/** How many queued runs one claim looks at before it says there is nothing for this target. */
const CANDIDATES = 10;

export type ClaimedRun = { run: WorkerRun; toolClaim: string; runToken: string; git: RepoCredential | null };

/**
 * Claim the next run for a target, or null when there is none it may take.
 * @param opts - Who is claiming.
 * @param opts.target - The installation target claiming.
 * @param opts.workerId - The container's id, the lease holder.
 * @param opts.workerVersion - The commit its image was built from.
 * @param opts.claimAfterSeconds - How long a run waits before this target takes it; the target's own setting wins.
 * @param opts.runId - Claim only this run.
 * @param opts.now - The clock.
 */
export async function claimNextRun(opts: { target: RunnerTarget; workerId: string; workerVersion?: string | null; claimAfterSeconds?: number; runId?: number | null; now?: Date }): Promise<ClaimedRun | null> {
  const now = opts.now ?? new Date();
  const wait = opts.target.claimAfterSeconds ?? Math.max(0, Math.floor(opts.claimAfterSeconds ?? 0));
  const queuedBefore = new Date(now.getTime() - wait * 1000);
  const candidates = await db
    .select({ id: workerRunSchema.id, orgId: workerRunSchema.orgId })
    .from(workerRunSchema)
    .where(and(
      eq(workerRunSchema.status, 'queued'),
      eq(workerRunSchema.kind, 'worker'),
      isNull(workerRunSchema.claimedAt),
      lte(workerRunSchema.createdAt, queuedBefore),
      ...(opts.runId ? [eq(workerRunSchema.id, opts.runId)] : []),
    ))
    .orderBy(asc(workerRunSchema.createdAt), asc(workerRunSchema.id))
    .limit(CANDIDATES);
  for (const c of candidates) {
    try {
      const { run, toolClaim } = await claimWorkerRun({ orgId: c.orgId, id: c.id, workerId: opts.workerId, workerVersion: opts.workerVersion, target: opts.target.name });
      const git = await repoCredentialFor(run.orgId, run.input as Record<string, unknown>).catch(() => null);
      return { run, toolClaim, runToken: signRunToken({ orgId: run.orgId, runId: run.id, target: opts.target.name }), git };
    } catch (e) {
      // Taken by another runner a moment ago, over budget, or its workspace is paused: not this
      // target's to build now. Anything else is a fault and is said.
      if (e instanceof WorkerRunError || e instanceof WorkspacePausedError) {
        continue;
      }
      throw e;
    }
  }
  return null;
}
