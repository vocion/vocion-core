import type { AttemptOutcome, BuildIntent, RequestWorkflowDeps, RunRead } from './requestWorkflow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineDurable, durable, durableIdFor } from '@/libs/durable';
import { memoryRunResult, resetMemoryEngine } from '@/libs/durable/memory';
import { BUILD_REQUESTED, runRequest } from './requestWorkflow';

vi.mock('@/libs/DB');

const ORG = 'org_request_wf';
let n = 0;

type Script = {
  dispatches: Array<{ intent: BuildIntent; attempt: number; base: string | null }>;
  stops: string[];
};

/**
 * A workflow over scripted effects: each dispatch returns the next outcome,
 * each run read the next read.
 * @param outcomes - What each dispatch returns, in order.
 * @param reads - What each run read returns, keyed by worker run id.
 */
function harness(outcomes: AttemptOutcome[], reads: Record<number, RunRead>) {
  const script: Script = { dispatches: [], stops: [] };
  const deps: RequestWorkflowDeps = {
    dispatch: async (_o, _r, intent, at) => {
      script.dispatches.push({ intent, attempt: at.attempt, base: at.base });
      return outcomes.shift() ?? { kind: 'refused', why: 'no more scripted outcomes' };
    },
    readRun: async (_o, id) => reads[id]!,
    stop: async (_o, _r, why) => {
      script.stops.push(why);
    },
  };
  const name = `test.request.${n++}`;
  defineDurable({ name, run: (ctx, input: { orgId: string; requestId: number; since: string }) => runRequest(ctx, input, deps) });
  return { script, name };
}

const emit = async (type: string, payload: Record<string, unknown>) => {
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({ orgId: ORG, type, payload });
};
const ask = (requestId: number, extra: Partial<BuildIntent> = {}) => emit(BUILD_REQUESTED, { requestId, by: 'usr_person', byPerson: true, from: 'build', ...extra });
const failed = (branch: string): RunRead => ({ status: 'failed', branch, prUrl: null, failure: 'the required checks failed (test)', decision: { do: 'dispatch', why: 'checks failed' } });
const opened = (branch: string, prUrl: string): RunRead => ({ status: 'completed', branch, prUrl, failure: null, decision: { do: 'none', why: '' } });

async function start(name: string, requestId: number) {
  const id = durableIdFor(ORG, 'request', `${requestId}.1`);
  await durable().start(name, id, { orgId: ORG, requestId, since: new Date(Date.now() - 5000).toISOString() });
  return id;
}

async function until(id: string, stage: string) {
  await vi.waitFor(async () => expect((await durable().status(id))?.stage).toBe(stage), { timeout: 5000 });
}

afterEach(async () => {
  resetMemoryEngine();
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema, eventLogSchema } = await import('@/models/Schema');
  await db.delete(durableWaitSchema);
  await db.delete(eventLogSchema);
});

