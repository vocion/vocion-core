/**
 * Mission runtime — executes a mission's task graph by dispatching each task
 * to its owning agent via the deepagents runtime (runAgentDeep). Honors the
 * autonomy ladder (gated tasks pause the run for human review) and persists
 * state to mission_run after every task, so a run is resumable.
 *
 * MVP: runs in-process to completion or to the first approval gate. Durable,
 * crash-safe, multi-day sessions (Temporal) are Phase 2.
 */

import type { MissionRunCompletedPayload } from '@/services/EventService';
import { and, eq, notInArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { missionRunSchema, missionSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { clampAutonomyLevel, taskNeedsApproval } from './autonomy';
import { describeTaskFailure } from './failure';

/**
 * Log through a dynamic import.
 *
 * `libs/Logger` used to open with a top-level await, and this file sits in
 * the Temporal worker's import chain, which tsx compiles as CommonJS, where
 * that await stopped the worker booting. The await is gone now, the sink
 * being configured in the background instead, but the import stays dynamic
 * so this file adds no static edge into the logger's import graph, which
 * `scripts/temporal-worker.imports.test.ts` guards. Same approach as
 * `libs/Langfuse.ts`.
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

// Matches the authenticated route (`/api/artifacts/<id>/<file>`) and the pre-0095 static path.
const ARTIFACT_URL_RE = /\/(?:api\/)?artifacts\/[\w.-]+(?:\/[\w.-]+)?/;

function depsSatisfied(task: Task, tasks: Task[]): boolean {
  if (!task.dependsOn?.length) {
    return true;
  }
  return task.dependsOn.every(d => tasks.find(t => t.id === d)?.status === 'completed');
}

/** A task in one of these has an outcome and is never picked up again in the same call. */
const FINISHED_TASK_STATUSES = new Set<Task['status']>(['completed', 'skipped', 'failed']);

/**
 * The next task this call can run: not attempted yet in this call, not
 * completed or skipped, and every task it depends on completed.
 *
 * Picking the next task from the whole plan each time, rather than walking
 * the array once, means a task listed before the task it depends on still
 * runs once that dependency completes. A task that failed in an earlier call
 * is still picked up again, as it always was on a resume; `attempted` only
 * stops the same call running it twice. It holds the task objects, not their
 * ids, so a plan saved before ids were made unique still runs both of two
 * tasks that share one.
 * @param tasks - The live plan.
 * @param attempted - Tasks this call has already run or gated.
 * @returns The task to run next, or undefined when nothing else can run.
 */
function nextRunnableTask(tasks: Task[], attempted: Set<Task>): Task | undefined {
  return tasks.find(task =>
    !attempted.has(task)
    && task.status !== 'completed'
    && task.status !== 'skipped'
    && depsSatisfied(task, tasks));
}

/**
 * Why a task that is still waiting can never run, in words for the run page.
 * @param task - A task still waiting on its dependencies.
 * @param tasks - The live plan.
 * @returns The reason, or null when a dependency may yet be skipped for its own reason.
 */
function unreachableReason(task: Task, tasks: Task[]): string | null {
  for (const dependencyId of task.dependsOn ?? []) {
    const dependency = tasks.find(t => t.id === dependencyId);
    if (!dependency) {
      return `Skipped: it depends on "${dependencyId}", which is not in the plan.`;
    }
    if (dependency.status === 'failed') {
      return `Skipped: it depends on "${dependency.title}", which failed.`;
    }
    if (dependency.status === 'skipped') {
      return `Skipped: it depends on "${dependency.title}", which was skipped.`;
    }
  }
  return null;
}

/**
 * Mark every task whose dependency failed, was skipped, or is not in the
 * plan as `skipped`, each with its reason. Worked out in rounds, so a task
 * two steps from the failure says which task it was waiting on.
 * @param tasks - The live plan; skipped tasks are changed in place.
 * @returns How many tasks were skipped.
 */
function skipTasksWaitingOnADeadEnd(tasks: Task[]): number {
  let skipped = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of tasks) {
      if (FINISHED_TASK_STATUSES.has(task.status)) {
        continue;
      }
      const reason = unreachableReason(task, tasks);
      if (reason) {
        task.status = 'skipped';
        task.error = reason;
        skipped += 1;
        changed = true;
      }
    }
  }
  return skipped;
}

/**
 * Whether a task waits on itself: following what it depends on, through
 * tasks that have not finished, leads back to it.
 * @param task - A task still waiting on its dependencies.
 * @param tasks - The live plan.
 * @returns True when the task is part of a dependency loop.
 */
