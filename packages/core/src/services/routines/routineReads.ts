/**
 * ROUTINES, READ — what every surface that shows an automation or a batch needs,
 * and only that: the rows, the browser runs' last steps and live pictures, and
 * people's names. Kept apart from `RoutineService`, which drives runs and so
 * reaches the model, the browser and the conversation: a page that only shows
 * an automation compiles this (the build budget, CI.yml "Build memory").
 */

import type { RoutineBatchView, RoutineRunStatus, RoutineRunView, RoutineVersionView, RoutineView } from '@/libs/routines/types';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { routineRunOpen } from '@/libs/routines/types';
import { browserRunSchema, routineBatchSchema, routineRunSchema, routineSchema, routineVersionSchema, userSchema } from '@/models/Schema';
import { toView as browserView } from '@/services/browser/runReads';

type RoutineRow = typeof routineSchema.$inferSelect;
type VersionRow = typeof routineVersionSchema.$inferSelect;
type BatchRow = typeof routineBatchSchema.$inferSelect;
type RunRow = typeof routineRunSchema.$inferSelect;

/**
 * User ids → display names. Ids that are not people (a token, an automation) come back unmapped.
 * @param ids - The ids.
 */
export async function namesOf(ids: Array<string | null | undefined>): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => typeof x === 'string' && x.length > 0))];
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await db.select({ id: userSchema.id, name: userSchema.name, email: userSchema.email }).from(userSchema).where(inArray(userSchema.id, wanted));
  return new Map(rows.map(r => [r.id, r.name?.trim() || r.email]));
}

function versionView(v: VersionRow, names: Map<string, string>): RoutineVersionView {
  return {
    n: v.n,
    status: v.status,
    spec: { ...v.spec, questions: v.spec.questions.map(q => ({ ...q, answeredBy: q.answeredBy ? names.get(q.answeredBy) ?? q.answeredBy : null })) },
    task: v.task,
    workflowYaml: v.workflowYaml,
    change: v.change,
    approvedBy: v.approvedBy ? names.get(v.approvedBy) ?? v.approvedBy : null,
    approvedAt: v.approvedAt?.toISOString() ?? null,
    createdAt: v.createdAt.toISOString(),
  };
}

/**
 * The version runs use (the approved one, else the newest draft), and a draft newer than it.
 * @param versions - Newest first.
 */
export function currentVersions(versions: VersionRow[]): { current: VersionRow | null; draft: VersionRow | null } {
  const approved = versions.find(v => v.status === 'approved') ?? null;
  const newestDraft = versions.find(v => v.status === 'draft') ?? null;
  if (!approved) {
    return { current: newestDraft, draft: null };
  }
  return { current: approved, draft: newestDraft && newestDraft.n > approved.n ? newestDraft : null };
}

