import type { ReconcileDeps } from './reconcile';
/**
 * A SHIPPED FEATURE STAYS SHIPPED (request 224, 2026-10-02), against PGlite.
 * The sequence replayed: attempt #350 opened PR #159 and was superseded;
 * attempt #353 opened PR #162 and was superseded; attempt #354 merged and the
 * request shipped in a release. Then, eleven minutes later, the reconciler
 * read PR #162's close back, a late green-checks event for closed PR #159
 * started a review, the review sent #350 back, and "Build again" queued a
 * fourth build of the shipped feature and wrote `state: building` over it.
 * Every name, repo and number here is invented.
 */
import type { GithubEvent } from '@/libs/github/events';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { settledReason } = await import('@/libs/factory/requestStates');
const { attemptIsHistory } = await import('./supersededPulls');
const { reconcileOpenPulls } = await import('./reconcile');
const { buildAgain, recordVerdictTool } = await import('@/services/agents/tools/recordVerdict');
const { factoryDispatchAction, settledRefusal } = await import('@/libs/actions/factory-dispatch');

const ORG = 'org_shipped_stays_shipped';
const REPO = 'Acme/northwind-core';
const SHIPPED = ['shipped', 'answered', 'out_of_scope', 'deferred'];
const types: Record<string, number> = {};

beforeAll(async () => {
  const [req] = await createObjectType({ slug: 'request', label: 'Request', schema: { 'x-settled': { field: 'state', in: SHIPPED } } }, ORG);
  const [task] = await createObjectType({ slug: 'engineering_task', label: 'Task' }, ORG);
  types.request = req!.id;
  types.task = task!.id;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const pull = (n: number) => `https://github.com/${REPO}/pull/${n}`;

/**
 * Request 224 as it stood at 03:19: shipped in release #355, three attempts behind it.
 * @param over
 */
async function shippedRequest(over: Record<string, unknown> = {}) {
  const [r] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.request!, title: 'Copy a share link from the library', status: 'approved', metadata: { state: 'shipped', shippedAt: '2026-10-02T03:19:08.432Z', shippedIn: 355, recovery: { log: [{ at: '2026-10-02T03:19:08.432Z', text: 'Shipped in release #355.', runId: null }], attempts: [], limit: 3 }, ...over } }).returning();
  const task = async (status: string, prUrl: string, extra: Record<string, unknown> = {}) => {
    const [t] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: types.task!, title: 'Copy link', status, metadata: { requestId: r!.id, status, prUrl, commitSha: 'c1ffeb2e', acceptanceContract: ['Every row shows a copy-link control.'], ...extra } }).returning();
    return t!;
  };
  // The superseded attempt QA had not finished with: its PR closed later.
  const a350 = await task('awaiting_review', pull(159), { prState: 'open' });
  const a353 = await task('changes_requested', pull(162), { prState: 'open' });
  const a354 = await task('accepted', pull(163), { prState: 'merged' });
  return { request: r!, a350, a353, a354 };
}

/**
 * A row as the factory services take a task.
 * @param row
 * @param row.id
 * @param row.metadata
 */
const asTask = (row: { id: number; metadata: unknown }) => ({ id: row.id, meta: (row.metadata ?? {}) as Record<string, unknown> });

async function read(id: number) {
  const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!;
}

async function dispatchesFor(requestId: number) {
  return (await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.actionId, 'factory.dispatch_task'))))
    .filter(r => Number((r.input as { requestId?: unknown }).requestId) === requestId);
}

