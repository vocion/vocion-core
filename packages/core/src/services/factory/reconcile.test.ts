import type { ReconcileDeps } from './reconcile';
/**
 * Webhooks first, a reconciler behind them (backlog 049), against PGlite.
 * GitHub is injected: what it says about a pull request, a branch's checks,
 * and whether an event was already heard. Every name and repo is invented.
 */
import type { GithubEvent } from '@/libs/github/events';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, businessObjectSchema, workerRunSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { reconcileOpenPulls, recheckFixedBranches, settleClosedRequests, settleWaitingMerges, watchQueuedRuns } = await import('./reconcile');

const ORG = 'org_factory_reconcile';
const REPO = 'Acme/northwind-core';
const types: Record<string, number> = {};

beforeAll(async () => {
  for (const slug of ['request', 'engineering_task']) {
    const [t] = await createObjectType({ slug, label: slug }, ORG);
    types[slug] = t!.id;
  }
});

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!;
}

async function taskFor(n: number, status = 'awaiting_review', extra: Record<string, unknown> = {}) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: `Rooms ${n}`, metadata: { state: 'building', product: 'rooms' } }).returning();
  const prUrl = `https://github.com/${REPO}/pull/${n}`;
  const [t] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.engineering_task!, title: `Task ${n}`, status, metadata: { requestId: r!.id, status, prUrl, commitSha: 'abc123', ...extra } }).returning();
  return { request: r!, task: t!, prUrl };
}

const pr = (n: number, over: Record<string, unknown> = {}) => ({ number: n, title: `Rooms ${n}`, state: 'open', html_url: `https://github.com/${REPO}/pull/${n}`, head: { ref: `factory/t${n}`, sha: 'abc123' }, base: { ref: 'main' }, created_at: '2026-09-30T09:00:00Z', updated_at: '2026-09-30T10:00:00Z', ...over });

function deps(over: Partial<ReconcileDeps> = {}, heard: Set<string> = new Set()) {
  const emitted: GithubEvent[] = [];
  const d: ReconcileDeps = {
    readPull: async (_o, url) => ({ repo: REPO, pr: pr(Number(url.split('/').at(-1))) as never, checkRuns: [{ id: 11, name: 'test', status: 'completed', conclusion: 'failure' }] }),
    branchChecks: async () => ({ sha: 'fff111', complete: true, failing: [] }),
    updatePullBranch: vi.fn(async () => undefined),
    emit: async (_o, event) => {
      emitted.push(event);
      const deduped = heard.has(event.dedupeKey);
      heard.add(event.dedupeKey);
      return { deduped };
    },
    ...over,
  };
  return { d, emitted, heard };
}

function log(meta: unknown): string[] {
  return (((meta as { recovery?: { log?: Array<{ text: string }> } }).recovery?.log) ?? []).map(l => l.text);
}

describe('the read-back raises what the webhook never delivered', () => {
  it('raises a red CI whose webhook never arrived, once, with the webhook\'s own key', async () => {
    const { request, prUrl } = await taskFor(501);
    const { d, emitted } = deps();

    const first = await reconcileOpenPulls(ORG, new Date(), d);

    expect(first.find(r => r.requestId === request.id)?.did).toBe('re-raised pr.checks_completed');
    expect(emitted.find(e => e.payload.url === prUrl)).toMatchObject({ type: 'pr.checks_completed', dedupeKey: `github:${REPO}#501:pr.checks_completed:abc123:failed-11`, payload: { conclusion: 'failure', failedChecks: 'test' } });
    expect(log((await read(request.id)).metadata).some(l => l.includes('never reached Vocion'))).toBe(true);

    // The next pass raises the same key, which is heard: nothing new is said.
    const second = await reconcileOpenPulls(ORG, new Date(), d);

    expect(second.find(r => r.requestId === request.id)).toBeUndefined();
  });

  it('raises a merge that was never heard, and stops reading a pull request once it has ended', async () => {
    const { task, prUrl } = await taskFor(502, 'accepted');
    const readPull = vi.fn(async (_o: string, url: string) => ({ repo: REPO, pr: pr(Number(url.split('/').at(-1)), { state: 'closed', merged_at: '2026-09-30T11:00:00Z', merge_commit_sha: 'mmm999' }) as never, checkRuns: [] }));
    const { d, emitted } = deps({ readPull });

    await reconcileOpenPulls(ORG, new Date(), d);

    expect(emitted.find(e => e.payload.url === prUrl)).toMatchObject({ type: 'pr.merged', payload: { mergeSha: 'mmm999' } });
    expect((await read(task.id)).metadata).toMatchObject({ prState: 'merged' });

    readPull.mockClear();
    await reconcileOpenPulls(ORG, new Date(), d);

    expect(readPull.mock.calls.some(([, url]) => url === prUrl)).toBe(false);
  });

  it('keeps a task\'s head in step with its pull request without moving updatedAt', async () => {
    const { task } = await taskFor(503);
    const before = (await read(task.id)).updatedAt;
    const { d } = deps({ readPull: async (_o, url) => ({ repo: REPO, pr: pr(Number(url.split('/').at(-1)), { head: { ref: 'factory/t503', sha: 'def456' } }) as never, checkRuns: [] }) });

    await reconcileOpenPulls(ORG, new Date(), d);

    expect((await read(task.id)).metadata).toMatchObject({ headSha: 'def456', prState: 'open' });
    expect((await read(task.id)).updatedAt).toEqual(before);
  });
});

