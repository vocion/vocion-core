import { beforeEach, describe, expect, it, vi } from 'vitest';

const engine = vi.hoisted(() => ({ states: new Map<string, string>(), started: [] as string[], cancelled: [] as string[] }));
const flowDef = vi.hoisted(() => ({ current: { name: 'northwind/request', steps: [{ status: { stage: 'idle' } }] } as unknown }));

vi.mock('./index', () => ({
  durableIdFor: (org: string, kind: string, key: string) => `${org}:${kind}:${key}`,
  durable: () => ({
    state: async (id: string) => engine.states.get(id) ?? 'unknown',
    cancel: async (id: string) => {
      engine.cancelled.push(id);
      engine.states.set(id, 'cancelled');
    },
    start: async (_name: string, id: string) => {
      engine.started.push(id);
      engine.states.set(id, 'pending');
    },
  }),
}));
vi.mock('./flowDefinitions', () => ({ loadFlow: () => flowDef.current }));
vi.mock('./flow', () => ({ FLOW_RUN: 'vocion.flow' }));

const { ensureRecordFlow, flowHash, restartOnCurrentFlow } = await import('./records');

function store() {
  const box: { meta: Record<string, unknown> } = { meta: {} };
  return {
    box,
    o: { orgId: 'org_n', recordId: 7, kind: 'request', flowRef: 'northwind/request', input: { requestId: 7 }, readMeta: async () => box.meta, writeMeta: async (p: Record<string, unknown>) => {
      box.meta = { ...box.meta, ...p };
    } },
  };
}

beforeEach(() => {
  engine.states.clear();
  engine.started.length = 0;
  engine.cancelled.length = 0;
  flowDef.current = { name: 'northwind/request', steps: [{ status: { stage: 'idle' } }] };
});

describe('a run on an old flow is restarted on the current one (Walk 18, FE-419)', () => {
  it('leaves a run on the current flow alone', async () => {
    const { box, o } = store();
    await ensureRecordFlow(o);

    expect(await restartOnCurrentFlow(o)).toEqual({ restarted: false, workflowId: 'org_n:request:7.1' });
    expect(engine.cancelled).toEqual([]);
    expect((box.meta.durable as { flowHash: string }).flowHash).toBe(flowHash(flowDef.current));
  });

  it('cancels a run started on another definition and starts the next generation on the current one', async () => {
    const { box, o } = store();
    await ensureRecordFlow(o);
    flowDef.current = { name: 'northwind/request', steps: [{ status: { stage: 'idle', line: 'changed' } }] };

    const out = await restartOnCurrentFlow(o);

    expect(out).toEqual({ restarted: true, workflowId: 'org_n:request:7.2' });
    expect(engine.cancelled).toEqual(['org_n:request:7.1']);
    expect((box.meta.durable as { generation: number; flowHash: string })).toMatchObject({ generation: 2, flowHash: flowHash(flowDef.current) });
  });

  it('treats a run marked before runs carried a definition as an old one', async () => {
    const { box, o } = store();
    box.meta = { durable: { workflowId: 'org_n:request:7.1', generation: 1, startedAt: '2026-10-02T00:00:00Z' } };
    engine.states.set('org_n:request:7.1', 'pending');

    expect((await restartOnCurrentFlow(o)).restarted).toBe(true);
    expect(engine.cancelled).toEqual(['org_n:request:7.1']);
  });
});
