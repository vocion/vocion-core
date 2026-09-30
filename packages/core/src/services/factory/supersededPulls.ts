/**
 * AN ATTEMPT THAT WAS REPLACED CLOSES ITS PULL REQUEST (Chris, 2026-09-30: "I'm
 * also seeing a bunch of work piled in PR or merge. I don't want to be
 * responsible for everything"). Every retry opened a new pull request and
 * nothing closed the one it replaced: squatch-core had 30 open, all green, nine
 * of them attempts at one feature that had already shipped.
 *
 * A task's pull request is closed, with one comment naming what replaced it,
 * when the task was superseded (`abandoned`, with `supersededBy`) or its request
 * is closed (`libs/factory/requestStates.ts`). Merged pull requests are never
 * touched and the branch stays, so a later attempt can still continue from it.
 * Runs on the sweep, so a pile that exists when this ships clears by itself.
 */

import { CLOSED_REQUEST_STATES } from '@/libs/factory/requestStates';

type Meta = Record<string, unknown>;
type Task = { id: number; status: string | null; meta: Meta };

/** The most pull requests one sweep closes, so a large pile clears over a few sweeps. */
const PER_SWEEP = 20;

/**
 * The pull request a task opened, when it has one.
 * @param meta
 */
export function taskPullUrl(meta: Meta): string | null {
  const url = typeof meta.prUrl === 'string' ? meta.prUrl : typeof meta.pr_url === 'string' ? meta.pr_url : null;
  return url && /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+/.test(url) ? url : null;
}

/**
 * Why a task's open pull request should close, or null when it should stay.
 * @param task - The engineering task.
 * @param requestState - Its request's state, when known.
 * @param replacement - The task that superseded it, when there is one.
 * @param replacement.id - Its id.
 * @param replacement.prUrl - Its pull request, when it opened one.
 */
export function closeReason(task: Task, requestState: string | null, replacement: { id: number; prUrl: string | null } | null): string | null {
  if (!taskPullUrl(task.meta) || task.meta.prClosedAt) {
    return null;
  }
  if (task.status === 'abandoned' || Number(task.meta.supersededBy) > 0) {
    const next = replacement
      ? `task #${replacement.id}${replacement.prUrl ? ` (${replacement.prUrl})` : ''}`
      : 'a later attempt';
    return `Closed by the Vocion factory: this attempt was replaced by ${next}. The branch is kept, so the work here is not lost.`;
  }
  if (requestState && CLOSED_REQUEST_STATES.has(requestState)) {
    return `Closed by the Vocion factory: the request is ${requestState.replace(/_/g, ' ')}, so this attempt will not merge. The branch is kept.`;
  }
  return null;
}

/**
 * Close the open pull requests of replaced attempts and closed requests.
 * @param orgId - The workspace.
 * @param deps - What it reaches outside itself; real by default.
 * @param deps.tasks - Every engineering task with its metadata.
 * @param deps.requestState - A request's state.
 * @param deps.close - Close one pull request with a comment.
 * @param deps.mark - Record on the task that its pull request was closed.
 */
export async function closeSupersededPulls(orgId: string, deps?: {
  tasks: () => Promise<Task[]>;
  requestState: (id: number) => Promise<string | null>;
  close: (url: string, comment: string) => Promise<{ closed: boolean; state: string }>;
  mark: (taskId: number, at: string, state: string) => Promise<void>;
}): Promise<{ closed: number[]; failed: Array<{ taskId: number; message: string }> }> {
  const d = deps ?? await realDeps(orgId);
  const tasks = await d.tasks();
  const byId = new Map(tasks.map(t => [t.id, t]));
  const states = new Map<number, string | null>();
  const out = { closed: [] as number[], failed: [] as Array<{ taskId: number; message: string }> };
  for (const task of tasks) {
    if (out.closed.length + out.failed.length >= PER_SWEEP) {
      break;
    }
    const requestId = Number(task.meta.requestId);
    if (requestId > 0 && !states.has(requestId)) {
      states.set(requestId, await d.requestState(requestId).catch(() => null));
    }
    const next = byId.get(Number(task.meta.supersededBy));
    const reason = closeReason(task, requestId > 0 ? states.get(requestId) ?? null : null, next ? { id: next.id, prUrl: taskPullUrl(next.meta) } : null);
    if (!reason) {
      continue;
    }
    try {
      const res = await d.close(taskPullUrl(task.meta)!, reason);
      await d.mark(task.id, new Date().toISOString(), res.state);
      if (res.closed) {
        out.closed.push(task.id);
      }
    } catch (err) {
      out.failed.push({ taskId: task.id, message: (err as Error).message.slice(0, 300) });
    }
  }
  if (out.closed.length > 0 || out.failed.length > 0) {
    console.warn('factory: superseded pull requests', { orgId, closed: out.closed, failed: out.failed });
  }
  return out;
}

async function realDeps(orgId: string) {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const { listBusinessObjects, getBusinessObject } = await import('@/services/BusinessObjectService');
  const { closePull } = await import('./githubMerge');
  return {
    tasks: async () => ((await listBusinessObjects(orgId, 'engineering_task').catch(() => [])) as Array<{ id: number; status: string | null; metadata: unknown }>)
      .map(r => ({ id: r.id, status: r.status, meta: (r.metadata ?? {}) as Meta })),
    requestState: async (id: number) => {
      const row = await getBusinessObject(id, orgId).catch(() => null) as { metadata?: unknown } | null;
      const state = (row?.metadata as Meta | undefined)?.state;
      return typeof state === 'string' ? state : null;
    },
    close: (url: string, comment: string) => closePull(orgId, url, comment),
    mark: async (taskId: number, at: string, state: string) => {
      await db.update(businessObjectSchema)
        .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify({ prClosedAt: at, prStateWhenClosed: state })}::jsonb` })
        .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, taskId)));
    },
  };
}