describe('settledReason reads the type, and a ship', () => {
  const settled = { field: 'state', in: SHIPPED };

  it('a request that shipped is settled whatever its state field reads afterwards', () => {
    expect(settledReason({ meta: { state: 'building', shippedAt: '2026-10-02T03:19:08Z', shippedIn: 355 }, settled })).toBe('it shipped in release #355');
  });

  it('a person\'s Build after the ship reopens it', () => {
    expect(settledReason({ meta: { state: 'building', shippedAt: '2026-10-02T03:19:08Z', reopenedAt: '2026-10-02T04:00:00Z' }, settled })).toBeNull();
  });

  it('otherwise the type\'s own `x-settled` decides, and a type with none falls back to the shared closed states', () => {
    expect(settledReason({ meta: { state: 'out_of_scope' }, settled })).toBe('it is out of scope');
    expect(settledReason({ meta: { state: 'building' }, settled })).toBeNull();
    expect(settledReason({ meta: { stage: 'done' }, settled: { field: 'stage', in: ['done'] } })).toBe('it is done');
    expect(settledReason({ meta: { state: 'shipped' }, settled: { field: 'stage', in: ['done'] } })).toBeNull();
    expect(settledReason({ meta: { state: 'deferred' } })).toBe('it is deferred');
  });

  it('an automatic start on a settled request is refused with that reason', () => {
    expect(settledRefusal({ id: 224, meta: { state: 'building', shippedAt: '2026-10-02T03:19:08Z', shippedIn: 355 }, settled })).toMatch(/^Nothing started: request #224 has settled \(it shipped in release #355\)/);
    expect(settledRefusal({ id: 224, meta: { state: 'building' }, settled })).toBeNull();
  });
});

describe('request 224: late events about a superseded attempt after the ship', () => {
  it('reads every older attempt, and every attempt of a shipped request, as history', async () => {
    const { request, a350, a354 } = await shippedRequest();

    expect(await attemptIsHistory(ORG, asTask(a350))).toBe(`request #${request.id} has settled (it shipped in release #355)`);
    expect(await attemptIsHistory(ORG, asTask(a354))).toBe(`request #${request.id} has settled (it shipped in release #355)`);

    // Before the ship, only the attempts a later one replaced are history.
    await db.update(businessObjectSchema).set({ metadata: { state: 'building' } }).where(eq(businessObjectSchema.id, request.id));

    expect(await attemptIsHistory(ORG, asTask(a350))).toMatch(/^attempt #\d+ superseded it$/);
    expect(await attemptIsHistory(ORG, asTask(a354))).toBeNull();
  });

  it('03:30:08 — the reconciler reads the superseded PR\'s close back without raising it or noting it on the shipped request', async () => {
    const { request, a353 } = await shippedRequest();
    const emitted: GithubEvent[] = [];
    const deps: ReconcileDeps = {
      readPull: async (_o, url) => ({ repo: REPO, pr: { number: Number(url.split('/').at(-1)), title: 'WIP', state: 'closed', merged_at: null, closed_at: '2026-10-02T03:29:00Z', html_url: url, head: { ref: 'factory/t353', sha: 'c1ffeb2e' }, base: { ref: 'main' } } as never, checkRuns: [] }),
      branchChecks: async () => ({ sha: null, complete: false, failing: [] }),
      updatePullBranch: vi.fn(async () => undefined),
      emit: async (_o, event) => {
        emitted.push(event);
        return { deduped: false };
      },
    };

    const out = await reconcileOpenPulls(ORG, new Date(), deps);

    expect(emitted.filter(e => e.payload.url === pull(162) || e.payload.url === pull(159))).toEqual([]);
    expect(out.filter(r => r.requestId === request.id)).toEqual([]);

    const log = ((await read(request.id)).metadata as { recovery: { log: Array<{ text: string }> } }).recovery.log.map(l => l.text);

    expect(log.some(l => l.includes('never reached Vocion'))).toBe(false);
    // The read-back is still stamped: the task's PR reads closed.
    expect(((await read(a353.id)).metadata as { prState?: string }).prState).toBe('closed');
  });

  it('03:30:35 — QA\'s verdict on closed PR #159 is history: the task keeps its status and nothing is built', async () => {
    const { request, a350 } = await shippedRequest();
    const tool = recordVerdictTool({ orgId: ORG, agentSlug: 'change-reviewer', emit: () => undefined } as never);

    const said = String(await tool.invoke({ pr_url: pull(159), value: 'changes', criteria: [{ criterion: 'Every row shows a copy-link control.', status: 'unproven' }], note: 'The control is missing on the list view.' }));

    expect(said).toMatch(/^Read as history: task #\d+ is not the attempt that decides anything \(request #\d+ has settled \(it shipped in release #355\)\)/);
    expect((await read(a350.id)).status).toBe('awaiting_review');
    expect(await dispatchesFor(request.id)).toEqual([]);
    expect(((await read(request.id)).metadata as { state: string }).state).toBe('shipped');
  });

  it('Build again on a superseded attempt starts nothing and files no stop, even at the limit', async () => {
    const full = { log: [], limit: 3, attempts: [1, 2, 3].map(n => ({ n, at: '2026-10-02T02:00:00Z', kind: 'build', line: 'x', runId: n, taskId: n, failure: null, trigger: 'recovery' })) };
    const { request, a350 } = await shippedRequest({ recovery: full });

    const said = await buildAgain(ORG, asTask(a350));

    expect(said).toBe(`Nothing built again: attempt #${a350.id} is history (request #${request.id} has settled (it shipped in release #355)).`);
    expect(await dispatchesFor(request.id)).toEqual([]);
    expect(((await read(request.id)).metadata as { recovery: { askId?: unknown } }).recovery.askId).toBeUndefined();
  });

  it('the dispatch itself refuses an automatic build of the shipped request — one guard for every caller — and takes a person\'s', async () => {
    vi.stubEnv('VOCION_EXTERNAL_WORKERS', '1');
    // Even with its state already written back to `building`, as 224's was.
    const { request, a350 } = await shippedRequest({ state: 'building' });
    const ctx = { orgId: ORG, invokedBy: 'agent:product-manager' } as never;

    expect(await factoryDispatchAction.precheck!(ctx, { requestId: request.id, autoRetryOf: a350.id } as never)).toMatch(/^Nothing started: request #\d+ has settled \(it shipped in release #355\)/);
    expect(await factoryDispatchAction.precheck!(ctx, { requestId: request.id, trigger: 'recovery', recoveryOfRun: 465 } as never)).toMatch(/has settled/);
    // A person's Build is not refused for having shipped (it may fail later for other reasons).
    expect(await factoryDispatchAction.precheck!(ctx, { requestId: request.id } as never) ?? '').not.toMatch(/has settled/);
  });
});
