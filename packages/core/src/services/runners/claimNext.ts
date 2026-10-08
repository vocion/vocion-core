/**
 * A RUNNER TARGET TAKES THE NEXT RUN (backlog 052; scoped per tenant in Vocion 5.1).
 *
 * Which run: the oldest queued engineering run (`kind: worker`) that has waited at least the
 * target's `claimAfterSeconds`, out of the runs the claiming credential may see. That wait is what
 * makes the on-box runner a backup: the cloud target is started at dispatch and claims at once,
 * and a run the cloud never picked up is taken on the box after two minutes. A run id pins the
 * claim to that run (a target started for it).
 *
 * What the credential may see is its scope, and the scope is applied in the query that picks
 * candidates, by joining the run's workspace to its account. Nothing outside it is ever a
 * candidate, so no ordering, race or retry can hand a runner another tenant's run:
 *
 * - `installation` — `VOCION_RUNNER_TOKEN` on a single-tenant installation: every workspace, as
 *   before (a run whose workspace has no project row stays claimable here and nowhere else).
 * - `account` — an account's runner token: that account's workspaces, or the listed subset.
 * - `run` — a start token: the one run it was minted for.
 *
 * The workspace's runner target (`workspaceTarget.ts`) narrows it again: a run whose workspace or
 * account names a target goes only to a runner claiming as that target.
 *
 * Each candidate is claimed through `claimWorkerRun`, so the lease, the budget refusal and the
 * workspace pause behave exactly as they do for a workspace's own worker; a candidate another
 * runner took first, or that is over budget, is passed over for the next.
 */

import type { SQL } from 'drizzle-orm';
import type { RunnerTarget } from '@/libs/runners/config';
import type { RepoCredential } from '@/services/runners/repoCredential';
import type { WorkerRun } from '@/services/WorkerRunService';
import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { projectSchema, tenantAccountSchema, workerRunSchema } from '@/models/Schema';
import { repoCredentialFor } from '@/services/runners/repoCredential';
import { signRunToken } from '@/services/runners/runToken';
import { claimWorkerRun, WorkerRunError } from '@/services/WorkerRunService';
import { WorkspacePausedError } from '@/services/workspacePause';

/** How many queued runs one claim looks at before it says there is nothing for this target. */
const CANDIDATES = 10;

/** The runs a claiming credential may take. */
export type ClaimScope
  = | { kind: 'installation' }
    | { kind: 'account'; accountId: string; projectIds: string[] | null }
    | { kind: 'run'; orgId: string; runId: number };

export type ClaimedRun = { run: WorkerRun; runToken: string; git: RepoCredential | null };

/**
 * The SQL that keeps candidates inside a scope. Exported for the test that proves an account's
 * scope never reaches another account's run.
 * @param scope - The credential's scope.
 */
export function scopeFilter(scope: ClaimScope): SQL | undefined {
  switch (scope.kind) {
    case 'installation':
      return undefined;
    case 'account':
      return and(
        eq(projectSchema.accountId, scope.accountId),
        ...(scope.projectIds ? [inArray(workerRunSchema.orgId, scope.projectIds)] : []),
      );
    case 'run':
      return and(eq(workerRunSchema.id, scope.runId), eq(workerRunSchema.orgId, scope.orgId));
  }
}

/**
 * Claim the next run for a target, or null when there is none it may take.
 * @param opts - Who is claiming.
 * @param opts.target - The installation target claiming.
 * @param opts.workerId - The container's id, the lease holder.
 * @param opts.workerVersion - The commit its image was built from.
 * @param opts.claimAfterSeconds - How long a run waits before this target takes it; the target's own setting wins.
 * @param opts.runId - Claim only this run.
 * @param opts.scope - The runs the claiming credential may see; the installation's when omitted.
 * @param opts.now - The clock.
 */
export async function claimNextRun(opts: { target: RunnerTarget; workerId: string; workerVersion?: string | null; claimAfterSeconds?: number; runId?: number | null; scope?: ClaimScope; now?: Date }): Promise<ClaimedRun | null> {
  const now = opts.now ?? new Date();
  const scope = opts.scope ?? { kind: 'installation' };
  const wait = opts.target.claimAfterSeconds ?? Math.max(0, Math.floor(opts.claimAfterSeconds ?? 0));
  const queuedBefore = new Date(now.getTime() - wait * 1000);
  // The workspace's target, then its account's; neither is any target.
  const servedBy = sql<string | null>`coalesce(${projectSchema.runnerTarget}, ${tenantAccountSchema.runnerTarget})`;
  const candidates = await db
    .select({ id: workerRunSchema.id, orgId: workerRunSchema.orgId })
    .from(workerRunSchema)
    .leftJoin(projectSchema, eq(projectSchema.id, workerRunSchema.orgId))
    .leftJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(and(
      eq(workerRunSchema.status, 'queued'),
      eq(workerRunSchema.kind, 'worker'),
      isNull(workerRunSchema.claimedAt),
      lte(workerRunSchema.createdAt, queuedBefore),
      or(sql`${servedBy} IS NULL`, eq(servedBy, opts.target.name)),
      scopeFilter(scope),
      ...(opts.runId ? [eq(workerRunSchema.id, opts.runId)] : []),
    ))
    .orderBy(asc(workerRunSchema.createdAt), asc(workerRunSchema.id))
    .limit(CANDIDATES);
  for (const c of candidates) {
    try {
      const { run } = await claimWorkerRun({ orgId: c.orgId, id: c.id, workerId: opts.workerId, workerVersion: opts.workerVersion, target: opts.target.name });
      const git = await repoCredentialFor(run.orgId, run.input as Record<string, unknown>).catch(() => null);
      return { run, runToken: signRunToken({ orgId: run.orgId, runId: run.id, target: opts.target.name, workerId: opts.workerId }), git };
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
