/**
 * WHERE EACH THING A TURN SET MOVING STANDS — the status dot on a follow chip
 * (`libs/chat/turnFollowups`, `ArtifactChips`). One word per thing, in four
 * states a person can read at a glance: queued, running, done, failed — and
 * `waiting` for a question in front of a person. Read from the rows
 * themselves, never from what the answer said about them.
 *
 * A request's state is its latest engineering run's while one exists, so the
 * chip under "I've started it" says "running · RUN-419" and follows it.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { nounCode } from '@/libs/codes';
import { db } from '@/libs/DB';
import { batchProgress, needsYou } from '@/libs/routines/display';
import { askSchema, browserRunSchema, businessObjectSchema, businessObjectTypeSchema, missionRunSchema, routineBatchSchema, routineRunSchema, routineSchema, workerRunSchema } from '@/models/Schema';

export type FollowState = 'queued' | 'running' | 'done' | 'failed' | 'waiting';
export type FollowRef = { type: 'worker_run' | 'object' | 'ask' | 'artifact' | 'mission_run' | 'browser_run' | 'routine' | 'routine_batch'; id: string };
export type FollowStatus = {
  state: FollowState;
  label: string;
  /** The thing's name as this workspace says it — "feature #201", "task #243" — when the client could not know it. */
  name?: string;
};

const FAILED = new Set(['failed', 'cancelled', 'lost', 'refused', 'rejected', 'error', 'stopped', 'expired']);
const DONE = new Set(['completed', 'done', 'succeeded', 'success', 'approved', 'accepted', 'merged', 'released', 'shipped', 'closed', 'superseded']);
const QUEUED = new Set(['queued', 'pending', 'planning', 'ready', 'new', 'draft', 'proposed']);

/**
 * A row's own status word as one of the four states.
 * @param status - Whatever the row says.
 */
export function followStateOf(status: string | null | undefined): FollowState {
  const s = (status ?? '').trim().toLowerCase();
  if (FAILED.has(s)) {
    return 'failed';
  }
  if (DONE.has(s)) {
    return 'done';
  }
  if (QUEUED.has(s) || s === '') {
    return 'queued';
  }
  return 'running';
}

const key = (r: FollowRef) => `${r.type}:${r.id}`;
const ids = (refs: FollowRef[], type: FollowRef['type']) => refs.filter(r => r.type === type).map(r => Number(r.id)).filter(n => Number.isSafeInteger(n) && n > 0);

/**
 * The status of each ref, keyed `type:id`. A ref this org does not hold is
 * left out, and the chip then shows no dot.
 * @param orgId - The workspace.
 * @param refs - What to read.
 */
