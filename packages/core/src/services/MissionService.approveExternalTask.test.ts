/**
 * An external task a person approved runs, instead of asking again.
 *
 * At autonomy level 1–2 an `action` task is gated by its type. Approving it
 * only cleared `approvalRequired`, so the gate stopped the same task on every
 * resume and the run could never finish. `runAgentDeep` is mocked, so no
 * model is called; the DB is the PGlite test mock.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { missionRunSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { executeMissionRun } = await import('@/services/missions/runtime');
const { resumeMission } = await import('@/services/MissionService');

const ORG = 'org_approve_external';
const mockRunAgent = vi.mocked(runAgentDeep);

type PlanTask = NonNullable<typeof missionRunSchema.$inferInsert.plan>['tasks'][number];

const SEND_EMAIL: PlanTask = { id: 'send', title: 'Send the email', ownerAgentSlug: 'agent-x', type: 'action', status: 'pending' };
const LOG_IN_CRM: PlanTask = { id: 'log', title: 'Log the send in the CRM', ownerAgentSlug: 'agent-x', type: 'action', status: 'pending', dependsOn: ['send'] };

async function seedDraftOnlyRun(tasks: PlanTask[]): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId: ORG,
    title: 'Send the follow-up',
    brief: 'send it',
    status: 'running',
    team: { lead: 'agent-x', members: [] },
    // Level 1, draft only: every external action waits for a person.
    autonomyPolicy: { level: 1 },
    plan: { tasks },
  }).returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  mockRunAgent.mockReset();
  mockRunAgent.mockResolvedValue({ response: 'sent', traceId: 'trace', toolCalls: [] } as never);
});

afterAll(async () => {
  await db.delete(missionRunSchema);
});

describe('approving an external task at autonomy level 1', () => {
  it('waits for approval first, then runs the task and finishes once a person approves', async () => {
    const id = await seedDraftOnlyRun([SEND_EMAIL]);

    expect(await executeMissionRun(id, ORG)).toBe('awaiting_review');
    expect(mockRunAgent).not.toHaveBeenCalled();

    const run = await resumeMission(id, ORG);

    expect(run.status).toBe('completed');
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
  });

  it('approving one external task leaves the next one waiting for its own approval', async () => {
    const id = await seedDraftOnlyRun([SEND_EMAIL, LOG_IN_CRM]);

    expect(await executeMissionRun(id, ORG)).toBe('awaiting_review');

    const afterFirstApproval = await resumeMission(id, ORG);
    const [send, log] = afterFirstApproval.plan!.tasks;

    expect(afterFirstApproval.status).toBe('awaiting_review');
    expect(afterFirstApproval.pauseReason).toBe('awaiting_approval:log');
    expect(send).toMatchObject({ status: 'completed', approvedAt: expect.any(String) });
    expect(log).toMatchObject({ status: 'awaiting_approval' });
    expect(log!.approvedAt).toBeUndefined();
    expect(mockRunAgent).toHaveBeenCalledTimes(1);

    const afterSecondApproval = await resumeMission(id, ORG);

    expect(afterSecondApproval.status).toBe('completed');
    expect(mockRunAgent).toHaveBeenCalledTimes(2);
  });
});
