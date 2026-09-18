/**
 * Done for you, by default — against PGlite.
 *
 * A reversible, low-risk kind with nothing said about it executes on its own
 * above the bar and can be put back; anything irreversible, or under the bar,
 * or once a person has spoken, still asks. The stamp on the run says why.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { DEFAULT_RISK_TIER } = await import('@/services/autonomy/rungs');
const { proposeAction, undoAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_done_for_you';
let writes: string[] = [];
let restored: string[] = [];

// Low-risk and reversible: the kind the default releases.
registerAction({
  id: 'test.reversible-write',
  name: 'Test reversible write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    writes.push((input as { value: string }).value);
    return { wrote: (input as { value: string }).value, previous: 'before' };
  },
  undo: async (_ctx, _input, result) => {
    restored.push(String(result.previous));
    return { restoredTo: result.previous };
  },
});
// Low-risk but with no way back: always asks.
registerAction({
  id: 'test.oneway-write',
  name: 'Test one-way write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => ({ ok: true }),
});
// Internal (nothing leaves the workspace) and reversible — the wiki-page /
// plugin-toggle shape. An agent proposing it is still judged by the ladder.
registerAction({
  id: 'test.internal-reversible',
  name: 'Test internal reversible write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: false,
  execute: async (_ctx, input) => {
    writes.push((input as { value: string }).value);
    return { wrote: (input as { value: string }).value, previous: 'before' };
  },
  undo: async () => ({ ok: true }),
});
// The platform's view of these kinds — set here because the table is keyed
// by id and test ids are not in it (an unknown external kind is high-risk).
DEFAULT_RISK_TIER['test.reversible-write'] = 'low';
DEFAULT_RISK_TIER['test.oneway-write'] = 'low';
DEFAULT_RISK_TIER['test.internal-reversible'] = 'low';

function agent(): Principal {
  return { kind: 'agent', id: 'agent:deal-desk', grants: ['test_write'], autonomy: 2, scope: { orgId: ORG } };
}

async function readRun(runId: number) {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));
  return row!;
}

function propose(actionId: string, confidence: number | undefined, extra: Record<string, unknown> = {}) {
  return proposeAction({
    orgId: ORG,
    actionId,
    input: { value: `v-${Math.random()}` },
    principal: agent(),
    proposal: { confidence, rationale: 'test', suggestedDecision: 'approve', suggestedDecisionReason: 'looks right' },
    ...extra,
  });
}

beforeEach(async () => {
  writes = [];
  restored = [];
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
  await db.delete(autonomyPolicySchema);
});

describe('done for you by default', () => {
  it('a reversible, low-risk proposal above the bar runs at once, credited to the agent, with the reason on the run', async () => {
    const res = await propose('test.reversible-write', 0.9);

    expect(res.status).toBe('done');
    expect(writes).toHaveLength(1);

    const run = await readRun(res.runId);

    expect(run.approvedByAgent).toBe(true);
    expect(run.decidedBy).toBe('agent:deal-desk');
    expect(run.proposal).toMatchObject({ autoApproved: true, autoApprovedThreshold: 0.8, autoApprovedBy: 'default' });
    expect(String((run.proposal as { autoApprovedReason?: string }).autoApprovedReason)).toMatch(/reversible, low-risk/);
  });

  it('under the bar it waits for a person', async () => {
    const res = await propose('test.reversible-write', 0.7);

    expect(res.status).toBe('pending');
    expect(writes).toHaveLength(0);
  });

  it('a kind with no undo always asks, however confident', async () => {
    const res = await propose('test.oneway-write', 0.99);

    expect(res.status).toBe('pending');
  });

  it('a thread set to ask before acting keeps its word', async () => {
    const res = await propose('test.reversible-write', 0.95, { conversationAutonomy: 'ask' });

    expect(res.status).toBe('pending');
  });

  it('once a person has held the kind at approval, the default steps aside', async () => {
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'test.reversible-write', rung: 'execute-with-approval', riskTier: 'low', minConfidence: 0.85, source: 'app' });

    const res = await propose('test.reversible-write', 0.95);

    expect(res.status).toBe('pending');
  });
});

describe('undo', () => {
  it('puts a done run back, hands the decision to the person, and holds the kind at approval', async () => {
    const res = await propose('test.reversible-write', 0.9);
    const out = await undoAction(res.runId, ORG, { by: 'usr-chris' });

    expect(out.status).toBe('undone');
    expect(restored).toEqual(['before']);

    const run = await readRun(res.runId);

    expect(run.status).toBe('undone');
    expect(run.approvedByAgent).toBe(false);
    expect(run.decidedBy).toBe('usr-chris');
    expect((run.result as { undo?: { by?: string; restoredTo?: string } }).undo).toMatchObject({ by: 'usr-chris', restoredTo: 'before' });

    // The next identical proposal asks: an undo is the ladder's strongest "no".
    const again = await propose('test.reversible-write', 0.95);

    expect(again.status).toBe('pending');
  });

  it('refuses a kind that cannot be undone, and a run that is not done', async () => {
    const pending = await propose('test.reversible-write', 0.5);

    await expect(undoAction(pending.runId, ORG, { by: 'usr-chris' })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const oneway = await propose('test.oneway-write', 0.5);

    await expect(undoAction(oneway.runId, ORG, { by: 'usr-chris' })).rejects.toMatchObject({ code: 'NOT_REVERSIBLE' });
  });
});

describe('an internal kind proposed by an agent is still judged by the ladder', () => {
  it('runs on its own above the bar and waits for a person under it — autonomy alone never releases it', async () => {
    const above = await propose('test.internal-reversible', 0.9);
    const under = await propose('test.internal-reversible', 0.45);

    expect(above.status).toBe('done');
    expect((await readRun(above.runId)).proposal?.autoApproved).toBe(true);
    expect(under.status).toBe('pending');
    expect((await readRun(under.runId)).proposal?.autoApproved).toBeUndefined();
    expect(writes).toHaveLength(1);
  });
});
