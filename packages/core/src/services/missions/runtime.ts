/**
 * Mission runtime — executes a mission's task graph by dispatching each task
 * to its owning agent via the deepagents runtime (runAgentDeep). Honors the
 * autonomy ladder (gated tasks pause the run for human review) and persists
 * state to mission_run after every task, so a run is resumable.
 *
 * MVP: runs in-process to completion or to the first approval gate. Durable,
 * crash-safe, multi-day sessions (Temporal) are Phase 2.
 */

import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { missionRunSchema, missionSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { clampAutonomyLevel, taskNeedsApproval } from './autonomy';

/**
 * Log through a dynamic import.
 *
 * `libs/Logger` has a top-level await, and this file sits in the Temporal
 * worker's import chain, which tsx compiles as CommonJS — where that await
 * stops the worker booting. `scripts/temporal-worker.imports.test.ts`
 * guards the chain. Same approach as `libs/Langfuse.ts`.
 * @param level - Which logger method to call.
 * @param message - What happened, in plain words.
 * @param properties - Identifiers and context worth keeping.
 */
function log(
  level: 'error' | 'warn' | 'info',
  message: string,
  properties: Record<string, unknown> = {},
): void {
  import('@/libs/Logger')
    .then(({ logger }) => logger[level](message, properties))
    // Nothing useful left to do if logging itself is broken.
    .catch(() => {});
}

type Task = NonNullable<typeof missionRunSchema.$inferSelect['plan']>['tasks'][number];
type Artifact = NonNullable<typeof missionRunSchema.$inferSelect['artifacts']>[number];

const ARTIFACT_URL_RE = /\/artifacts\/[\w.-]+/;

function depsSatisfied(task: Task, tasks: Task[]): boolean {
  if (!task.dependsOn?.length) {
    return true;
  }
  return task.dependsOn.every(d => tasks.find(t => t.id === d)?.status === 'completed');
}

function taskMessage(opts: { brief: string; goal?: string | null; task: Task; priorOutputs: string }): string {
  return [
    `You are working one task of a team mission.`,
    `Mission brief: ${opts.brief}`,
    opts.goal ? `Mission goal: ${opts.goal}` : '',
    opts.priorOutputs ? `\nWork already done by the team:\n${opts.priorOutputs}` : '',
    `\nYour task: ${opts.task.title}`,
    `Produce your part. If you create a file/report/image, use your artifact tools and include the resulting URL.`,
  ].filter(Boolean).join('\n');
}

/**
 * Run pending tasks until the plan completes or a task requires approval.
 * Returns the terminal status reached.
 *
 * `resumeMission` claims a run by flipping its status to `running` in the
 * same UPDATE that wins the resume race (vocion-core#112), before this
 * function ever runs. That means every code path below has to land the run
 * somewhere sane — if setup (reading the run, resolving the mission slug) or
 * a `patch()` call throws, the row is stuck at `running` with the one status
 * that can never be reclaimed (the claim's WHERE only matches
 * `awaiting_review`). The outer try/catch exists to close that gap: any
 * throw that isn't already turned into a per-task failure below gets turned
 * into the same `failed` end state a task failure produces, so a reviewer
 * always finds either a resumable run or a plainly failed one — never a
 * card stuck showing "running" forever.
 * @param runId
 * @param orgId
 */
export async function executeMissionRun(runId: number, orgId: string): Promise<string> {
  // Set once the tasks reach an outcome, so a failure to write that outcome
  // down is not mistaken for the work itself failing.
  let outcome: 'completed' | 'failed' | null = null;
  try {
    const [run] = await db.select().from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId)));
    if (!run) {
      throw new Error(`mission run ${runId} not found`);
    }
    const level = clampAutonomyLevel((run.autonomyPolicy as { level?: number } | null)?.level);
    // Resolve the mission slug so mission-scoped tools (update_mission_notes)
    // can persist working memory. Ad-hoc briefs without a template have none.
    const missionSlug = run.missionId
      ? (await db.select({ slug: missionSchema.slug }).from(missionSchema).where(eq(missionSchema.id, run.missionId)))[0]?.slug ?? null
      : null;
    const tasks: Task[] = run.plan?.tasks ?? [];
    const artifacts: Artifact[] = [...(run.artifacts ?? [])];

    await patch(runId, { status: 'running', pauseReason: null });

    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'skipped') {
        continue;
      }
      if (!depsSatisfied(task, tasks)) {
        continue;
      }
      // Autonomy gate: pause for human review before a gated task runs.
      if (taskNeedsApproval(task, level)) {
        task.status = 'awaiting_approval';
        await patch(runId, {
          status: 'awaiting_review',
          pauseReason: `awaiting_approval:${task.id}`,
          pausedAt: new Date(),
          plan: { tasks },
        });
        return 'awaiting_review';
      }

      task.status = 'running';
      await patch(runId, { plan: { tasks } });

      const priorOutputs = tasks
        .filter(t => t.status === 'completed' && t.output)
        .map(t => `- ${t.title}: ${truncate(t.output!, 600)}`)
        .join('\n');

      try {
        const result = await runAgentDeep({
          orgId,
          agentSlug: task.ownerAgentSlug,
          message: taskMessage({ brief: run.brief, goal: run.goal, task, priorOutputs }),
          userId: run.createdBy ?? 'mission',
          missionSlug: missionSlug ?? undefined,
          missionRunId: runId,
        });
        task.status = 'completed';
        task.output = result.response;
        task.traceId = result.traceId;
        for (const call of result.toolCalls) {
          if (call.tool === 'generate_image' || call.tool === 'create_artifact') {
            const url = call.output.match(ARTIFACT_URL_RE)?.[0];
            if (url) {
              artifacts.push({ taskId: task.id, kind: call.tool === 'generate_image' ? 'image' : 'file', url });
            }
          }
        }
      } catch (err) {
        task.status = 'failed';
        task.error = (err as Error).message ?? 'unknown error';
      }
      await patch(runId, { plan: { tasks }, artifacts });
    }

    const anyFailed = tasks.some(t => t.status === 'failed');
    const allDone = tasks.every(t => t.status === 'completed' || t.status === 'skipped' || t.status === 'failed');
    if (allDone) {
      // Remember the outcome before writing it. If the write itself throws,
      // the catch below needs to know the work actually finished.
      outcome = anyFailed ? 'failed' : 'completed';
      const settled = await settleRun(runId, {
        status: outcome,
        completedAt: new Date(),
        error: anyFailed ? 'one or more tasks failed' : null,
      });
      if (!settled) {
        log('info', 'mission run was already settled while its tasks were running, leaving that status alone', { runId, orgId, wouldHaveWritten: outcome });
      }
      return outcome;
    }
    return run.status;
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    // If `outcome` is already set, the tasks finished and the throw came from
    // writing that down — record what really happened instead of relabelling
    // a successful run as failed.
    const finalStatus = outcome ?? 'failed';
    log('error', outcome === null
      ? 'mission run crashed before recording its own outcome — marking it failed rather than leaving it stuck at running'
      : 'mission run finished but could not record its outcome — writing it again', {
      runId,
      orgId,
      finalStatus,
      error: message,
    });
    try {
      await settleRun(runId, {
        status: finalStatus,
        completedAt: new Date(),
        error: finalStatus === 'completed' ? null : message,
      });
    } catch (patchErr) {
      // The database is the problem, so there is nowhere left to record
      // this. The run stays at `running` and needs a person.
      log('error', 'could not record the failed status after a mission run crash — the run may still show as running', {
        runId,
        orgId,
        error: (patchErr as Error).message ?? 'unknown error',
      });
    }
    return finalStatus;
  }
}

async function patch(runId: number, values: Partial<typeof missionRunSchema.$inferInsert>): Promise<void> {
  await db.update(missionRunSchema).set(values).where(eq(missionRunSchema.id, runId));
}

/** A run that reached one of these is done, and nothing here may overwrite it. */
const SETTLED_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/**
 * Write a run's final status, unless someone already settled it.
 *
 * A person can cancel a mission while its tasks are still running, and this
 * loop would otherwise write straight over that with `completed` or
 * `failed` — the cancellation would simply vanish. Keeping the check in the
 * WHERE clause lets the database decide, the same way the resume claim does.
 * @param runId - Which run to settle.
 * @param values - The final status and its accompanying fields.
 * @returns True when this call settled the run, false when it was already settled.
 */
async function settleRun(runId: number, values: Partial<typeof missionRunSchema.$inferInsert>): Promise<boolean> {
  const settled = await db.update(missionRunSchema)
    .set(values)
    .where(and(eq(missionRunSchema.id, runId), notInArray(missionRunSchema.status, [...SETTLED_STATUSES])))
    .returning({ id: missionRunSchema.id });
  return settled.length > 0;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
