/**
 * Mission runtime — executes a mission's task graph by dispatching each task
 * to its owning agent via the deepagents runtime (runAgentDeep). Honors the
 * autonomy ladder (gated tasks pause the run for human review) and persists
 * state to mission_run after every task, so a run is resumable.
 *
 * MVP: runs in-process to completion or to the first approval gate. Durable,
 * crash-safe, multi-day sessions (Temporal) are Phase 2.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { missionRunSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import { clampAutonomyLevel, taskNeedsApproval } from './autonomy';

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
 * @param runId
 * @param orgId
 */
export async function executeMissionRun(runId: number, orgId: string): Promise<string> {
  const [run] = await db.select().from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId)));
  if (!run) {
    throw new Error(`mission run ${runId} not found`);
  }
  const level = clampAutonomyLevel((run.autonomyPolicy as { level?: number } | null)?.level);
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
    const status = anyFailed ? 'failed' : 'completed';
    await patch(runId, { status, completedAt: new Date(), error: anyFailed ? 'one or more tasks failed' : null });
    return status;
  }
  return run.status;
}

async function patch(runId: number, values: Partial<typeof missionRunSchema.$inferInsert>): Promise<void> {
  await db.update(missionRunSchema).set(values).where(eq(missionRunSchema.id, runId));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
