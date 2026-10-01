/**
 * The planner gives every task its own id.
 *
 * The run loop, the approval gate and resume all find a task by id. The
 * planner used to fall back to `t<position>` for a task the model gave no
 * id, which could land on an id the model had given another task; the
 * second of the two then never ran and the run ended `failed`.
 *
 * `runAgentDeep` is mocked, so no model is called.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { runAgentDeep } = await import('@/services/AgentService');
const { planMission } = await import('@/services/missions/planner');

const mockRunAgent = vi.mocked(runAgentDeep);

/**
 * Make the mocked lead answer with this plan.
 * @param tasks - The tasks the model "returned".
 */
function modelReturns(tasks: unknown[]) {
  mockRunAgent.mockResolvedValue({ response: JSON.stringify({ tasks }), traceId: 'trace', toolCalls: [] } as never);
}

function plan() {
  return planMission({ orgId: 'org_planner_ids', brief: 'do the thing', team: { lead: 'agent-x', members: [] } });
}

beforeEach(() => {
  mockRunAgent.mockReset();
});

describe('planMission task ids', () => {
  it('does not give a task without an id the id the model gave another task', async () => {
    modelReturns([{ id: 't2', title: 'Research' }, { title: 'Draft' }]);

    const tasks = await plan();

    expect(tasks.map(t => t.id)).toEqual(['t2', 't2-2']);
  });

  it('keeps two tasks apart when the model gave both the same id', async () => {
    modelReturns([{ id: 'research', title: 'Research' }, { id: 'research', title: 'Research again' }, { id: 'research', title: 'And again' }]);

    const tasks = await plan();

    expect(tasks.map(t => t.id)).toEqual(['research', 'research-2', 'research-3']);
  });

  it('keeps the model\'s ids when they are already unique', async () => {
    modelReturns([{ id: 'research', title: 'Research' }, { id: 'draft', title: 'Draft', dependsOn: ['research'] }]);

    const tasks = await plan();

    expect(tasks.map(t => t.id)).toEqual(['research', 'draft']);
    expect(tasks[1]!.dependsOn).toEqual(['research']);
  });
});