describe('one workflow owns a request from Build to live (backlog 054)', () => {
  it('retries a failure on the kept branch, takes QA\'s send-back as the next attempt, and ends live', async () => {
    const { script, name } = harness(
      [{ kind: 'building', workerRunId: 501, taskId: 1 }, { kind: 'building', workerRunId: 502, taskId: 2 }, { kind: 'building', workerRunId: 503, taskId: 3 }],
      { 501: failed('wip-501'), 502: opened('feat-2', 'pr/2'), 503: opened('feat-3', 'pr/3') },
    );
    await ask(40);
    const id = await start(name, 40);
    await until(id, 'building');
    await emit('worker_run.failed', { workerRunId: 501 });
    await vi.waitFor(() => expect(script.dispatches).toHaveLength(2));
    await emit('worker_run.completed', { workerRunId: 502 });
    await until(id, 'review');
    // QA sends it back: that is a build ask, told to the workflow.
    await ask(40, { by: 'agent:change-reviewer', byPerson: false, from: 'qa', note: 'prove the empty state' });
    await vi.waitFor(() => expect(script.dispatches).toHaveLength(3));
    await emit('worker_run.completed', { workerRunId: 503 });
    await until(id, 'review');
    // A late merge of an older attempt's PR is not this attempt's.
    await emit('pr.merged', { url: 'pr/2' });
    await emit('pr.merged', { url: 'pr/3' });
    await until(id, 'deploying');
    await emit('release.linked', { releaseId: 900, requestIds: [40] });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'live' });
    expect(script.dispatches.map(d => [d.attempt, d.base, d.intent.from])).toEqual([[1, null, 'build'], [2, 'wip-501', 'recovery'], [3, 'feat-2', 'qa']]);
  });

  it('a person\'s Build again after a stop continues the latest kept branch at the next attempt (FE-364)', async () => {
    const { script, name } = harness(
      [{ kind: 'building', workerRunId: 473, taskId: 366 }, { kind: 'building', workerRunId: 474, taskId: 367 }],
      { 473: { ...failed('factory/send-t366-wip-473'), decision: { do: 'escalate', why: 'Stopped: needs a person' } }, 474: opened('feat', 'pr/9') },
    );
    await ask(364);
    const id = await start(name, 364);
    await until(id, 'building');
    await emit('worker_run.failed', { workerRunId: 473 });
    await until(id, 'stopped');

    expect(script.stops).toEqual(['Stopped: needs a person']);

    // The person's word, from chat or the ask's Build again: a message, not a dispatch.
    await ask(364, { from: 'chat', note: 'fix the size label' });
    await vi.waitFor(() => expect(script.dispatches).toHaveLength(2));

    expect(script.dispatches[1]).toMatchObject({ attempt: 2, base: 'factory/send-t366-wip-473', intent: { from: 'chat', note: 'fix the size label', byPerson: true } });
  });

  it('the live check is done only when a result is recorded: one retry with the reason, then a typed stop (release #369)', async () => {
    const asks: string[] = [];
    const stops: string[] = [];
    const name = `test.request.live.${n++}`;
    defineDurable({
      name,
      run: (ctx, input: { orgId: string; requestId: number; since: string }) => runRequest(ctx, input, {
        dispatch: async () => ({ kind: 'building', workerRunId: 901, taskId: 9 }),
        readRun: async () => opened('b', 'pr/45'),
        stop: async (_o, _r, why) => {
          stops.push(why);
        },
        readLive: async () => null,
        askLive: async (_o, releaseId, why) => {
          asks.push(`${releaseId}:${why}`);
        },
      }),
    });
    await ask(45);
    const id = await start(name, 45);
    await until(id, 'building');
    await emit('worker_run.completed', { workerRunId: 901 });
    await until(id, 'review');
    await emit('pr.merged', { url: 'pr/45' });
    await until(id, 'deploying');
    await emit('release.linked', { releaseId: 369, requestIds: [45] });
    await emit('automation_run.completed', { slug: 'release-live-check' });
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    await emit('automation_run.completed', { slug: 'release-live-check' });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'live_unchecked' });
    expect(asks[0]).toMatch(/^369:the last QA run ended without recording/);
    expect(stops).toEqual(['REL-369 is live, but no live check was recorded after 2 tries.']);
  });

  it('a person\'s cancel is final: nothing retries it', async () => {
    const { script, name } = harness([{ kind: 'building', workerRunId: 601, taskId: 1 }], { 601: { status: 'cancelled', branch: 'wip-601', prUrl: null, failure: null, decision: { do: 'dispatch', why: '' } } });
    await ask(41);
    const id = await start(name, 41);
    await until(id, 'building');
    await emit('worker_run.completed', { workerRunId: 601 });
    await until(id, 'stopped');
    await new Promise(r => setTimeout(r, 50));

    expect(script.dispatches).toHaveLength(1);
  });

  it('stops after three automatic attempts in a row and asks a person once', async () => {
    const { script, name } = harness(
      [501, 502, 503, 504].map(w => ({ kind: 'building', workerRunId: w, taskId: w }) as AttemptOutcome),
      { 501: failed('b1'), 502: failed('b2'), 503: failed('b3'), 504: failed('b4') },
    );
    await ask(42);
    const id = await start(name, 42);
    for (const w of [501, 502, 503, 504]) {
      await vi.waitFor(() => expect(script.dispatches.length).toBeGreaterThanOrEqual(w - 500));
      await emit('worker_run.failed', { workerRunId: w });
    }
    await until(id, 'stopped');

    expect(script.dispatches).toHaveLength(4);
    expect(script.stops).toHaveLength(1);
    expect(script.stops[0]).toMatch(/3 automatic attempts/);
  });

  it('an ask raised while the dispatch runs is not lost (FE-370: the plan approved before the wait opened)', async () => {
    const { script, name } = harness([], {});
    const outcomes: AttemptOutcome[] = [{ kind: 'planning', line: 'Planning first' }, { kind: 'building', workerRunId: 801, taskId: 8 }];
    defineDurable({
      name: `${name}.race`,
      run: (ctx, input: { orgId: string; requestId: number; since: string }) => runRequest(ctx, input, {
        dispatch: async (_o, _r, intent, at) => {
          script.dispatches.push({ intent, attempt: at.attempt, base: at.base });
          const out = outcomes.shift()!;
          if (out.kind === 'planning') {
            // The planner is fast: its plan is approved and the build asked for before this step returns.
            await ask(44, { by: 'factory:plan', byPerson: false, from: 'plan', planId: 88, trigger: 'plan' });
          }
          return out;
        },
        readRun: async () => opened('b', 'pr/44'),
        stop: async () => {},
      }),
    });
    await ask(44);
    const id = await start(`${name}.race`, 44);
    await until(id, 'building');

    expect(script.dispatches.map(d => d.intent.from)).toEqual(['build', 'plan']);
  });

  it('planning is not an attempt: the plan\'s ask starts attempt 1', async () => {
    const { script, name } = harness([{ kind: 'planning', line: 'Planning first: three packages' }, { kind: 'building', workerRunId: 701, taskId: 7 }], {});
    await ask(43);
    const id = await start(name, 43);
    await until(id, 'planning');
    await ask(43, { by: 'factory:plan', byPerson: false, from: 'plan', planId: 77, trigger: 'plan' });
    await until(id, 'building');

    expect(script.dispatches.map(d => [d.attempt, d.intent.from, d.intent.planId ?? null])).toEqual([[1, 'build', null], [1, 'plan', 77]]);
  });
});
