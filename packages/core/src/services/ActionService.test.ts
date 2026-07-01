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
const { proposeAction, executeAction } = await import('@/services/ActionService');
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

  it('validates input against the action schema', async () => {
    await expect(proposeAction({ orgId: ORG, actionId: 'test.write', input: { wrong: 1 }, principal: agent(5) }))
      .rejects
      .toThrow();
  });
});
