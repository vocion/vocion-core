/**
 * WHAT IS RUNNING — the long and background work behind a conversation, read
 * from the run records the platform already keeps: mission runs, workflow
 * runs, automation runs and worker runs. No table of its own.
 *
 * The chat's "N running ›" chip and its panel read this (founder, 2026-10-09,
 * after Claude Code's "1 background task stopped, 1 running ›"): what is
 * running now, with Stop where the run has a stop; what finished since the
 * conversation began, folded; each one linking to its run.
 *
 * Not listed: a source sync — no row records a sync in progress, only when it
 * last finished, so there is nothing true to say about one that is running.
 *
 * Tenant scoping: every read is keyed on the workspace (`org_id`).
 */

import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { automationRunSchema, missionRunSchema, workerRunSchema, workflowRunSchema, workflowSchema } from '@/models/Schema';

export type WorkKind = 'mission' | 'workflow' | 'automation' | 'worker';

export type WorkItem = {
  /** `<kind>:<id>` — what Stop names. */
  key: string;
  kind: WorkKind;
  /** What it is, in words. */
  title: string;
  /** What kind of work it is, for the second line ("Mission", "Workflow"). */
  what: string;
  state: 'running' | 'done' | 'failed' | 'stopped' | 'waiting';
  startedAt: string;
  endedAt: string | null;
  /** Its run: where the transcript or the result is. */
  href: string;
  /** Whether Stop is offered: only where the run has a stop. */
  canStop: boolean;
};

export type WorkView = { running: WorkItem[]; finished: WorkItem[] };

const LIMIT = 20;

const MISSION_RUNNING = ['planning', 'running'];
const WORKFLOW_RUNNING = ['running', 'pending'];
const WORKER_RUNNING = ['queued', 'claimed', 'running', 'paused'];
/** The worker states `cancelWorkerRun` accepts. */
const WORKER_STOPPABLE = ['queued', 'running', 'paused'];

function missionState(status: string): WorkItem['state'] {
  return MISSION_RUNNING.includes(status) ? 'running' : status === 'completed' ? 'done' : status === 'cancelled' ? 'stopped' : status === 'failed' ? 'failed' : 'waiting';
}

