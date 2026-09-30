import type { LiveMissionRunInput, LiveRun, LiveWorkerRunInput } from '@/libs/factory/liveStatus';
import type { PageRow } from '@/libs/workspace/pageFields';
import { and, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { readDelivery } from '@/libs/factory/delivery';
import { pickLive, prLabel } from '@/libs/factory/liveStatus';
import { laneOf } from '@/libs/workspace/workQueue';
import { automationRunSchema, missionRunSchema, toolCallSchema, workerRunSchema } from '@/models/Schema';
import { taskStatus } from './featureReport';
import { recoveryStage } from './recovery';

/**
 * THE NOW LINE'S RECORDS, read for one record or for a page of them in one
 * pass (`libs/factory/liveStatus.ts` decides what the line says).
 *
 * An agent run is working on a record when it is live (its own status) and
 * either the automation fire that started it names the record in its input
 * (`automation_run.input.requestId` → `target_run_id`), or one of its tool
 * calls read or wrote the record or one of its tasks by id. Neither reads
 * which automation it was: the planning run, a reviewer's run and whatever a
 * workspace adds next are found the same way.
 *
 * Bounded: live agent runs are few, and only the last day's are read; the
 * fires and tool calls are read for those runs only.
 */

/** How far back a run can have started and still be the one carrying work. */
const LIVE_WINDOW_MS = 24 * 3_600_000;

/** Mission-run statuses that still move without a person — `isLiveStatus`'s set, for SQL. */
const MISSION_LIVE = ['planning', 'running', 'paused'];

/** Worker-run statuses that are queued or going. */
const WORKER_LIVE = ['queued', 'claimed', 'running', 'paused'];

/**
 * The record id a tool call names in its input — the same keys the feature
 * page's Connected work reads (`featureReportData.loadActivity`).
 */
export const toolCallNamedId = sql<string>`coalesce(${toolCallSchema.input}->>'id', ${toolCallSchema.input}->>'object_id', ${toolCallSchema.input}#>>'{action_input,objectId}', ${toolCallSchema.input}#>>'{input,id}')`;

/**
 * The task a worker run was queued for — `input.record`, the same ref
 * `WorkerRunService.runRecord` reads — or null.
 * @param input - `worker_run.input`.
 * @param taskType - The factory's task type (`libs/factory/types.ts`).
 */
export function taskOfRun(input: Record<string, unknown>, taskType: string): number | null {
  const rec = input.record;
  if (!rec || typeof rec !== 'object') {
    return null;
  }
  const { type, id } = rec as Record<string, unknown>;
  const n = typeof id === 'number' ? id : Number(id);
  return type === taskType && Number.isInteger(n) && n > 0 ? n : null;
}

/** One record and the records beneath it (its tasks), by id. */
export type LiveSubject = { recordId: number; childIds: number[] };

/**
 * The plan task a mission run is on, when its plan says.
 * @param plan - `mission_run.plan`.
 */
function stepOf(plan: unknown): string | null {
  const tasks = (plan as { tasks?: Array<{ title?: string; status?: string }> } | null)?.tasks ?? [];
  const on = tasks.find(t => t.status === 'running');
  return on?.title?.trim() || null;
}

/**
 * Live agent runs working on each subject.
 * @param orgId - Tenant.
 * @param subjects - The records, each with its children.
 * @param now - The clock.
 * @returns Record id → the live agent runs on it (possibly empty).
 */
export async function loadLiveMissionRuns(orgId: string, subjects: readonly LiveSubject[], now: Date = new Date()): Promise<Map<number, LiveMissionRunInput[]>> {
  const out = new Map<number, LiveMissionRunInput[]>(subjects.map(s => [s.recordId, []]));
  if (subjects.length === 0) {
    return out;
  }
  const runs = await db
    .select({ id: missionRunSchema.id, title: missionRunSchema.title, status: missionRunSchema.status, createdAt: missionRunSchema.createdAt, plan: missionRunSchema.plan })
    .from(missionRunSchema)
    .where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.status, MISSION_LIVE), gt(missionRunSchema.createdAt, new Date(now.getTime() - LIVE_WINDOW_MS))));
  if (runs.length === 0) {
    return out;
  }
  const runIds = runs.map(r => r.id);
  const ownerOf = new Map<string, number>();
  for (const s of subjects) {
    ownerOf.set(String(s.recordId), s.recordId);
    for (const c of s.childIds) {
      ownerOf.set(String(c), s.recordId);
    }
  }
  const [fires, calls] = await Promise.all([
    db
      .select({ targetRunId: automationRunSchema.targetRunId, requestId: sql<string | null>`${automationRunSchema.input}->>'requestId'` })
      .from(automationRunSchema)
      .where(and(eq(automationRunSchema.orgId, orgId), isNotNull(automationRunSchema.targetRunId), inArray(automationRunSchema.targetRunId, runIds))),
    db
      .selectDistinct({ missionRunId: toolCallSchema.missionRunId, named: toolCallNamedId })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.missionRunId, runIds), inArray(toolCallNamedId, [...ownerOf.keys()]))),
  ]);
  const forRecord = new Map<number, Set<number>>();
  const touched = new Map<number, Set<number>>();
  for (const f of fires) {
    const owner = f.requestId !== null && Number(f.requestId) > 0 ? out.has(Number(f.requestId)) ? Number(f.requestId) : null : null;
    if (owner !== null && f.targetRunId !== null) {
      forRecord.set(f.targetRunId, (forRecord.get(f.targetRunId) ?? new Set()).add(owner));
    }
  }
  for (const c of calls) {
    const owner = ownerOf.get(String(c.named));
    if (owner !== undefined && c.missionRunId !== null) {
      touched.set(c.missionRunId, (touched.get(c.missionRunId) ?? new Set()).add(owner));
    }
  }
  for (const r of runs) {
    const owners = new Set([...(forRecord.get(r.id) ?? []), ...(touched.get(r.id) ?? [])]);
    for (const owner of owners) {
      out.get(owner)!.push({ id: r.id, status: r.status, title: r.title, startedAt: r.createdAt, step: stepOf(r.plan), forRecord: forRecord.get(r.id)?.has(owner) === true });
    }
  }
  return out;
}

