/**
 * WHICH TARGET BUILDS A WORKSPACE'S RUNS (Vocion 5.1). Runner targets are installation config
 * (`libs/runners/config.ts`); on a host that serves several companies, a company's repository
 * code should run only on capacity meant for it — its own Fargate cluster, subnets and task role.
 * A workspace names the target that serves it, or its account does for every workspace in it.
 *
 * The workspace's own `runner_target` wins, then the account's. Neither set: any target, which is
 * the behaviour every installation had before. A named target is honoured in two places:
 * `claimNext.ts` gives the run only to a runner claiming as that target, and `targets.ts` starts
 * a container for it only there.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { runnerTarget } from '@/libs/runners/config';
import { projectSchema, tenantAccountSchema } from '@/models/Schema';

export type EffectiveRunnerTarget = { target: string | null; from: 'workspace' | 'account' | null };

/** A target a person cannot set; the message says why in their terms. */
export class RunnerTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerTargetError';
  }
}

/**
 * The target that builds a workspace's runs, and where that came from.
 * @param orgId - The workspace (`worker_run.org_id`, which is the project id).
 */
export async function runnerTargetFor(orgId: string): Promise<EffectiveRunnerTarget> {
  const [row] = await db
    .select({ workspace: projectSchema.runnerTarget, account: tenantAccountSchema.runnerTarget })
    .from(projectSchema)
    .leftJoin(tenantAccountSchema, eq(tenantAccountSchema.id, projectSchema.accountId))
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (row?.workspace) {
    return { target: row.workspace, from: 'workspace' };
  }
  if (row?.account) {
    return { target: row.account, from: 'account' };
  }
  return { target: null, from: null };
}

function declared(target: string | null): string | null {
  if (target === null) {
    return null;
  }
  const name = target.trim();
  if (!runnerTarget(name)) {
    throw new RunnerTargetError(`"${name}" is not a runner target this installation declares (VOCION_RUNNERS), so nothing would ever build these runs.`);
  }
  return name;
}

/**
 * Name the target that builds one workspace's runs, or null to follow its account.
 * @param projectId - The workspace.
 * @param target - A target the installation declares, or null.
 */
export async function setWorkspaceRunnerTarget(projectId: string, target: string | null): Promise<void> {
  await db.update(projectSchema).set({ runnerTarget: declared(target) }).where(eq(projectSchema.id, projectId));
}

/**
 * Name the target that builds every workspace of an account that names none, or null for any.
 * @param accountId - The account.
 * @param target - A target the installation declares, or null.
 */
export async function setAccountRunnerTarget(accountId: string, target: string | null): Promise<void> {
  await db.update(tenantAccountSchema).set({ runnerTarget: declared(target) }).where(eq(tenantAccountSchema.id, accountId));
}
