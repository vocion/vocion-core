import type { FlowEffects } from '@/libs/durable/flow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineDurable, durable, durableIdFor } from '@/libs/durable';
import { runFlow } from '@/libs/durable/flow';
import { loadFlow } from '@/libs/durable/flowDefinitions';
import { memoryRunResult, resetMemoryEngine } from '@/libs/durable/memory';
import { BUILD_REQUESTED, REQUEST_FLOW } from './requestWorkflowStart';

vi.mock('@/libs/DB');

/**
 * The software-factory plugin's request flow (`workflows/request.yaml`), run
 * by the generic flow engine over scripted actions: the same seven cases the
 * TypeScript workflow it replaces was held to (backlog 054).
 */
const ORG = 'org_request_flow';
let n = 0;

type Outcome = { kind: 'building'; workerRunId: number; taskId: number } | { kind: 'planning'; line: string } | { kind: 'refused'; why: string };
type Read = { status: string; branch: string | null; prUrl: string | null; failure: string | null; decision: { do: string; why: string } };
type Dispatch = { attempt: number; base: string | null; reason: string; by: string; note?: string; planId?: number; trigger?: string };

function harness(outcomes: Outcome[], reads: Record<number, Read>, opts: { live?: () => { state: string | null; line: string | null }; onDispatch?: (d: Dispatch) => Promise<void> } = {}) {
  const dispatches: Dispatch[] = [];
  const stops: string[] = [];
  const asks: string[] = [];
  const marks: Array<[string, string]> = [];
  const effects: FlowEffects = {
    async markRecord(_org, _id, transition, line) {
      marks.push([transition, line]);
    },
    async runAction(_org, actionId, input, by) {
      if (actionId === 'factory.dispatch_task') {
        const contract = (input.contract ?? {}) as { attempt?: number; baseSha?: string };
        const d: Dispatch = { attempt: Number(contract.attempt), base: contract.baseSha ?? null, reason: String(input.reason), by, ...(input.note ? { note: String(input.note) } : {}), ...(input.planId ? { planId: Number(input.planId) } : {}), ...(input.trigger ? { trigger: String(input.trigger) } : {}) };
        dispatches.push(d);
        await opts.onDispatch?.(d);
        const out = outcomes.shift() ?? { kind: 'refused', why: 'no more scripted outcomes' };
        return out.kind === 'refused'
          ? { status: 'refused', result: null, error: out.why }
          : { status: 'done', result: out.kind === 'planning' ? { planning: true, why: out.line } : { workerRunId: out.workerRunId, taskId: out.taskId }, error: null };
      }
      if (actionId === 'factory.read_attempt') {
        return { status: 'done', result: reads[Number(input.workerRunId)] as unknown as Record<string, unknown>, error: null };
      }
      if (actionId === 'factory.stop_request') {
        stops.push(String(input.why));
        return { status: 'done', result: { stopped: true }, error: null };
      }
      if (actionId === 'factory.read_release_live') {
        return { status: 'done', result: opts.live?.() ?? { state: null, line: null }, error: null };
      }
      if (actionId === 'factory.check_live_again') {
        asks.push(`${input.releaseId}:${input.reason}`);
        return { status: 'done', result: {}, error: null };
      }
      throw new Error(`unscripted action ${actionId}`);
    },
  };
  const name = `test.request.flow.${n++}`;
  defineDurable({ name, run: (ctx, input: { orgId: string; flowRef: string; flow: never; input: Record<string, unknown> }) => runFlow(ctx, input, effects) });
  return { dispatches, stops, asks, marks, name };
}

const emit = async (type: string, payload: Record<string, unknown>) => {
  const { emitEvent } = await import('@/services/EventService');
  await emitEvent({ orgId: ORG, type, payload });
};
const ask = (requestId: number, extra: Record<string, unknown> = {}) => emit(BUILD_REQUESTED, { requestId, by: 'usr_person', byPerson: true, from: 'build', ...extra });
const failed = (branch: string): Read => ({ status: 'failed', branch, prUrl: null, failure: 'the required checks failed (test)', decision: { do: 'dispatch', why: 'checks failed' } });
const opened = (branch: string, prUrl: string): Read => ({ status: 'completed', branch, prUrl, failure: null, decision: { do: 'none', why: '' } });
const from = (d: Dispatch) => /\(([\w-]+)\)\.$/.exec(d.reason)?.[1];

