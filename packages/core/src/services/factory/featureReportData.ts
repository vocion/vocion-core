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

import type { FeatureReport, ReportActionRun, ReportActivity, ReportArtifact, ReportAsk, ReportObject, ReportWorkerRun } from './featureReport';
import type { FeatureSpend } from './featureSpend';
import type { FactoryTypes } from '@/libs/factory/types';
import type { RecordOrigin } from '@/services/objects/related';
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { nounCode } from '@/libs/codes';
import { db } from '@/libs/DB';
import { runTitle } from '@/libs/factory/runTitle';
import { factoryTypes } from '@/libs/factory/types';
import { runCostCents } from '@/libs/worker/runCost';
import { actionRunSchema, agentSchema, askSchema, automationRunSchema, automationSchema, conversationSchema, missionRunSchema, toolCallSchema, userSchema, workerRunSchema } from '@/models/Schema';
import { listArtifactsByIds, listArtifactsForRecords } from '@/services/ArtifactService';
import { failedFireLines } from '@/services/automations/failedFires';
import { getBusinessObject, listBusinessObjects } from '@/services/BusinessObjectService';
import { codesForRecords } from '@/services/codes';
import { recordLinkerForOrg } from '@/services/objects/recordHref';
import { recordOrigin } from '@/services/objects/related';
import { REPORTED_ROLE, reportedAttachments } from '@/services/objects/reported';
import { assembleFeatureReport, executedRun, runChange } from './featureReport';
import { loadFeatureSpend, splitOf } from './featureSpend';
import { loadLiveMissionRuns, taskOfRun, toolCallNamedId } from './liveStatusData';
import { loadPullSignals, mergeRiskClassOf, mergeRunsItself } from './pullSignals';

type ObjectRow = { id: number; title: string; status: string | null; createdAt: Date | null; metadata: unknown; type?: { slug: string } | null };

/**
 * A business object row as the report reads it.
 * @param row - The row.
 */
