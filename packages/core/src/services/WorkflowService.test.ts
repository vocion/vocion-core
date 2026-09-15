import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';
import { runAgentDeep } from '@/services/AgentService';
import {
  cancelWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  resumeWorkflow,
  startWorkflow,
  WorkflowRunNotResumableError,
} from './WorkflowService';

vi.mock('@/libs/DB');

// Legacy `agent`-typed steps (see `seedWorkflow('explodes', ...)` and the
// concurrent-resume test below) call out to AgentService. Mocking it here —
// rather than letting the real thing run — is what makes an invocation
// counter possible: the real function's LangChain call has no cheap hook a
// test can watch from the outside.
vi.mock('@/services/AgentService', () => ({
  runAgentDeep: vi.fn(),
}));

const mockRunAgentDeep = vi.mocked(runAgentDeep);

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

/**
 * Delays the second SELECT inside `resumeWorkflow` — the workflow-definition
 * read that sits between the initial status read and the claiming UPDATE —
 * just long enough to run `sideEffect` first, then lets the real query
 * through unchanged. That gap is the only place a genuinely concurrent
 * caller could land a write before the claim: the initial read has already
 * passed (or these tests couldn't get this far), and the UPDATE hasn't run
 * yet. Using call order rather than matching on a specific table keeps this
 * honest about what it's standing in for — a second process finishing its
 * own read-then-write in the moment this call is waiting on I/O between its
 * own two reads.
 * @param sideEffect - Runs to completion before the intercepted read resolves.
 */
function injectBetweenReadAndClaim(sideEffect: () => Promise<unknown>) {
  let selectCallCount = 0;
  const originalSelect = db.select.bind(db);
  return vi.spyOn(db, 'select').mockImplementation((...args: unknown[]) => {
    selectCallCount += 1;
    const builder = (originalSelect as (...a: unknown[]) => any)(...args);
    if (selectCallCount !== 2) {
      return builder;
    }
    const originalFrom = builder.from.bind(builder);
    builder.from = (...fromArgs: unknown[]) => {
      const fromResult = originalFrom(...fromArgs);
      const originalWhere = fromResult.where.bind(fromResult);
      fromResult.where = (...whereArgs: unknown[]) => {
        const whereResult = originalWhere(...whereArgs);
        const originalThen = whereResult.then.bind(whereResult);
        whereResult.then = (onFulfilled?: unknown, onRejected?: unknown) =>
          sideEffect().then(() => originalThen(onFulfilled, onRejected));
        return whereResult;
      };
      return fromResult;
    };
    return builder;
  });
}

