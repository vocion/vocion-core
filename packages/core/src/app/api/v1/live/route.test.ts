/**
 * `GET /api/v1/live` — the workspace live stream as a browser meets it: who
 * may open it, which topics it will follow (a thing in another workspace, an
 * artifact shared only with someone else and another person's notifications
 * are refused, and said so), and that a write made elsewhere arrives as a
 * notice, with a reconnect replaying what it missed.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema, liveNoticeSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const { liveHub } = await import('@/libs/live/hub');
const { authorizeTopics } = await import('@/services/live/authorizeTopics');
const { GET } = await import('./route');

const mockSession = vi.mocked(clerkAuth);
const mockBearer = vi.mocked(authenticateBearer);

const ORG = 'org_live_route_northwind';
const OTHER = 'org_live_route_kestrel';
const ADA = 'user_ada_northwind';

function signedIn(userId: string | null, orgId: string | null) {
  mockSession.mockResolvedValue({ userId, orgId, accountId: null, projectId: orgId, role: 'member', workspaceRole: 'member', has: () => false } as never);
}

function caller(orgId = ORG, userId = ADA) {
  return { orgId, actorId: userId, source: 'session' as const, principal: { kind: 'user' as const, id: userId, role: 'member' as const, scope: { orgId } } };
}

async function record(orgId: string): Promise<number> {
  const [t] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: `request_${orgId}`, label: 'Request' }).onConflictDoNothing().returning({ id: businessObjectTypeSchema.id });
  const typeId = t?.id ?? (await db.select({ id: businessObjectTypeSchema.id }).from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, orgId)))[0]!.id;
  const [row] = await db.insert(businessObjectSchema).values({ orgId, typeId, title: 'Northwind rollout' }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

/**
 * Read SSE frames off a response until `enough` says stop.
 * @param res
 * @param enough
 * @param ms
 */
async function frames(res: Response, enough: (seen: Array<{ event: string; id?: string; data: unknown }>) => boolean, ms = 3000) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const seen: Array<{ event: string; id?: string; data: unknown }> = [];
  let buffer = '';
  const deadline = Date.now() + ms;
  while (!enough(seen) && Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>(r => setTimeout(() => r(null), deadline - Date.now()))]);
    if (!chunk || chunk.done) {
      break;
    }
    buffer += decoder.decode(chunk.value);
    let at = buffer.indexOf('\n\n');
    while (at >= 0) {
      const frame = buffer.slice(0, at);
      buffer = buffer.slice(at + 2);
      const lines = frame.split('\n');
      const event = lines.find(l => l.startsWith('event: '))?.slice(7);
      const id = lines.find(l => l.startsWith('id: '))?.slice(4);
      const data = lines.find(l => l.startsWith('data: '))?.slice(6);
      if (event) {
        seen.push({ event, ...(id ? { id } : {}), data: data ? JSON.parse(data) : null });
      }
      at = buffer.indexOf('\n\n');
    }
  }
  await reader.cancel().catch(() => {});
  return seen;
}

function open(query: string, headers: Record<string, string> = {}) {
  const ac = new AbortController();
  return { res: GET(new Request(`https://vocion.test/api/v1/live?${query}`, { headers, signal: ac.signal })), abort: () => ac.abort() };
}

beforeEach(async () => {
  vi.clearAllMocks();
  signedIn(ADA, ORG);
  mockBearer.mockResolvedValue(null);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(artifactSchema);
  await db.delete(liveNoticeSchema);
});

afterAll(async () => {
  await liveHub().stop();
});

describe('who may follow what', () => {
  it('refuses a record in another workspace, and says so without confirming it exists', async () => {
    const mine = await record(ORG);
    const theirs = await record(OTHER);

    const out = await authorizeTopics(caller(), [`record:${mine}`, `record:${theirs}`, 'record:999999']);

    expect(out.allowed).toEqual([`record:${mine}`]);
    expect(out.refused).toEqual([
      { topic: `record:${theirs}`, reason: 'not_in_this_workspace' },
      { topic: 'record:999999', reason: 'not_in_this_workspace' },
    ]);
  });

  it('lets only its owner follow an artifact shared with "only me", and only you follow your notifications', async () => {
    const [art] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'markdown', title: 'Kestrel notes', shareAudience: 'me', shareOwnerId: 'user_grace' }).returning({ id: artifactSchema.id });

    const out = await authorizeTopics(caller(), [`artifact:${art!.id}`, `notification:${ADA}`, 'notification:user_grace', 'runs', 'list:request', 'nonsense']);

    expect(out.allowed).toEqual([`notification:${ADA}`, 'runs', 'list:request']);
    expect(out.refused).toEqual([
      { topic: 'nonsense', reason: 'not_a_topic' },
      { topic: `artifact:${art!.id}`, reason: 'not_yours' },
      { topic: 'notification:user_grace', reason: 'not_yours' },
    ]);
  });
});