function toReportObject(row: ObjectRow): ReportObject {
  return {
    id: row.id,
    type: row.type?.slug ?? null,
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
 * @param taskType - The factory's task type.
 */
function runIsForTask(input: Record<string, unknown>, taskIds: Set<number>, taskType: string): boolean {
  const n = taskOfRun(input, taskType);
  return n !== null && taskIds.has(n);
}

/**
 * Whether an action run is a hand-off about this work. Matched on the ids a
 * proposer puts on the payload; an action that names neither is somebody
 * else's and is left off rather than guessed onto the page.
 * @param input - `action_run.input`.
 * @param requestId - The request.
 * @param taskIds - Its tasks.
 * @param types - The factory's types.
 */
function actionIsForWork(input: Record<string, unknown>, requestId: number, taskIds: Set<number>, types: FactoryTypes): boolean {
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
    if (rec.type === types.request && n === requestId) {
      return true;
    }
    if (rec.type === types.task && n !== null && taskIds.has(n)) {
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
  const [row, types] = await Promise.all([getBusinessObject(requestId, orgId), factoryTypes(orgId)]);
  if (!row || row.type?.slug !== types.request) {
    return null;
  }
  const request = toReportObject(row as ObjectRow);

  const allTasks = await listBusinessObjects(orgId, types.task);
  const tasks = allTasks
    .map(t => toReportObject(t as ObjectRow))
    .filter(t => idOf(t.meta, 'requestId') === requestId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  const taskIds = new Set(tasks.map(t => t.id));

  // The plan stage. `catch` because a workspace on an older plugin has no such
  // object type, and a missing type is not a plan: the section then says the
  // stage did not happen, which is the honest answer.
  const allPlans = await listBusinessObjects(orgId, types.plan).catch(() => []);
  const plans = allPlans
    .map(pl => toReportObject(pl as ObjectRow))
    .filter(pl => idOf(pl.meta, 'requestId') === requestId)
    .sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));

  const allReleases = await listBusinessObjects(orgId, types.release).catch(() => []);
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
    .filter(r => runIsForTask((r.input ?? {}) as Record<string, unknown>, taskIds, types.task))
    .map(r => ({
      id: r.id,
      agentSlug: r.agentSlug,
      kind: r.kind,
      status: r.status,
      attempt: r.attempt ?? null,
      // One figure: the worker's final account over the heartbeats' sum (`runCost.ts`).
      cents: runCostCents(r),
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
      failures: (r.failures ?? []) as Array<{ scope?: string; message?: string }>,
    }));

  const asks: ReportAsk[] = askRows
    .filter(a => (a.objectRefs ?? []).some(ref =>
      (ref.type === types.request && Number(ref.id) === requestId)
      || (ref.type === types.task && taskIds.has(Number(ref.id)))))
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
    .filter(a => actionIsForWork((a.input ?? {}) as Record<string, unknown>, requestId, taskIds, types))
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
  // Two different kinds of id, read two different ways. The request's own id
  // and its tasks' ids are RECORD ids: every artifact filed against them. The
  // ids under `visuals.beforeArtifactIds` / `mockupArtifactIds` / `afterArtifactIds` are ARTIFACT
  // ids — a picture may live on another record (the Share dialog 87 shipped
  // was captured on request 121) — so they are read by id. They were read as
  // record ids, and a picture filed anywhere but on the request itself never
  // reached its page.
  const requestVisuals = (request.meta.visuals ?? {}) as Record<string, unknown>;
  const pictureIds = new Set<number>();
  for (const key of ['beforeArtifactIds', 'mockupArtifactIds', 'afterArtifactIds']) {
    const ids = requestVisuals[key];
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const n = Number(id);
        if (Number.isInteger(n) && n > 0) {
          pictureIds.add(n);
        }
      }
    }
  }
  const recordIds = [...new Set([...taskIds].map(String).concat([String(request.id)]))];
  const [onRecords, byId] = await Promise.all([
    listArtifactsForRecords({ orgId, recordType: 'object', recordIds }),
    pictureIds.size === 0 ? Promise.resolve([]) : listArtifactsByIds({ orgId, ids: [...pictureIds] }),
  ]);
  // The chat it was requested in, read once: its Activity leads with it, and
  // a request filed before its uploads were linked finds them there (`reported.ts`).
  const origin = await recordOrigin(orgId, { id: request.id, meta: (row.metadata ?? {}) as Record<string, unknown>, reviewActionRunId: row.reviewActionRunId }).catch(() => null);
  const reportedRows = onRecords.some(a => a.recordRole === REPORTED_ROLE && a.recordId === String(request.id))
    ? []
    : (await reportedAttachments(orgId, { id: request.id, createdAt: row.createdAt, conversationId: origin?.conversationId ?? null }).catch(() => []))
        .map(a => ({ ...a, recordType: 'object', recordId: String(request.id), recordRole: REPORTED_ROLE }));
  const artifactRows = [...onRecords, ...byId.filter(b => !onRecords.some(r => r.id === b.id)), ...reportedRows.filter(r => !onRecords.some(o => o.id === r.id))];
  // WHO MADE EACH PICTURE, BY NAME (the carousel's source line): an agent's
  // name from its row, a person's from theirs, the platform as Vocion.
  const authors = await authorNames(orgId, artifactRows.map(a => ({ kind: a.lastAuthorKind ?? null, id: a.lastAuthorId ?? null })));
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
    author: a.lastAuthorKind === 'system' ? 'Vocion' : (a.lastAuthorId ? authors.get(a.lastAuthorId) ?? null : null),
    conversationId: a.conversationId ?? null,
  }));

  // WHO APPROVED IT, BY NAME. A plan's `approvedBy` is often the approver's
  // user id, and a raw id is not a person (2026-09-28). Read the names for
  // every id the records carry; one that resolves to nobody reads
  // "Approver unavailable", never the id.
  const personIds = [...new Set([
    ...plans.map(p => p.meta.approvedBy),
    ...tasks.map(t => ((t.meta.plan ?? {}) as Record<string, unknown>).approvedBy),
  ].filter((v): v is string => typeof v === 'string' && v.trim() !== ''))];
  const people: Record<string, string> = {};
  if (personIds.length > 0) {
    const rows = await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, personIds));
    for (const u of rows) {
      people[u.id] = u.name?.trim() || u.email;
    }
  }

  // THE RUNS WORKING ON IT NOW — the planning run its fire started for it, a
  // reviewer's run over its change (`liveStatusData.loadLiveMissionRuns`).
  // WHAT GITHUB AND THE TRUST RULE SAY (backlog 044): merged, closed and CI
  // for every pull request the attempts carry, and whether the current
  // attempt's merge runs itself — so the report never says merged, green or
  // "waiting on a person" on a guess.
  const pullUrls = [
    ...tasks.map(t => (typeof t.meta.prUrl === 'string' ? t.meta.prUrl : null)),
    ...workerRuns.map(r => (typeof r.result?.pr_url === 'string' ? r.result.pr_url : null)),
  ];
  const current = [...tasks].sort((a, b) => b.id - a.id)[0] ?? null;
  const product = typeof request.meta.product === 'string' ? request.meta.product : null;
  // WHAT IT COST, in one place (`featureSpend.ts`): its worker runs, the
  // agent runs that served it and the chat turns about it. The same figure
  // the request carries for the Work page.
  const spend = (await loadFeatureSpend(orgId).catch(() => null))?.get(requestId) ?? null;
  const [live, activity, link, pulls, mergeRule, liveBases] = await Promise.all([
    loadLiveMissionRuns(orgId, [{ recordId: requestId, childIds: [...taskIds] }], now),
    loadActivity(orgId, requestId, taskIds, workerRuns, origin, spend),
    recordLinkerForOrg(orgId),
    loadPullSignals(orgId, pullUrls).catch(() => undefined),
    current
      ? mergeRiskClassOf(orgId, current.meta).then(async riskClass => ({ riskClass, runsItself: await mergeRunsItself(orgId, riskClass) })).catch(() => undefined)
      : Promise.resolve(undefined),
    // Where the product runs (its production environments), so a live link
    // never carries a host an agent guessed (`libs/factory/liveUrl.ts`). The
    // surfaces a person opens come first; an API or a worker is never one.
    product
      ? import('./productAccess').then(m => m.productAccess(orgId, product)).then(a => [...a.environments]
          .filter(e => e.url && !['api', 'worker'].includes(String(e.surface ?? '')))
          .sort((x, y) => (x.login ? 0 : 1) - (y.login ? 0 : 1))
          .map(e => e.url as string)).catch(() => [])
      : Promise.resolve([] as string[]),
  ]);
  const watcher = await pipelineWatcher(orgId).catch(() => null);
  const workflow = await workflowStatusOf(orgId, request.meta);
  // The Current state's label is the request's status, as its type words it.
  const { loadStatusModel } = await import('@/services/objects/statusField');
  const { placeOf } = await import('@/libs/objects/statusModel');
  const statuses = await loadStatusModel(orgId, types.request).catch(() => null);
  const place = statuses ? placeOf(statuses, request.meta) : null;
  // The records' codes (PL-371, REL-375), so the Timeline names them as every surface does.
  const codes = await codesForRecords(orgId, [...plans, ...releases, ...tasks].map(r => r.id)).catch(() => new Map<number, string>());
  const report = assembleFeatureReport({ request, tasks, plans, workerRuns, asks, actionRuns, releases, artifacts, now, people, link, missionRuns: live.get(requestId) ?? [], pulls, mergeRule, liveBases, watcher, workflow, place: place && place.value !== null ? { label: place.label, tone: place.tone } : null, activity, codes, spend: spend ? splitOf(spend) : undefined });
  return { ...report, activity };
}

