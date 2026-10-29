/**
 * A workflow's `action` step runs its registered action for real, down the
 * path an agent's proposal takes, on the test database: the trust ladder runs
 * it or holds it on its card; the card's answer moves the run; an outward or
 * irreversible action always waits and is never "Always allow"; the result is
 * the step's output; a failure fails the run, or inside a repeat group, the
 * round. The actions are test kinds; every name is fictional.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, trustRuleSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { decide } = await import('@/services/ReviewService');
const { cancelWorkflow, getWorkflowRun, resumeWorkflow, startWorkflow, WorkflowRunNotResumableError } = await import('@/services/WorkflowService');
const { alwaysAllowOption } = await import('@/services/decisions/alwaysAllow');

const ORG = 'proj_wf_actions_northwind';
const PERSON = 'usr-wf-actions-dana';

const notes: string[] = [];
let flaky = 0;
const undo = async () => ({ undone: true });

// Reversible and external: the trust ladder may run it, given a rule.
registerAction({ id: 'test.wf-tag', name: 'Tag a record', description: 'test', inputSchema: z.object({ tag: z.string() }), grant: 'test_tag', external: true, undo, execute: async (_ctx, input) => {
  notes.push(`tag:${(input as { tag: string }).tag}`);
  return { tagged: (input as { tag: string }).tag, line: `Tagged ${(input as { tag: string }).tag}` };
} });
// Goes out and cannot be put back: always a person's.
registerAction({ id: 'test.wf-announce', name: 'Announce it', description: 'test', inputSchema: z.object({ text: z.string() }), grant: 'test_announce', external: true, execute: async (_ctx, input) => {
  notes.push(`announce:${(input as { text: string }).text}`);
  return { posted: true };
} });
// Fails until its third try.
registerAction({ id: 'test.wf-flaky', name: 'Try the flaky thing', description: 'test', inputSchema: z.object({ n: z.coerce.number() }), grant: 'test_tag', external: true, undo, execute: async () => {
  flaky += 1;
  if (flaky < 3) {
    throw new Error(`try ${flaky} timed out`);
  }
  return { tries: flaky };
} });

/**
 * A trust rule that lets the ladder run a kind on its own.
 * @param actionId - The kind.
 */
async function trust(actionId: string): Promise<void> {
  await db.insert(trustRuleSchema).values({ orgId: ORG, actionId, threshold: 0.5, enabled: 'true' });
}

/**
 * Seed a workflow.
 * @param slug - Its slug.
 * @param steps - Its steps.
 */
async function seed(slug: string, steps: unknown[]): Promise<void> {
  await db.insert(workflowSchema).values({ orgId: ORG, slug, name: slug, status: 'active', trigger: { type: 'manual' }, steps: steps as Array<Record<string, unknown>>, ownerAgentSlug: 'release-manager' });
}

/**
 * Wait for a run to reach a status: a card's answer moves it after the decision returns.
 * @param runId - The run.
 * @param status - The status.
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

/**
 * The action run a step waits on.
 * @param run - The workflow run.
 * @param run.stepResults - Its step results.
 * @param step - The step.
 */
function cardOf(run: { stepResults: Record<string, { output?: unknown }> }, step: string): number {
  return (run.stepResults[step]!.output as { actionRunId: number }).actionRunId;
}

