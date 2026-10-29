/**
 * The engine with agent steps (ADR 0011): repeat until / max / onExhausted,
 * `when`, interpolation into a task, run and step labels, a step a restart
 * interrupted, and fan-out. The agent is a stand-in (`agentRunner`); the
 * database is the test one.
 */
import type { AgentTurnRequest, AgentTurnResult } from './workflows/agentRunner';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/libs/DB';
import { workflowRunSchema, workflowSchema } from '@/models/Schema';
import { runAgentTurn } from './workflows/agentRunner';
import { advanceWorkflowRun, cancelWorkflow, startWorkflow } from './WorkflowService';

vi.mock('@/libs/DB');
vi.mock('./workflows/agentRunner', () => ({ runAgentTurn: vi.fn() }));

const turn = vi.mocked(runAgentTurn);
const ORG = 'test_org_wf_agent_steps';

/**
 * Seed a workflow.
 * @param slug - Its slug.
 * @param steps - Its steps.
 * @param extra - Other columns.
 */
async function seed(slug: string, steps: unknown[], extra: Partial<typeof workflowSchema.$inferInsert> = {}): Promise<number> {
  const [row] = await db.insert(workflowSchema).values({ orgId: ORG, slug, name: slug, version: 1, status: 'active', trigger: { type: 'manual' }, steps: steps as Array<Record<string, unknown>>, ...extra }).returning();
  return row!.id;
}

/**
 * Answer each agent turn by the agent asked: a queue of replies per agent.
 * @param replies - Replies per agent slug, in order.
 */
function answer(replies: Record<string, string[]>): AgentTurnRequest[] {
  const calls: AgentTurnRequest[] = [];
  turn.mockImplementation(async (req): Promise<AgentTurnResult> => {
    calls.push(req);
    const next = replies[req.agentSlug]?.shift();
    if (next === undefined) {
      throw new Error(`no reply left for ${req.agentSlug}`);
    }
    return { text: next, traceId: `t-${calls.length}`, toolCalls: 1, model: 'claude-sonnet-4-6', effort: 'standard', microCents: 500_000 };
  });
  return calls;
}

const verdict = (v: 'pass' | 'revise', findings: string[] = []) => `\`\`\`json\n${JSON.stringify({ verdict: v, findings })}\n\`\`\``;

const reviewGroup = (max: number, onExhausted?: 'continue' | 'fail') => ({
  name: 'edit',
  type: 'repeat',
  label: 'Editor review',
  until: '{{steps.review.output.verdict}} == \'pass\'',
  max,
  ...(onExhausted ? { onExhausted } : {}),
  steps: [
    { name: 'review', type: 'agent', agent: 'seo-editor', task: 'Review draft {{steps.draft.output.draftId}} (round {{repeat.round}}).', output: { type: 'object', required: ['verdict'], properties: { verdict: { enum: ['pass', 'revise'] }, findings: { type: 'array' } } } },
    { name: 'revise', type: 'agent', agent: 'seo-writer', task: 'Fix {{steps.review.output.findings}}' },
  ],
});

const draft = { name: 'draft', type: 'agent', agent: 'seo-writer', task: 'Write page {{input.page_id}} on "{{input.keyword}}".', output: { type: 'object', required: ['draftId'], properties: { draftId: { type: 'integer' } } } };

