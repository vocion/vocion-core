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
import { askSchema, businessObjectSchema, businessObjectTypeSchema, missionRunSchema, workerRunSchema } from '@/models/Schema';

export type FollowState = 'queued' | 'running' | 'done' | 'failed' | 'waiting';
export type FollowRef = { type: 'worker_run' | 'object' | 'ask' | 'artifact' | 'mission_run'; id: string };
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
  const askIds = ids(refs, 'ask');
  if (askIds.length > 0) {
    const rows = await db.select({ id: askSchema.id, status: askSchema.status }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, askIds)));
    for (const r of rows) {
      out[key({ type: 'ask', id: String(r.id) })] = r.status === 'open' ? { state: 'waiting', label: 'waiting on a person' } : { state: r.status === 'rejected' ? 'failed' : 'done', label: r.status };
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