function plainState(status: string, running: readonly string[]): WorkItem['state'] {
  if (running.includes(status)) {
    return 'running';
  }
  return status === 'failed' || status === 'error' ? 'failed' : status === 'cancelled' || status === 'stopped' ? 'stopped' : status === 'awaiting_approval' ? 'waiting' : 'done';
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/**
 * What is running in this workspace, and what finished since `since` —
 * including work that started before it (a mission running when the
 * conversation began and stopped from it).
 * @param orgId - The workspace.
 * @param since - The start of the window (a conversation's start): older finished work is not listed.
 */
export async function workSince(orgId: string, since: Date): Promise<WorkView> {
  const [missions, workflows, automations, workers] = await Promise.all([
    db.select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status, createdAt: missionRunSchema.createdAt, completedAt: missionRunSchema.completedAt })
      .from(missionRunSchema)
      .where(and(eq(missionRunSchema.orgId, orgId), or(inArray(missionRunSchema.status, MISSION_RUNNING), gte(missionRunSchema.createdAt, since), gte(missionRunSchema.completedAt, since))))
      .orderBy(desc(missionRunSchema.createdAt))
      .limit(LIMIT),
    db.select({ id: workflowRunSchema.id, status: workflowRunSchema.status, createdAt: workflowRunSchema.createdAt, completedAt: workflowRunSchema.completedAt, name: workflowSchema.name, slug: workflowSchema.slug })
      .from(workflowRunSchema)
      .innerJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId))
      .where(and(eq(workflowRunSchema.orgId, orgId), or(inArray(workflowRunSchema.status, WORKFLOW_RUNNING), gte(workflowRunSchema.createdAt, since), gte(workflowRunSchema.completedAt, since))))
      .orderBy(desc(workflowRunSchema.createdAt))
      .limit(LIMIT),
    db.select({ id: automationRunSchema.id, slug: automationRunSchema.slug, status: automationRunSchema.status, startedAt: automationRunSchema.startedAt, finishedAt: automationRunSchema.finishedAt, dryRun: automationRunSchema.dryRun })
      .from(automationRunSchema)
      .where(and(eq(automationRunSchema.orgId, orgId), or(eq(automationRunSchema.status, 'running'), gte(automationRunSchema.startedAt, since), gte(automationRunSchema.finishedAt, since))))
      .orderBy(desc(automationRunSchema.startedAt))
      .limit(LIMIT),
    db.select({ id: workerRunSchema.id, agentSlug: workerRunSchema.agentSlug, kind: workerRunSchema.kind, summary: workerRunSchema.summary, status: workerRunSchema.status, createdAt: workerRunSchema.createdAt, completedAt: workerRunSchema.completedAt })
      .from(workerRunSchema)
      .where(and(eq(workerRunSchema.orgId, orgId), or(inArray(workerRunSchema.status, WORKER_RUNNING), gte(workerRunSchema.createdAt, since), gte(workerRunSchema.completedAt, since))))
      .orderBy(desc(workerRunSchema.createdAt))
      .limit(LIMIT),
  ]);

  const items: WorkItem[] = [
    ...missions.map(m => ({ key: `mission:${m.id}`, kind: 'mission' as const, title: m.title, what: 'Mission', state: missionState(m.status), startedAt: m.createdAt.toISOString(), endedAt: iso(m.completedAt), href: `/dashboard/missions/runs/${m.id}`, canStop: MISSION_RUNNING.includes(m.status) })),
    ...workflows.map(w => ({ key: `workflow:${w.id}`, kind: 'workflow' as const, title: w.name, what: 'Workflow', state: plainState(w.status, WORKFLOW_RUNNING), startedAt: w.createdAt.toISOString(), endedAt: iso(w.completedAt), href: `/dashboard/workflows/${encodeURIComponent(w.slug)}`, canStop: false })),
    ...automations.filter(a => !a.dryRun).map(a => ({ key: `automation:${a.id}`, kind: 'automation' as const, title: a.slug.replace(/[-_]+/g, ' ').replace(/^./, c => c.toUpperCase()), what: 'Automation', state: plainState(a.status, ['running']), startedAt: a.startedAt.toISOString(), endedAt: iso(a.finishedAt), href: '/dashboard/automations', canStop: false })),
    ...workers.map(w => ({ key: `worker:${w.id}`, kind: 'worker' as const, title: w.summary?.trim() || `${w.kind === 'worker' ? 'Engineering task' : w.kind} for ${w.agentSlug}`, what: 'Background task', state: plainState(w.status, WORKER_RUNNING), startedAt: w.createdAt.toISOString(), endedAt: iso(w.completedAt), href: '/dashboard/activity', canStop: WORKER_STOPPABLE.includes(w.status) })),
  ];
  const newest = (a: WorkItem, b: WorkItem) => (b.endedAt ?? b.startedAt).localeCompare(a.endedAt ?? a.startedAt);
  return {
    running: items.filter(i => i.state === 'running').sort(newest),
    finished: items.filter(i => i.state !== 'running' && new Date(i.endedAt ?? i.startedAt) >= since).sort(newest).slice(0, LIMIT),
  };
}

/**
 * Stop one piece of running work, where its run has a stop: a mission run is
 * cancelled, a worker run asked to stop. Anything else is refused.
 * @param orgId - The workspace.
 * @param key - `<kind>:<id>`.
 * @returns Whether it was stopped.
 */
export async function stopWork(orgId: string, key: string): Promise<boolean> {
  const [kind, raw] = key.split(':');
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    return false;
  }
  if (kind === 'mission') {
    // Only a run of this workspace that is still running: a finished run keeps its ending.
    const [run] = await db.select({ status: missionRunSchema.status }).from(missionRunSchema).where(and(eq(missionRunSchema.id, id), eq(missionRunSchema.orgId, orgId))).limit(1);
    if (!run || !MISSION_RUNNING.includes(run.status)) {
      return false;
    }
    const { cancelMission } = await import('@/services/MissionService');
    await cancelMission(id, orgId, 'stopped from the chat');
    return true;
  }
  if (kind === 'worker') {
    const [run] = await db.select({ status: workerRunSchema.status }).from(workerRunSchema).where(and(eq(workerRunSchema.id, id), eq(workerRunSchema.orgId, orgId))).limit(1);
    if (!run || !WORKER_STOPPABLE.includes(run.status)) {
      return false;
    }
    const { cancelWorkerRun } = await import('@/services/WorkerRunService');
    await cancelWorkerRun(orgId, id);
    return true;
  }
  return false;
}