describe('WorkflowService', () => {
  afterEach(async () => {
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    mockRunAgentDeep.mockReset();
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
    mockRunAgentDeep.mockRejectedValueOnce(new Error('agent "missing-agent" not found'));

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

  it('refuses to resume a run that is genuinely not paused when read', async () => {
    // This is the plain, non-racy guard: a run that finished on its own, with
    // no other caller anywhere near it. It only proves the read-check in
    // isolation — the claiming UPDATE's own status predicate, added for
    // vocion-core#111, is exercised separately below by tests that flip the
    // row's status in the gap between the read and the write, since a row
    // that was already completed before this call started never reaches that
    // UPDATE at all.
    await seedWorkflow('simple', [{ name: 'a', type: 'action', action: 'log', input: {} }]);
    const run = await startWorkflow({ orgId: ORG, slug: 'simple' });

    expect(run.status).toBe('completed');

    await expect(resumeWorkflow(run.id, ORG)).rejects.toThrow(/completed/);
    await expect(resumeWorkflow(run.id, ORG)).rejects.toBeInstanceOf(WorkflowRunNotResumableError);
  });

  it('rejects a resume when the run finishes in the gap between the read and the claiming update', async () => {
    await seedWorkflow('completes_before_claim', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);
    const run = await startWorkflow({ orgId: ORG, slug: 'completes_before_claim' });

    expect(run.status).toBe('paused');

    // Stands in for a second resume finishing in full — read, claim, run to
    // completion — in the gap between this call's own read (which still saw
    // `paused`) and its own claiming UPDATE. The old check-then-update code
    // never looked again after its first read, so this flip was invisible to
    // it; only the UPDATE's own status predicate can still catch it.
    const spy = injectBetweenReadAndClaim(async () => {
      await db.update(workflowRunSchema)
        .set({ status: 'completed', pauseReason: null, pausedAt: null })
        .where(eq(workflowRunSchema.id, run.id));
    });

    try {
      const promise = resumeWorkflow(run.id, ORG);

      await expect(promise).rejects.toBeInstanceOf(WorkflowRunNotResumableError);
      // This exact wording only comes from the UPDATE returning zero rows —
      // the initial-read rejection above says "status is completed" instead.
      // Matching it is what proves this test reached the claim, not the read.
      await expect(promise).rejects.toThrow(/another request already resumed it/);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects a resume when another resume claims the run in the gap between the read and this one’s claiming update', async () => {
    await seedWorkflow('claimed_before_claim', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);
    const run = await startWorkflow({ orgId: ORG, slug: 'claimed_before_claim' });

    expect(run.status).toBe('paused');

    // The exact race vocion-core#111 fixed: another resume's own claiming
    // UPDATE lands first. This call's read already passed — only its own
    // UPDATE's status predicate stands between it and running the same step
    // twice.
    const spy = injectBetweenReadAndClaim(async () => {
      await db.update(workflowRunSchema).set({ status: 'running' }).where(eq(workflowRunSchema.id, run.id));
    });

    try {
      const promise = resumeWorkflow(run.id, ORG);

      await expect(promise).rejects.toBeInstanceOf(WorkflowRunNotResumableError);
      await expect(promise).rejects.toThrow(/another request already resumed it/);
    } finally {
      spy.mockRestore();
    }
  });

  it('does not let a resume for a different org claim the run', async () => {
    await seedWorkflow('cross_org', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);
    const run = await startWorkflow({ orgId: ORG, slug: 'cross_org' });

    expect(run.status).toBe('paused');

    // This only proves the lookup is org-scoped: the first SELECT already
    // filters by orgId, so a call carrying the wrong org never finds the row
    // at all and never gets near the claiming UPDATE. The UPDATE's own org
    // predicate is exercised separately below.
    await expect(resumeWorkflow(run.id, 'a_different_org')).rejects.toThrow();

    const stillPaused = await getWorkflowRun(run.id, ORG);

    expect(stillPaused?.status).toBe('paused');

    const resumed = await resumeWorkflow(run.id, ORG);

    expect(resumed.status).toBe('completed');
  });

  it('rejects a resume when the run is reassigned to a different org in the gap between the read and the claiming update', async () => {
    // A resume's orgId is fixed for the whole call, so the only way the row's
    // ownership can differ between this call's read and its write is if
    // something else reassigns it mid-flight — contrived, but it is the one
    // way to exercise the UPDATE's own `eq(orgId, orgId)` predicate on its
    // own merits, distinct from the initial SELECT's org filter (proven
    // separately above), since deleting the UPDATE's predicate would not
    // fail any test that never gets this row's org out of sync between the
    // two queries.
    await seedWorkflow('reassigned_before_claim', [
      { name: 's', type: 'action', action: 'log', input: {} },
      { name: 'gate', type: 'approve', prompt: 'wait' },
    ]);
    const run = await startWorkflow({ orgId: ORG, slug: 'reassigned_before_claim' });

    expect(run.status).toBe('paused');

    const spy = injectBetweenReadAndClaim(async () => {
      await db.update(workflowRunSchema).set({ orgId: 'a_different_org' }).where(eq(workflowRunSchema.id, run.id));
    });

    try {
      const promise = resumeWorkflow(run.id, ORG);

      await expect(promise).rejects.toBeInstanceOf(WorkflowRunNotResumableError);
      await expect(promise).rejects.toThrow(/another request already resumed it/);
    } finally {
      spy.mockRestore();
    }
  });

  it('lets exactly one of two concurrent resumes through; the step after the gate runs exactly once', async () => {
    const runLog: string[] = [];
    mockRunAgentDeep.mockImplementation(async ({ agentSlug }) => {
      runLog.push(agentSlug);
      return { response: 'drafted', traceId: 'trace-1', toolCalls: [] };
    });

    // The step after the gate is a legacy `agent` step (not `action`) purely
    // so its execution can be counted: `action` steps are inline stubs with
    // no call a test can spy on, so a second, wrongly-allowed execution would
    // overwrite the first with an identical `completed` status and leave no
    // trace. runAgentDeep is mocked above, so this makes no live model call.
    await seedWorkflow('approve_then_agent', [
      { name: 'gate', type: 'approve', prompt: 'go?' },
      { name: 'after', type: 'agent', agent: 'agent-x', prompt: 'do the thing' },
    ]);
    const run = await startWorkflow({ orgId: ORG, slug: 'approve_then_agent' });

    expect(run.status).toBe('paused');

    // Two clicks on the same approve button, or one click plus a stale page
    // firing a duplicate request — either way, two resumes land on the same
    // paused run at once.
    const [first, second] = await Promise.allSettled([
      resumeWorkflow(run.id, ORG),
      resumeWorkflow(run.id, ORG),
    ]);

    const outcomes = [first.status, second.status].toSorted();

    expect(outcomes).toEqual(['fulfilled', 'rejected']);

    const refusal = [first, second].find(r => r.status === 'rejected') as PromiseRejectedResult;

    expect(refusal.reason).toBeInstanceOf(WorkflowRunNotResumableError);

    const winner = [first, second].find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof resumeWorkflow>>>;

    expect(winner.value.status).toBe('completed');
    expect(winner.value.stepResults.after?.status).toBe('completed');

    // The status assertions above read identically whether the step ran once
    // or twice — a second, wrongly-allowed execution would overwrite the same
    // `completed` status with another `completed` status. The invocation log
    // is what actually proves single execution, which is the whole point of
    // the claim this fix adds.
    expect(runLog).toEqual(['agent-x']);

    const final = await getWorkflowRun(run.id, ORG);

    expect(final?.stepResults.after?.status).toBe('completed');
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