describe('workflow action steps', () => {
  beforeEach(() => {
    notes.length = 0;
    flaky = 0;
  });

  afterEach(async () => {
    await new Promise(r => setTimeout(r, 50));
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    await db.delete(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG));
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
  });

  it('runs the action now when the trust ladder lets it, and its result is the step\'s output', async () => {
    await trust('test.wf-tag');
    await seed('tag', [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { tag: '{{input.tag}}' } }, { name: 'after', type: 'action', action: 'log', input: { line: '{{steps.tag.output.result.line}}' } }]);

    const run = await startWorkflow({ orgId: ORG, slug: 'tag', input: { tag: 'SB-512' } });

    expect(run.status).toBe('completed');
    expect(notes).toEqual(['tag:SB-512']);
    expect(run.stepResults.tag).toMatchObject({ status: 'completed', output: { ok: true, status: 'done', action: 'test.wf-tag', result: { tagged: 'SB-512' } } });
    expect((run.stepResults.after!.output as { input: Record<string, unknown> }).input).toEqual({ line: 'Tagged SB-512' });

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, cardOf(run, 'tag')));

    // Proposed as the owning agent, by the run, on the ladder.
    expect(row).toMatchObject({ status: 'done', invokedBy: `workflow:tag:${run.id}`, approvedByAgent: true });
  });

  it('without a rule the ladder holds it on its card; approving runs it and the run goes on', async () => {
    await seed('tag', [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { tag: 'x' } }, { name: 'after', type: 'action', action: 'log', input: {} }]);

    const paused = await startWorkflow({ orgId: ORG, slug: 'tag' });

    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('awaiting_action:tag');
    expect(paused.stepResults.tag).toMatchObject({ status: 'awaiting_approval', output: { status: 'pending', why: expect.stringContaining('trust ladder') } });
    expect(notes).toEqual([]);

    // The run page's Resume does not skip past the action.
    await expect(resumeWorkflow(paused.id, ORG)).rejects.toBeInstanceOf(WorkflowRunNotResumableError);

    await decide({ kind: 'action', id: cardOf(paused, 'tag') }, 'approve', ORG, { reviewedBy: PERSON });
    const done = await until(paused.id, 'completed');

    expect(done?.status).toBe('completed');
    expect(notes).toEqual(['tag:x']);
    expect(done?.stepResults.tag).toMatchObject({ status: 'completed', output: { ok: true, result: { tagged: 'x' } } });
    expect(done?.stepResults.after?.status).toBe('completed');
  });

  it('turning the card down stops the run with the reason', async () => {
    await seed('tag', [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { tag: 'x' } }, { name: 'after', type: 'action', action: 'log', input: {} }]);
    const paused = await startWorkflow({ orgId: ORG, slug: 'tag' });

    await decide({ kind: 'action', id: cardOf(paused, 'tag') }, 'reject', ORG, { reviewedBy: PERSON, reason: 'Wrong batch.' });
    const stopped = await until(paused.id, 'cancelled');

    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.error).toContain('was turned down');
    expect(stopped?.error).toContain('Wrong batch.');
    expect(stopped?.stepResults.after).toBeUndefined();
    expect(notes).toEqual([]);
  });

  it('an outward, irreversible action always waits, whatever the trust rule, and is never "Always allow"', async () => {
    await trust('test.wf-announce');
    await seed('announce', [{ name: 'post', type: 'action', action: 'test.wf-announce', input: { text: 'Live' } }]);

    const paused = await startWorkflow({ orgId: ORG, slug: 'announce' });

    expect(paused.status).toBe('paused');
    expect(paused.stepResults.post!.output).toMatchObject({ status: 'pending', why: expect.stringContaining('cannot be undone') });
    expect(notes).toEqual([]);

    const [row] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, cardOf(paused, 'post')));

    expect((row!.proposal as { workflow?: unknown }).workflow).toEqual({ runId: paused.id, step: 'post' });
    expect(await alwaysAllowOption(ORG, PERSON, 'test.wf-announce')).toBeNull();

    await decide({ kind: 'action', id: row!.id }, 'approve', ORG, { reviewedBy: PERSON });

    expect((await until(paused.id, 'completed'))?.status).toBe('completed');
    expect(notes).toEqual(['announce:Live']);
  });

  it('a failed action fails the run, with its error', async () => {
    await trust('test.wf-flaky');
    await seed('flaky', [{ name: 'try', type: 'action', action: 'test.wf-flaky', input: { n: 1 } }, { name: 'never', type: 'action', action: 'log', input: {} }]);

    const run = await startWorkflow({ orgId: ORG, slug: 'flaky' });

    expect(run.status).toBe('failed');
    expect(run.error).toContain('try 1 timed out');
    expect(run.stepResults.try).toMatchObject({ status: 'failed', output: { ok: false, status: 'failed' } });
    expect(run.stepResults.never).toBeUndefined();
  });

  it('inside a repeat group a failed action is a failed round: until, max and onExhausted decide', async () => {
    await trust('test.wf-flaky');
    const group = (max: number, onExhausted: 'continue' | 'fail') => ({ name: 'retry', type: 'repeat', until: '{{steps.try.output.ok}}', max, onExhausted, steps: [{ name: 'try', type: 'action', action: 'test.wf-flaky', input: { n: '{{repeat.round}}' } }] });

    await seed('enough', [group(3, 'fail')]);
    const ok = await startWorkflow({ orgId: ORG, slug: 'enough' });

    expect(ok.status).toBe('completed');
    expect(ok.stepResults.retry).toMatchObject({ output: { rounds: 3, satisfied: true } });
    expect(ok.stepResults.try).toMatchObject({ status: 'completed', round: 3, output: { ok: true, result: { tries: 3 } } });
    expect(ok.stepResults.try!.previous?.map(p => p.status)).toEqual(['failed', 'failed']);

    flaky = 0;
    await seed('short', [group(2, 'fail')]);
    const failed = await startWorkflow({ orgId: ORG, slug: 'short' });

    expect(failed.status).toBe('failed');
    expect(failed.error).toMatch(/2 rounds ran/);

    flaky = 0;
    await seed('onward', [group(2, 'continue'), { name: 'after', type: 'action', action: 'log', input: { last: '{{steps.try.output.error}}' } }]);
    const onward = await startWorkflow({ orgId: ORG, slug: 'onward' });

    expect(onward.status).toBe('completed');
    expect((onward.stepResults.after!.output as { input: Record<string, unknown> }).input).toEqual({ last: 'try 2 timed out' });
  });

  it('an action held on its card inside a group pauses the group, and picks it up when approved', async () => {
    await seed('held', [{ name: 'loop', type: 'repeat', until: '{{steps.tag.output.ok}}', max: 2, steps: [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { tag: 'r{{repeat.round}}' } }] }]);

    const paused = await startWorkflow({ orgId: ORG, slug: 'held' });

    expect(paused.status).toBe('paused');
    expect(paused.stepResults.loop).toMatchObject({ status: 'running', repeat: { round: 1, next: 0 } });

    await decide({ kind: 'action', id: cardOf(paused, 'tag') }, 'approve', ORG, { reviewedBy: PERSON });
    const done = await until(paused.id, 'completed');

    expect(done?.stepResults.loop).toMatchObject({ status: 'completed', output: { rounds: 1, satisfied: true } });
    expect(notes).toEqual(['tag:r1']);
  });

  it('stopping a run withdraws the card it waits on', async () => {
    await seed('tag', [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { tag: 'x' } }]);
    const paused = await startWorkflow({ orgId: ORG, slug: 'tag' });

    await cancelWorkflow(paused.id, ORG, 'Batch withdrawn');

    const [row] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, ORG), eq(actionRunSchema.id, cardOf(paused, 'tag'))));

    expect(row?.status).toBe('rejected');
    expect(row?.error).toContain('Batch withdrawn');
  });

  it('a refused input fails the step with the action\'s own words', async () => {
    await seed('bad', [{ name: 'tag', type: 'action', action: 'test.wf-tag', input: { nope: 1 } }]);
    const run = await startWorkflow({ orgId: ORG, slug: 'bad' });

    expect(run.status).toBe('failed');
    expect(run.stepResults.tag).toMatchObject({ status: 'failed', output: { status: 'refused' } });
  });

  it('an id no action is registered under still records what it would do', async () => {
    await seed('stub', [{ name: 'note', type: 'action', action: 'crm.not_a_thing', input: { a: 1 } }]);
    const run = await startWorkflow({ orgId: ORG, slug: 'stub' });

    expect(run.status).toBe('completed');
    expect(run.stepResults.note!.output).toMatchObject({ stubbed: true, input: { a: 1 } });
  });
});