describe('a red base that turned green', () => {
  it('brings every blocked pull request up to date with it, once', async () => {
    const blocked = await taskFor(510, 'awaiting_review', { mainBlocked: { requestId: 0, branch: 'main' } });
    const [fix] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'main is red', metadata: { state: 'building', pipelineFix: { repo: REPO, branch: 'main', sha: 'red000', blocks: [{ url: blocked.prUrl, taskId: blocked.task.id, requestId: blocked.request.id }] } } }).returning();

    // Still red: nothing moves.
    const red = deps({ branchChecks: async () => ({ sha: 'red001', complete: true, failing: ['test'] }) });

    expect(await recheckFixedBranches(ORG, new Date(), red.d)).toEqual([]);

    const green = deps();
    const out = await recheckFixedBranches(ORG, new Date(), green.d);

    expect(out).toEqual([expect.objectContaining({ requestId: fix!.id, did: 'base green: rechecked' })]);
    expect(green.d.updatePullBranch).toHaveBeenCalledWith(ORG, blocked.prUrl, 'abc123');
    expect((await read(blocked.task.id)).metadata).toMatchObject({ mainBlocked: null, mainRechecked: { baseSha: 'fff111', fixRequestId: fix!.id } });
    expect(log((await read(blocked.request.id)).metadata).some(l => l.startsWith(`main is green again (fix #${fix!.id})`))).toBe(true);
    expect(await recheckFixedBranches(ORG, new Date(), green.d)).toEqual([]);
  });
});

describe('runs queued past pickup', () => {
  it('asks the pipeline\'s owner once per run, and closes the ask when a worker claims it', async () => {
    const { request, task } = await taskFor(520, 'dispatched');
    const [run] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'task-engineer', status: 'queued', input: { record: { id: task.id } }, createdAt: new Date(Date.now() - 20 * 60_000) } as never).returning();

    const first = await watchQueuedRuns(ORG, new Date(), 'release-engineer');
    const again = await watchQueuedRuns(ORG, new Date(), 'release-engineer');

    expect(first).toEqual([expect.objectContaining({ requestId: request.id, did: 'queued past pickup: asked' })]);
    expect(again).toEqual([]);

    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `pipeline-pickup:${run!.id}`)));

    expect(ask).toMatchObject({ status: 'open', agentSlug: 'release-engineer' });

    await db.update(workerRunSchema).set({ status: 'running', claimedAt: new Date() }).where(eq(workerRunSchema.id, run!.id));
    await watchQueuedRuns(ORG, new Date(), 'release-engineer');

    expect((await db.select().from(askSchema).where(eq(askSchema.id, ask!.id)))[0]!.status).not.toBe('open');
  });
});

