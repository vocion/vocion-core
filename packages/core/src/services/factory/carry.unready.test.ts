/**
 * A build that would be refused never just stops (2026-10-01, #294): intake
 * reads what the dispatch would refuse on before proposing it, finds the repo
 * the product lists, plans or leaves a blocker that names who fixes it, and
 * the sweep carries the request on once the records say it can be built.
 * Against PGlite; every name, repo and person is invented.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/agents/turnJudge', async original => ({
  ...(await original<typeof import('@/services/agents/turnJudge')>()),
  saidToDecide: vi.fn(async () => ({ said: false, quote: null })),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema, businessObjectSchema, trustRuleSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const carry = await import('./carry');
const { buildReadiness, readRepo } = await import('@/libs/actions/factory-dispatch');

const ORG = 'org_factory_unready';
const types: Record<string, number> = {};
const NOW = new Date();

beforeAll(async () => {
  process.env.VOCION_EXTERNAL_WORKERS = '1';
  for (const slug of ['request', 'engineering_task', 'architecture_plan', 'repo', 'product']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
  await db.insert(agentSchema).values({ orgId: ORG, slug: 'task-engineer', name: 'Engineer', systemPrompt: 'x', harnessConfig: { runsOn: 'external-worker' } } as never);
  // Harbor lists its repo; the repo record does not name Harbor back.
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.product!, title: 'Harbor', metadata: { slug: 'harbor', name: 'Harbor', repos: ['harbor-app'], accountableUser: 'dana@northwind.example' } });
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'Acme/harbor-app', metadata: { slug: 'harbor-app', checks: [{ name: 'test' }], productPaths: { harbor: ['apps/harbor/src/**'] } } });
  // Quay's only repo record is a pending candidate, and another was rejected.
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.product!, title: 'Quay', metadata: { slug: 'quay', name: 'Quay' } });
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'Quay (web) monorepo', status: 'candidate', metadata: { slug: 'quay', product: 'quay', url: 'https://github.com/quay-example/quay', checks: [{ name: 'test' }] } });
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'Acme/quay-old', status: 'rejected', metadata: { slug: 'quay-old', product: 'quay', checks: [{ name: 'test' }] } });
  // Lantern is built nowhere this factory knows.
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.product!, title: 'Lantern', metadata: { slug: 'lantern', name: 'Lantern', accountableUser: 'eli@northwind.example' } });
  // Beacon's repo names no checks.
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.product!, title: 'Beacon', metadata: { slug: 'beacon', name: 'Beacon' } });
  await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'Acme/beacon-web', metadata: { slug: 'beacon-web', product: 'beacon', owners: ['fay@northwind.example'], productPaths: { beacon: ['apps/beacon/src/**'] } } });
  for (const actionId of ['factory.dispatch_task.from_request', 'factory.dispatch_task.recovery', 'factory.dispatch_task.from_plan']) {
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.8, enabled: 'true' });
  }
});

async function request(product: string, extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: types.request!,
    title: `Show the page count on a ${product} document`,
    metadata: { kind: 'bug', severity: 'p1', state: 'new', product, surface: 'ui', outcome: 'A reader sees how long a document is.', acceptance: ['The document page shows "N pages" beside its title.'], ...extra },
  }).returning();
  return row!;
}

async function meta(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata as Record<string, any>;
}

async function dispatchesFor(id: number) {
  return (await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task')))).filter(a => (a.input as { requestId?: number }).requestId === id);
}

describe('a proposed or rejected repo record is never built from (FE-314, 2026-10-01)', () => {
  it('reads neither, and the build is refused for having no repo', async () => {
    expect(await readRepo(ORG, 'quay', 'quay')).toBeNull();
    expect(await readRepo(ORG, 'quay-old', null)).toBeNull();

    const r = await request('quay');

    expect(await buildReadiness(ORG, r.id)).toMatchObject({ ready: false, cause: 'no_repo' });
  });
});

describe('the repo is read from the product', () => {
  it('a product that lists its repo builds from it, though the repo names no product', async () => {
    expect(await readRepo(ORG, null, 'harbor')).toMatchObject({ title: 'Acme/harbor-app' });

    const r = await request('harbor');

    expect(await buildReadiness(ORG, r.id)).toMatchObject({ ready: true, repo: 'Acme/harbor-app' });

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 7, byPerson: true });

    expect(out.did).toBe('start:done');
    expect((await meta(r.id)).intake).toMatchObject({ outcome: 'started', tries: 1 });
  });
});

describe('a build that would be refused is not proposed', () => {
  it('no repo: a blocker that says what is wrong, who fixes it and the move, and no refused card', async () => {
    const r = await request('lantern');

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 7, byPerson: true });

    expect(out.did).toBe('blocked:no_repo');
    expect(await dispatchesFor(r.id)).toHaveLength(0);

    const m = await meta(r.id);

    expect(m.blocker).toMatchObject({ what: 'Nothing says which repository Lantern is built in, so it cannot be built', owner: 'eli@northwind.example', cause: 'no_repo', next: expect.stringContaining('add a repo record for Lantern') });
    expect(m.intake).toMatchObject({ outcome: 'blocked', cause: 'no_repo' });
    expect(m.recovery.log.at(-1).text).toMatch(/^Blocked: Nothing says which repository Lantern is built in/);
  });

  it('a repo with no checks: blocked on the repo\'s owner', async () => {
    const r = await request('beacon');

    const out = await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 7, byPerson: true });

    expect(out.did).toBe('blocked:no_checks');
    expect((await meta(r.id)).blocker).toMatchObject({ owner: 'fay@northwind.example', cause: 'no_checks', what: 'The repo record Acme/beacon-web lists no checks, so a build of it could not be proven' });
  });
});

describe('the sweep carries it on', () => {
  it('clears the blocker once the product has a repo, says so, and starts the build', async () => {
    const r = await request('lantern', { title: 'Lantern: show the page count' });
    await carry.intakeFiledRequest(ORG, { objectType: 'request', objectId: r.id, conversationId: 7, byPerson: true });

    // Still no repo: the sweep reads it and leaves it, saying nothing new.
    await carry.sweepStuckRequests(ORG, NOW, 50);

    expect((await meta(r.id)).blocker).toMatchObject({ cause: 'no_repo' });

    await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.repo!, title: 'Acme/lantern-web', metadata: { slug: 'lantern-web', product: 'lantern', checks: [{ name: 'test' }], productPaths: { lantern: ['apps/lantern/src/**'] } } });
    const swept = await carry.sweepStuckRequests(ORG, NOW, 50);

    expect(swept.acted.find(a => a.requestId === r.id)?.did).toMatch(/^unblocked:start:/);

    const m = await meta(r.id);

    expect(m.blocker).toBeNull();
    expect(m.recovery.log.map((l: { text: string }) => l.text)).toContain('The blocker cleared: it can be built now from Acme/lantern-web.');
    expect(await dispatchesFor(r.id)).toHaveLength(1);
  });

  it('a person\'s request intake never started (filed before intake marked it) is read again, as theirs', async () => {
    const at = new Date(NOW.getTime() - 60 * 60_000).toISOString();
    const r = await request('harbor', { title: 'Harbor: show the page count', origin: { at, userId: 'user-dana', conversationId: 7 } });

    const swept = await carry.sweepStuckRequests(ORG, NOW, 50);

    expect(swept.acted.find(a => a.requestId === r.id)?.did).toMatch(/^intake again:start:/);
    expect((await meta(r.id)).intake).toMatchObject({ outcome: 'started' });

    // Once started, the sweep has nothing more to do for it.
    const again = await carry.sweepStuckRequests(ORG, NOW, 50);

    expect(again.acted.find(a => a.requestId === r.id)).toBeUndefined();
  });

  it('leaves a request a machine filed, or one filed a moment ago, alone', async () => {
    const fresh = await request('harbor', { title: 'Harbor: fresh', origin: { at: NOW.toISOString(), userId: 'user-dana', conversationId: 7 } });
    const machine = await request('harbor', { title: 'Harbor: machine idea' });

    const swept = await carry.sweepStuckRequests(ORG, NOW, 50);

    expect(swept.acted.find(a => a.requestId === fresh.id || a.requestId === machine.id)).toBeUndefined();
    expect(await dispatchesFor(fresh.id)).toHaveLength(0);
    expect(await dispatchesFor(machine.id)).toHaveLength(0);
  });
});

describe('the unready blocker in words', () => {
  it('names the product, its owner and the move; with no product, what to set', () => {
    expect(carry.unreadyBlocker({ ready: false, cause: 'no_repo', gaps: ['repo'], product: null, repo: null }, 'x')).toMatchObject({ what: 'This request names no product with a repository, so it cannot be built', owner: null, next: 'set the product this request is for' });
  });
});

describe('waiting names who (2026-10-01, plan #276)', () => {
  it('a plan on a person\'s card says the product\'s owner approves it', async () => {
    const r = await request('harbor', { title: 'Harbor: a plan to approve', recovery: { stage: 'planning', line: 'Planning — the change spans 2 packages', attempts: [], log: [], limit: 3 } });
    const [plan] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.architecture_plan!, title: 'Plan for the page count', metadata: { requestId: r.id, status: 'in_review', approach: 'Read the count from the stored file.' } }).returning();

    const out = await carry.reviewFiledPlan(ORG, { objectType: 'architecture_plan', objectId: plan!.id });

    expect(out.did).toBe('approve_plan:pending');

    const m = await meta(r.id);

    expect(m.recovery.line).toBe(`Planning — AP-${plan!.id} is written and waiting for dana@northwind.example to approve it.`);
    expect(m.recovery.waitingOn).toMatchObject({ who: 'dana@northwind.example', line: m.recovery.line });
  });
});

describe('the repo record a contract was read from rides with it', () => {
  it('carries the record\'s id and code', async () => {
    expect(await readRepo(ORG, 'harbor-app', null)).toMatchObject({ title: 'Acme/harbor-app', recordId: expect.any(Number), recordCode: expect.stringMatching(/\d+$/) });
  });
});