async function routineViews(rows: RoutineRow[]): Promise<RoutineView[]> {
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map(r => r.id);
  const versions = await db.select().from(routineVersionSchema).where(inArray(routineVersionSchema.routineId, ids)).orderBy(desc(routineVersionSchema.n));
  const runs = await db.select({ routineId: routineRunSchema.routineId, status: routineRunSchema.status, batchId: routineRunSchema.batchId, n: routineRunSchema.n }).from(routineRunSchema).where(inArray(routineRunSchema.routineId, ids));
  const names = await namesOf([...rows.map(r => r.expertUserId), ...versions.map(v => v.approvedBy), ...versions.flatMap(v => v.spec.questions.map(q => q.answeredBy))]);
  return rows.map((r) => {
    const mine = versions.filter(v => v.routineId === r.id);
    const { current, draft } = currentVersions(mine);
    const rs = runs.filter(x => x.routineId === r.id && x.n > 0);
    const t = r.teaching;
    return {
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      status: r.status,
      trust: r.trust,
      expert: r.expertUserId ? { userId: r.expertUserId, name: names.get(r.expertUserId) ?? 'Someone' } : null,
      source: r.source ?? null,
      version: current ? versionView(current, names) : null,
      draft: draft ? versionView(draft, names) : null,
      versions: mine.map(v => ({ n: v.n, status: v.status, change: v.change, createdAt: v.createdAt.toISOString() })),
      stats: {
        runs: rs.length,
        done: rs.filter(x => x.status === 'done').length,
        escalated: rs.filter(x => x.status === 'escalated').length,
        failed: rs.filter(x => x.status === 'failed' || x.status === 'unknown_outcome').length,
        lastBatchId: rs.reduce<number | null>((m, x) => (m === null || x.batchId > m ? x.batchId : m), null),
      },
      teaching: t ? { state: t.state, startedAt: t.startedAt, targetUrl: t.targetUrl, recordUrl: t.recordUrl, instruction: t.instruction ?? null, checks: t.checks, lastCheckedAt: t.lastCheckedAt } : null,
      savedInputs: r.savedInputs?.names ?? [],
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  });
}

/**
 * The workspace's routines, newest first; retired last.
 * @param orgId - The workspace.
 */
export async function listRoutines(orgId: string): Promise<RoutineView[]> {
  const rows = await db.select().from(routineSchema).where(eq(routineSchema.orgId, orgId)).orderBy(desc(routineSchema.updatedAt)).limit(200);
  const views = await routineViews(rows);
  return [...views.filter(v => v.status !== 'retired'), ...views.filter(v => v.status === 'retired')];
}

/**
 * One routine, or null when this workspace has none by that id.
 * @param orgId - The workspace.
 * @param id - The automation.
 */
export async function getRoutine(orgId: string, id: number): Promise<RoutineView | null> {
  const rows = await db.select().from(routineSchema).where(and(eq(routineSchema.orgId, orgId), eq(routineSchema.id, id))).limit(1);
  return (await routineViews(rows))[0] ?? null;
}

/**
 * An automation by its slug or its name, for chat ("run the add-a-user routine").
 * @param orgId - The workspace.
 * @param ref - An id, a slug, or words from its name.
 */
export async function findRoutine(orgId: string, ref: string | number): Promise<RoutineView | null> {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) {
    return getRoutine(orgId, Number(ref));
  }
  const all = await listRoutines(orgId);
  const want = String(ref).trim().toLowerCase();
  return all.find(r => r.slug === want) ?? all.find(r => r.name.toLowerCase() === want) ?? all.find(r => r.name.toLowerCase().includes(want) || want.includes(r.name.toLowerCase())) ?? null;
}

function countsOf(runs: Array<{ status: RoutineRunStatus; n: number }>): Partial<Record<RoutineRunStatus, number>> {
  const counts: Partial<Record<RoutineRunStatus, number>> = {};
  for (const r of runs) {
    if (r.n > 0) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * An automation's recent batches, newest first.
 * @param orgId - The workspace.
 * @param routineId - The automation.
 */
export async function batchesOf(orgId: string, routineId: number): Promise<Array<{ id: number; status: 'running' | 'done'; total: number; counts: Partial<Record<RoutineRunStatus, number>>; startedAt: string; endedAt: string | null; followUp: boolean }>> {
  const batches = await db.select().from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), eq(routineBatchSchema.routineId, routineId))).orderBy(desc(routineBatchSchema.id)).limit(20);
  if (batches.length === 0) {
    return [];
  }
  const runs = await db.select({ batchId: routineRunSchema.batchId, status: routineRunSchema.status, n: routineRunSchema.n }).from(routineRunSchema).where(inArray(routineRunSchema.batchId, batches.map(b => b.id)));
  return batches.map((b) => {
    const mine = runs.filter(r => r.batchId === b.id);
    return { id: b.id, status: b.status, total: mine.filter(r => r.n > 0).length, counts: countsOf(mine), startedAt: b.createdAt.toISOString(), endedAt: b.endedAt?.toISOString() ?? null, followUp: Boolean(b.followUp) };
  });
}

/**
 * A run of an automation as its tile draws it.
 * @param r - The run.
 * @param b - Its browser run, when it has one.
 */
function runView(r: RunRow, b: typeof browserRunSchema.$inferSelect | undefined): RoutineRunView {
  const bv = b ? browserView(b) : null;
  const last = bv ? [...bv.steps].reverse()[0] : undefined;
  return {
    id: r.id,
    batchId: r.batchId,
    n: r.n,
    label: r.label,
    status: r.status,
    input: r.input ?? {},
    browserRunId: r.browserRunId,
    browser: bv
      ? { status: bv.status, step: last?.label ?? null, why: last?.why ?? null, steps: bv.steps.length, live: bv.live, frameSeq: bv.frameSeq, url: bv.url, finalShotUrl: bv.finalShotUrl }
      : null,
    waiting: r.waiting ? { kind: r.waiting.kind, text: r.waiting.text, options: r.waiting.options ?? [], askId: r.waiting.askId ?? null } : null,
    receipt: r.receipt ?? null,
    summary: r.summary,
    error: r.error,
    humanMs: Number(r.humanMs ?? 0),
    cents: bv?.cents ?? 0,
    startedAt: r.startedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
  };
}

