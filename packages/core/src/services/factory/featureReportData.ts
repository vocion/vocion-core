/**
 * Gathering one request's records for the feature report.
 *
 * Everything here reads; nothing here decides. The assembly, the honesty
 * rules and the QA evidence convention are in `featureReport.ts`, which
 * takes plain records so it can be tested without a database. This module
 * is the half that knows the tables.
 *
 * How each record is found, which is also how a worker has to file one for
 * it to appear:
 *
 * | record | linked by |
 * |---|---|
 * | `engineering_task` | `metadata.requestId` = the request's id |
 * | `architecture_plan` | `metadata.requestId` = the request's id |
 * | `worker_run` | `input.record` = `{type: 'engineering_task', id}` |
 * | `ask` | an `object_refs` entry for the request or one of its tasks |
 * | `action_run` | `input.requestId` / `input.taskId`, or `input.record` |
 * | `release` | `metadata.requestIds` or `metadata.taskIds` names it |
 * | artifact (QA) | `record_type` `object` + `record_id` = a task id |
 */

import type { FeatureReport, ReportActionRun, ReportArtifact, ReportAsk, ReportObject, ReportWorkerRun } from './featureReport';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema, askSchema, workerRunSchema } from '@/models/Schema';
import { listArtifactsForRecords } from '@/services/ArtifactService';
import { getBusinessObject, listBusinessObjects } from '@/services/BusinessObjectService';
import { assembleFeatureReport } from './featureReport';

type ObjectRow = { id: number; title: string; status: string | null; createdAt: Date | null; metadata: unknown; type?: { slug: string } | null };

/**
 * A business object row as the report reads it.
 * @param row - The row.
 */
