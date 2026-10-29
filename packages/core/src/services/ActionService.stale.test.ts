import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * OVERTAKEN BY EVENTS at approval (`Action.basisFor` / `Action.stillHolds`).
 * A registered test action whose world is a variable: the basis is read at
 * propose, and the check compares against it. No network.
 */
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { StaleError } = await import('@/libs/actions/stale');
const { proposeAction, executeAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

/** The outside world the test action reads: one field's value. */
let world = { stage: 'Proposal sent' };
let checkThrows = false;
let executeRaises: InstanceType<typeof StaleError> | null = null;
const executions: Array<{ proceededPast?: unknown }> = [];

registerAction({
  id: 'test.stale-write',
  name: 'Test stale write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  basisFor: async () => ({ stage: world.stage }),
  stillHolds: async (_ctx, _input, basis) => {
    if (checkThrows) {
      throw new Error('the outside system is down');
    }
    const was = (basis as { stage?: string } | null)?.stage;
    return was !== undefined && was !== world.stage
      ? { line: `Deal stage changed from ${was} to ${world.stage} since this was proposed`, changed: [{ label: 'Deal stage', from: was, to: world.stage }], code: 'stage_moved' }
      : null;
  },
  execute: async (ctx) => {
    if (executeRaises) {
      throw executeRaises;
    }
    executions.push({ proceededPast: ctx.proceededPast });
    return { ok: true };
  },
});

const ORG = 'org_stale';
const agent = (autonomy: 1 | 2 | 3 | 4 | 5 = 2): Principal => ({ kind: 'agent', id: 'agent:deals-desk', grants: ['test_write'], autonomy, scope: { orgId: ORG } });

/** Propose, then age the basis past the "read moments ago" window. */
async function proposeAged(): Promise<number> {
  const out = await proposeAction({ orgId: ORG, actionId: 'test.stale-write', input: { value: 'x' }, principal: agent() });
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));
  const proposal = { ...(row!.proposal as Record<string, unknown>), basisAt: new Date(Date.now() - 3 * 86_400_000).toISOString() };
  await db.update(actionRunSchema).set({ proposal: proposal as never }).where(eq(actionRunSchema.id, out.runId));
  return out.runId;
}

async function rowOf(id: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));
  return row!;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  world = { stage: 'Proposal sent' };
  checkThrows = false;
  executeRaises = null;
  executions.length = 0;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('the basis is recorded at propose time', () => {
  it('stores what the recommendation assumed, and when, on the proposal', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.stale-write', input: { value: 'x' }, principal: agent() });
    const row = await rowOf(out.runId);

    expect(row.proposal).toMatchObject({ basis: { stage: 'Proposal sent' } });
    expect(typeof (row.proposal as { basisAt?: unknown }).basisAt).toBe('string');
  });

  it('a re-proposal on the same key refreshes the basis and drops the old stale finding', async () => {
    const first = await proposeAction({ orgId: ORG, actionId: 'test.stale-write', input: { value: 'x' }, principal: agent(), dedupKey: 'k1' });
    await db.update(actionRunSchema).set({ proposal: { basis: { stage: 'Proposal sent' }, stale: { line: 'old', checkedAt: 'x' } } as never }).where(eq(actionRunSchema.id, first.runId));
    world = { stage: 'Closed won' };
    const again = await proposeAction({ orgId: ORG, actionId: 'test.stale-write', input: { value: 'y' }, principal: agent(), dedupKey: 'k1' });

    expect(again).toMatchObject({ runId: first.runId, outcome: 'refreshed' });

    const row = await rowOf(first.runId);

    expect(row.proposal).toMatchObject({ basis: { stage: 'Closed won' } });
    expect((row.proposal as { stale?: unknown }).stale).toBeUndefined();
  });
});