export async function followStatuses(orgId: string, refs: FollowRef[]): Promise<Record<string, FollowStatus>> {
  const out: Record<string, FollowStatus> = {};
  const runIds = ids(refs, 'worker_run');
  if (runIds.length > 0) {
    const rows = await db.select({ id: workerRunSchema.id, status: workerRunSchema.status }).from(workerRunSchema).where(and(eq(workerRunSchema.orgId, orgId), inArray(workerRunSchema.id, runIds)));
    for (const r of rows) {
      out[key({ type: 'worker_run', id: String(r.id) })] = { state: followStateOf(r.status), label: r.status };
    }
  }
  const missionIds = ids(refs, 'mission_run');
  if (missionIds.length > 0) {
    const rows = await db.select({ id: missionRunSchema.id, status: missionRunSchema.status }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), inArray(missionRunSchema.id, missionIds)));
    for (const r of rows) {
      out[key({ type: 'mission_run', id: String(r.id) })] = { state: followStateOf(r.status), label: r.status };
    }
  }
  const browserIds = ids(refs, 'browser_run');
  if (browserIds.length > 0) {
    const rows = await db.select({ id: browserRunSchema.id, status: browserRunSchema.status, waiting: browserRunSchema.waiting }).from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), inArray(browserRunSchema.id, browserIds)));
    for (const r of rows) {
      out[key({ type: 'browser_run', id: String(r.id) })] = r.status === 'waiting'
        ? { state: 'waiting', label: r.waiting?.kind === 'approval' ? 'waiting on your approval' : 'waiting on you' }
        : r.status === 'proposed'
          ? { state: 'waiting', label: 'ready to start' }
          : { state: followStateOf(r.status), label: r.status };
    }
  }
  const routineIds = ids(refs, 'routine');
  if (routineIds.length > 0) {
    const rows = await db.select({ id: routineSchema.id, status: routineSchema.status, error: routineSchema.error }).from(routineSchema).where(and(eq(routineSchema.orgId, orgId), inArray(routineSchema.id, routineIds)));
    for (const r of rows) {
      out[key({ type: 'routine', id: String(r.id) })] = r.status === 'teaching'
        ? (r.error ? { state: 'failed', label: 'could not learn it' } : { state: 'running', label: 'teaching' })
        : r.status === 'in_review'
          ? { state: 'waiting', label: 'in review' }
          : { state: 'done', label: r.status === 'live' ? 'live' : 'retired' };
    }
  }
  const batchIds = ids(refs, 'routine_batch');
  if (batchIds.length > 0) {
    // A batch is its runs: "7 of 10 done · 1 waiting on you", and waiting while any run wants a person.
    const [batches, runs] = await Promise.all([
      db.select({ id: routineBatchSchema.id, status: routineBatchSchema.status }).from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), inArray(routineBatchSchema.id, batchIds))),
      db.select({ batchId: routineRunSchema.batchId, status: routineRunSchema.status, n: sql<number>`count(*)::int` }).from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), inArray(routineRunSchema.batchId, batchIds))).groupBy(routineRunSchema.batchId, routineRunSchema.status),
    ]);
    for (const b of batches) {
      const counts: Partial<Record<(typeof runs)[number]['status'], number>> = {};
      let total = 0;
      for (const r of runs.filter(x => x.batchId === b.id)) {
        counts[r.status] = Number(r.n);
        total += Number(r.n);
      }
      const label = batchProgress(counts, total);
      out[key({ type: 'routine_batch', id: String(b.id) })] = needsYou(counts) > 0
        ? { state: 'waiting', label, name: `Routine batch ${b.id}` }
        : b.status === 'running'
          ? { state: 'running', label, name: `Routine batch ${b.id}` }
          : { state: (counts.done ?? 0) === 0 && (counts.failed ?? 0) > 0 ? 'failed' : 'done', label, name: `Routine batch ${b.id}` };
    }
  }
  const askIds = ids(refs, 'ask');
  if (askIds.length > 0) {
    const rows = await db.select({ id: askSchema.id, status: askSchema.status, title: askSchema.title, kind: askSchema.kind }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, askIds)));
    for (const r of rows) {
      out[key({ type: 'ask', id: String(r.id) })] = r.status === 'open' ? { state: 'waiting', label: r.kind === 'input' ? 'awaiting answer' : r.kind === 'approval' ? 'awaiting approval' : 'awaiting decision', name: r.title } : { state: r.status === 'rejected' ? 'failed' : 'done', label: r.status, name: r.title };
    }
  }
  for (const r of refs.filter(x => x.type === 'artifact')) {
    out[key(r)] = { state: 'done', label: 'made' };
  }
  const objectIds = ids(refs, 'object');
  if (objectIds.length > 0) {
    const rows = await db
      .select({ id: businessObjectSchema.id, status: businessObjectSchema.status, meta: businessObjectSchema.metadata, type: businessObjectTypeSchema.slug })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), inArray(businessObjectSchema.id, objectIds)));
    const { recordLinksForOrg } = await import('@/services/objects/recordHref');
    const { recordCodeFrom } = await import('@/libs/workspace/recordHref');
    const links = await recordLinksForOrg(orgId);
    for (const r of rows) {
      const meta = (r.meta ?? {}) as Record<string, unknown>;
      // One name per thing: its code, which says what kind of thing it is (FE-294).
      const name = recordCodeFrom(links, { objectType: r.type, id: r.id });
      if (r.type === 'request') {
        // A request follows its latest engineering run while it has one.
        const [run] = await db
          .select({ id: workerRunSchema.id, status: workerRunSchema.status })
          .from(workerRunSchema)
          .where(and(eq(workerRunSchema.orgId, orgId), sql`${workerRunSchema.input}->'task'->>'request_id' = ${String(r.id)}`))
          .orderBy(desc(workerRunSchema.id))
          .limit(1);
        const word = typeof meta.state === 'string' ? meta.state : r.status;
        out[key({ type: 'object', id: String(r.id) })] = run && followStateOf(run.status) !== 'done'
          ? { state: followStateOf(run.status), label: `${run.status} · ${nounCode('run', run.id)}`, name }
          : { state: followStateOf(word), label: word ?? 'open', name };
        continue;
      }
      const word = typeof meta.status === 'string' ? meta.status : r.status;
      out[key({ type: 'object', id: String(r.id) })] = { state: followStateOf(word), label: word ?? 'open', name };
    }
  }
  return out;
}
