import type { Principal } from '@/services/authz';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * ActionService gating against PGlite. Uses a registered test action (no creds,
 * no network) so the test isolates the propose→gate→execute logic + the
 * autonomy gate. Gmail specifics are covered in gmail-send.test.ts.
 */
import { z } from 'zod';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { proposeAction, executeAction, rejectAction } = await import('@/services/ActionService');
const { eq } = await import('drizzle-orm');

// Register a side-effect-free external action for the test.
let executed = 0;
registerAction({
  id: 'test.write',
  name: 'Test write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => {
    executed += 1;
    return { echoed: (input as { value: string }).value };
  },
});

// A second action whose schema carries a hand-authored `superRefine` message
// (the same shape `objects.propose_candidate` uses for its `dedupOn` checks),
// so the ZodError-to-ActionError translation can be tested against a message
// that isn't zod's own generic wording.
registerAction({
  id: 'test.write-custom-message',
  name: 'Test write with a custom validation message',
  description: 'test',
  inputSchema: z.object({ value: z.string() }).superRefine((value, ctx) => {
    if (value.value === '') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'value must not be empty' });
    }
  }),
  grant: 'test_write',
  external: true,
  execute: async (_ctx, input) => ({ echoed: (input as { value: string }).value }),
});

const ORG = 'org_act';
function agent(autonomy: 1 | 2 | 3 | 4 | 5): Principal {
  return { kind: 'agent', id: 'agent:follow-up', grants: ['test_write'], autonomy, scope: { orgId: ORG } };
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  executed = 0;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('ActionService gating', () => {
  it('gates an external action from a low-autonomy agent → pending, not executed', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: agent(2) });

    expect(out.status).toBe('pending');
    expect(executed).toBe(0);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));

    expect(row!.status).toBe('pending');
  });

  it('executes immediately for a high-autonomy agent', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'go' }, principal: agent(4) });

    expect(out.status).toBe('done');
    expect(out.result).toMatchObject({ echoed: 'go' });
    expect(executed).toBe(1);
  });

  it('forbids an agent without the grant', async () => {
    const noGrant: Principal = { kind: 'agent', id: 'agent:x', grants: [], autonomy: 5, scope: { orgId: ORG } };

    await expect(proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, principal: noGrant }))
      .rejects
      .toMatchObject({ code: 'FORBIDDEN' });
  });

  it('executeAction runs a pending action on approval', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'later' }, principal: agent(1) });

    expect(out.status).toBe('pending');

    const done = await executeAction(out.runId, ORG);

    expect(done.status).toBe('done');
    expect(executed).toBe(1);
  });

  it('stamps who decided and when, on approve and on reject', async () => {
    const approved = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'a' }, principal: agent(1) });
    await executeAction(approved.runId, ORG, { reviewedBy: 'user-jamie' });
    const [runA] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, approved.runId));

    expect(runA).toMatchObject({ status: 'done', decidedBy: 'user-jamie' });
    expect(runA!.decidedAt).toBeInstanceOf(Date);

    const rejected = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'b' }, principal: agent(1) });
    await rejectAction(rejected.runId, ORG, 'wrong angle', { reviewedBy: 'user-lili' });
    const [runR] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, rejected.runId));

    expect(runR).toMatchObject({ status: 'rejected', decidedBy: 'user-lili' });
    expect(runR!.decidedAt).toBeInstanceOf(Date);
  });

  it('a machine execution with no reviewer stamps no decision', async () => {
    const out = await proposeAction({ orgId: ORG, actionId: 'test.write', input: { value: 'auto' }, principal: agent(5) });
    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, out.runId));

    expect(out.status).toBe('done');
    expect(run!.decidedBy).toBeNull();
    expect(run!.decidedAt).toBeNull();
  });

  it('validates input against the action schema', async () => {
    await expect(proposeAction({ orgId: ORG, actionId: 'test.write', input: { wrong: 1 }, principal: agent(5) }))
      .rejects
      .toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('surfaces a schema violation as a clean ActionError, not a raw ZodError dump', async () => {
    // Before this fix, `proposeAction` let `inputSchema.parse` throw straight
    // through: every caller (the agent's `propose_action` tool, the write
    // API, the review router) only reads `.message` off whatever it catches,
    // and a raw ZodError's `.message` is its issues array JSON-stringified —
    // burying a hand-authored validation message inside brace-and-quote
    // noise instead of handing back the sentence it was written to be.
    let caught: unknown;
    try {
      await proposeAction({ orgId: ORG, actionId: 'test.write-custom-message', input: { value: '' }, principal: agent(5) });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({ code: 'VALIDATION_FAILED', message: 'value must not be empty' });
    // The regression this guards against: message text buried in a JSON blob.
    expect((caught as Error).message).not.toMatch(/[[{]/);
  });
});
