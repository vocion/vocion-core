/**
 * What a feature cost, in one place (2026-10-02): its worker runs, the agent
 * runs that served it and the chat turns about it — attributed by the links
 * the records carry, split evenly where one run served several features, and
 * the same figure on the feature page, in its Activity and on the request the
 * Work page reads.
 *
 * Runs against PGlite. Fixtures are fictional.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { automationRunSchema, businessObjectSchema, businessObjectTypeSchema, conversationMessageSchema, conversationSchema, missionRunSchema, toolCallSchema, workerRunSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { attributeSpend, featureGraph, featuresInFireInput, loadFeatureSpend, namedRecordId, refreshFeatureSpend, splitOf } = await import('./featureSpend');
const { loadFeatureReport } = await import('./featureReportData');

const TYPES = { request: 'request', task: 'engineering_task', plan: 'architecture_plan', release: 'release' };
const M = 1_000_000;

describe('the feature graph and what names it', () => {
  const graph = featureGraph(TYPES, [
    { id: 10, type: 'request', meta: {} },
    { id: 20, type: 'request', meta: {} },
    { id: 11, type: 'engineering_task', meta: { requestId: 10, prUrl: 'https://github.example/kestrel/app/pull/7' } },
    { id: 12, type: 'architecture_plan', meta: { requestId: 10 } },
    { id: 13, type: 'release', meta: { taskIds: [11], requestIds: [20] } },
  ]);

  it('follows the links each record carries to its request', () => {
    expect([...graph.owners.get(11)!]).toEqual([10]);
    expect([...graph.owners.get(12)!]).toEqual([10]);
    expect([...graph.owners.get(13)!].sort()).toEqual([10, 20]);
  });

  it('reads a fire by key shape and by pull request, not by key name', () => {
    expect([...featuresInFireInput(graph, { releaseId: 13, attempt: 2, number: 11 })].sort()).toEqual([10, 20]);
    expect([...featuresInFireInput(graph, { url: 'https://github.example/kestrel/app/pull/7', number: 7 })]).toEqual([10]);
    expect(featuresInFireInput(graph, { prompt: 'check 12' }).size).toBe(0);
  });

  it('reads a type\'s code as its record, and a core noun\'s code as nothing', () => {
    expect(namedRecordId('REL-13')).toBe(13);
    expect(namedRecordId('13')).toBe(13);
    expect(namedRecordId('RUN-13')).toBeNull();
    expect(namedRecordId(null)).toBeNull();
  });

  it('splits a run that served two features evenly, so nothing is counted twice', () => {
    const spend = attributeSpend({
      graph,
      engineering: new Map([[10, 277]]),
      missionRuns: [{ id: 1, microCents: 100 * M }, { id: 2, microCents: 40 * M }],
      runNamed: new Map([[1, [13]], [2, [12]]]),
      runFires: new Map(),
      turns: [{ id: 5, conversationId: 9, microCents: 12 * M, named: [] }, { id: 6, conversationId: 8, microCents: 3 * M, named: [] }],
      anchors: new Map([[9, [10]]]),
    });

    expect(splitOf(spend.get(10)!)).toEqual({ engineeringCents: 277, agentCents: 90, chatCents: 12, totalCents: 379 });
    expect(splitOf(spend.get(20)!)).toEqual({ engineeringCents: null, agentCents: 50, chatCents: 0, totalCents: 50 });
    // A turn about nothing stays with its conversation.
    expect([...spend.values()].some(s => s.conversations.has(8))).toBe(false);
  });
});

describe('a feature\'s spend from the run rows', () => {
  it('adds engineering, the agent runs that served it and the chats about it — the same on the page, in Activity and on the request', async () => {
    const orgId = 'org_spend_kestrel';
    const schema = { type: 'object', properties: {} };
    const type = async (slug: string) => (await db.insert(businessObjectTypeSchema).values({ orgId, slug, label: slug, schema } as never).returning({ id: businessObjectTypeSchema.id }))[0]!.id;
    const [reqT, taskT, relT] = [await type('request'), await type('engineering_task'), await type('release')];
    const obj = async (typeId: number, title: string, metadata: Record<string, unknown>) => (await db.insert(businessObjectSchema).values({ orgId, typeId, title, metadata } as never).returning({ id: businessObjectSchema.id }))[0]!.id;
    const feature = await obj(reqT, 'Show the upload date', { state: 'building' });
    const other = await obj(reqT, 'Expiring links', { state: 'building' });
    const pr = 'https://github.example/kestrel/app/pull/175';
    const task = await obj(taskT, 'Upload date on rows', { requestId: feature, prUrl: pr });
    const release = await obj(relT, 'Send 1.4', { requestIds: [feature, other], taskIds: [task] });

    await db.insert(workerRunSchema).values({ orgId, agentSlug: 'engineer', kind: 'build', status: 'completed', cents: 554, input: { record: { type: 'engineering_task', id: task } }, result: { token_usage: { cost_usd: 2.77 } } } as never);

    const team = { lead: 'qa', members: [] };
    const run = async (title: string, microCents: number | null) => (await db.insert(missionRunSchema).values({ orgId, title, brief: 'b', status: 'completed', team, microCents } as never).returning({ id: missionRunSchema.id }))[0]!.id;
    const plan = await run('Plan it', 40 * M);
    const review = await run('QA review', 60 * M);
    const live = await run('Live check', 100 * M);
    const before = await run('A run from before costs were recorded', null);
    await db.insert(toolCallSchema).values([
      { orgId, agentSlug: 'pm', tool: 'read_object', input: { id: String(feature) }, output: 'ok', missionRunId: plan },
      { orgId, agentSlug: 'pm', tool: 'read_object', input: { id: String(feature) }, output: 'ok', missionRunId: before },
    ] as never);
    await db.insert(automationRunSchema).values([
      // The review names nothing in its tool calls: its fire carries the pull request.
      { orgId, slug: 'review', kind: 'mission_check', status: 'ok', input: { url: pr, number: 175 }, targetRunId: review },
      { orgId, slug: 'live', kind: 'mission_check', status: 'ok', input: { releaseId: release, attempt: 1 }, targetRunId: live },
    ] as never);

    // A chat started on the feature's page, whose turn named nothing.
    const [conv] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'pm', title: 'About the upload date', contextJson: { path: '/p/feature', title: 'Feature', record: { type: 'object', id: String(feature) } } } as never).returning({ id: conversationSchema.id });
    await db.insert(conversationMessageSchema).values([
      { conversationId: conv!.id, role: 'user', content: 'How is it going?' },
      { conversationId: conv!.id, role: 'assistant', content: 'Building.', microCents: 12 * M },
    ] as never);

    const spend = (await loadFeatureSpend(orgId)).get(feature)!;

    // 277 engineering (the worker's own account, not its doubled heartbeats);
    // 40 plan + 60 review + half of the 100 live check; 12 chat.
    expect(splitOf(spend)).toEqual({ engineeringCents: 277, agentCents: 150, chatCents: 12, totalCents: 439 });
    expect(spend.agentRuns.has(before)).toBe(false);

    const report = await loadFeatureReport(orgId, feature, new Date());

    expect(report!.money.actualCents).toBe(439);
    expect(report!.money.actualSource).toContain('$2.77 engineering, $1.50 agents, $0.12 chat');

    const shown = new Map(report!.activity!.map(a => [`${a.kind}-${a.id}`, a.cents]));

    expect(shown.get(`mission_run-${review}`)).toBe(60);
    expect(shown.get(`mission_run-${live}`)).toBe(50);
    expect(shown.get(`conversation-${conv!.id}`)).toBe(12);
    expect(shown.get(`worker_run-${(await db.select({ id: workerRunSchema.id }).from(workerRunSchema).where(eq(workerRunSchema.orgId, orgId)))[0]!.id}`)).toBe(277);
    // A run from before costs were recorded is listed, with no figure.
    expect(shown.has(`mission_run-${before}`)).toBe(true);
    expect(shown.get(`mission_run-${before}`)).toBeNull();
    // The Timeline's foot is the same one total.
    expect(report!.historyCost.totalCents).toBe(439);
    expect(report!.historyCost.split.map(x => x.cents)).toEqual([277, 150, 12]);

    await refreshFeatureSpend(orgId);
    const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, feature));

    expect(row!.meta).toMatchObject({ state: 'building', spentCents: 439, engineeringCents: 277, agentCents: 150, chatCents: 12 });
  });
});