/**
 * WHO WATCHES BETWEEN THE MERGE AND THE RELEASE, by name: the seat that owns
 * the automation running the pipeline's reconcile (`factory-reconcile`, core's
 * own job) — the plugin says which seat that is, never core.
 * @param orgId - Tenant.
 */
async function pipelineWatcher(orgId: string): Promise<string | null> {
  const { sql } = await import('drizzle-orm');
  const { automationSchema } = await import('@/models/Schema');
  const { FACTORY_RECONCILE_JOB } = await import('@/services/jobs/factoryCarry');
  const [auto] = await db.select({ owner: automationSchema.ownerAgentSlug }).from(automationSchema).where(and(
    eq(automationSchema.orgId, orgId),
    eq(automationSchema.status, 'active'),
    sql`${automationSchema.doConfig} ->> 'job' = ${FACTORY_RECONCILE_JOB}`,
  )).limit(1);
  if (!auto?.owner) {
    return null;
  }
  const [agent] = await db.select({ name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, auto.owner))).limit(1);
  return agent?.name?.trim() || auto.owner;
}

/**
 * Names for the authors artifacts carry: `agent:<slug>` is the agent's name,
 * a user id the person's name (or email). Anything else — a worker's token —
 * has no name here and reads as what made it instead.
 * @param orgId - Tenant.
 * @param refs - The authors.
 */
