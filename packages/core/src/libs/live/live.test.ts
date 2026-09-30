/**
 * The live stream's server half, against a real (PGlite) database with the
 * migrated schema: the triggers publish what a person could see from the
 * writer's own transaction, the hub hands each notice only to its workspace
 * and its topics, a subscriber hears a write it did not make (the worker's,
 * say) both by the doorbell and — when the doorbell is out — by reading the
 * ring, and a reconnect replays what it missed.
 *
 * PGlite is one process, so "another process" here is another writer on the
 * same database with no call into the hub: the notice reaches the hub only
 * through the trigger and NOTIFY (or the ring), exactly the route a worker's
 * commit takes. The cross-process run against Postgres is
 * `live.postgres.test.ts`, which runs when `LIVE_PG_URL` is set.
 */
import type { LiveNotice } from './topics';
import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, artifactSchema, businessObjectSchema, businessObjectTypeSchema, eventLogSchema, liveNoticeSchema, workerRunSchema } = await import('@/models/Schema');
const { LiveHub } = await import('./hub');
const { memoryTransport, pgliteTransport } = await import('./transport');
const { publish } = await import('./publish');

const ORG = 'org_live_northwind';
const OTHER = 'org_live_kestrel';

async function type(orgId: string, slug: string): Promise<number> {
  const [row] = await db.insert(businessObjectTypeSchema).values({ orgId, slug, label: slug }).returning({ id: businessObjectTypeSchema.id });
  return row!.id;
}

async function record(orgId: string, typeId: number, title = 'Northwind onboarding'): Promise<number> {
  const [row] = await db.insert(businessObjectSchema).values({ orgId, typeId, title }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

async function notices(): Promise<Array<{ orgId: string; topics: string[]; ref: string; kind: string }>> {
  return db.select({ orgId: liveNoticeSchema.orgId, topics: liveNoticeSchema.topics, ref: liveNoticeSchema.ref, kind: liveNoticeSchema.kind }).from(liveNoticeSchema).orderBy(liveNoticeSchema.id);
}

/**
 * Wait until `check` passes, or fail with what it last saw.
 * @param check
 * @param ms
 */
async function until(check: () => void, ms = 3000): Promise<void> {
  await vi.waitFor(check, { timeout: ms, interval: 10 });
}

const hubs: Array<InstanceType<typeof LiveHub>> = [];
function hub(opts: ConstructorParameters<typeof LiveHub>[0]) {
  const h = new LiveHub({ db, ...opts });
  hubs.push(h);
  return h;
}

beforeEach(async () => {
  // Each file has its own database; each test starts from empty tables.
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(actionRunSchema);
  await db.delete(workerRunSchema);
  await db.delete(artifactSchema);
  await db.delete(eventLogSchema);
  await db.delete(liveNoticeSchema);
});

afterEach(async () => {
  await Promise.all(hubs.splice(0).map(h => h.stop()));
});

describe('the triggers publish from the writer\'s own transaction', () => {
  it('a record: its own topic and its type\'s list, on create, change and delete', async () => {
    const t = await type(ORG, 'engineering_task');
    const id = await record(ORG, t);
    await db.update(businessObjectSchema).set({ status: 'running' }).where(eq(businessObjectSchema.id, id));
    await db.delete(businessObjectSchema).where(eq(businessObjectSchema.id, id));

    expect(await notices()).toEqual([
      { orgId: ORG, topics: [`record:${id}`, 'list:engineering_task'], ref: `record:${id}`, kind: 'created' },
      { orgId: ORG, topics: [`record:${id}`, 'list:engineering_task'], ref: `record:${id}`, kind: 'changed' },
      { orgId: ORG, topics: [`record:${id}`, 'list:engineering_task'], ref: `record:${id}`, kind: 'deleted' },
    ]);
  });

  it('a worker run: its own topic, the runs feed, and the record its input is for', async () => {
    const t = await type(ORG, 'engineering_task');
    const task = await record(ORG, t);
    await db.delete(liveNoticeSchema);
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'task-engineer', input: { record: { type: 'engineering_task', id: task } } }).returning({ id: workerRunSchema.id });
    const [bare] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'task-engineer', input: { record: { id: 'not-a-number' } } }).returning({ id: workerRunSchema.id });

    expect(await notices()).toEqual([
      { orgId: ORG, topics: [`run:${run!.id}`, 'runs', `record:${task}`], ref: `run:${run!.id}`, kind: 'created' },
      { orgId: ORG, topics: [`run:${bare!.id}`, 'runs'], ref: `run:${bare!.id}`, kind: 'created' },
    ]);
  });

  it('a card, an artifact (and the record it belongs to), and an event', async () => {
    const [card] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'objects.update_meta' }).returning({ id: actionRunSchema.id });
    await db.update(actionRunSchema).set({ status: 'done' }).where(eq(actionRunSchema.id, card!.id));
    const [art] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Kestrel brief', recordType: 'object', recordId: '41' }).returning({ id: artifactSchema.id });
    const [ev] = await db.insert(eventLogSchema).values({ orgId: ORG, type: 'worker_run.completed' }).returning({ id: eventLogSchema.id });

    expect(await notices()).toEqual([
      { orgId: ORG, topics: [`card:${card!.id}`, 'cards'], ref: `card:${card!.id}`, kind: 'created' },
      { orgId: ORG, topics: [`card:${card!.id}`, 'cards'], ref: `card:${card!.id}`, kind: 'changed' },
      { orgId: ORG, topics: [`artifact:${art!.id}`, 'record:41'], ref: `artifact:${art!.id}`, kind: 'created' },
      { orgId: ORG, topics: ['events'], ref: `event:${ev!.id}`, kind: 'worker_run.completed' },
    ]);
  });

  it('a write that rolls back publishes nothing', async () => {
    const t = await type(ORG, 'request');
    await db.transaction(async (tx) => {
      await tx.insert(businessObjectSchema).values({ orgId: ORG, typeId: t, title: 'Contoso rollout' });
      tx.rollback();
    }).catch(() => {});

    expect(await notices()).toEqual([]);
  });
});