function dependsOnItself(task: Task, tasks: Task[]): boolean {
  const toVisit = [...(task.dependsOn ?? [])];
  const visited = new Set<string>();
  while (toVisit.length > 0) {
    const dependencyId = toVisit.pop()!;
    if (dependencyId === task.id) {
      return true;
    }
    if (visited.has(dependencyId)) {
      continue;
    }
    visited.add(dependencyId);
    const dependency = tasks.find(t => t.id === dependencyId);
    if (dependency && !FINISHED_TASK_STATUSES.has(dependency.status)) {
      toVisit.push(...(dependency.dependsOn ?? []));
    }
  }
  return false;
}

/**
 * Mark every task that can no longer run as `skipped`, each with its reason.
 *
 * Called once nothing else is runnable. Without it, the dependents of a
 * failed task sat at `pending` for ever, the plan never counted as done, and
 * the run stayed at `running` with nobody told (vocion-core#121). The same
 * holds for a planner that named a dependency that does not exist, or two
 * tasks that depend on each other.
 *
 * Only the tasks inside a dependency loop get the loop reason. A task that
 * merely waits on the loop is marked afterwards, and says which task of the
 * loop it was waiting on, so nobody goes looking for a loop through it.
 * @param tasks - The live plan; skipped tasks are changed in place.
 * @returns How many tasks were skipped.
 */
