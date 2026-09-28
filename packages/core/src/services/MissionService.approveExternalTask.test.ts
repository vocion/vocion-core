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

async function seedDraftOnlyRunWithAnAction(): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId: ORG,
    title: 'Send the follow-up',
    brief: 'send it',
    status: 'running',
    team: { lead: 'agent-x', members: [] },
    // Level 1, draft only: every external action waits for a person.
    autonomyPolicy: { level: 1 },
    plan: { tasks: [{ id: 'send', title: 'Send the email', ownerAgentSlug: 'agent-x', type: 'action', status: 'pending' }] },
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
    const id = await seedDraftOnlyRunWithAnAction();

    expect(await executeMissionRun(id, ORG)).toBe('awaiting_review');
    expect(mockRunAgent).not.toHaveBeenCalled();

    const run = await resumeMission(id, ORG);

    expect(run.status).toBe('completed');
    expect(mockRunAgent).toHaveBeenCalledTimes(1);
  });
});