function toReportObject(row: ObjectRow): ReportObject {
  return {
    id: row.id,
    title: row.title,
    status: row.status ?? null,
    createdAt: row.createdAt ?? null,
    meta: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

/**
 * A number off free-form JSON, however the writer spelled it.
 * @param source - The bag.
 * @param key - The key.
 */
function idOf(source: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = source?.[key];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Whether a worker run was queued for one of these tasks — `input.record`,
 * the same ref `WorkerRunService.runRecord` reads.
 * @param input - `worker_run.input`.
 * @param taskIds - The task ids.
 */
function runIsForTask(input: Record<string, unknown>, taskIds: Set<number>): boolean {
  const rec = input.record;
  if (!rec || typeof rec !== 'object') {
    return false;
  }
  const { type, id } = rec as Record<string, unknown>;
  const n = typeof id === 'number' ? id : Number(id);
  return type === 'engineering_task' && Number.isInteger(n) && taskIds.has(n);
}

/**
 * Whether an action run is a hand-off about this work. Matched on the ids a
 * proposer puts on the payload; an action that names neither is somebody
 * else's and is left off rather than guessed onto the page.
 * @param input - `action_run.input`.
 * @param requestId - The request.
 * @param taskIds - Its tasks.
 */
function actionIsForWork(input: Record<string, unknown>, requestId: number, taskIds: Set<number>): boolean {
  if (idOf(input, 'requestId') === requestId) {
    return true;
  }
  const taskId = idOf(input, 'taskId');
  if (taskId !== null && taskIds.has(taskId)) {
    return true;
  }
  const rec = input.record as Record<string, unknown> | undefined;
  if (rec && typeof rec === 'object') {
    const n = idOf(rec, 'id');
    if (rec.type === 'request' && n === requestId) {
      return true;
    }
    if (rec.type === 'engineering_task' && n !== null && taskIds.has(n)) {
      return true;
    }
  }
  return false;
}

/**
 * One request's feature report, or null when the org has no such request.
 *
 * Scoped by org on every read. A record that does not name this request is
 * never pulled in on a resemblance — an empty section is the honest answer
 * and the page is built to say so.
 * @param orgId - Tenant.
 * @param requestId - The `request` object's id.
 * @param now - The clock, for the elapsed figure.
 */
export async function loadFeatureReport(orgId: string, requestId: number, now: Date = new Date()): Promise<FeatureReport | null> {
  const row = await getBusinessObject(requestId, orgId);
  if (!row || row.type?.slug !== 'request') {
    return null;
  }
  const request = toReportObject(row as ObjectRow);

  const allTasks = await listBusinessObjects(orgId, 'engineering_task');
  const tasks = allTasks
    .map(t => toReportObject(t as ObjectRow))
    .filter(t => idOf(t.meta, 'requestId') === requestId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const taskIds = new Set(tasks.map(t => t.id));

  // The plan stage. `catch` because a workspace on an older plugin has no such
  // object type, and a missing type is not a plan: the section then says the
  // stage did not happen, which is the honest answer.
  const allPlans = await listBusinessObjects(orgId, 'architecture_plan').catch(() => []);
  const plans = allPlans
    .map(pl => toReportObject(pl as ObjectRow))
    .filter(pl => idOf(pl.meta, 'requestId') === requestId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

  const allReleases = await listBusinessObjects(orgId, 'release').catch(() => []);
  const releases = allReleases
    .map(r => toReportObject(r as ObjectRow))
    .filter((r) => {
      const carriesTask = (Array.isArray(r.meta.taskIds) ? r.meta.taskIds : []).some(id => taskIds.has(Number(id)));
      const carriesRequest = (Array.isArray(r.meta.requestIds) ? r.meta.requestIds : []).some(id => Number(id) === requestId);
      return carriesTask || carriesRequest;
    });

  const [runRows, askRows, actionRows] = await Promise.all([
    taskIds.size === 0
      ? Promise.resolve([])
      : db.select().from(workerRunSchema).where(eq(workerRunSchema.orgId, orgId)),
    db.select().from(askSchema).where(eq(askSchema.orgId, orgId)),
    db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.status, ['pending', 'approved', 'executing', 'done', 'failed', 'rejected', 'undone']))),
  ]);

  const workerRuns: ReportWorkerRun[] = runRows
    .filter(r => runIsForTask((r.input ?? {}) as Record<string, unknown>, taskIds))
    .map(r => ({
      id: r.id,
      agentSlug: r.agentSlug,
      kind: r.kind,
      status: r.status,
      attempt: r.attempt ?? null,
      cents: r.cents ?? null,
      model: r.model ?? null,
      summary: r.summary ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt,
      claimedAt: r.claimedAt ?? null,
      completedAt: r.completedAt ?? null,
      heartbeatAt: r.heartbeatAt ?? null,
      input: (r.input ?? {}) as Record<string, unknown>,
      result: (r.result ?? null) as Record<string, unknown> | null,
      progress: (r.progress ?? {}) as Record<string, unknown>,
    }));

  const asks: ReportAsk[] = askRows
    .filter(a => (a.objectRefs ?? []).some(ref =>
      (ref.type === 'request' && Number(ref.id) === requestId)
      || (ref.type === 'engineering_task' && taskIds.has(Number(ref.id)))))
    .map(a => ({
      id: a.id,
      kind: a.kind,
      title: a.title,
      body: a.body ?? null,
      status: a.status,
      decision: a.decision ?? null,
      decisionNote: a.decisionNote ?? null,
      decidedBy: a.decidedBy ?? null,
      decidedAt: a.decidedAt ?? null,
      decisionCost: a.decisionCost ?? null,
      contextUrl: a.contextUrl ?? null,
      createdAt: a.createdAt,
      objectRefs: a.objectRefs ?? [],
    }));

  const actionRuns: ReportActionRun[] = actionRows
    .filter(a => actionIsForWork((a.input ?? {}) as Record<string, unknown>, requestId, taskIds))
    .map(a => ({
      id: a.id,
      actionId: a.actionId,
      status: a.status,
      input: (a.input ?? {}) as Record<string, unknown>,
      decidedBy: a.decidedBy ?? null,
      decidedAt: a.decidedAt ?? null,
      approvedByAgent: a.approvedByAgent ?? null,
      note: a.regenerateNote ?? null,
      createdAt: a.createdAt,
      executedAt: a.executedAt ?? null,
    }));

  // QA evidence hangs off the TASK, because it proves a change and the change
  // is the task's. VISUALS hang off the REQUEST: a mockup or a flow diagram is
  // what the outcome should look like, and it exists before there is a task to
  // attach it to. Both are ordinary artifacts, so both arrive the same way.
  const visualIds = new Set<string>([String(request.id)]);
  const requestVisuals = (request.meta.visuals ?? {}) as Record<string, unknown>;
  for (const key of ['beforeArtifactIds', 'afterArtifactIds']) {
    const ids = requestVisuals[key];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === 'number' || typeof id === 'string') {
          visualIds.add(String(id));
        }
      }
    }
  }
  const recordIds = [...new Set([...taskIds].map(String).concat([...visualIds]))];
  const artifactRows = recordIds.length === 0
    ? []
    : await listArtifactsForRecords({ orgId, recordType: 'object', recordIds });
  const artifacts: ReportArtifact[] = artifactRows.map(a => ({
    id: a.id,
    kind: a.kind,
    title: a.title,
    recordType: a.recordType ?? null,
    recordId: a.recordId ?? null,
    recordRole: a.recordRole ?? null,
    spec: (a.spec ?? {}) as Record<string, unknown>,
    url: a.url ?? null,
    createdAt: a.createdAt,
  }));

  return assembleFeatureReport({ request, tasks, plans, workerRuns, asks, actionRuns, releases, artifacts, now });
}
