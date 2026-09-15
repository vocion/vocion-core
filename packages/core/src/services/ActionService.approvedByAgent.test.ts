/**
 * Who decided an action run — the agent, or a person — against PGlite.
 *
 * `approved_by_agent` is deliberately three-state, and the tests that matter
 * here are the ones that protect the third state: an item nobody has decided
 * must never read as human-approved, and an approval an agent made must never
 * be erased by whatever a person does to the run afterwards. Both are silent
 * corruptions of an audit trail if they regress — nothing throws, the number on
 * the adoption screen simply stops being true.
 */
import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, trustRuleSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { proposeAction, executeAction, rejectAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

const ORG = 'org_approved_by_agent';

// A side-effect-free external action, so the test exercises the gate and the
// decision stamp rather than a connector.
registerAction({
  id: 'test.trusted-write',
  name: 'Test trusted write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

/** An agent whose autonomy still sends external writes to the review gate. */
function proposingAgent(): Principal {
  return { kind: 'agent', id: 'agent:event-scout', grants: ['test_write'], autonomy: 2, scope: { orgId: ORG } };
}

async function enableTrustRule(threshold: number): Promise<void> {
  await db.insert(trustRuleSchema).values({
    orgId: ORG,
    actionId: 'test.trusted-write',
    threshold,
    enabled: 'true',
  });
}

async function readRun(runId: number): Promise<typeof actionRunSchema.$inferSelect> {
  const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, runId));
  return row!;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
  await db.delete(trustRuleSchema);
});

describe('approved_by_agent', () => {
  it('leaves a run nobody has decided as null, so pending never reads as human-approved', async () => {
    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'waiting' },
      principal: proposingAgent(),
      proposal: { confidence: 0.4 },
    });

    const run = await readRun(out.runId);

    expect(run.status).toBe('pending');
    expect(run.approvedByAgent).toBeNull();
    expect(run.decidedAt).toBeNull();
  });

  it('stamps true, the deciding agent and a timestamp when the trust ladder releases a proposal', async () => {
    await enableTrustRule(0.8);

    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'auto' },
      principal: proposingAgent(),
      proposal: { confidence: 0.95 },
    });

    const run = await readRun(out.runId);

    expect(run.approvedByAgent).toBe(true);
    // The agent is named, not just "something automated" — a bad run of
    // auto-approvals has to be traceable to which agent made them.
    expect(run.decidedBy).toBe('agent:event-scout');
    expect(run.decidedAt).toBeInstanceOf(Date);
  });

  it('names the agent from the proposal envelope when the proposal came in over the API', async () => {
    await enableTrustRule(0.5);

    // A proposal made over the API records its CALLER in `invokedBy`, so the
    // envelope is the only place the agent behind it is named. Getting this
    // wrong drops the run out of every per-agent metric.
    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'over the api' },
      principal: proposingAgent(),
      invokedBy: 'token:42',
      proposal: { confidence: 0.9, agentSlug: 'event-scout' },
    });

    const run = await readRun(out.runId);

    expect(run.approvedByAgent).toBe(true);
    expect(run.decidedBy).toBe('agent:event-scout');
  });

  it('credits the trust ladder rather than guessing when no agent can be named', async () => {
    await enableTrustRule(0.5);

    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'anonymous' },
      principal: proposingAgent(),
      invokedBy: 'token:42',
      proposal: { confidence: 0.9 },
    });

    const run = await readRun(out.runId);

    expect(run.approvedByAgent).toBe(true);
    // Honest about the mechanism instead of crediting an agent we cannot name.
    expect(run.decidedBy).toBe('trust-ladder');
  });

  it('stamps false when a person approves, so a human decision is recorded rather than left empty', async () => {
    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'by hand' },
      principal: proposingAgent(),
      proposal: { confidence: 0.4 },
    });

    await executeAction(out.runId, ORG, { reviewedBy: 'user_123' });

    const run = await readRun(out.runId);

    expect(run.approvedByAgent).toBe(false);
    expect(run.decidedBy).toBe('user_123');
  });

  it('stamps false when a person rejects — a rejection is a decision, not an absence of one', async () => {
    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'no thanks' },
      principal: proposingAgent(),
      proposal: { confidence: 0.4 },
    });

    await rejectAction(out.runId, ORG, 'wrong venue', { reviewedBy: 'user_123' });

    const run = await readRun(out.runId);

    expect(run.approvedByAgent).toBe(false);
  });

  it('keeps the agent approval when a person later rejects the run the agent approved', async () => {
    await enableTrustRule(0.5);
    const out = await proposeAction({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'auto then reversed' },
      principal: proposingAgent(),
      proposal: { confidence: 0.9 },
    });

    await rejectAction(out.runId, ORG, 'should not have gone out', { reviewedBy: 'user_123' });

    const run = await readRun(out.runId);

    // The reversal shows in `status`. Flipping the flag would erase the exact
    // fact the column exists to audit — that an agent approved this first.
    expect(run.status).toBe('rejected');
    expect(run.approvedByAgent).toBe(true);
  });

  it('keeps the agent approval when a person re-runs an auto-approved execution that failed', async () => {
    await db.insert(actionRunSchema).values({
      orgId: ORG,
      actionId: 'test.trusted-write',
      input: { value: 'retry me' },
      status: 'failed',
      approvedByAgent: true,
      decidedBy: 'agent:event-scout',
      decidedAt: new Date(),
    });
    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    await executeAction(row!.id, ORG, { reviewedBy: 'user_123' });

    const run = await readRun(row!.id);

    expect(run.approvedByAgent).toBe(true);
  });
});
