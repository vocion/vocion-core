/**
 * EXECUTED TWICE IS IMPOSSIBLE (request #224, 2026-09-29).
 *
 * Runs 5016 and 5018 each started request #224 within 27 seconds; each went
 * to planning and asked the planner for a plan, so two planners ran side by
 * side for one change and neither filed (mission runs 6102, 6103). A second
 * start of a request that is already building answers "already building:
 * run #N" and starts nothing. Every name below is invented.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildUnderway, factoryDispatchAction, underwayRefusal } from './factory-dispatch';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, workerRunSchema } = await import('@/models/Schema');

const NOW = new Date('2026-09-29T03:23:09Z');
const planning = { planning: true, requestId: 224, workerRunId: null, why: 'the allowed paths span 3 packages' };

describe('is the request already building? (pure)', () => {
  it('a start that went to planning a minute ago holds the request, and says which run has it', () => {
    const out = underwayRefusal([{ id: 5016, status: 'done', executedAt: new Date('2026-09-29T03:22:41Z'), result: planning }], { now: NOW });

    expect(out).toMatch(/^already building: run #5016/);
    expect(out).toMatch(/planning first \(the allowed paths span 3 packages\)/);
  });

  it('a plan\'s own build is the continuation of that planning, not a second start', () => {
    expect(underwayRefusal([{ id: 5016, status: 'done', executedAt: new Date('2026-09-29T03:22:41Z'), result: planning }], { now: NOW, trigger: 'plan' })).toBeNull();
  });

  it('planning that went quiet for fifteen minutes no longer holds it: a person may press Build again', () => {
    expect(underwayRefusal([{ id: 5016, status: 'done', executedAt: new Date('2026-09-29T03:07:00Z'), result: planning }], { now: NOW })).toBeNull();
  });

  it('a worker run that is queued, running or paused holds it; one that ended does not', () => {
    const started = { workerRunId: 409, requestId: 224, taskId: 225 };

    expect(underwayRefusal([{ id: 5017, status: 'done', executedAt: NOW, result: started, workerStatus: 'running' }], { now: NOW })).toMatch(/^already building: run #409 \(started by action #5017\) is running/);

    for (const ended of ['completed', 'failed', 'cancelled', 'awaiting_review']) {
      expect(underwayRefusal([{ id: 5017, status: 'done', executedAt: NOW, result: started, workerStatus: ended }], { now: NOW })).toBeNull();
    }
  });

  it('a start between its decision and its result holds it', () => {
    expect(underwayRefusal([{ id: 5020, status: 'executing', executedAt: null, result: null }], { now: NOW })).toMatch(/^already building: run #5020/);
  });

  it('an undone or failed start holds nothing', () => {
    expect(underwayRefusal([{ id: 5016, status: 'undone', executedAt: NOW, result: planning }, { id: 5015, status: 'failed', executedAt: null, result: null }], { now: NOW })).toBeNull();
  });
});

describe('the action keys every start on its request, and keeps its triggers to itself', () => {
  it('owns its dedup key and names the fields a model may not write', () => {
    expect(factoryDispatchAction.ownsDedupKey).toBe(true);
    expect(factoryDispatchAction.internalInput).toEqual(expect.arrayContaining(['trigger', 'autoRetryOf', 'recoveryOfRun', 'planFirst']));
    expect(factoryDispatchAction.dedupKeyFor!(factoryDispatchAction.inputSchema.parse({ requestId: 224, reason: 'x' }))).toBe('factory.dispatch_task:request-224');
  });
});

describe('buildUnderway, read from the runs', () => {
  const ORG = 'org_build_underway';

  beforeEach(async () => {
    await db.delete(actionRunSchema);
    await db.delete(workerRunSchema);
  });

  afterAll(async () => {
    await db.delete(actionRunSchema);
    await db.delete(workerRunSchema);
  });

  it('refuses a second start while the first is planning, but not the run asking about itself', async () => {
    const [run] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', input: { requestId: 224 }, status: 'done', executedAt: new Date(), result: planning }).returning({ id: actionRunSchema.id });

    expect(await buildUnderway(ORG, 224)).toMatch(new RegExp(`^already building: run #${run!.id}`));
    expect(await buildUnderway(ORG, 224, { excludeRunId: run!.id })).toBeNull();
    expect(await buildUnderway(ORG, 999)).toBeNull();
    expect(await buildUnderway('org_other', 224)).toBeNull();
  });

  it('reads the worker run\'s status for a start that queued a build', async () => {
    const [worker] = await db.insert(workerRunSchema).values({ orgId: ORG, agentSlug: 'send-engineer', status: 'queued' }).returning({ id: workerRunSchema.id });
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'factory.dispatch_task', input: { requestId: 130 }, status: 'done', executedAt: new Date(), result: { workerRunId: worker!.id, requestId: 130 } });

    expect(await buildUnderway(ORG, 130)).toMatch(new RegExp(`^already building: run #${worker!.id}`));
  });
});
