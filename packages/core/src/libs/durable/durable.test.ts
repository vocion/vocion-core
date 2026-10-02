import { afterEach, describe, expect, it, vi } from 'vitest';
import { defineDurable, durable, durableIdFor } from './index';
import { memoryRunResult, resetMemoryEngine } from './memory';

vi.mock('@/libs/DB');

const ORG = 'org_durable_test';

// A record's run: waits for a typed event naming it, retries carrying state,
// says where it is, and ends.
defineDurable<{ recordId: number; failTimes: number }, { carried: string | null; answeredBy: string | null }>({
  name: 'test.record',
  async run(ctx, input) {
    await ctx.setStatus({ stage: 'started', line: 'started' });
    let carried: string | null = null;
    for (let n = 1; n <= 3; n++) {
      const r = await ctx.step(`attempt-${n}`, async () => (n <= input.failTimes ? { ok: false, branch: `wip-${n}` } : { ok: true }));
      if (r.ok) {
        break;
      }
      carried = r.branch ?? null;
    }
    await ctx.setStatus({ stage: 'waiting', line: 'waiting for the merge', carried });
    const event = await ctx.waitForEvent('merged', { orgId: ORG, types: ['pr.merged'], match: { recordId: input.recordId }, timeoutSeconds: 2 });
    await ctx.setStatus({ stage: event ? 'done' : 'timed_out', line: event ? 'merged' : 'no merge' });
    return { carried, answeredBy: event ? event.type : null };
  },
});

afterEach(async () => {
  resetMemoryEngine();
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema, eventLogSchema } = await import('@/models/Schema');
  await db.delete(durableWaitSchema);
  await db.delete(eventLogSchema);
});

describe('a durable run owns its record', () => {
  it('starts once per id, carries state across retries, and is answered by the event that names it', async () => {
    const id = durableIdFor(ORG, 'record', 7);
    await durable().start('test.record', id, { recordId: 7, failTimes: 2 });
    await durable().start('test.record', id, { recordId: 7, failTimes: 0 });
    await vi.waitFor(async () => expect((await durable().status(id))?.stage).toBe('waiting'));

    expect((await durable().status(id))?.carried).toBe('wip-2');

    const { emitEvent } = await import('@/services/EventService');
    await emitEvent({ orgId: ORG, type: 'pr.merged', payload: { recordId: 99 } });
    await emitEvent({ orgId: ORG, type: 'pr.merged', payload: { recordId: 7, url: 'x' } });

    await expect(memoryRunResult(id)).resolves.toEqual({ carried: 'wip-2', answeredBy: 'pr.merged' });
    expect((await durable().status(id))?.stage).toBe('done');
  });

  it('is answered by an event raised before its wait opened', async () => {
    const { emitEvent } = await import('@/services/EventService');
    const id = durableIdFor(ORG, 'record', 8);
    const since = new Date(Date.now() - 1000).toISOString();
    await emitEvent({ orgId: ORG, type: 'pr.merged', payload: { recordId: 8 } });
    defineDurable({
      name: 'test.early',
      run: async ctx => ctx.waitForEvent('merged', { orgId: ORG, types: ['pr.merged'], match: { recordId: 8 }, timeoutSeconds: 1, since }),
    });
    await durable().start('test.early', id, {});

    await expect(memoryRunResult(id)).resolves.toMatchObject({ type: 'pr.merged' });
  });

  it('times out to null when no event comes', async () => {
    const id = durableIdFor(ORG, 'record', 9);
    await durable().start('test.record', id, { recordId: 9, failTimes: 0 });

    await expect(memoryRunResult(id)).resolves.toEqual({ carried: null, answeredBy: null });
    expect((await durable().status(id))?.stage).toBe('timed_out');
  });

  it('is answered by the first of several kinds of event, each with its own match', async () => {
    defineDurable({
      name: 'test.any',
      run: async ctx => ctx.waitForEvent('next', { orgId: ORG, any: [{ types: ['pr.merged'], match: { url: 'u-1' } }, { types: ['build.requested'], match: { recordId: 11 } }], timeoutSeconds: 5 }),
    });
    const id = durableIdFor(ORG, 'record', 11);
    await durable().start('test.any', id, {});
    await vi.waitFor(async () => expect(await durable().steps(id)).toContain('recv:event:next'));
    const { emitEvent } = await import('@/services/EventService');
    await emitEvent({ orgId: ORG, type: 'pr.merged', payload: { url: 'u-2' } });
    await emitEvent({ orgId: ORG, type: 'build.requested', payload: { recordId: 11, note: 'again' } });

    await expect(memoryRunResult(id)).resolves.toMatchObject({ type: 'build.requested', payload: { note: 'again' } });
  });

  it('a cancel ends a waiting run', async () => {
    const id = durableIdFor(ORG, 'record', 10);
    await durable().start('test.record', id, { recordId: 10, failTimes: 0 });
    await vi.waitFor(async () => expect((await durable().status(id))?.stage).toBe('waiting'));
    await durable().cancel(id);
    await memoryRunResult(id);

    expect(await durable().state(id)).toBe('cancelled');
  });
});