/**
 * One batch as its queue draws it, or null when this workspace has none by that id. The
 * reconciliation run (row 0) is not a tile: what it found is the batch's findings.
 * @param orgId - The workspace.
 * @param id - The batch.
 */
export async function getBatch(orgId: string, id: number): Promise<RoutineBatchView | null> {
  const [b] = await db.select().from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), eq(routineBatchSchema.id, id))).limit(1);
  if (!b) {
    return null;
  }
  return batchView(b);
}

/**
 * A batch row as its view.
 * @param b - The batch.
 */
export async function batchView(b: BatchRow): Promise<RoutineBatchView> {
  const [routine] = await db.select().from(routineSchema).where(eq(routineSchema.id, b.routineId)).limit(1);
  const [version] = await db.select({ spec: routineVersionSchema.spec }).from(routineVersionSchema).where(and(eq(routineVersionSchema.routineId, b.routineId), eq(routineVersionSchema.n, b.version))).limit(1);
  const runs = await db.select().from(routineRunSchema).where(eq(routineRunSchema.batchId, b.id)).orderBy(asc(routineRunSchema.n));
  const browserIds = runs.map(r => r.browserRunId).filter((x): x is number => typeof x === 'number');
  const browsers = browserIds.length > 0 ? await db.select().from(browserRunSchema).where(inArray(browserRunSchema.id, browserIds)) : [];
  const byId = new Map(browsers.map(x => [x.id, x]));
  const names = await namesOf([b.requestedBy, routine?.expertUserId]);
  const views = runs.map(r => runView(r, r.browserRunId ? byId.get(r.browserRunId) : undefined));
  const tiles = views.filter(v => v.n > 0);
  const cents = views.reduce((s, v) => s + v.cents, 0);
  return {
    id: b.id,
    routine: { id: b.routineId, name: routine?.name ?? 'An automation', version: b.version, trust: routine?.trust ?? 'drafted', expert: routine?.expertUserId ? names.get(routine.expertUserId) ?? null : null },
    requestedBy: names.get(b.requestedBy) ?? null,
    conversationId: b.conversationId,
    status: b.status,
    counts: countsOf(runs),
    total: tiles.length,
    cents,
    humanMs: views.reduce((s, v) => s + v.humanMs, 0),
    manualMinutes: version?.spec.manualMinutes ?? null,
    startedAt: b.createdAt.toISOString(),
    endedAt: b.endedAt?.toISOString() ?? null,
    runs: tiles,
    findings: b.findings ?? [],
    followUp: b.followUp ? { parentBatchId: b.followUp.parentBatchId, answer: /\u201C(.+?)\u201D/.exec(b.followUp.task)?.[1] ?? 'the expert\'s answer', approvedBy: b.followUp.approvedBy } : null,
    report: b.reportArtifactId ? { artifactId: b.reportArtifactId, url: `/dashboard/artifacts/${b.reportArtifactId}` } : null,
  };
}

/**
 * Where a batch stands, in a few words: "7 of 10 done · 1 waiting on the expert".
 * @param v - The batch.
 */
export function batchStatusLine(v: Pick<RoutineBatchView, 'counts' | 'total' | 'status'>): string {
  const c = v.counts;
  const done = (c.done ?? 0) + (c.skipped ?? 0);
  const waiting = (c.waiting ?? 0) + (c.escalated ?? 0);
  const bad = (c.failed ?? 0) + (c.unknown_outcome ?? 0);
  const parts = [`${done} of ${v.total} done`];
  if (waiting > 0) {
    parts.push(`${waiting} waiting on the expert`);
  }
  if (bad > 0) {
    parts.push(`${bad} need a look`);
  }
  if (v.status === 'running' && (c.running ?? 0) > 0) {
    parts.push(`${c.running} running`);
  }
  return parts.join(' · ');
}

export { routineRunOpen };