describe('publish()', () => {
  it('writes a notice for anything that is not a row change — a person\'s notification', async () => {
    const id = await publish({ orgId: ORG, topics: ['notification:user_ada'], ref: 'notification:7', kind: 'created' });

    expect(id).toBeGreaterThan(0);
    expect(await notices()).toEqual([{ orgId: ORG, topics: ['notification:user_ada'], ref: 'notification:7', kind: 'created' }]);
  });

  it('refuses a topic nothing could follow, rather than writing it', async () => {
    await expect(publish({ orgId: ORG, topics: ['recrod:12'], ref: 'record:12', kind: 'changed' })).rejects.toThrow(/recrod:12/);
    expect(await notices()).toEqual([]);
  });

  it('is in the caller\'s transaction', async () => {
    await db.transaction(async (tx) => {
      await publish({ orgId: ORG, topics: ['runs'], ref: 'run:1', kind: 'changed' }, tx);
      tx.rollback();
    }).catch(() => {});

    expect(await notices()).toEqual([]);
  });
});

describe('the hub', () => {
  it('hears a write it did not make, through the trigger and the doorbell, and hands it only to its workspace and topics', async () => {
    const client = (db as unknown as { $client: Parameters<typeof pgliteTransport>[0] }).$client;
    const h = hub({ transport: () => pgliteTransport(client), tailSlowMs: 60_000 });
    const t = await type(ORG, 'request');
    const id = await record(ORG, t);
    const mine: LiveNotice[] = [];
    const theirs: LiveNotice[] = [];
    const elsewhere: LiveNotice[] = [];
    h.subscribe({ orgId: ORG, topics: new Set([`record:${id}`]), send: n => mine.push(n) });
    h.subscribe({ orgId: OTHER, topics: new Set([`record:${id}`, 'list:request']), send: n => theirs.push(n) });
    h.subscribe({ orgId: ORG, topics: new Set(['runs']), send: n => elsewhere.push(n) });
    await h.ready();

    // The write, as a worker would make it: straight to the table.
    await db.update(businessObjectSchema).set({ status: 'shipped' }).where(eq(businessObjectSchema.id, id));

    await until(() => expect(mine.map(n => n.ref)).toEqual([`record:${id}`]));

    expect(mine[0]).toMatchObject({ topics: [`record:${id}`, 'list:request'], kind: 'changed' });
    expect(mine[0]!.at).toMatch(/Z$/);
    expect(h.state()).toMatchObject({ transport: 'pglite', pushing: true });
    expect(theirs).toEqual([]);
    expect(elsewhere).toEqual([]);
  });

  it('reads the ring when the doorbell is out, so a notice rung meanwhile still arrives', async () => {
    const transport = memoryTransport();
    const h = hub({ transport: () => transport, tailFastMs: 20, tailSlowMs: 60_000 });
    const got: LiveNotice[] = [];
    h.subscribe({ orgId: ORG, topics: new Set(['cards']), send: n => got.push(n) });
    await h.ready();
    transport.drop('connection reset');

    // Nothing rings the memory doorbell: only the ring can carry this one.
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task' });

    await until(() => expect(got).toHaveLength(1));

    expect(h.state()).toMatchObject({ pushing: false, reason: 'connection reset' });
  });

  it('delivers a notice once, however it arrives', async () => {
    const transport = memoryTransport();
    const h = hub({ transport: () => transport, tailFastMs: 20, tailSlowMs: 20 });
    const got: LiveNotice[] = [];
    h.subscribe({ orgId: ORG, topics: new Set(['cards']), send: n => got.push(n) });
    await h.ready();
    const [row] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task' }).returning({ id: actionRunSchema.id });
    const [notice] = await db.select().from(liveNoticeSchema).where(sql`${liveNoticeSchema.ref} = ${`card:${row!.id}`}`);
    transport.ring({ id: Number(notice!.id), orgId: ORG, topics: notice!.topics, ref: notice!.ref, kind: notice!.kind, at: new Date().toISOString() });
    await new Promise(r => setTimeout(r, 120));

    expect(got.map(n => n.id)).toEqual([Number(notice!.id)]);
  });

  it('replays what a reconnecting tab missed after its Last-Event-ID, for its topics and workspace only', async () => {
    const h = hub({ transport: () => memoryTransport() });
    const t = await type(ORG, 'request');
    const a = await record(ORG, t, 'Northwind');
    const [seen] = await db.select({ id: liveNoticeSchema.id }).from(liveNoticeSchema).orderBy(liveNoticeSchema.id);
    const b = await record(ORG, t, 'Kestrel');
    await db.update(businessObjectSchema).set({ status: 'building' }).where(eq(businessObjectSchema.id, a));
    const tOther = await type(OTHER, 'request');
    await record(OTHER, tOther, 'Contoso');

    const replay = await h.replay(ORG, [`record:${a}`], { afterId: Number(seen!.id) });

    // The slack re-sends the one the tab already had; the tab drops it by id.
    expect(replay.reset).toBe(false);
    expect(replay.notices.map(n => [n.ref, n.kind])).toEqual([[`record:${a}`, 'created'], [`record:${a}`, 'changed']]);

    const list = await h.replay(ORG, ['list:request'], { afterId: Number(seen!.id) });

    expect(list.notices.map(n => n.ref)).toEqual([`record:${a}`, `record:${b}`, `record:${a}`]);
  });

  it('says reset when the ring no longer holds that far back', async () => {
    const h = hub({ transport: () => memoryTransport() });
    const t = await type(ORG, 'request');
    await record(ORG, t);
    const [first] = await db.select({ id: liveNoticeSchema.id }).from(liveNoticeSchema);
    // Pruned past what the tab last had.
    for (let i = 0; i < 3; i += 1) {
      await record(ORG, t);
    }
    await db.delete(liveNoticeSchema).where(sql`${liveNoticeSchema.id} <= ${Number(first!.id) + 1}`);

    const replay = await h.replay(ORG, ['list:request'], { afterId: Number(first!.id) - 1 });

    expect(replay).toEqual({ notices: [], reset: true });
  });

  it('replays a first connection from when the page loaded', async () => {
    const h = hub({ transport: () => memoryTransport() });
    const loadedAt = Date.now();
    const t = await type(ORG, 'request');
    const id = await record(ORG, t);

    const replay = await h.replay(ORG, [`record:${id}`], { sinceMs: loadedAt });

    expect(replay.notices.map(n => n.ref)).toEqual([`record:${id}`]);
  });
});
