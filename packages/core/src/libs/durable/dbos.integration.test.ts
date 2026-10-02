import { describe, expect, it } from 'vitest';

// Runs only against a real Postgres: DURABLE_PG_URL=postgres://… (never the
// production tunnel). Proves the DBOS runtime end to end: the executor in this
// process, the app's client calls, a message wait, a child run, status, cancel.
const URL = process.env.DURABLE_PG_URL;

describe.skipIf(!URL)('the DBOS runtime', () => {
  it('starts once per id, waits for a message, runs a child, reports status, and cancels', async () => {
    process.env.DURABLE_DATABASE_URL = URL;
    const { defineDurable } = await import('./registry');
    defineDurable<{ n: number }, number>({ name: 'it.child', run: async (_ctx, i) => i.n * 2 });
    defineDurable<{ n: number }, { child: number; msg: string | null }>({
      name: 'it.parent',
      async run(ctx, input) {
        await ctx.setStatus({ stage: 'waiting', line: 'waiting' });
        const msg = await ctx.waitFor<string>('go', 30);
        const child = await ctx.child<{ n: number }, number>('it.child', `${ctx.workflowId}:child`, { n: input.n });
        await ctx.setStatus({ stage: 'done', line: 'done' });
        return { child, msg };
      },
    });
    defineDurable({ name: 'it.waiter', run: async ctx => ctx.waitFor('never', 60) });
    const { dbosEngine, launchDurableExecutor } = await import('./dbos');
    await launchDurableExecutor();
    const e = dbosEngine();
    const id = `org_it:parent:${Date.now()}`;
    await e.start('it.parent', id, { n: 21 });
    await e.start('it.parent', id, { n: 0 });
    for (let i = 0; i < 100 && (await e.status(id))?.stage !== 'waiting'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    await e.signal(id, 'go', 'now');
    for (let i = 0; i < 100 && (await e.state(id)) !== 'succeeded'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }

    expect(await e.state(id)).toBe('succeeded');
    expect((await e.status(id))?.stage).toBe('done');
    expect(await e.steps(id)).toContain('DBOS.recv');

    const w = `org_it:waiter:${Date.now()}`;
    await e.start('it.waiter', w, {});
    for (let i = 0; i < 50 && (await e.state(w)) !== 'pending'; i++) {
      await new Promise(r => setTimeout(r, 100));
    }
    await e.cancel(w);

    expect(await e.state(w)).toBe('cancelled');

    const { DBOS } = await import('@dbos-inc/dbos-sdk');
    await DBOS.shutdown();
  }, 60_000);
});