async function start(name: string, requestId: number) {
  const id = durableIdFor(ORG, 'request', `${requestId}.1`);
  await durable().start(name, id, { orgId: ORG, flowRef: REQUEST_FLOW, flow: loadFlow(REQUEST_FLOW), input: { requestId, since: new Date(Date.now() - 5000).toISOString() } });
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

describe('the software-factory request flow owns a request from Build to live (backlog 054)', () => {
  it('parses as a flow', () => {
    expect(loadFlow(REQUEST_FLOW).name).toBe(REQUEST_FLOW);
  });

  it('writes the request\'s own status in the same step as the run\'s, and every transition it names has a value on the request type (Chris, 2026-10-02)', async () => {
    const h = harness([{ kind: 'building', workerRunId: 601, taskId: 1 }], { 601: opened('feat-1', 'pr/61') }, { live: () => ({ state: 'seen', line: 'Seen live: 2 of 2' }) });
    await ask(60);
    const id = await start(h.name, 60);
    await until(id, 'building');
    await emit('worker_run.completed', { workerRunId: 601 });
    await until(id, 'review');
    await emit('pr.merged', { url: 'pr/61' });
    await until(id, 'deploying');
    await emit('release.linked', { releaseId: 901, requestIds: [60] });
    await vi.waitFor(() => expect(h.marks.map(([t]) => t)).toContain('checking_live'));
    await emit('automation_run.completed', { slug: 'release-live-check' });
    await memoryRunResult(id);

    expect(h.marks.map(([t]) => t)).toEqual(['starting', 'building', 'review', 'deploying', 'checking_live', 'live']);
    expect(h.marks[1]![1]).toBe('RUN-601 is building attempt 1.');

    // `checking_live` is deliberately no transition: the release already wrote Shipped.
    const { REQUEST_STATUSES } = await import('@/libs/objects/requestStatuses.fixture');
    const { valueFor } = await import('@/libs/objects/statusModel');

    expect(h.marks.map(([t]) => [t, valueFor(REQUEST_STATUSES, t)])).toEqual([['starting', 'building'], ['building', 'building'], ['review', 'in_qa'], ['deploying', 'deploying'], ['checking_live', null], ['live', 'seen_live']]);
  });

  it('retries a failure on the kept branch, takes QA\'s send-back as the next attempt, and ends live', async () => {
    const h = harness(
      [{ kind: 'building', workerRunId: 501, taskId: 1 }, { kind: 'building', workerRunId: 502, taskId: 2 }, { kind: 'building', workerRunId: 503, taskId: 3 }],
      { 501: failed('wip-501'), 502: opened('feat-2', 'pr/2'), 503: opened('feat-3', 'pr/3') },
      { live: () => ({ state: 'seen', line: 'Seen live: 2 of 2' }) },
    );
    await ask(40);
    const id = await start(h.name, 40);
    await until(id, 'building');
    await emit('worker_run.failed', { workerRunId: 501 });
    await vi.waitFor(() => expect(h.dispatches).toHaveLength(2));
    await emit('worker_run.completed', { workerRunId: 502 });
    await until(id, 'review');
    await ask(40, { by: 'agent:change-reviewer', byPerson: false, from: 'qa', note: 'prove the empty state' });
    await vi.waitFor(() => expect(h.dispatches).toHaveLength(3));
    await emit('worker_run.completed', { workerRunId: 503 });
    await until(id, 'review');
    // A late merge of an older attempt's PR is not this attempt's.
    await emit('pr.merged', { url: 'pr/2' });
    await emit('pr.merged', { url: 'pr/3' });
    await until(id, 'deploying');
    await emit('release.linked', { releaseId: 900, requestIds: [40] });
    await emit('automation_run.completed', { slug: 'release-live-check' });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'live' });
    expect(h.dispatches.map(d => [d.attempt, d.base, from(d)])).toEqual([[1, null, 'build'], [2, 'wip-501', 'recovery'], [3, 'feat-2', 'qa']]);
  });

  it('a person\'s Build again after a stop continues the latest kept branch at the next attempt (FE-364)', async () => {
    const h = harness(
      [{ kind: 'building', workerRunId: 473, taskId: 366 }, { kind: 'building', workerRunId: 474, taskId: 367 }],
      { 473: { ...failed('factory/send-t366-wip-473'), decision: { do: 'escalate', why: 'Stopped: needs a person' } }, 474: opened('feat', 'pr/9') },
    );
    await ask(364);
    const id = await start(h.name, 364);
    await until(id, 'building');
    await emit('worker_run.failed', { workerRunId: 473 });
    await until(id, 'stopped');

    expect(h.stops).toEqual(['Stopped: needs a person']);

    await ask(364, { from: 'chat', note: 'fix the size label' });
    await vi.waitFor(() => expect(h.dispatches).toHaveLength(2));

    expect(h.dispatches[1]).toMatchObject({ attempt: 2, base: 'factory/send-t366-wip-473', note: 'fix the size label', by: 'usr_person' });
    expect(from(h.dispatches[1]!)).toBe('chat');
  });

  it('the live check is done only when a result is recorded: one retry with the reason, then a typed stop (release #369)', async () => {
    const h = harness([{ kind: 'building', workerRunId: 901, taskId: 9 }], { 901: opened('b', 'pr/45') });
    await ask(45);
    const id = await start(h.name, 45);
    await until(id, 'building');
    await emit('worker_run.completed', { workerRunId: 901 });
    await until(id, 'review');
    await emit('pr.merged', { url: 'pr/45' });
    await until(id, 'deploying');
    await emit('release.linked', { releaseId: 369, requestIds: [45] });
    await emit('automation_run.completed', { slug: 'release-live-check' });
    await vi.waitFor(() => expect(h.asks).toHaveLength(1));
    await emit('automation_run.completed', { slug: 'release-live-check' });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'live_unchecked' });
    expect(h.asks[0]).toMatch(/^369:the last QA run ended without recording/);
    expect(h.stops).toEqual(['REL-369 is live, but no live check was recorded after 2 tries.']);
  });

  it('a person\'s cancel is final: nothing retries it', async () => {
    const h = harness([{ kind: 'building', workerRunId: 601, taskId: 1 }], { 601: { status: 'cancelled', branch: 'wip-601', prUrl: null, failure: null, decision: { do: 'dispatch', why: '' } } });
    await ask(41);
    const id = await start(h.name, 41);
    await until(id, 'building');
    await emit('worker_run.completed', { workerRunId: 601 });
    await until(id, 'stopped');
    await new Promise(r => setTimeout(r, 50));

    expect(h.dispatches).toHaveLength(1);
  });

  it('stops after three automatic attempts in a row and asks a person once', async () => {
    const h = harness(
      [501, 502, 503, 504].map(w => ({ kind: 'building', workerRunId: w, taskId: w }) as Outcome),
      { 501: failed('b1'), 502: failed('b2'), 503: failed('b3'), 504: failed('b4') },
    );
    await ask(42);
    const id = await start(h.name, 42);
    for (const w of [501, 502, 503, 504]) {
      await vi.waitFor(() => expect(h.dispatches.length).toBeGreaterThanOrEqual(w - 500));
      await emit('worker_run.failed', { workerRunId: w });
    }
    await until(id, 'stopped');

    expect(h.dispatches).toHaveLength(4);
    expect(h.stops).toHaveLength(1);
    expect(h.stops[0]).toMatch(/3 automatic attempts/);
  });

  it('an ask raised while the dispatch runs is not lost (FE-370: the plan approved before the wait opened)', async () => {
    let planned = false;
    const h = harness([{ kind: 'planning', line: 'Planning first' }, { kind: 'building', workerRunId: 801, taskId: 8 }], {}, {
      onDispatch: async () => {
        if (!planned) {
          planned = true;
          // The planner is fast: its plan is approved and the build asked for before this step returns.
          await ask(44, { by: 'factory:plan', byPerson: false, from: 'plan', planId: 88, trigger: 'plan' });
        }
      },
    });
    await ask(44);
    const id = await start(h.name, 44);
    await until(id, 'building');

    expect(h.dispatches.map(from)).toEqual(['build', 'plan']);
  });

  it('planning is not an attempt: the plan\'s ask starts attempt 1', async () => {
    const h = harness([{ kind: 'planning', line: 'three packages' }, { kind: 'building', workerRunId: 701, taskId: 7 }], {});
    await ask(43);
    const id = await start(h.name, 43);
    await until(id, 'planning');
    await ask(43, { by: 'factory:plan', byPerson: false, from: 'plan', planId: 77, trigger: 'plan' });
    await until(id, 'building');

    expect(h.dispatches.map(d => [d.attempt, from(d), d.planId ?? null])).toEqual([[1, 'build', null], [1, 'plan', 77]]);
  });
});
