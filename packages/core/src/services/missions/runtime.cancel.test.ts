/**
 * Cancelling a mission run stops its loop (vocion-core#123).
 *
 * The loop never read the run's status between tasks, so a person cancelled
 * a run and every remaining task still ran — agent calls, spend, artifacts —
 * while the loop's next status write set the run back to `running`.
 *
 * `runAgentDeep` is mocked so no model is called; the first task's turn
 * cancels the run the way the Review UI does, through `cancelMission`. The
 * DB is the PGlite test mock, so the guarded writes run for real.
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
const { cancelMission, startMission } = await import('@/services/MissionService');
const { executeMissionRun } = await import('@/services/missions/runtime');

const mockRunAgent = vi.mocked(runAgentDeep);
const mockPlan = vi.mocked(planMission);

const ORG = 'org_cancel_mid_run';

/** The run the mocked agent cancels. Set by each test before the loop starts. */
let runUnderTest = 0;

async function seedRun(taskIds: string[], status = 'running', gatedTaskIds: string[] = []): Promise<number> {
  const [row] = await db
    .insert(missionRunSchema)
    .values({
      orgId: ORG,
      title: 'Cancel test run',
      brief: 'do the thing',
      status,
      team: { lead: 'agent-x', members: [] },
      // Level 5: nothing is gated, so only the cancel can stop the loop.
      autonomyPolicy: { level: 5 },
      plan: {
        tasks: taskIds.map(id => ({ id, title: `Task ${id}`, ownerAgentSlug: 'agent-x', type: 'analysis' as const, status: 'pending' as const, approvalRequired: gatedTaskIds.includes(id) })),
      },
    })
    .returning({ id: missionRunSchema.id });
  return row!.id;
}

async function readRun(id: number) {
  const [row] = await db.select().from(missionRunSchema).where(eq(missionRunSchema.id, id));
  return { row: row!, tasks: new Map(row!.plan!.tasks.map(t => [t.id, t])) };
}

/**
 * An agent turn during which a person cancels the run; the turn itself still finishes.
 */
async function turnDuringWhichThePersonCancels(): Promise<never> {
  await cancelMission(runUnderTest, ORG, 'stopped by the operator');
  return { response: 'finished the first task', traceId: 'trace-1', toolCalls: [] } as never;
}

/**
 * A planner overtaken by a person cancelling the run; it still returns a plan.
 */
async function plannerDuringWhichThePersonCancels(): Promise<never> {
  const [row] = await db.select({ id: missionRunSchema.id }).from(missionRunSchema).where(eq(missionRunSchema.orgId, ORG));
  await cancelMission(row!.id, ORG, 'stopped while planning');
  return [{ id: 't1', title: 'Task t1', ownerAgentSlug: 'agent-x', type: 'analysis', status: 'pending' }] as never;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  mockRunAgent.mockReset();
  mockPlan.mockReset();
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('cancelling a mission run', () => {
  it('starts no further task once the run is cancelled, and keeps the output already produced', async () => {
    runUnderTest = await seedRun(['t1', 't2', 't3']);
    mockRunAgent.mockImplementationOnce(turnDuringWhichThePersonCancels);

    const status = await executeMissionRun(runUnderTest, ORG);
    const { row, tasks } = await readRun(runUnderTest);

    expect(status).toBe('cancelled');
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('cancelled');
    expect(row.error).toBe('stopped by the operator');
    expect(tasks.get('t1')!.status).toBe('completed');
    expect(tasks.get('t1')!.output).toBe('finished the first task');
    expect(tasks.get('t2')!.status).toBe('pending');
    expect(tasks.get('t3')!.status).toBe('pending');
  });

  it('does not pause a cancelled run for approval when the next task is gated', async () => {
    runUnderTest = await seedRun(['t1', 't2'], 'running', ['t2']);
    mockRunAgent.mockImplementationOnce(turnDuringWhichThePersonCancels);

    const status = await executeMissionRun(runUnderTest, ORG);
    const { row, tasks } = await readRun(runUnderTest);

    // Not `awaiting_review`: a cancelled run never lands in Review.
    expect(status).toBe('cancelled');
    expect(row.status).toBe('cancelled');
    expect(row.pauseReason).toBeNull();
    expect(tasks.get('t2')!.status).toBe('pending');
  });

  it('does not start a run that was cancelled before its loop began', async () => {
    runUnderTest = await seedRun(['t1'], 'cancelled');

    const status = await executeMissionRun(runUnderTest, ORG);

    expect(status).toBe('cancelled');
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('runs no task of a run cancelled while it was being planned', async () => {
    mockPlan.mockImplementation(plannerDuringWhichThePersonCancels);

    const run = await startMission({ orgId: ORG, brief: 'Write the launch plan', team: { lead: 'agent-x', members: [] } });

    expect(run.status).toBe('cancelled');
    expect(run.error).toBe('stopped while planning');
    expect(mockRunAgent).not.toHaveBeenCalled();
  });

  it('leaves a run that already completed as completed', async () => {
    const id = await seedRun(['t1'], 'completed');

    const run = await cancelMission(id, ORG, 'too late');

    expect(run.status).toBe('completed');
    expect(run.error).toBeNull();
  });

  it('leaves a run that already failed with its own error', async () => {
    const id = await seedRun(['t1'], 'failed');
    await db.update(missionRunSchema).set({ error: 'one or more tasks failed' }).where(eq(missionRunSchema.id, id));

    const run = await cancelMission(id, ORG, 'too late');

    expect(run.status).toBe('failed');
    expect(run.error).toBe('one or more tasks failed');
  });
});