describe('a person approving', () => {
  it('runs when it still holds', async () => {
    const id = await proposeAged();
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery' });

    expect(out.status).toBe('done');
    expect(executions).toHaveLength(1);
  });

  it('is told what changed, and nothing runs or is decided', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery' });

    expect(out.status).toBe('stale');
    expect(out.stale).toMatchObject({ line: 'Deal stage changed from Proposal sent to Closed won since this was proposed', changed: [{ label: 'Deal stage', from: 'Proposal sent', to: 'Closed won' }] });
    expect(executions).toHaveLength(0);

    const row = await rowOf(id);

    expect(row.status).toBe('pending');
    expect(row.decidedBy).toBeNull();
    expect((row.proposal as { stale?: { line: string } }).stale?.line).toContain('Closed won');
  });

  it('proceeds anyway with overrideStale, and the run records what they proceeded past', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    await executeAction(id, ORG, { reviewedBy: 'user_avery' });
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery', overrideStale: true });

    expect(out.status).toBe('done');
    expect(executions[0]?.proceededPast).toMatchObject({ code: 'stage_moved' });

    const row = await rowOf(id);

    expect(row.result).toMatchObject({ proceededPastStale: { line: expect.stringContaining('Closed won'), code: 'stage_moved', by: 'user_avery' } });
  });

  it('fails open: a check that throws is read as still holding, and the run goes ahead', async () => {
    const id = await proposeAged();
    checkThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery' });

    expect(out.status).toBe('done');
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('an action that finds it stale as it runs puts the run back in Review, not failed', async () => {
    const id = await proposeAged();
    executeRaises = new StaleError({ line: 'Already in a sequence since Oct 25', keepOpen: true, code: 'already_enrolled:1' });
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery' });

    expect(out).toMatchObject({ status: 'stale', stale: { line: 'Already in a sequence since Oct 25', code: 'already_enrolled:1' } });

    const row = await rowOf(id);

    expect(row.status).toBe('pending');
    expect(row.error).toBeNull();
  });
});

describe('a machine approving', () => {
  it('a decision clock\'s approval does not run a stale item: it stays pending with the reason, undecided', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    const out = await executeAction(id, ORG, { reviewedBy: 'by-default' });

    expect(out.status).toBe('pending');
    expect(out.stale?.line).toContain('Closed won');
    expect(executions).toHaveLength(0);

    const row = await rowOf(id);

    expect(row).toMatchObject({ status: 'pending', decidedBy: null, approvedByAgent: null });
  });

  it('the trust ladder\'s approval of an aged run is withdrawn when it no longer holds', async () => {
    const id = await proposeAged();
    await db.update(actionRunSchema).set({ approvedByAgent: true, decidedBy: 'trust-ladder', decidedAt: new Date() }).where(eq(actionRunSchema.id, id));
    world = { stage: 'Closed won' };
    const out = await executeAction(id, ORG);

    expect(out.status).toBe('pending');

    const row = await rowOf(id);

    expect(row).toMatchObject({ status: 'pending', decidedBy: null, approvedByAgent: null });
    expect((row.proposal as { stale?: { line: string } }).stale?.line).toContain('Closed won');
  });

  it('overrideStale does not let a machine past it', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    const out = await executeAction(id, ORG, { reviewedBy: 'by-default', overrideStale: true });

    expect(out.status).toBe('pending');
    expect(executions).toHaveLength(0);
  });
});

describe('a basis read moments ago is not read again', () => {
  it('auto-approval right after proposing runs without asking twice', async () => {
    let checks = 0;
    registerAction({
      id: 'test.stale-counted',
      name: 'Counted',
      description: 'test',
      inputSchema: z.object({ value: z.string() }),
      grant: 'test_write',
      external: true,
      basisFor: async () => ({ v: 1 }),
      stillHolds: async () => {
        checks += 1;
        return { line: 'changed' };
      },
      execute: async () => ({ ok: true }),
    });
    const out = await proposeAction({ orgId: ORG, actionId: 'test.stale-counted', input: { value: 'x' }, principal: agent() });
    const done = await executeAction(out.runId, ORG, { reviewedBy: 'user_avery' });

    expect(done.status).toBe('done');
    expect(checks).toBe(0);
  });
});

