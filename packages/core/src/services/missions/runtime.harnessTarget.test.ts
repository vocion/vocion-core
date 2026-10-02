/**
 * A mission task runs where its agent runs.
 *
 * `executeMissionRun` dispatches every task through `runAgentDeep`, the same
 * seam a chat turn goes through, so an agent authored `harness.runsOn:
 * agentcore-container` has its mission work done on the container too — which
 * is the whole point of moving a fleet off one box: QA reviews, PM passes and
 * every automation's agent run are missions.
 *
 * What these tests pin is that the run's identity crosses with it. The
 * container's tool calls come back to core carrying only what the claim
 * carries, so a task dispatched without its `missionRunId` writes tool_call
 * rows that belong to no run, and everything that reads a run back by its
 * calls (the automation's check summary, the required-tool pass, the review's
 * "opened none of the screenshots" rule) sees a run that did nothing.
 *
 * No live model and no container: the providers are mocked, the DB is the
 * PGlite test mock, and the dispatch is the real one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const runAgentOnRuntime = vi.fn(async (_opts: Record<string, unknown>) => ({ response: 'done on the container', traceId: 't-runtime', toolCalls: [] }));
vi.mock('@/services/agents/providers/runtime', () => ({ runAgentOnRuntime }));
vi.mock('@/services/agents/providers/agentcore', () => ({ runAgentOnAgentCoreHarness: vi.fn() }));
vi.mock('@/services/agents/harness', () => ({
  chatModelOptionsFor: () => ({}),
  chatModelOptionsWithOverride: () => ({}),
  buildInitialFiles: vi.fn(async () => ({})),
  compileAgentForRequest: vi.fn(async () => {
    throw new Error('in-process loop reached');
  }),
}));
vi.mock('@/libs/Langfuse', () => ({ createLangfuseCallback: vi.fn(() => undefined) }));
vi.mock('@/services/BudgetService', () => ({
  preflightCheck: vi.fn(async () => ({ ok: true })),
  chargeUsage: vi.fn(async () => {}),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, missionRunSchema } = await import('@/models/Schema');
const { executeMissionRun } = await import('./runtime');

const ORG = 'org_mission_on_runtime';

async function seedAgent(slug: string, harnessConfig: Record<string, unknown>): Promise<void> {
  await db.insert(agentSchema).values({ orgId: ORG, slug, name: slug, systemPrompt: 'Do the task.', harnessConfig } as never);
}

async function seedRun(owner: string): Promise<number> {
  const [row] = await db.insert(missionRunSchema).values({
    orgId: ORG,
    title: 'Weekly check',
    brief: 'Check the queue and say what changed.',
    team: { lead: owner, members: [] },
    // Level 3 runs a plain analysis task without pausing for approval.
    autonomyPolicy: { level: 3 },
    plan: { tasks: [{ id: 't1', title: 'Check the queue', ownerAgentSlug: owner, type: 'analysis', status: 'pending' }] },
  } as never).returning({ id: missionRunSchema.id });
  return row!.id;
}

beforeEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(agentSchema);
  runAgentOnRuntime.mockClear();
  delete process.env.VOCION_AGENT_PROVIDER;
  delete process.env.VOCION_DISABLE_RUNTIME;
});

afterEach(async () => {
  await db.delete(missionRunSchema);
  await db.delete(agentSchema);
});

describe('a mission task on an agent that runs on the container', () => {
  it('is dispatched to the container, carrying the run it belongs to', async () => {
    await seedAgent('queue-checker', { runsOn: 'agentcore-container' });
    const runId = await seedRun('queue-checker');

    await expect(executeMissionRun(runId, ORG)).resolves.toBe('completed');

    expect(runAgentOnRuntime).toHaveBeenCalledTimes(1);

    const opts = runAgentOnRuntime.mock.calls[0]![0];

    expect(opts).toMatchObject({ orgId: ORG, agentSlug: 'queue-checker', missionRunId: runId });

    const [run] = await db.select().from(missionRunSchema);

    expect(run!.plan!.tasks[0]).toMatchObject({ status: 'completed', output: 'done on the container', traceId: 't-runtime' });
  });

  it('goes back to this process when the kill switch is on', async () => {
    // VOCION_DISABLE_RUNTIME=1 is the documented way to take every agent off
    // the container at once; a mission must obey it exactly as chat does.
    process.env.VOCION_DISABLE_RUNTIME = '1';
    await seedAgent('queue-checker', { runsOn: 'agentcore-container' });
    const runId = await seedRun('queue-checker');

    await executeMissionRun(runId, ORG);

    expect(runAgentOnRuntime).not.toHaveBeenCalled();

    const [run] = await db.select().from(missionRunSchema);

    expect(run!.plan!.tasks[0]!.error).toMatch(/in-process loop reached/);
  });

  it('leaves an agent that names no target in this process', async () => {
    await seedAgent('queue-checker', {});
    const runId = await seedRun('queue-checker');

    await executeMissionRun(runId, ORG);

    expect(runAgentOnRuntime).not.toHaveBeenCalled();
  });
});
