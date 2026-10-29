/**
 * A four-step workflow end to end on the test database (ADR 0011): an agent
 * researches, a bounded repeat has the editor review until it passes, a
 * person signs off on a Decision, and an action step records a note (an id
 * no action is registered under; the real publish is `seoExample.pglite.test.ts`).
 * The agents are stand-ins; everything else is real — the durable run, the ask,
 * the decision path, the run's labels. Every name here is fictional.
 */
import type { AgentTurnRequest } from './agentRunner';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('./agentRunner', () => ({ runAgentTurn: vi.fn() }));

const { db } = await import('@/libs/DB');
const { askSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { decideAsk, getAskBySourceRef } = await import('@/services/AskService');
const { activityFeed } = await import('@/services/ActivityService');
const { getWorkflowRun, startWorkflow } = await import('@/services/WorkflowService');
const { runAgentTurn } = await import('./agentRunner');

const ORG = 'proj_pipeline_northwind';
const PERSON = 'usr-pipeline-dana';
const turn = vi.mocked(runAgentTurn);

const PIPELINE = [
  {
    name: 'research',
    type: 'agent',
    label: 'Researching Google\'s top results for "{{input.keyword}}"',
    agent: 'serp-analyst',
    task: 'Research Google\'s top results for page {{input.page_id}} and save the SERP brief.',
    effort: 'standard',
    output: { type: 'object', required: ['briefArtifactId'], properties: { briefArtifactId: { type: 'integer' } } },
  },
  {
    name: 'edit',
    type: 'repeat',
    label: 'Editor review',
    until: '{{steps.review.output.verdict}} == \'pass\'',
    max: 3,
    onExhausted: 'continue',
    steps: [
      {
        name: 'review',
        type: 'agent',
        agent: 'seo-editor',
        task: 'Review the page built on brief {{steps.research.output.briefArtifactId}}.',
        output: { type: 'object', required: ['verdict', 'findings'], properties: { verdict: { enum: ['pass', 'revise'] }, findings: { type: 'array', items: { type: 'string' } } } },
      },
    ],
  },
  { name: 'signoff', type: 'approve', label: 'Sign off the page', prompt: 'Sign off "{{input.keyword}}" for Northwind Home Services.', reviews: 'review' },
  { name: 'publish', type: 'action', action: 'crm.note_publish', when: '{{input.target}} != \'none\'', input: { pageRecordId: '{{input.page_id}}', note: '{{steps.signoff.output.note}}' } },
];

/**
 * Replies per agent, in order.
 * @param replies
 */
function agents(replies: Record<string, string[]>): AgentTurnRequest[] {
  const calls: AgentTurnRequest[] = [];
  turn.mockImplementation(async (req) => {
    calls.push(req);
    const text = replies[req.agentSlug]?.shift();
    if (text === undefined) {
      throw new Error(`no reply for ${req.agentSlug}`);
    }
    return { text, traceId: `trace-${calls.length}`, toolCalls: 1, model: 'claude-sonnet-4-6', effort: 'standard', microCents: 2_000_000 };
  });
  return calls;
}

/**
 * Wait for a run to reach a status: the answer moves it on its own.
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

describe('an SEO page pipeline as a workflow', () => {
  afterEach(async () => {
    // An answer moves its run after the decision returns; let that settle first.
    await new Promise(r => setTimeout(r, 50));
    await db.delete(askSchema).where(eq(askSchema.orgId, ORG));
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    turn.mockReset();
  });

  it('researches, reviews until it passes, waits on a sign-off, and publishes once approved', async () => {
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'seo-page', name: 'Write one SEO page', status: 'active', trigger: { type: 'manual' }, steps: PIPELINE, ownerAgentSlug: 'seo-strategist', runLabel: '{{input.batch_ref}} · page {{input.index}} of {{input.total}}' });
    const calls = agents({
      'serp-analyst': ['Saved the brief.\n```json\n{"briefArtifactId": 31}\n```'],
      'seo-editor': ['```json\n{"verdict":"revise","findings":["No local proof"]}\n```', '```json\n{"verdict":"pass","findings":[]}\n```'],
    });

    const paused = await startWorkflow({ orgId: ORG, slug: 'seo-page', input: { page_id: 88, keyword: 'boiler repair', batch_ref: 'SB-512', index: 2, total: 3, target: 'squarespace' } });

    // Research, then the editor twice: round 1 asked for changes, round 2 passed.
    expect(calls.map(c => c.agentSlug)).toEqual(['serp-analyst', 'seo-editor', 'seo-editor']);
    expect(calls[1]!.message).toContain('brief 31');
    expect(paused.status).toBe('paused');
    expect(paused.pauseReason).toBe('awaiting_approval:signoff');
    expect(paused.runLabel).toBe('SB-512 · page 2 of 3');
    expect(paused.stepResults.edit).toMatchObject({ status: 'completed', output: { rounds: 2, satisfied: true } });

    // The gate is one Decision, about this run, carrying what it reviews.
    const ask = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:signoff`);

    expect(ask).toMatchObject({ kind: 'approval', status: 'open', title: 'Sign off the page · SB-512 · page 2 of 3', agentSlug: 'seo-strategist', body: 'Sign off "boiler repair" for Northwind Home Services.' });
    expect(ask!.contextMd).toContain('**verdict:** pass');
    expect(paused.stepResults.signoff).toMatchObject({ status: 'awaiting_approval', askId: ask!.id });

    // Activity names the run and the step it waits on.
    const feed = await activityFeed(ORG, { kind: 'workflow' });

    expect(feed.find(i => i.key === `workflow-${paused.id}`)).toMatchObject({ title: 'SB-512 · page 2 of 3', detail: 'Sign off the page' });

    // A person approves it, in their own words, through the one decision path.
    await decideAsk({ orgId: ORG, id: ask!.id, decision: 'approve', note: 'Ship it after the hours check.', decidedBy: PERSON, via: 'chat' });
    const done = await until(paused.id, 'completed');

    expect(done?.status).toBe('completed');
    expect(done?.stepResults.signoff).toMatchObject({ status: 'completed', output: { approved: true, approvedBy: PERSON, note: 'Ship it after the hours check.', via: 'chat' } });
    expect(done?.stepResults.publish).toMatchObject({ status: 'completed', output: { input: { pageRecordId: 88, note: 'Ship it after the hours check.' }, envelope: { action: 'crm.note_publish' } } });
  });

  it('a rejected sign-off stops the run with the reason, and nothing publishes', async () => {
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'seo-page', name: 'Write one SEO page', status: 'active', trigger: { type: 'manual' }, steps: PIPELINE });
    agents({ 'serp-analyst': ['{"briefArtifactId": 31}'], 'seo-editor': ['{"verdict":"pass","findings":[]}'] });

    const paused = await startWorkflow({ orgId: ORG, slug: 'seo-page', input: { page_id: 89, keyword: 'boiler service', target: 'squarespace' } });
    const ask = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:signoff`);

    // No run label: the workflow's name and the run's number keep the title apart.
    expect(ask?.title).toBe(`Sign off the page · Write one SEO page #${paused.id}`);

    await decideAsk({ orgId: ORG, id: ask!.id, decision: 'reject', note: 'Wrong service area.', decidedBy: PERSON, via: 'card' });
    const stopped = await until(paused.id, 'cancelled');

    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.error).toBe(`${PERSON} rejected it at "signoff": Wrong service area.`);
    expect(stopped?.stepResults.publish).toBeUndefined();
  });

  it('resumed from the run page, the run closes its Decision', async () => {
    await db.insert(workflowSchema).values({ orgId: ORG, slug: 'seo-page', name: 'Write one SEO page', status: 'active', trigger: { type: 'manual' }, steps: PIPELINE });
    agents({ 'serp-analyst': ['{"briefArtifactId": 31}'], 'seo-editor': ['{"verdict":"pass","findings":[]}'] });

    const paused = await startWorkflow({ orgId: ORG, slug: 'seo-page', input: { page_id: 90, keyword: 'boiler', target: 'none' } });
    const { resumeWorkflow } = await import('@/services/WorkflowService');
    const done = await resumeWorkflow(paused.id, ORG);

    expect(done.status).toBe('completed');
    // The target is none: publish is skipped.
    expect(done.stepResults.publish?.status).toBe('skipped');

    const ask = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:signoff`);

    expect(ask?.status).toBe('superseded');
  });
});