async function authorNames(orgId: string, refs: Array<{ kind: string | null; id: string | null }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const agentSlugs = [...new Set(refs.map(r => r.id).filter((id): id is string => typeof id === 'string' && id.startsWith('agent:')).map(id => id.slice('agent:'.length)))];
  const userIds = [...new Set(refs.filter(r => r.kind === 'human' && r.id && !r.id.includes(':')).map(r => r.id as string))];
  const [agents, users] = await Promise.all([
    agentSlugs.length === 0
      ? Promise.resolve([])
      : db.select({ slug: agentSchema.slug, name: agentSchema.name }).from(agentSchema).where(and(eq(agentSchema.orgId, orgId), inArray(agentSchema.slug, agentSlugs))),
    userIds.length === 0
      ? Promise.resolve([])
      : db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, userIds)),
  ]).catch(() => [[], []] as const);
  for (const a of agents) {
    out.set(`agent:${a.slug}`, a.name?.trim() || a.slug);
  }
  for (const u of users) {
    out.set(u.id, u.name?.trim() || u.email);
  }
  return out;
}

/**
 * Every conversation and run tied to this feature, newest first, each run
 * its own row. A conversation or mission run counts when one of its tool calls named this
 * request (or one of its tasks) by id — a record it read, wrote or carded —
 * never on a resemblance — or when the feature's cost counts it. Engineering runs are the tasks' own worker runs.
 * @param orgId - Tenant.
 * @param requestId - The request.
 * @param taskIds - Its tasks.
 * @param workerRuns - Its tasks' worker runs.
 * @param origin - The conversation it was requested in, when it was (`recordOrigin`).
 * @param spend - What its agent runs and chats cost (`featureSpend.ts`); each one it counts is listed with its share.
 */
