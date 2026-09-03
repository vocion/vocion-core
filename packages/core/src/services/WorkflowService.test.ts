import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  startWorkflow,
} from './WorkflowService';

vi.mock('@/libs/DB');

vi.mock('@/libs/Langfuse', () => {
  const fakeTrace = () => ({
    id: 'test-trace',
    generation: () => ({ end: vi.fn() }),
    span: () => ({ end: vi.fn() }),
    update: vi.fn(),
    event: vi.fn(),
  });
  return {
    flushTraces: vi.fn(async () => {}),
    getLangfuseClient: () => ({ trace: fakeTrace }),
    traceFor: fakeTrace,
    cleanUsageDetails: (x: Record<string, number | undefined>) => x,
  };
});

const ORG = 'test_org_workflow';

async function seedWorkflow(slug: string, steps: unknown): Promise<number> {
  const [row] = await db.insert(workflowSchema).values({
    orgId: ORG,
    slug,
    name: slug,
    version: 1,
    status: 'active',
    trigger: { type: 'manual' },
    steps: steps as Array<Record<string, unknown>>,
  }).returning();
  return row!.id;
}

describe('WorkflowService', () => {
  afterEach(async () => {
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
  });

  it('runs a happy-path workflow with action steps and interpolated input', async () => {
    await seedWorkflow('shout_and_log', [
      { name: 'log_it', type: 'action', action: 'log', input: { text: '{{input.text}}' } },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'shout_and_log', input: { text: 'hello world' } });

    expect(run.status).toBe('completed');
    expect(run.stepResults.log_it?.status).toBe('completed');
  });

  it('pauses at an approve step and resumes on approval', async () => {
    await seedWorkflow('draft_then_approve', [
      { name: 'drafting', type: 'action', action: 'log', input: { body: 'draft body' } },
      { name: 'check', type: 'approve', prompt: 'look good?' },
      { name: 'final', type: 'action', action: 'send', input: { body: 'draft body' } },
    ]);

    const first = await startWorkflow({ orgId: ORG, slug: 'draft_then_approve' });

    expect(first.status).toBe('paused');
    expect(first.pauseReason).toBe('awaiting_approval:check');
    expect(first.stepResults.drafting?.status).toBe('completed');
    expect(first.stepResults.check?.status).toBe('awaiting_approval');
    expect(first.stepResults.final).toBeUndefined();

    const resumed = await resumeWorkflow(first.id, ORG);

    expect(resumed.status).toBe('completed');
    expect(resumed.stepResults.final?.status).toBe('completed');
  });

  it('pauses at an ask step and resumes with human input flowing downstream', async () => {
    await seedWorkflow('ask_then_send', [
      { name: 'transcript', type: 'ask', prompt: 'Paste the call transcript' },
      { name: 'send_it', type: 'action', action: 'log', input: { text: '{{steps.transcript.output}}' } },
    ]);

    const first = await startWorkflow({ orgId: ORG, slug: 'ask_then_send' });

    expect(first.status).toBe('paused');
    expect(first.pauseReason).toBe('awaiting_input:transcript');
    expect(first.stepResults.transcript?.status).toBe('awaiting_approval');
    expect(first.stepResults.transcript?.output).toEqual({ prompt: 'Paste the call transcript', kind: 'ask' });
    expect(first.stepResults.send_it).toBeUndefined();

    // an ask step resumes only WITH data
    await expect(resumeWorkflow(first.id, ORG)).rejects.toThrow(/awaiting input/);

    const resumed = await resumeWorkflow(first.id, ORG, { input: 'Call with Jane Doe of Acme' });

    expect(resumed.status).toBe('completed');
    expect(resumed.stepResults.transcript?.status).toBe('completed');
    expect(resumed.stepResults.transcript?.output).toBe('Call with Jane Doe of Acme');
    expect(resumed.stepResults.send_it?.status).toBe('completed');
  });

  /**
   * An ask whose `default` resolves doesn't ask — one workflow serves both an
   * automated caller that supplies the data and a human starting it by hand.
   */
  it('completes an ask step from its default instead of pausing', async () => {
    await seedWorkflow('ask_prefilled', [
      { name: 'transcript', type: 'ask', prompt: 'Paste the call transcript', default: '{{input.transcript}}' },
    ]);

    const run = await startWorkflow({
      orgId: ORG,
      slug: 'ask_prefilled',
      input: { transcript: 'Gated transcript supplied by detection' },
    });

    expect(run.status).toBe('completed'); // never paused
    expect(run.pauseReason).toBeNull();
    expect(run.stepResults.transcript?.status).toBe('completed');
    expect(run.stepResults.transcript?.output).toBe('Gated transcript supplied by detection');
  });

  it('still pauses a defaulted ask step when the default resolves to nothing', async () => {
    await seedWorkflow('ask_prefill_absent', [
      { name: 'transcript', type: 'ask', prompt: 'Paste the call transcript', default: '{{input.transcript}}' },
    ]);

    // Manual start — no transcript in the input, so the human is still asked.
    const run = await startWorkflow({ orgId: ORG, slug: 'ask_prefill_absent' });

    expect(run.status).toBe('paused');
    expect(run.pauseReason).toBe('awaiting_input:transcript');
  });

  it('pauses rather than accepting a whitespace-only default', async () => {
    await seedWorkflow('ask_prefill_blank', [
      { name: 'transcript', type: 'ask', prompt: 'Paste the call transcript', default: '{{input.transcript}}' },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'ask_prefill_blank', input: { transcript: '   ' } });

    expect(run.status).toBe('paused');
  });

  it('fails a run when a step throws', async () => {
    await seedWorkflow('explodes', [
      { name: 'first_ok', type: 'action', action: 'log', input: {} },
      // A sync step naming an unknown source degrades per-source, so use a
      // step shape the engine cannot execute at all: an unknown type from a
      // hand-edited DB row.
      { name: 'goes_bad', type: 'agent', agent: 'missing-agent', prompt: 'will throw' },
      { name: 'never_reached', type: 'action', action: 'log', input: {} },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'explodes' });

    expect(run.status).toBe('failed');
    expect(run.stepResults.first_ok?.status).toBe('completed');
    expect(run.stepResults.goes_bad?.status).toBe('failed');
    expect(run.stepResults.never_reached).toBeUndefined();
  });

  it('refuses to start when workflow is disabled', async () => {
    const [row] = await db.insert(workflowSchema).values({
      orgId: ORG,
      slug: 'disabled_wf',
      name: 'disabled',
      version: 1,
      status: 'disabled',
      trigger: { type: 'manual' },
      steps: [{ name: 's', type: 'action', action: 'log', input: {} }],
    }).returning();

    expect(row).toBeDefined();

    await expect(startWorkflow({ orgId: ORG, slug: 'disabled_wf' })).rejects.toThrow(/disabled/);
  });

  it('refuses to resume a run that is not paused', async () => {
    await seedWorkflow('simple', [{ name: 'a', type: 'action', action: 'log', input: {} }]);
    const run = await startWorkflow({ orgId: ORG, slug: 'simple' });

    expect(run.status).toBe('completed');

    await expect(resumeWorkflow(run.id, ORG)).rejects.toThrow(/completed/);
  });

  it('cancel sets status and records reason', async () => {
    await seedWorkflow('needs_approve', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);

    const run = await startWorkflow({ orgId: ORG, slug: 'needs_approve' });

    expect(run.status).toBe('paused');

    const cancelled = await cancelWorkflow(run.id, ORG, 'no longer needed');

    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.error).toBe('no longer needed');
  });

  it('lists runs filtered by status', async () => {
    await seedWorkflow('will_complete', [{ name: 's', type: 'action', action: 'log', input: {} }]);
    await seedWorkflow('will_pause', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'g', type: 'approve', prompt: 'hold' },
    ]);

    await startWorkflow({ orgId: ORG, slug: 'will_complete' });
    await startWorkflow({ orgId: ORG, slug: 'will_pause' });

    const completed = await listWorkflowRuns(ORG, { status: 'completed' });
    const paused = await listWorkflowRuns(ORG, { status: 'paused' });

    expect(completed.length).toBe(1);
    expect(paused.length).toBe(1);
  });

  it('getWorkflowRun returns null for missing id', async () => {
    const got = await getWorkflowRun(99999999, ORG);

    expect(got).toBeNull();
  });
});
