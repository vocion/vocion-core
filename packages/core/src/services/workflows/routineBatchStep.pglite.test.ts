/**
 * A workflow step that runs an automation and waits for its batch (`routine.run`
 * with `wait: true`): the run pauses until the batch closes, then the next step
 * reads every row's read-back. The batch itself is a stand-in; the durable run,
 * the pause and the hand-off are real. Every name here is fictional.
 */
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/services/routines/routineReads', async (orig) => {
  const real = await orig<typeof import('@/services/routines/routineReads')>();
  return { ...real, findRoutine: vi.fn(), getBatch: vi.fn() };
});
vi.mock('@/services/routines/RoutineService', () => ({ startRoutineBatch: vi.fn() }));
vi.mock('@/services/chat/tellConversation', () => ({ tellConversation: vi.fn(async () => ({ said: true })) }));

const { db } = await import('@/libs/DB');
const { workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { getWorkflowRun, resumeWorkflow, settleBatchStep, startWorkflow } = await import('@/services/WorkflowService');
const reads = await import('@/services/routines/routineReads');
const { startRoutineBatch } = await import('@/services/routines/RoutineService');
const { tellConversation } = await import('@/services/chat/tellConversation');

const ORG = 'proj_batchstep_cedar';

const STEPS = [
  { name: 'check', type: 'action', action: 'routine.run', label: 'Check the licenses', input: { routine: 'check-license', rows: '{{input.rows}}', wait: true } },
  { name: 'note', type: 'action', action: 'crm.note_publish', input: { first: '{{steps.check.output.rows}}', summary: '{{steps.check.output.summary}}' } },
];

/**
 * Wait for a run to reach a status.
 * @param runId - The run.
 * @param status - The status to wait for.
 */
async function until(runId: number, status: string) {
  for (let i = 0; i < 200; i++) {
    const run = await getWorkflowRun(runId, ORG);
    if (run?.status === status) {
      return run;
    }
    await new Promise(r => setTimeout(r, 15));
  }
  return getWorkflowRun(runId, ORG);
}

describe('a workflow step that waits for an automation batch', () => {
  afterEach(async () => {
    await new Promise(r => setTimeout(r, 50));
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    vi.mocked(reads.getBatch).mockReset();
    vi.mocked(tellConversation).mockClear();
  });

  it('pauses until the batch closes, then hands each row\'s read-back to the next step', async () => {
    vi.mocked(reads.findRoutine).mockResolvedValue({ id: 7, name: 'Check a provider\'s license', expert: null } as never);
    vi.mocked(startRoutineBatch).mockResolvedValue({ id: 41, total: 2 } as never);
    vi.mocked(reads.getBatch).mockResolvedValue({ id: 41, status: 'running', counts: {}, total: 2, runs: [] } as never);
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'enroll', name: 'Enroll', status: 'active', trigger: { type: 'manual' }, steps: STEPS, ownerAgentSlug: 'coordinator' });

    const rows = [{ provider_name: 'Maya Chen', npi: '1628194821' }, { provider_name: 'Owen Fitzgerald', npi: '1730207451' }];
    const paused = await startWorkflow({ orgId: ORG, slug: 'enroll', input: { rows }, invokedBy: 'usr-marcus', triggerContext: { conversationId: 9 } });

    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('awaiting_batch:check');
    expect(vi.mocked(startRoutineBatch).mock.calls[0]![0]).toMatchObject({ orgId: ORG, routineId: 7, rows, conversationId: 9 });
    await expect(resumeWorkflow(paused.id, ORG)).rejects.toThrow(/automation batch/);

    // A different batch closing leaves the run waiting.
    await settleBatchStep(ORG, 99);

    expect((await getWorkflowRun(paused.id, ORG))?.status).toBe('paused');

    vi.mocked(reads.getBatch).mockResolvedValue({
      id: 41,
      status: 'done',
      total: 2,
      counts: { done: 2 },
      runs: [
        { n: 1, label: 'Maya Chen', status: 'done', input: rows[0], receipt: { after: { board_status: 'Ready to submit' }, verified: true } },
        { n: 2, label: 'Owen Fitzgerald', status: 'done', input: rows[1], receipt: { after: { board_status: 'Ready to submit' }, verified: true } },
      ],
    } as never);
    await settleBatchStep(ORG, 41);
    const done = await until(paused.id, 'completed');

    expect(done?.stepResults.check).toMatchObject({ status: 'completed', output: { batchId: 41, summary: '2 of 2 done', rows: [{ row: 1, read_back: { board_status: 'Ready to submit' }, verified: true }, { row: 2 }] } });
    expect(done?.stepResults.note).toMatchObject({ status: 'completed' });
  });

  it('without wait, completes as soon as the batch starts', async () => {
    vi.mocked(reads.findRoutine).mockResolvedValue({ id: 7, name: 'Check a provider\'s license', expert: null } as never);
    vi.mocked(startRoutineBatch).mockResolvedValue({ id: 42, total: 1 } as never);
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'enroll-nowait', name: 'Enroll', status: 'active', trigger: { type: 'manual' }, steps: [{ ...STEPS[0], input: { routine: 'check-license', rows: '{{input.rows}}' } }], ownerAgentSlug: 'coordinator' });

    const run = await startWorkflow({ orgId: ORG, slug: 'enroll-nowait', input: { rows: [{ npi: '1' }] } });

    expect(run.status).toBe('completed');
    expect(run.stepResults.check).toMatchObject({ output: { batchId: 42, rows: 1 } });
  });

  it('a run started from a conversation says there that it is done, or why it stopped', async () => {
    vi.mocked(reads.findRoutine).mockResolvedValueOnce({ id: 7, name: 'Check a provider\'s license', expert: null } as never);
    vi.mocked(startRoutineBatch).mockResolvedValue({ id: 43, total: 1 } as never);
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'told', name: 'Enroll', status: 'active', trigger: { type: 'manual' }, steps: [{ ...STEPS[0], input: { routine: 'check-license', rows: '{{input.rows}}' } }], ownerAgentSlug: 'coordinator' });

    const done = await startWorkflow({ orgId: ORG, slug: 'told', input: { rows: [{ npi: '1' }] }, triggerContext: { conversationId: 12 } });

    expect(done.status).toBe('completed');
    expect(vi.mocked(tellConversation)).toHaveBeenCalledWith(ORG, 12, expect.stringContaining('Enroll is done: every step finished.'), expect.objectContaining({ key: `workflow-run:${done.id}:completed` }));

    vi.mocked(reads.findRoutine).mockResolvedValueOnce(null as never);
    const failed = await startWorkflow({ orgId: ORG, slug: 'told', input: { rows: [{ npi: '1' }] }, triggerContext: { conversationId: 12 } });

    expect(failed.status).toBe('failed');
    expect(vi.mocked(tellConversation)).toHaveBeenLastCalledWith(ORG, 12, expect.stringMatching(/^Enroll stopped\. step .* failed: routine\.run: no routine "check-license"/), expect.objectContaining({ key: `workflow-run:${failed.id}:failed` }));

    vi.mocked(tellConversation).mockClear();
    vi.mocked(reads.findRoutine).mockResolvedValueOnce({ id: 7, name: 'Check a provider\'s license', expert: null } as never);
    await startWorkflow({ orgId: ORG, slug: 'told', input: { rows: [{ npi: '1' }] } });

    expect(vi.mocked(tellConversation)).not.toHaveBeenCalled();
  });
});
