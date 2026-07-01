import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * Actions as the 4th review kind — a pending action_run surfaces in the unified
 * queue and `decide` dispatches to ActionService (execute on approve, reject
 * otherwise). PGlite; the other dispatch services are stubbed.
 */
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { listPending, decide } = await import('@/services/ReviewService');
const { eq } = await import('drizzle-orm');

let executed = 0;
registerAction({
  id: 'test.write',
  name: 'Test write',
  description: 'test',
  inputSchema: z.object({ value: z.string() }),
  grant: 'test_write',
  external: true,
  execute: async () => {
    executed += 1;
    return { ok: true };
  },
});

const ORG = 'org_rev_action';
async function pendingAction(): Promise<number> {
  const [r] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'test.write', input: { value: 'x' }, status: 'pending' })
    .returning({ id: actionRunSchema.id });
  return r!.id;
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
  executed = 0;
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('ReviewService × actions', () => {
  it('surfaces a pending action in the unified queue', async () => {
    const id = await pendingAction();
    const queue = await listPending(ORG);

    const item = queue.find(q => q.kind === 'action' && q.id === id);

    expect(item).toBeDefined();
    expect(item!.title).toContain('test.write');
  });

  it('approve → executes the action', async () => {
    const id = await pendingAction();
    await decide({ kind: 'action', id }, 'approve', ORG);

    expect(executed).toBe(1);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row!.status).toBe('done');
  });

  it('reject → never executes', async () => {
    const id = await pendingAction();
    await decide({ kind: 'action', id }, 'reject', ORG, { reason: 'no' });

    expect(executed).toBe(0);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, id));

    expect(row!.status).toBe('rejected');
  });
});