describe('proceed anyway re-checks, and proceeds only past what the person was shown', () => {
  it('something new since the STALE answer is answered as stale again, with the new line', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    const first = await executeAction(id, ORG, { reviewedBy: 'user_avery' });
    world = { stage: 'Closed lost' };
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery', overrideStale: true, staleFingerprint: first.stale!.fingerprint });

    expect(out.status).toBe('stale');
    expect(out.stale?.line).toContain('Closed lost');
    expect(executions).toHaveLength(0);
  });

  it('overrideStale with no STALE answer before it is a normal approve: checked, and stale', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery', overrideStale: true });

    expect(out.status).toBe('stale');
    expect(executions).toHaveLength(0);
  });

  it('a fingerprint that names a different finding does not proceed', async () => {
    const id = await proposeAged();
    world = { stage: 'Closed won' };
    await executeAction(id, ORG, { reviewedBy: 'user_avery' });
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery', overrideStale: true, staleFingerprint: 'not-that-one' });

    expect(out.status).toBe('stale');
  });

  it('overrideStale on an item that holds just runs, recording nothing proceeded past', async () => {
    const id = await proposeAged();
    const out = await executeAction(id, ORG, { reviewedBy: 'user_avery', overrideStale: true });

    expect(out.status).toBe('done');
    expect(out.result?.proceededPastStale).toBeUndefined();
  });
});

describe('a refresh whose basis cannot be read is judged from the refresh, not the first proposal', () => {
  it('stamps basisAt now and keeps no stale basis', async () => {
    let fail = false;
    registerAction({
      id: 'test.stale-flaky-basis',
      name: 'Flaky basis',
      description: 'test',
      inputSchema: z.object({ value: z.string() }),
      grant: 'test_write',
      external: true,
      basisFor: async () => {
        if (fail) {
          throw new Error('down');
        }
        return { v: 1 };
      },
      stillHolds: async () => null,
      execute: async () => ({ ok: true }),
    });
    const first = await proposeAction({ orgId: ORG, actionId: 'test.stale-flaky-basis', input: { value: 'x' }, principal: agent(), dedupKey: 'flaky' });
    await db.update(actionRunSchema).set({ proposal: { basis: { v: 1 }, basisAt: '2026-10-01T00:00:00.000Z' } as never }).where(eq(actionRunSchema.id, first.runId));
    fail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const before = Date.now();
    await proposeAction({ orgId: ORG, actionId: 'test.stale-flaky-basis', input: { value: 'y' }, principal: agent(), dedupKey: 'flaky' });
    warn.mockRestore();
    const p = (await rowOf(first.runId)).proposal as { basis?: unknown; basisAt?: string };

    expect(p.basis).toBeUndefined();
    expect(Date.parse(p.basisAt!)).toBeGreaterThanOrEqual(before - 1000);
  });
});

describe('a person\'s own word', () => {
  it('a StaleError on a run nobody reviewed returns the line, so the tool can say it', async () => {
    const [row] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'test.stale-write', input: { value: 'x' }, status: 'approved', invokedBy: 'usr-avery' }).returning({ id: actionRunSchema.id });
    executeRaises = new StaleError({ line: 'Already in a sequence since Oct 25', code: 'already_enrolled:1' });
    const out = await executeAction(row!.id, ORG);

    expect(out).toMatchObject({ status: 'stale', stale: { line: 'Already in a sequence since Oct 25' } });
  });

  it('the action is told it runs on the person\'s word; an agent\'s own run is not', async () => {
    const seen: boolean[] = [];
    registerAction({
      id: 'test.stale-word',
      name: 'Word',
      description: 'test',
      inputSchema: z.object({ value: z.string() }),
      grant: 'test_write',
      external: true,
      execute: async (ctx) => {
        seen.push(ctx.onPersonsWord === true);
        return { ok: true };
      },
    });
    const [mine] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'test.stale-word', input: { value: 'x' }, status: 'approved', invokedBy: 'usr-avery' }).returning({ id: actionRunSchema.id });
    const [theirs] = await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'test.stale-word', input: { value: 'x' }, status: 'approved', invokedBy: 'agent:deals-desk' }).returning({ id: actionRunSchema.id });
    await executeAction(mine!.id, ORG);
    await executeAction(theirs!.id, ORG);

    expect(seen).toEqual([true, false]);
  });
});
