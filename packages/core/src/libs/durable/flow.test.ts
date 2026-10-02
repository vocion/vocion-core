import type { Flow, FlowEffects } from './flow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compact, fill, FlowSchema, holds, runFlow } from './flow';
import { defineDurable, durable } from './index';
import { memoryRunResult, resetMemoryEngine } from './memory';

vi.mock('@/libs/DB');
vi.mock('./flowDefinitions', () => ({
  loadFlow: () => ({ name: 'kestrel/child', vars: {}, steps: [{ status: { stage: 'child', line: 'child ran {{input.n}}' } }, { end: { stage: 'child-done' } }] }),
}));

const scope = { input: { requestId: 7 }, vars: { a: { b: 2 }, s: 'x', none: null } };

describe('values and conditions are typed, never matched as text', () => {
  it('a whole template keeps the value\'s type; mixed text becomes text', () => {
    expect(fill('{{input.requestId}}', scope)).toBe(7);
    expect(fill('{{vars.a}}', scope)).toEqual({ b: 2 });
    expect(fill('n={{vars.a.b}} s={{vars.s}} none={{vars.none}}', scope)).toBe('n=2 s=x none=');
    expect(fill({ ids: ['{{input.requestId}}'] }, scope)).toEqual({ ids: [7] });
  });

  it('conditions compare values by path', () => {
    expect(holds({ path: 'vars.a.b', equals: 2 }, scope)).toBe(true);
    expect(holds({ path: 'vars.none', exists: false }, scope)).toBe(true);
    expect(holds({ path: 'vars.a.b', gt: 1 }, scope)).toBe(true);
    expect(holds({ all: [{ path: 'vars.s', in: ['x', 'y'] }, { not: { path: 'vars.a.b', lt: 2 } }] }, scope)).toBe(true);
    expect(holds({ any: [{ path: 'vars.s', notEquals: 'x' }, { path: 'vars.missing', exists: true }] }, scope)).toBe(false);
  });

  it('inputs with no value are left out', () => {
    expect(compact({ a: 1, b: null, c: undefined, d: { e: null, f: 2 } })).toEqual({ a: 1, d: { f: 2 } });
  });

  it('a step with no kind is refused by the schema', () => {
    expect(() => FlowSchema.parse({ name: 'x', steps: [{ nope: true }] })).toThrow();
  });
});

describe('the flow runner', () => {
  afterEach(() => resetMemoryEngine());

  let n = 0;
  const run = async (flow: Flow, effects: FlowEffects = { runAction: async () => ({ status: 'done', result: {}, error: null }) }) => {
    const name = `test.flow.${n++}`;
    defineDurable({ name, run: (ctx, input: { orgId: string; flowRef: string; flow: Flow; input: Record<string, unknown> }) => runFlow(ctx, input, effects) });
    const id = `org_flow:test:${n}`;
    await durable().start(name, id, { orgId: 'org_flow', flowRef: 'kestrel/test', flow, input: { requestId: 3 } });
    return id;
  };

  it('loops with carried variables, steers with next and break, and ends with a stage', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const id = await run(FlowSchema.parse({
      name: 'kestrel/count',
      vars: { i: 0 },
      steps: [
        { loop: { max: 10, steps: [
          { set: { i: { add: [{ from: 'vars.i' }, 1] } } },
          { when: [{ if: { path: 'vars.i', lt: 3 }, then: [{ next: true }] }] },
          { do: 'kestrel.record', input: { i: '{{vars.i}}', missing: '{{vars.nothing}}' }, as: 'out' },
          { break: true },
        ] } },
        { status: { stage: 'counted', line: 'counted to {{vars.i}}' } },
        { end: { stage: 'counted' } },
      ],
    }), { runAction: async (_o, actionId, input, by) => {
      calls.push({ actionId, input, by });
      return { status: 'done', result: { ok: true }, error: null };
    } });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'counted' });
    expect(calls).toEqual([{ actionId: 'kestrel.record', input: { i: 3 }, by: 'workflow:kestrel/count' }]);
    expect((await durable().status(id))?.line).toBe('counted to 3');
  });

  it('waits for a message with a timeout and branches on it', async () => {
    const id = await run(FlowSchema.parse({
      name: 'kestrel/word',
      steps: [
        { wait_message: { topic: 'word', timeout: 5 }, as: 'word' },
        { when: [{ if: { path: 'vars.word.go', equals: true }, then: [{ end: { stage: 'went' } }] }, { else: [{ end: { stage: 'stayed' } }] }] },
      ],
    }));
    await durable().signal(id, 'word', { go: true });

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'went' });
  });

  it('runs a child flow and keeps its result', async () => {
    const id = await run(FlowSchema.parse({
      name: 'kestrel/parent',
      steps: [
        { child: { flow: 'kestrel/child', id: 'org_flow:child:1', input: { n: '{{input.requestId}}' } }, as: 'kid' },
        { when: [{ if: { path: 'vars.kid.stage', equals: 'child-done' }, then: [{ end: { stage: 'parent-done' } }] }] },
      ],
    }));

    await expect(memoryRunResult(id)).resolves.toEqual({ stage: 'parent-done' });
  });
});