describe('workflow agent steps', () => {
  afterEach(async () => {
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    turn.mockReset();
  });

  it('interpolates the task, keeps the typed result, and names the run and its steps', async () => {
    await seed('page', [draft], { runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}' });
    const calls = answer({ 'seo-writer': ['Done.\n```json\n{"draftId": 7}\n```'] });

    const run = await startWorkflow({ orgId: ORG, slug: 'page', input: { page_id: 42, keyword: 'boiler repair', batch_ref: 'SB-512', index: 2, total: 3 } });

    expect(run.status).toBe('completed');
    expect(run.runLabel).toBe('SB-512 · page 2 of 3');
    expect(calls[0]!.message).toContain('Write page 42 on "boiler repair".');
    expect(calls[0]!.userId).toBe(`workflow:page:${run.id}`);
    expect(run.stepResults.draft).toMatchObject({ status: 'completed', output: { draftId: 7 }, label: 'Write page 42 on "boiler repair"', agent: { slug: 'seo-writer', model: 'claude-sonnet-4-6', microCents: 500_000 } });
  });

  it('a caller\'s own runLabel wins over the workflow\'s', async () => {
    await seed('page', [{ name: 'note', type: 'action', action: 'log', input: {} }], { runLabel: 'page {{input.index}}' });
    const run = await startWorkflow({ orgId: ORG, slug: 'page', input: { index: 1, runLabel: 'Refreshing the boiler page · SB-512' } });

    expect(run.runLabel).toBe('Refreshing the boiler page · SB-512');
  });

  it('repeats until the condition holds, and stops the moment it does', async () => {
    await seed('page', [draft, reviewGroup(3)]);
    const calls = answer({ 'seo-writer': ['{"draftId": 7}', 'Revised.'], 'seo-editor': [verdict('revise', ['Thin intro']), verdict('pass')] });

    const run = await startWorkflow({ orgId: ORG, slug: 'page' });

    expect(run.status).toBe('completed');
    // draft, review r1, revise r1, review r2 (pass) — no revise in round 2.
    expect(calls.map(c => c.agentSlug)).toEqual(['seo-writer', 'seo-editor', 'seo-writer', 'seo-editor']);
    expect(calls[1]!.message).toContain('Review draft 7 (round 1).');
    expect(calls[2]!.message).toContain('Fix ["Thin intro"]');
    expect(calls[3]!.message).toContain('(round 2)');
    expect(run.stepResults.edit).toMatchObject({ status: 'completed', output: { rounds: 2, satisfied: true, exhausted: false } });
    expect(run.stepResults.review).toMatchObject({ status: 'completed', round: 2, output: { verdict: 'pass' }, label: expect.stringContaining('round 2 of 3') });
    expect(run.stepResults.review!.previous).toEqual([expect.objectContaining({ round: 1, status: 'completed', output: { verdict: 'revise', findings: ['Thin intro'] } })]);
    expect(run.stepResults.revise).toMatchObject({ status: 'completed', round: 1 });
  });

  it('after max rounds, onExhausted: continue goes on with the open findings', async () => {
    await seed('page', [draft, reviewGroup(2), { name: 'note', type: 'action', action: 'log', input: { open: '{{steps.review.output.findings}}', rounds: '{{steps.edit.output.rounds}}' } }]);
    answer({ 'seo-writer': ['{"draftId": 7}', 'r1', 'r2'], 'seo-editor': [verdict('revise', ['a']), verdict('revise', ['b'])] });

    const run = await startWorkflow({ orgId: ORG, slug: 'page' });

    expect(run.status).toBe('completed');
    expect(run.stepResults.edit).toMatchObject({ output: { rounds: 2, satisfied: false, exhausted: true }, label: 'Editor review · all 2 rounds ran' });
    expect((run.stepResults.note!.output as { input: Record<string, unknown> }).input).toEqual({ open: ['b'], rounds: 2 });
  });

  it('after max rounds, onExhausted: fail fails the run and says why', async () => {
    await seed('page', [draft, reviewGroup(1, 'fail'), { name: 'never', type: 'action', action: 'log', input: {} }]);
    answer({ 'seo-writer': ['{"draftId": 7}', 'r1'], 'seo-editor': [verdict('revise')] });

    const run = await startWorkflow({ orgId: ORG, slug: 'page' });

    expect(run.status).toBe('failed');
    expect(run.error).toMatch(/1 round ran and .* never held/);
    expect(run.stepResults.edit?.status).toBe('failed');
    expect(run.stepResults.never).toBeUndefined();
  });

  it('a failing step inside a group fails the group and the run', async () => {
    await seed('page', [draft, reviewGroup(3)]);
    answer({ 'seo-writer': ['{"draftId": 7}'], 'seo-editor': ['no json', 'still none'] });

    const run = await startWorkflow({ orgId: ORG, slug: 'page' });

    expect(run.status).toBe('failed');
    expect(run.stepResults.review).toMatchObject({ status: 'failed', agent: { attempts: [expect.objectContaining({ ok: false }), expect.objectContaining({ ok: false })] } });
    expect(run.stepResults.edit?.status).toBe('failed');
    expect(run.error).toMatch(/after 2 tries/);
  });

  it('skips a step whose when is false, and runs it when true', async () => {
    const steps = [{ name: 'publish', type: 'action', action: 'crm.note_publish', when: '{{input.target}} != \'none\'', input: { page: '{{input.page_id}}' } }, { name: 'after', type: 'action', action: 'log', input: {} }];
    await seed('page', steps);

    const skipped = await startWorkflow({ orgId: ORG, slug: 'page', input: { target: 'none', page_id: 4 } });

    expect(skipped.status).toBe('completed');
    expect(skipped.stepResults.publish).toMatchObject({ status: 'skipped', skippedBecause: '{{input.target}} != \'none\'' });
    expect(skipped.stepResults.after?.status).toBe('completed');

    const ran = await startWorkflow({ orgId: ORG, slug: 'page', input: { target: 'squarespace', page_id: 4 } });

    expect(ran.stepResults.publish?.status).toBe('completed');
  });

  it('a step a restart interrupted runs again, and says so', async () => {
    const workflowId = await seed('page', [{ name: 'first', type: 'action', action: 'log', input: {} }, draft]);
    // The process stopped while `draft` ran: its row says running, the cursor is on it.
    const [run] = await db.insert(workflowRunSchema).values({
      orgId: ORG,
      workflowId,
      status: 'running',
      currentStep: 1,
      stepResults: {
        first: { status: 'completed', output: { ok: true } },
        draft: { status: 'running', label: 'Write page', startedAt: '2026-10-29T10:00:00.000Z', attempt: 1 },
      },
    }).returning();
    const calls = answer({ 'seo-writer': ['{"draftId": 9}'] });

    const after = await advanceWorkflowRun(run!.id);

    expect(after.status).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(after.stepResults.first).toEqual({ status: 'completed', output: { ok: true } });
    expect(after.stepResults.draft).toMatchObject({ status: 'completed', attempt: 2, startedAt: '2026-10-29T10:00:00.000Z', output: { draftId: 9 } });
  });

  it('a step interrupted three times fails rather than loop', async () => {
    const workflowId = await seed('page', [draft]);
    const [run] = await db.insert(workflowRunSchema).values({ orgId: ORG, workflowId, status: 'running', currentStep: 0, stepResults: { draft: { status: 'running', attempt: 3 } } }).returning();
    answer({});

    const after = await advanceWorkflowRun(run!.id);

    expect(after.status).toBe('failed');
    expect(after.error).toMatch(/interrupted 3 times/);
    expect(turn).not.toHaveBeenCalled();
  });

  it('a repeat group picks up at its round and step after a restart', async () => {
    const workflowId = await seed('page', [draft, reviewGroup(3)]);
    const [run] = await db.insert(workflowRunSchema).values({
      orgId: ORG,
      workflowId,
      status: 'running',
      currentStep: 1,
      stepResults: {
        draft: { status: 'completed', output: { draftId: 7 } },
        edit: { status: 'running', repeat: { round: 2, max: 3, next: 0 } },
        review: { status: 'completed', round: 1, output: { verdict: 'revise', findings: ['a'] } },
        revise: { status: 'completed', round: 1, output: 'r1' },
      },
    }).returning();
    const calls = answer({ 'seo-editor': [verdict('pass')] });

    const after = await advanceWorkflowRun(run!.id);

    expect(after.status).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.message).toContain('(round 2)');
    expect(after.stepResults.edit).toMatchObject({ output: { rounds: 2, satisfied: true } });
  });

  it('a run cancelled while a step runs stops there', async () => {
    await seed('page', [draft, { name: 'after', type: 'agent', agent: 'seo-writer', task: 'More.' }]);
    let runId = 0;
    turn.mockImplementation(async (req) => {
      runId = req.runId;
      await cancelWorkflow(req.runId, ORG, 'Stopped by a person');
      return { text: '{"draftId": 1}', traceId: 't', toolCalls: 0 };
    });

    const run = await startWorkflow({ orgId: ORG, slug: 'page' });

    expect(run.id).toBe(runId);
    expect(run.status).toBe('cancelled');
    expect(turn).toHaveBeenCalledTimes(1);
  });

  it('fans out: one child run per item, each named by its own input', async () => {
    await seed('page', [{ name: 'only', type: 'action', action: 'log', input: { id: '{{input.id}}' } }], { runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}' });
    await seed('batch', [{ name: 'pages', type: 'action', action: 'workflow.start', input: { workflow: 'page', items: '{{input.pages}}', input: { batch_ref: '{{input.batch_ref}}' } } }]);

    const parent = await startWorkflow({ orgId: ORG, slug: 'batch', input: { batch_ref: 'SB-512', pages: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] } });

    expect(parent.status).toBe('completed');

    const out = parent.stepResults.pages!.output as { count: number; runs: Array<{ id: number; label: string }> };

    expect(out.count).toBe(3);
    expect(out.runs.map(r => r.label)).toEqual(['SB-512 · page 1 of 3', 'SB-512 · page 2 of 3', 'SB-512 · page 3 of 3']);

    const children = await db.select().from(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    const kids = children.filter(c => out.runs.some(r => r.id === c.id));

    expect(kids).toHaveLength(3);
    expect(kids.every(k => (k.triggerContext as { parentRunId?: number }).parentRunId === parent.id)).toBe(true);
    expect(kids.map(k => (k.input as { id: string }).id).sort()).toEqual(['p1', 'p2', 'p3']);
  });

  it('fan-out refuses to start itself, or more than its ceiling', async () => {
    await seed('loop', [{ name: 'again', type: 'action', action: 'workflow.start', input: { workflow: 'loop', items: [1] } }]);
    const self = await startWorkflow({ orgId: ORG, slug: 'loop' });

    expect(self.status).toBe('failed');
    expect(self.error).toMatch(/cannot start the workflow it runs in/);

    await seed('child', [{ name: 'x', type: 'action', action: 'log', input: {} }]);
    await seed('wide', [{ name: 'many', type: 'action', action: 'workflow.start', input: { workflow: 'child', items: Array.from({ length: 51 }, (_, i) => i) } }]);
    const wide = await startWorkflow({ orgId: ORG, slug: 'wide' });

    expect(wide.status).toBe('failed');
    expect(wide.error).toMatch(/at most 50/);
  });
});