async function loadActivity(orgId: string, requestId: number, taskIds: Set<number>, workerRuns: ReportWorkerRun[], origin: RecordOrigin | null = null, spend: FeatureSpend | null = null): Promise<ReportActivity[]> {
  const ids = [String(requestId), ...[...taskIds].map(String)];
  const calls = await db
    .select({ conversationId: toolCallSchema.conversationId, missionRunId: toolCallSchema.missionRunId, tool: toolCallSchema.tool, at: toolCallSchema.createdAt, named: toolCallNamedId })
    .from(toolCallSchema)
    .where(and(
      eq(toolCallSchema.orgId, orgId),
      inArray(toolCallNamedId, ids),
    ))
    .orderBy(desc(toolCallSchema.createdAt))
    .limit(400);
  const conv = new Map<number, { at: Date; writes: number; steps: number }>();
  const mission = new Map<number, { at: Date; writes: number; steps: number }>();
  // Which of the feature's records each agent run named: the request, or an
  // attempt's task — how the Timeline puts QA's review under its attempt.
  const touched = new Map<number, Set<number>>();
  for (const c of calls) {
    if (c.missionRunId !== null && Number(c.named) > 0) {
      touched.set(c.missionRunId, (touched.get(c.missionRunId) ?? new Set()).add(Number(c.named)));
    }
    const into = c.conversationId !== null ? conv : c.missionRunId !== null ? mission : null;
    const key = c.conversationId ?? c.missionRunId;
    if (!into || key === null) {
      continue;
    }
    const cur = into.get(key) ?? { at: c.at, writes: 0, steps: 0 };
    cur.steps += 1;
    if (/^(?:update|create|file|propose|recommend|write|save)_/.test(c.tool)) {
      cur.writes += 1;
    }
    into.set(key, cur);
  }
  const out: ReportActivity[] = [];
  // A chat the feature's cost counts is on the list too, with its share.
  const talked = spend?.conversations ?? new Map<number, number>();
  const convIds = [...new Set([...conv.keys(), ...talked.keys()])];
  if (convIds.length > 0) {
    const rows = await db
      .select({ id: conversationSchema.id, title: conversationSchema.title, agentSlug: conversationSchema.agentSlug, updatedAt: conversationSchema.updatedAt })
      .from(conversationSchema)
      .where(and(eq(conversationSchema.orgId, orgId), inArray(conversationSchema.id, convIds)));
    for (const r of rows) {
      const c = conv.get(r.id);
      const share = talked.get(r.id);
      out.push({
        kind: 'conversation',
        id: r.id,
        title: r.title?.trim() || nounCode('conversation', r.id),
        at: c?.at ?? r.updatedAt,
        status: c ? (c.writes > 0 ? 'wrote' : 'read') : null,
        detail: [r.agentSlug ?? 'agent', c ? `${c.steps} step${c.steps === 1 ? '' : 's'}` : null].filter(Boolean).join(' · '),
        cents: share === undefined ? null : Math.round(share / 1_000_000),
      });
    }
  }
  // Every agent run the feature's cost counts is in its Timeline, with its
  // share beside it — a review started by its pull request names no record
  // in its tool calls, and its cost must not be a figure nobody can open.
  const costed = spend?.agentRuns ?? new Map<number, number>();
  // A review its pull request started names no record in its calls: its
  // fire carried the attempt's pull request (FE-370's QA of attempt 3 was on
  // no list). Each such run counts as having named that attempt's task.
  const prTask = new Map<string, number>();
  for (const w of workerRuns) {
    const pr = runChange(w).prUrl;
    const task = Number((w.input?.record as { id?: unknown } | undefined)?.id);
    if (pr && Number.isSafeInteger(task) && task > 0) {
      prTask.set(pr, task);
    }
  }
  if (prTask.size > 0) {
    const fires = await db
      .select({ runId: automationRunSchema.targetRunId, url: sql<string | null>`coalesce(${automationRunSchema.input} ->> 'url', ${automationRunSchema.input} ->> 'prUrl')` })
      .from(automationRunSchema)
      .where(and(
        eq(automationRunSchema.orgId, orgId),
        isNotNull(automationRunSchema.targetRunId),
        inArray(sql`coalesce(${automationRunSchema.input} ->> 'url', ${automationRunSchema.input} ->> 'prUrl')`, [...prTask.keys()]),
      ))
      .limit(200)
      .catch(() => [] as Array<{ runId: number | null; url: string | null }>);
    for (const f of fires) {
      const task = f.url ? prTask.get(f.url) : undefined;
      if (f.runId !== null && task !== undefined) {
        touched.set(f.runId, (touched.get(f.runId) ?? new Set()).add(task));
      }
    }
  }
  const missionIds = [...new Set([...mission.keys(), ...costed.keys(), ...touched.keys()])];
  if (missionIds.length > 0) {
    // The automation that started each run (the first fire in its chain)
    // gives it its words: `label`, `doing`, its name (`runTitle`).
    const rows = await db
      .select({
        id: missionRunSchema.id,
        title: missionRunSchema.title,
        status: missionRunSchema.status,
        causedBy: missionRunSchema.causedBy,
        createdAt: missionRunSchema.createdAt,
        completedAt: missionRunSchema.completedAt,
        name: automationSchema.name,
        label: sql<string | null>`${automationSchema.doConfig} ->> 'label'`,
        doing: sql<string | null>`${automationSchema.doConfig} ->> 'doing'`,
      })
      .from(missionRunSchema)
      .leftJoin(automationSchema, and(eq(automationSchema.orgId, missionRunSchema.orgId), eq(automationSchema.slug, sql`${missionRunSchema.causedBy} -> 0 ->> 'automationSlug'`)))
      .where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.id, missionIds)));
    // A review whose fire failed reads failed, whatever the run under it says.
    const fireFailed = await failedFireLines(orgId, rows);
    // When each run's tool calls landed: the Timeline reads which run wrote
    // a verdict, a plan or a live check by the call made at that moment.
    const callRows = await db
      .select({ missionRunId: toolCallSchema.missionRunId, at: toolCallSchema.createdAt })
      .from(toolCallSchema)
      .where(and(eq(toolCallSchema.orgId, orgId), inArray(toolCallSchema.missionRunId, missionIds)))
      .limit(3000)
      .catch(() => [] as Array<{ missionRunId: number | null; at: Date }>);
    const callsOf = new Map<number, Date[]>();
    for (const c of callRows) {
      if (c.missionRunId !== null) {
        callsOf.set(c.missionRunId, [...(callsOf.get(c.missionRunId) ?? []), c.at]);
      }
    }
    for (const r of rows) {
      const m = mission.get(r.id);
      const share = costed.get(r.id);
      const name = r.name?.trim() || null;
      out.push({
        kind: 'mission_run',
        id: r.id,
        title: r.title?.trim() || nounCode('run', r.id),
        at: m?.at ?? r.createdAt,
        status: fireFailed.get(r.id) ?? r.status ?? null,
        detail: m ? `${m.steps} step${m.steps === 1 ? '' : 's'}` : null,
        runStatus: fireFailed.has(r.id) ? 'failed' : r.status ?? null,
        label: r.label?.trim() || name,
        doing: r.doing?.trim() || name,
        stored: r.title,
        startedAt: r.createdAt,
        endedAt: r.completedAt ?? null,
        touched: [...(touched.get(r.id) ?? [])],
        calls: callsOf.get(r.id) ?? [],
        // This feature's share of what the run cost (`featureSpend.ts`); null is not recorded.
        cents: share === undefined ? null : Math.round(share / 1_000_000),
      });
    }
  }
  for (const w of workerRuns) {
    // Titled by what it did, never by the worker's log line (`runTitle`).
    const n = [...workerRuns].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).indexOf(w) + 1;
    const change = runChange(w);
    out.push({ kind: 'worker_run', id: w.id, title: runTitle({ kind: 'build', status: w.status, executed: executedRun(w), attempt: n, prUrl: change.prUrl, checks: change.checks }), at: w.completedAt ?? w.claimedAt ?? w.createdAt, status: w.status, detail: [w.model, w.cents !== null ? `$${(w.cents / 100).toFixed(2)}` : null].filter(Boolean).join(' · ') || null, cents: w.cents });
  }
  if (!origin) {
    return newestFirst(out);
  }
  // WHERE IT STARTED (Chris, 2026-09-30, #269): the conversation it was
  // requested in, from the record's own origin, in its place in time — the
  // oldest entry, so it closes the list.
  const asked: ReportActivity = {
    kind: 'conversation',
    id: origin.conversationId,
    title: `Requested in chat${origin.by ? ` by ${origin.by}` : ''}`,
    at: origin.at ? new Date(origin.at) : out.find(a => a.kind === 'conversation' && a.id === origin.conversationId)?.at ?? new Date(0),
    status: null,
    detail: origin.title,
    origin: true,
    // The chat it was requested in keeps what its turns about this cost.
    cents: talked.has(origin.conversationId) ? Math.round(talked.get(origin.conversationId)! / 1_000_000) : null,
  };
  return newestFirst([asked, ...out.filter(a => !(a.kind === 'conversation' && a.id === origin.conversationId))]);
}

/**
 * Newest first, strictly: where it started is the oldest entry, so it closes
 * the list (Chris, 2026-09-30, #269). Every run keeps its own row — the
 * Timeline titles each by what it did and found (`featureHistory.ts`).
 * @param rows - The rows.
 */
function newestFirst(rows: ReportActivity[]): ReportActivity[] {
  return [...rows].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

/**
 * The status of the durable workflow that owns a request, when one does
 * (backlog 054). Null when none owns it or it cannot be read.
 * @param orgId - Tenant.
 * @param meta - The request's metadata.
 */
async function workflowStatusOf(orgId: string, meta: Record<string, unknown>): Promise<{ stage: string; line: string } | null> {
  const { durableMarkOf, ownedByWorkflow } = await import('./requestWorkflowStart');
  const mark = durableMarkOf(meta);
  if (!mark || !(await ownedByWorkflow(orgId, meta))) {
    return null;
  }
  const { durable } = await import('@/libs/durable');
  const s = await durable().status(mark.workflowId).catch(() => null);
  return s ? { stage: s.stage, line: s.line } : null;
}
