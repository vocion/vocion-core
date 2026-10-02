import { afterEach, describe, expect, it, vi } from 'vitest';
import { durable } from '@/libs/durable';
import { resetMemoryEngine } from '@/libs/durable/memory';

vi.mock('@/libs/DB');
const meta = new Map<number, Record<string, unknown>>();
vi.mock('@/libs/actions/factory-dispatch', () => ({
  readRecord: async (_o: string, id: number) => ({ id, title: 'r', typeId: 1, typeSlug: 'request', meta: meta.get(id) ?? {} }),
  writeMeta: async (_o: string, id: number, set: Record<string, unknown>) => {
    meta.set(id, { ...(meta.get(id) ?? {}), ...set });
  },
}));
// The real workflow is replaced by one that waits for the first ask and ends.
vi.mock('./requestWorkflow', async () => {
  const { defineDurable: define } = await import('@/libs/durable');
  define({ name: 'factory.request', run: async ctx => ctx.waitFor('end', 5) });
  return { BUILD_REQUESTED: 'factory.build_requested', REQUEST_WORKFLOW: 'factory.request' };
});

const ORG = 'org_wf_start';

afterEach(async () => {
  resetMemoryEngine();
  meta.clear();
  const { db } = await import('@/libs/DB');
  const { eventLogSchema } = await import('@/models/Schema');
  await db.delete(eventLogSchema);
});

describe('a build ask goes to the request\'s one workflow', () => {
  it('records the ask, starts the workflow once while it lives, and a new generation after it ends', async () => {
    const { askRequestWorkflow } = await import('./requestWorkflowStart');
    const first = await askRequestWorkflow(ORG, 5, { by: 'usr_a', byPerson: true, from: 'build' });
    const second = await askRequestWorkflow(ORG, 5, { by: 'usr_a', byPerson: true, from: 'chat', note: 'again' });

    expect(first.workflowId).toBe(`${ORG}:request:5.1`);
    expect(second.workflowId).toBe(first.workflowId);
    expect(meta.get(5)?.durable).toMatchObject({ workflowId: `${ORG}:request:5.1`, generation: 1 });

    const { db } = await import('@/libs/DB');
    const { eventLogSchema } = await import('@/models/Schema');
    const asks = await db.select().from(eventLogSchema);

    expect(asks.map(e => [e.type, (e.payload as { from: string }).from])).toEqual([['factory.build_requested', 'build'], ['factory.build_requested', 'chat']]);

    await durable().signal(String(first.workflowId), 'end', true);
    await vi.waitFor(async () => expect(await durable().state(String(first.workflowId))).toBe('succeeded'));
    const third = await askRequestWorkflow(ORG, 5, { by: 'usr_a', byPerson: true, from: 'build' });

    expect(third.workflowId).toBe(`${ORG}:request:5.2`);
  });
});