function skipUnreachableTasks(tasks: Task[]): number {
  let skipped = skipTasksWaitingOnADeadEnd(tasks);
  const inALoop = tasks.filter(task => !FINISHED_TASK_STATUSES.has(task.status) && dependsOnItself(task, tasks));
  for (const task of inALoop) {
    task.status = 'skipped';
    task.error = 'Skipped: the tasks it depends on also depend on it, so none of them could start.';
    skipped += 1;
  }
  skipped += skipTasksWaitingOnADeadEnd(tasks);
  return skipped;
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
 * a status write throws, the row is stuck at `running` with the one status
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

    // Every status write from here on is refused once a person has cancelled
    // the run, and a refusal means stop: no further task starts
    // (vocion-core#123). The task already in flight when the cancel lands
    // cannot be interrupted, but its output is still kept (`saveProgress`).
    if (!(await writeUnlessSettled(runId, { status: 'running', pauseReason: null }))) {
      return await currentStatus(runId);
    }

    const attempted = new Set<Task>();
    let task = nextRunnableTask(tasks, attempted);
    while (task) {
      attempted.add(task);
      // Autonomy gate: pause for human review before a gated task runs.
      if (taskNeedsApproval(task, level)) {
        task.status = 'awaiting_approval';
        const paused = await writeUnlessSettled(runId, {
          status: 'awaiting_review',
          pauseReason: `awaiting_approval:${task.id}`,
          pausedAt: new Date(),
          plan: { tasks },
        });
        return paused ? 'awaiting_review' : await currentStatus(runId);
      }

      task.status = 'running';
      // The run page draws each task as a step with its duration.
      task.startedAt = new Date().toISOString();
      delete task.endedAt;
      if (!(await writeUnlessSettled(runId, { plan: { tasks } }))) {
        return await currentStatus(runId);
      }

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
        task.error = describeTaskFailure(err);
        log('error', 'mission task failed', { runId, taskId: task.id, error: task.error });
      }
      task.endedAt = new Date().toISOString();
      const statusNow = await saveProgress(runId, { plan: { tasks }, artifacts });
      if (isSettled(statusNow)) {
        return statusNow;
      }
      task = nextRunnableTask(tasks, attempted);
    }

    // Nothing else can run, so whatever is still waiting never will. After
    // this every task has an outcome, so the run always settles here; the
    // only other exit from the loop is the approval gate above.
    const unreachable = skipUnreachableTasks(tasks);
    const anyFailed = tasks.some(t => t.status === 'failed');
    // Remember the outcome before writing it. If the write itself throws,
    // the catch below needs to know the work actually finished.
    outcome = anyFailed || unreachable > 0 ? 'failed' : 'completed';
    const settled = await writeUnlessSettled(runId, {
      status: outcome,
      completedAt: new Date(),
      error: anyFailed
        ? 'one or more tasks failed'
        : unreachable > 0 ? 'one or more tasks could not run because a task they depend on never completed' : null,
      // Carries the skipped tasks and their reasons onto the run page.
      plan: { tasks },
    });
    if (!settled) {
      log('info', 'mission run was already settled while its tasks were running, leaving that status alone', { runId, orgId, wouldHaveWritten: outcome });
    } else if (outcome === 'completed') {
      await announceCompleted(run, missionSlug, tasks);
    }
    return outcome;
  } catch (err) {
    const message = describeTaskFailure(err);
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
      await writeUnlessSettled(runId, {
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

/**
 * Raise `mission_run.completed` for a run this loop just settled as
 * completed — once, because `writeUnlessSettled` said this call was the one that
 * wrote it. A check-mode run (an automation's mission check) says so in
 * `mode`, so a debrief automation can filter it out; the chain of fires
 * behind the run rides along too, so the automation that started it is
 * refused by the matcher whether or not the debrief filtered
 * (`services/automations/fireGuards.ts`). A failure
 * to record the event is logged and never re-labels the run.
 * @param run - The run row as it was read at the start of the loop.
 * @param missionSlug - The template's slug, when the run has one.
 * @param tasks - The plan as it ended.
 */
async function announceCompleted(run: typeof missionRunSchema.$inferSelect, missionSlug: string | null, tasks: Task[]): Promise<void> {
  const last = [...tasks].reverse().find(t => t.status === 'completed' && t.output);
  const payload: MissionRunCompletedPayload = {
    missionRunId: run.id,
    missionId: run.missionId ?? null,
    missionSlug,
    title: run.title,
    agentSlug: run.team.lead,
    mode: tasks.length === 1 && tasks[0]!.id === 'scheduled-check' ? 'check' : 'planned',
    summary: truncate(last?.output ?? '', 500),
    tasksTotal: tasks.length,
    tasksFailed: tasks.filter(t => t.status === 'failed').length,
    completedAt: new Date().toISOString(),
  };
  try {
    const { emitEvent, MISSION_RUN_COMPLETED } = await import('@/services/EventService');
    await emitEvent({
      orgId: run.orgId,
      type: MISSION_RUN_COMPLETED,
      payload,
      dedupeKey: `${MISSION_RUN_COMPLETED}:${run.id}`,
      invokedBy: `mission_run:${run.id}`,
      // The fires behind this run ride the event, so the automation whose
      // check this was is skipped by the matcher rather than fired again.
      causedBy: run.causedBy?.map((link, i) => (i === 0 ? { ...link, missionRunId: run.id } : link)) ?? null,
    });
  } catch (error) {
    log('warn', 'mission run completed but its event could not be raised', { runId: run.id, orgId: run.orgId, error: (error as Error).message ?? 'unknown error' });
  }
}

/** A run that reached one of these is done, and nothing here may overwrite it. */
const SETTLED_STATUSES = ['completed', 'failed', 'cancelled'] as const;

/**
 * Has the run reached an end state — most often, has a person cancelled it?
 * @param status - A `mission_run.status` value.
 */
function isSettled(status: string): boolean {
  return (SETTLED_STATUSES as readonly string[]).includes(status);
}

/**
 * Write to the run, unless someone already settled it.
 *
 * A person can cancel a mission while its tasks are still running, and this
 * loop would otherwise write straight over that with `running`,
 * `awaiting_review`, `completed` or `failed` — the cancellation would simply
 * vanish. Keeping the check in the WHERE clause lets the database decide, the
 * same way the resume claim does. Every write that changes the status, or
 * marks a task as started, goes through here.
 * @param runId - Which run to write.
 * @param values - The fields to write.
 * @returns True when the write happened, false when the run was already settled.
 */
async function writeUnlessSettled(runId: number, values: Partial<typeof missionRunSchema.$inferInsert>): Promise<boolean> {
  const written = await db.update(missionRunSchema)
    .set(values)
    .where(and(eq(missionRunSchema.id, runId), notInArray(missionRunSchema.status, [...SETTLED_STATUSES])))
    .returning({ id: missionRunSchema.id });
  return written.length > 0;
}

/**
 * Save a finished task's output and artifacts, and report the run's status.
 *
 * Unlike {@link writeUnlessSettled} this write is never refused: a task that
 * finished after a person cancelled the run still did its work, and the run
 * page should show what it produced. It writes no status, so it cannot undo
 * the cancel. The status it reads back is how the loop learns of a cancel
 * and stops before starting the next task.
 * @param runId - Which run the task belongs to.
 * @param values - The plan and artifacts as they stand after the task.
 * @returns The run's status after the write.
 */
async function saveProgress(runId: number, values: Pick<typeof missionRunSchema.$inferInsert, 'plan' | 'artifacts'>): Promise<string> {
  const [row] = await db.update(missionRunSchema)
    .set(values)
    .where(eq(missionRunSchema.id, runId))
    .returning({ status: missionRunSchema.status });
  if (!row) {
    throw new Error(`mission run ${runId} no longer exists`);
  }
  return row.status;
}

/**
 * The run's status as stored, read when a write was refused because it was settled.
 * @param runId - Which run.
 */
async function currentStatus(runId: number): Promise<string> {
  const [row] = await db.select({ status: missionRunSchema.status }).from(missionRunSchema).where(eq(missionRunSchema.id, runId));
  if (!row) {
    throw new Error(`mission run ${runId} no longer exists`);
  }
  return row.status;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
