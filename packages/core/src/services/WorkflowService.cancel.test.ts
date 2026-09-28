/**
 * Cancelling a workflow run stops its loop (vocion-core#123).
 *
 * `runLoop` never re-read the run between steps, and `persistState` wrote
 * with no status predicate. A person cancelled a run, every remaining step
 * still ran, and the loop's last write turned `cancelled` into `completed`.
 *
 * Steps are legacy `agent` steps so each one is a call to the mocked
 * `runAgentDeep`, which counts them; the first one cancels the run through
 * `cancelWorkflow`, the same call the Review UI makes. The DB is the PGlite
 * test mock, so the guarded writes run for real.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { and, eq } = await import('drizzle-orm');
const { workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { cancelWorkflow, startWorkflow } = await import('@/services/WorkflowService');

const mockRunAgent = vi.mocked(runAgentDeep);

const ORG = 'org_workflow_cancel';

async function seedWorkflow(slug: string, steps: unknown): Promise<void> {
  await db.insert(workflowSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    version: 1,
    status: 'active',
    trigger: { type: 'manual' },
    steps: steps as Array<Record<string, unknown>>,
  });
}

/**
 * A legacy agent step, the only step type whose work the test can count.
 * @param name - The step's name.
 */
function agentStep(name: string) {
  return { name, type: 'agent', agent: 'agent-x', prompt: `do ${name}` };
}

/**
 * An agent step during which a person cancels the run; the step itself still finishes.
 */
async function stepDuringWhichThePersonCancels(): Promise<never> {
  const [running] = await db
    .select({ id: workflowRunSchema.id })
    .from(workflowRunSchema)
    .where(and(eq(workflowRunSchema.orgId, ORG), eq(workflowRunSchema.status, 'running')));
  await cancelWorkflow(running!.id, ORG, 'stopped by the operator');
  return { response: 'first step output', traceId: 'trace-1', toolCalls: [] } as never;
}

/**
 * An agent step during which a person cancels the run, and which then fails.
 */
async function stepThatFailsAfterThePersonCancels(): Promise<never> {
  await stepDuringWhichThePersonCancels();
  throw new Error('the sync API timed out');
}

beforeEach(async () => {
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
  mockRunAgent.mockReset();
  mockRunAgent.mockResolvedValue({ response: 'ok', traceId: 'trace', toolCalls: [] } as never);
});

afterAll(async () => {
  await db.delete(workflowRunSchema);
  await db.delete(workflowSchema);
});

describe('cancelling a workflow run', () => {
  it('runs no step after the cancel, stays cancelled, and keeps the step that finished', async () => {
    await seedWorkflow('three_steps', [agentStep('first'), agentStep('second'), agentStep('third')]);
    mockRunAgent.mockImplementationOnce(stepDuringWhichThePersonCancels);

    const run = await startWorkflow({ orgId: ORG, slug: 'three_steps', invokedBy: 'test' });

    expect(mockRunAgent).toHaveBeenCalledTimes(1);
    expect(run.status).toBe('cancelled');
    expect(run.error).toBe('stopped by the operator');
    expect(run.stepResults.first?.status).toBe('completed');
    expect(run.stepResults.first?.output).toBe('first step output');
    expect(run.stepResults.second).toBeUndefined();
  });

  it('still records why a step failed when it failed after the cancel, and stays cancelled', async () => {
    await seedWorkflow('fails_after_cancel', [agentStep('first'), agentStep('second')]);
    mockRunAgent.mockImplementationOnce(stepThatFailsAfterThePersonCancels);

    const run = await startWorkflow({ orgId: ORG, slug: 'fails_after_cancel', invokedBy: 'test' });

    expect(run.status).toBe('cancelled');
    expect(run.error).toBe('stopped by the operator');
    expect(run.stepResults.first?.status).toBe('failed');
    expect(run.stepResults.first?.error).toBe('the sync API timed out');
    expect(run.stepResults.first?.finishedAt).toBeDefined();
  });

  it('keeps the last step\'s output when the cancel landed while it ran', async () => {
    await seedWorkflow('last_step_cancel', [agentStep('only')]);
    mockRunAgent.mockImplementationOnce(stepDuringWhichThePersonCancels);

    const run = await startWorkflow({ orgId: ORG, slug: 'last_step_cancel', invokedBy: 'test' });

    expect(run.status).toBe('cancelled');
    expect(run.stepResults.only?.status).toBe('completed');
    expect(run.stepResults.only?.output).toBe('first step output');
  });

  it('leaves a run that already completed as completed', async () => {
    await seedWorkflow('one_step', [agentStep('only')]);
    const done = await startWorkflow({ orgId: ORG, slug: 'one_step', invokedBy: 'test' });

    expect(done.status).toBe('completed');

    const after = await cancelWorkflow(done.id, ORG, 'too late');

    expect(after.status).toBe('completed');
    expect(after.error).toBeNull();
  });

  it('still says not found for a run in another org', async () => {
    await seedWorkflow('one_step', [agentStep('only')]);
    const done = await startWorkflow({ orgId: ORG, slug: 'one_step', invokedBy: 'test' });

    await expect(cancelWorkflow(done.id, 'some_other_org')).rejects.toThrow('not found');
  });
});