describe('a closed request leaves no stage behind', () => {
  it('settles a shipped request still reading Recovering, and leaves an open one alone (#269, 2026-10-01)', async () => {
    const recovering = { stage: 'recovering', line: 'Recovering (attempt 2 of 3): QA sent attempt #71 back', attempts: [], since: null, limit: 3, askId: null, planRequestedAt: null, handledRunIds: [], log: [] };
    const [shipped] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Rooms theme toggle', metadata: { state: 'shipped', recovery: recovering } }).returning();
    const [open] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Rooms export', metadata: { state: 'building', recovery: recovering } }).returning();

    const out = await settleClosedRequests(ORG, new Date('2026-10-01T02:00:00Z'));

    expect(out.map(r => r.requestId)).toContain(shipped!.id);
    expect(out.map(r => r.requestId)).not.toContain(open!.id);

    const [after] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, shipped!.id));
    const rec = (after!.metadata as { recovery: { stage: unknown; line: unknown; log: Array<{ text: string }> } }).recovery;

    expect(rec.stage).toBeNull();
    expect(rec.line).toBeNull();
    expect(rec.log.at(-1)?.text).toMatch(/^Closed \(shipped\)/);
  });
});

describe('a merge waiting on a person is what the request says', () => {
  // Walk 7, 2026-10-02: #130 had QA 8 of 8 and a pending merge card (infra class) and its
  // stage still read "Recovering (attempt 1 of 3): … the required checks failed (no-runtime-ddl)".
  const recovering = (attemptAt: string) => ({
    stage: 'recovering',
    line: 'Recovering (attempt 1 of 3): sending it again because the required checks failed (no-runtime-ddl)',
    attempts: [{ n: 1, at: attemptAt, kind: 'build', trigger: 'recovery', runId: 470, taskId: null, line: 'Recovered: sending it again because the required checks failed (no-runtime-ddl).', failure: null }],
    since: '2026-10-02T03:28:07.522Z',
    limit: 3,
    askId: null,
    planRequestedAt: null,
    handledRunIds: [],
    log: [{ at: attemptAt, text: 'Recovered: sending it again because the required checks failed (no-runtime-ddl) (attempt 1 of 3).', runId: 470 }],
  });
  const approved = { value: 'approve', proven: 8, total: 8 };

  async function seed(attemptAt: string, cardAt: string, cardStatus = 'pending', verdict: Record<string, unknown> = approved) {
    const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Remind who has not opened', metadata: { state: 'building', recovery: recovering(attemptAt) } }).returning();
    const [t] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.engineering_task!, title: 'Attempt', status: 'accepted', metadata: { requestId: r!.id, status: 'accepted', verdict } }).returning();
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'git.merge', status: cardStatus, input: { taskId: t!.id, riskClass: 'infra' }, createdAt: new Date(cardAt) });
    return r!.id;
  }

  it('settles a stage older than the pending card on one true line, and leaves a newer attempt alone', async () => {
    const waiting = await seed('2026-10-02T03:54:55Z', '2026-10-02T04:21:38Z');
    const newer = await seed('2026-10-02T05:00:00Z', '2026-10-02T04:21:38Z');
    const notApproved = await seed('2026-10-02T03:54:55Z', '2026-10-02T04:21:38Z', 'pending', { value: 'changes', proven: 6, total: 8 });

    const out = await settleWaitingMerges(ORG, new Date('2026-10-02T06:00:00Z'));

    expect(out.find(r => r.requestId === waiting)).toMatchObject({ did: 'settled on its merge card', line: 'QA approved 8 of 8; the merge waits on a person (infra class).' });
    expect(out.map(r => r.requestId)).not.toContain(newer);
    expect(out.map(r => r.requestId)).not.toContain(notApproved);

    const rec = ((await read(waiting)).metadata as { recovery: { stage: unknown; line: unknown; log: Array<{ text: string }> } }).recovery;

    expect(rec.stage).toBeNull();
    expect(rec.line).toBeNull();
    expect(rec.log.at(-1)?.text).toBe('QA approved 8 of 8; the merge waits on a person (infra class).');
    expect(((await read(newer)).metadata as { recovery: { stage: unknown } }).recovery.stage).toBe('recovering');

    // Once settled, the next pass has nothing to do.
    expect((await settleWaitingMerges(ORG, new Date('2026-10-02T06:05:00Z'))).map(r => r.requestId)).not.toContain(waiting);
  });
});
