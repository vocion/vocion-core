/**
 * The factory's own filing does not spend the PM's weekly proposal cap.
 *
 * Prod, 2026-09-29: request #224 stalled at "Planning" because the planning
 * automation's plan filing (factory-plan-request → file_architecture_plan →
 * objects.propose_candidate) was refused by the PM's weekly proposal limit
 * ("11 of 10") — an allowance meant for the agent's OWN initiative, spent
 * instead by the factory's own control-loop step. `isFactoryStep` reads the
 * turn's `ctx.userId`, which the factory stamps `factory:<seat>` when it
 * raises the event a mission check answers (`services/factory/carry.ts`),
 * structurally — never by asking what the model is filing.
 */
import type { RuntimeContext } from '../types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema, agentSchema } = await import('@/models/Schema');

vi.mock('@/services/ActionService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/services/ActionService')>()),
  proposeAction: vi.fn(async () => ({
    runId: 9,
    status: 'pending',
    outcome: 'created',
    result: null,
  })),
}));

const { proposeAction: mockedProposeAction } = await import('@/services/ActionService');
const { proposeActionTool } = await import('./proposeAction');

const ORG = 'org_factory_step_weekly_cap';
const AGENT = 'product-manager';

function ctxFor(userId: string): RuntimeContext {
  return {
    orgId: ORG,
    agentSlug: AGENT,
    userId,
    missionRunId: 501,
    connectorSources: [],
    emit: () => {},
  } as unknown as RuntimeContext;
}

async function seedWeeklyIdeas(n: number) {
  for (let i = 0; i < n; i++) {
    await db.insert(actionRunSchema).values({
      orgId: ORG,
      actionId: 'objects.propose_candidate',
      input: { title: `Idea ${i}` },
      status: 'done',
      invokedBy: `agent:${AGENT}`,
    } as never);
  }
}

const planFiling = {
  action_id: 'objects.propose_candidate',
  action_input: { objectType: 'architecture_plan', title: 'Plan: fix the widget', fields: {}, dedupOn: ['title'] },
  confidence: 0.9,
  rationale: 'The gap the request describes.',
  suggested_decision: 'approve' as const,
  suggested_decision_reason: 'Filing the plan the build needs.',
};

beforeEach(async () => {
  await db.delete(actionRunSchema);
  await db.delete(agentSchema);
  await db.insert(agentSchema).values({
    orgId: ORG,
    slug: AGENT,
    name: 'PM',
    systemPrompt: 'x',
    model: 'm',
    temperature: '0.2',
    approvalPolicy: { proposals: { openMax: 50, weeklyMax: 10 } },
  } as never);
  vi.clearAllMocks();
});

describe('the factory\'s own filing is bounded by its own limit, not the agent\'s weekly cap', () => {
  it('a planning filing at 11/10 still files, stamped factory:<slug> so it never counts toward the week', async () => {
    await seedWeeklyIdeas(11);

    const said = await proposeActionTool(ctxFor('factory:product-manager')).invoke(planFiling);

    expect(said).not.toContain('Refused');
    expect(said).toContain('PENDING human approval');
    expect(mockedProposeAction).toHaveBeenCalledTimes(1);
    expect(vi.mocked(mockedProposeAction).mock.calls[0]![0]).toMatchObject({ invokedBy: `factory:${AGENT}` });
  });

  it('the same filing at 11/10 from the agent\'s own schedule (no factory stamp) is still refused', async () => {
    await seedWeeklyIdeas(11);

    const said = await proposeActionTool(ctxFor('scheduled')).invoke(planFiling);

    expect(said).toContain('Refused');
    expect(said).toContain('11 new records');
    expect(mockedProposeAction).not.toHaveBeenCalled();
  });
});