/**
 * Queued and running engineering runs, by the child record (task) id their
 * input names.
 * @param orgId - Tenant.
 * @param taskOf - Reads a run's input and returns the task id it is for, or null.
 */
export async function loadLiveWorkerRuns(orgId: string, taskOf: (input: Record<string, unknown>) => number | null): Promise<Map<number, Array<Omit<LiveWorkerRunInput, 'n'> & { attempt: number | null }>>> {
  const rows = await db
    .select({ id: workerRunSchema.id, status: workerRunSchema.status, createdAt: workerRunSchema.createdAt, claimedAt: workerRunSchema.claimedAt, progress: workerRunSchema.progress, input: workerRunSchema.input, attempt: workerRunSchema.attempt })
    .from(workerRunSchema)
    .where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.status, WORKER_LIVE)));
  const out = new Map<number, Array<Omit<LiveWorkerRunInput, 'n'> & { attempt: number | null }>>();
  for (const r of rows) {
    const task = taskOf((r.input ?? {}) as Record<string, unknown>);
    if (task !== null) {
      out.set(task, [...(out.get(task) ?? []), { id: r.id, status: r.status, createdAt: r.createdAt, claimedAt: r.claimedAt ?? null, progress: (r.progress ?? {}) as Record<string, unknown>, attempt: r.attempt ?? null }]);
    }
  }
  return out;
}

/** A record row as the Work page holds it. */
type Row = { id: number | string; status?: string | null; meta: Record<string, unknown> };

/**
 * THE NOW LINE FOR A PAGE OF RECORDS, in one read: each record's live run, or
 * null. The same pick the feature report makes (`pickLive`), from the same
 * stage facts: planning from the record's own recovery stage, reviewing from
 * a child waiting on QA.
 * @param orgId - Tenant.
 * @param records - The rows to read it for.
 * @param children - Their children (tasks), each naming its record in `meta.requestId`.
 * @param taskOf - Reads a worker run's input and returns the child id it is for.
 * @param now - The clock.
 */
export async function loadLiveRuns(orgId: string, records: readonly Row[], children: readonly Row[], taskOf: (input: Record<string, unknown>) => number | null, now: Date = new Date()): Promise<Map<number, LiveRun | null>> {
  const out = new Map<number, LiveRun | null>();
  if (records.length === 0) {
    return out;
  }
  const childrenOf = new Map<number, Row[]>();
  for (const c of children) {
    const rid = Number(c.meta.requestId);
    if (Number.isSafeInteger(rid) && rid > 0) {
      childrenOf.set(rid, [...(childrenOf.get(rid) ?? []), c]);
    }
  }
  const subjects = records.map(r => ({ recordId: Number(r.id), childIds: (childrenOf.get(Number(r.id)) ?? []).map(c => Number(c.id)) }));
  const [agents, workers] = await Promise.all([loadLiveMissionRuns(orgId, subjects, now), loadLiveWorkerRuns(orgId, taskOf)]);
  for (const r of records) {
    const id = Number(r.id);
    const kids = childrenOf.get(id) ?? [];
    const review = kids.find(k => taskStatus({ id: Number(k.id), title: '', status: k.status ?? null, createdAt: null, meta: k.meta }) === 'awaiting_review');
    const runs = kids.flatMap(k => workers.get(Number(k.id)) ?? []);
    out.set(id, pickLive({
      // The attempt number is the report's to count (it reads every run);
      // a page of rows reads only the live ones, so it names none.
      workerRuns: runs.map(w => ({ ...w, n: 1 })),
      missionRuns: agents.get(id) ?? [],
      delivery: readDelivery(r.meta),
      context: {
        planning: recoveryStage(r.meta)?.stage === 'planning',
        reviewing: review ? { pr: prLabel(typeof review.meta.prUrl === 'string' ? review.meta.prUrl : null) } : null,
      },
    }));
  }
  return out;
}

/**
 * The Work page's Now lines: one batched read for every row in progress.
 * @param orgId - Tenant.
 * @param rows - The page's record rows.
 * @param tasks - Their tasks.
 * @param now - The clock.
 */
export async function loadWorkLive(orgId: string, rows: readonly PageRow[], tasks: readonly PageRow[], now: Date = new Date()): Promise<Map<number, LiveRun | null>> {
  const inProgress = rows.filter(r => laneOf(r) === 'progress');
  const { factoryTypes } = await import('@/libs/factory/types');
  const taskType = (await factoryTypes(orgId)).task;
  return loadLiveRuns(orgId, inProgress, tasks, input => taskOfRun(input, taskType), now).catch(() => new Map());
}
