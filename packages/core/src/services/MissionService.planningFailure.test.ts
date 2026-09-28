/**
 * A mission run whose planning step throws (vocion-core#122).
 *
 * `startMission` inserts the run at `planning` before the planner runs. A
 * throw between that insert and the plan write used to leave the row at
 * `planning` with an empty plan — not an attention status, so nobody saw it
 * until the stranded-run reaper closed it half an hour later.
 *
 * The planner is mocked so it can be made to throw on demand, and
 * `runAgentDeep` is mocked so no model is ever called. The DB is the PGlite
 * test mock, so the status writes run for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));
vi.mock('@/services/missions/planner', () => ({
  planMission: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { missionRunSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { planMission } = await import('@/services/missions/planner');
const { startMission } = await import('@/services/MissionService');

const mockRunAgent = vi.mocked(runAgentDeep);
const mockPlan = vi.mocked(planMission);

const ORG = 'org_planning_failure';
const TEAM = { lead: 'agent-lead', members: [] };

/**
 * A planner that is overtaken by a person cancelling the run, then throws.
 */
async function plannerThatThrowsAfterACancel(): Promise<never> {
  await db.update(missionRunSchema).set({ status: 'cancelled', error: 'cancelled by user' });
  throw new Error('planner exploded after the cancel');
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  mockRunAgent.mockReset();
  mockPlan.mockReset();
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('startMission when planning throws', () => {
  it('marks the run failed with the planner\'s reason instead of leaving it at planning', async () => {
    mockPlan.mockRejectedValue(new Error('planner exploded'));

    const run = await startMission({ orgId: ORG, brief: 'Write the launch plan', team: TEAM });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('Planning failed');
    expect(run.error).toContain('planner exploded');

    const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, run.id));

    expect(row!.status).toBe('failed');
    expect(row!.completedAt).not.toBeNull();
    // No task ever ran against a plan that was never written.
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('leaves a run the person cancelled during planning as cancelled', async () => {
    mockPlan.mockImplementation(plannerThatThrowsAfterACancel);

    const run = await startMission({ orgId: ORG, brief: 'Write the launch plan', team: TEAM });

    expect(run.status).toBe('cancelled');
    expect(run.error).toBe('cancelled by user');
  });

  it('still moves a planned run from planning to running and executes its plan', async () => {
    mockPlan.mockResolvedValue([
      { id: 't1', title: 'Draft it', ownerAgentSlug: 'agent-lead', type: 'analysis', status: 'pending' },
    ]);
    mockRunAgent.mockResolvedValue({ response: 'drafted', traceId: 'trace-1', toolCalls: [] } as never);

    const run = await startMission({ orgId: ORG, brief: 'Write the launch plan', team: TEAM });

    expect(run.status).toBe('completed');
    expect(run.error).toBeNull();
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
  });
});