describe('GET /api/v1/live', () => {
  it('asks for credentials, for topics, and refuses a stream with nothing it may follow', async () => {
    signedIn(null, null);

    expect((await open('topics=runs').res).status).toBe(401);

    signedIn(ADA, ORG);

    expect((await open('').res).status).toBe(400);

    const theirs = await record(OTHER);
    const refused = await open(`topics=record:${theirs}`).res;

    expect(refused.status).toBe(403);
    expect((await refused.json()).error.details.refused).toEqual([{ topic: `record:${theirs}`, reason: 'not_in_this_workspace' }]);
  });

  it('opens with ready — naming what it refused — and carries a change written elsewhere as a notice', async () => {
    const id = await record(ORG);
    const theirs = await record(OTHER);
    const { res: pending, abort } = open(`topics=record:${id},record:${theirs}`);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    // The write, as the worker would make it: the stream is not told, the trigger is.
    // (A drizzle query runs when awaited, hence the `.execute()`.)
    setTimeout(() => {
      void db.update(businessObjectSchema).set({ status: 'shipped' }).where(eq(businessObjectSchema.id, theirs)).execute();
      void db.update(businessObjectSchema).set({ status: 'shipped' }).where(eq(businessObjectSchema.id, id)).execute();
    }, 50);
    const seen = await frames(res, s => s.some(f => f.event === 'notice'));
    abort();

    expect(seen[0]).toMatchObject({ event: 'ready', data: { topics: [`record:${id}`], refused: [{ topic: `record:${theirs}`, reason: 'not_in_this_workspace' }] } });

    const notice = seen.find(f => f.event === 'notice');

    expect(notice?.data).toMatchObject({ ref: `record:${id}`, kind: 'changed', topics: expect.arrayContaining([`record:${id}`]) });
    expect(notice?.id).toBe(String((notice?.data as { id: number }).id));
    expect(seen.filter(f => f.event === 'notice').every(f => (f.data as { ref: string }).ref === `record:${id}`)).toBe(true);
  });

  it('replays what a reconnect missed, from Last-Event-ID', async () => {
    const id = await record(ORG);
    const [created] = await db.select({ id: liveNoticeSchema.id }).from(liveNoticeSchema);
    // Two changes while the tab was away.
    await db.update(businessObjectSchema).set({ status: 'building' }).where(eq(businessObjectSchema.id, id));
    await db.update(businessObjectSchema).set({ status: 'review' }).where(eq(businessObjectSchema.id, id));

    const { res, abort } = open(`topics=record:${id}`, { 'last-event-id': String(created!.id) });
    const seen = await frames(await res, s => s.filter(f => f.event === 'notice').length >= 3);
    abort();

    expect(seen.filter(f => f.event === 'notice').map(f => (f.data as { kind: string }).kind)).toEqual(['created', 'changed', 'changed']);
  });

  it('tells a tab that was away too long to read everything again', async () => {
    const id = await record(ORG);
    await db.update(businessObjectSchema).set({ status: 'building' }).where(eq(businessObjectSchema.id, id));
    await db.update(businessObjectSchema).set({ status: 'review' }).where(eq(businessObjectSchema.id, id));
    const rows = await db.select({ id: liveNoticeSchema.id }).from(liveNoticeSchema).orderBy(liveNoticeSchema.id);
    // The ring was pruned past what the tab last had.
    await db.delete(liveNoticeSchema).where(eq(liveNoticeSchema.id, rows[0]!.id));
    await db.delete(liveNoticeSchema).where(eq(liveNoticeSchema.id, rows[1]!.id));

    const { res, abort } = open(`topics=record:${id}&after=${rows[0]!.id - 1}`);
    const seen = await frames(await res, s => s.some(f => f.event === 'reset'));
    abort();

    expect(seen.map(f => f.event)).toContain('reset');
  });
});
