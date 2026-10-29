/**
 * The workflows guide's worked SEO page pipeline, run end to end on the test
 * database exactly as the guide writes it: research, draft, the editor's
 * bounded review, a person's sign-off, and `site.publish_page` — the real
 * action, proposed by the step, held on its own card (it publishes outside),
 * approved, and executed against a GitHub that is a fake. The agents are
 * stand-ins. Every name here is fictional (Northwind Home Services, SB-512).
 */
import type { AgentTurnRequest } from './agentRunner';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('./agentRunner', () => ({ runAgentTurn: vi.fn() }));

// The target: GitHub is a fake that records the pull request it was asked to open.
const opened = vi.hoisted(() => [] as Array<{ repo: string; title: string; branch: string; files: Array<{ path: string; content: string }> }>);
vi.mock('@/services/factory/githubChange', () => ({
  PAGE_BRANCH_PREFIX: 'vocion/seo-',
  defaultBranch: vi.fn(async () => 'main'),
  discardChange: vi.fn(async () => ({ closed: true, branchDeleted: true, revertUrl: null, state: 'closed' })),
  openChangePull: vi.fn(async (_org: string, o: { repo: string; title: string; branch: string; files: Array<{ path: string; content: string }> }) => {
    opened.push(o);
    return { repo: o.repo, url: `https://github.com/${o.repo}/pull/41`, number: 41, branch: o.branch, base: 'main', headSha: 'abc123', created: true, paths: o.files.map(f => f.path) };
  }),
}));
vi.mock('@/services/factory/githubChecks', () => ({ ghFor: vi.fn(async () => ({})), call: vi.fn(async () => ({ ok: false, status: 404 })) }));

// The page's plan (its record, project, target and draft) is read from the SEO app's records; here it is given.
vi.mock('@/services/publish/sitePublish', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/publish/sitePublish')>();
  const { publishTargetSchema } = await import('@/libs/publish/targets');
  const plan = {
    project: { id: 7, title: 'Northwind Home Services' },
    target: publishTargetSchema.parse({ id: 'site', kind: 'github', label: 'Northwind site', config: { repo: 'northwind-home/site', path: 'src/content/blog/{slug}.md' } }),
    page: { recordId: 88, title: 'Boiler repair in Larkfield', description: 'What a boiler repair costs in Larkfield, how long it takes, and when to replace instead.', slug: 'boiler-repair-larkfield', keyword: 'boiler repair', at: new Date('2026-10-29T12:00:00Z'), descriptionFrom: 'given', refresh: false, publishedUrl: null, existingUrl: null, draftUrl: null },
    draft: { artifactId: 31, title: 'Boiler repair in Larkfield', version: 3, markdown: '# Boiler repair in Larkfield\n\nWhat it costs and how long it takes.' },
    before: null,
  };
  return {
    ...real,
    planPublish: vi.fn(async () => ({ ok: true, plan })),
    recordOnPage: vi.fn(async () => {}),
    followPull: vi.fn(async () => true),
  };
});

const { db } = await import('@/libs/DB');
const { actionRunSchema, askSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { WorkflowManifestSchema } = await import('@/libs/workspace/schemas');
const { decideAsk, getAskBySourceRef } = await import('@/services/AskService');
const { decide } = await import('@/services/ReviewService');
const { getWorkflowRun, startWorkflow } = await import('@/services/WorkflowService');
const { runAgentTurn } = await import('./agentRunner');

const ORG = 'proj_seo_example_northwind';
const PERSON = 'usr-seo-example-dana';
const turn = vi.mocked(runAgentTurn);

/** The guide's `seo-page` workflow, as the loader reads it. */
function guideWorkflow() {
  const guide = readFileSync(join(import.meta.dirname, '../../../../../docs/guides/workflows.md'), 'utf8');
  const block = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(m => parseYaml(m[1]!) as { slug?: string }).find(y => y?.slug === 'seo-page');
  return WorkflowManifestSchema.parse(block);
}

/**
 * The agents' replies, in order, per agent.
 * @param replies - Replies per agent slug.
 */
function agents(replies: Record<string, string[]>): AgentTurnRequest[] {
  const calls: AgentTurnRequest[] = [];
  turn.mockImplementation(async (req) => {
    calls.push(req);
    const text = replies[req.agentSlug]?.shift();
    if (text === undefined) {
      throw new Error(`no reply for ${req.agentSlug}`);
    }
    return { text, traceId: `trace-${calls.length}`, toolCalls: 2, model: 'claude-sonnet-4-6', effort: 'standard', microCents: 3_000_000 };
  });
  return calls;
}

/**
 * Wait for a run to reach a status: an answer moves it after the decision returns.
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

describe('the workflows guide\'s SEO page pipeline, end to end', () => {
  afterEach(async () => {
    await new Promise(r => setTimeout(r, 50));
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    await db.delete(askSchema).where(eq(askSchema.orgId, ORG));
    await db.delete(workflowRunSchema).where(eq(workflowRunSchema.orgId, ORG));
    await db.delete(workflowSchema).where(eq(workflowSchema.orgId, ORG));
    opened.length = 0;
    turn.mockReset();
  });

  it('researches, drafts, reviews until it passes, is signed off, and publishes through the real action once its card is approved', async () => {
    const wf = guideWorkflow();
    await db.insert(workflowSchema).values({ orgId: ORG, slug: wf.slug, name: wf.name, status: 'active', trigger: wf.trigger, steps: wf.steps as never, ownerAgentSlug: wf.agent, runLabel: wf.runLabel });
    const calls = agents({
      'serp-analyst': ['Saved the brief.\n```json\n{"briefArtifactId": 30, "summary": "Top results are local service pages with prices."}\n```'],
      'seo-writer': ['```json\n{"draftArtifactId": 31}\n```', 'Revised: added local proof. Saved v3.'],
      'seo-editor': ['```json\n{"verdict":"revise","findings":["No local proof"]}\n```', '```json\n{"verdict":"pass","findings":[]}\n```'],
    });

    const atSignoff = await startWorkflow({ orgId: ORG, slug: 'seo-page', input: { page_id: 88, keyword: 'boiler repair', location: 'Larkfield', client: 'Northwind Home Services', batch_ref: 'SB-512', index: 2, total: 3, publish_target: 'github' } });

    expect(calls.map(c => c.agentSlug)).toEqual(['serp-analyst', 'seo-writer', 'seo-editor', 'seo-writer', 'seo-editor']);
    expect(atSignoff.runLabel).toBe('SB-512 · page 2 of 3: boiler repair');
    expect(atSignoff.pauseReason).toBe('awaiting_approval:signoff');
    expect(atSignoff.stepResults.edit).toMatchObject({ output: { rounds: 2, satisfied: true } });

    // A person signs the page off on its Decision.
    const signoff = await getAskBySourceRef(ORG, `workflow-run:${atSignoff.id}:signoff`);
    await decideAsk({ orgId: ORG, id: signoff!.id, decision: 'approve', decidedBy: PERSON, via: 'card' });
    // The run moves after the decision returns, to its next stop.
    for (let i = 0; i < 200 && (await getWorkflowRun(atSignoff.id, ORG))?.pauseReason !== 'awaiting_action:publish'; i++) {
      await new Promise(r => setTimeout(r, 15));
    }
    const waiting = await getWorkflowRun(atSignoff.id, ORG);

    // Publishing goes outside: the real action is proposed and held on its own card, whatever the sign-off said.
    expect(waiting?.status).toBe('paused');
    expect(waiting?.pauseReason).toBe('awaiting_action:publish');
    expect(opened).toEqual([]);

    const cardId = (waiting!.stepResults.publish!.output as { actionRunId: number }).actionRunId;
    const [card] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, cardId));

    expect(card).toMatchObject({ actionId: 'site.publish_page', status: 'pending', input: { pageRecordId: 88 } });
    expect((card!.proposal as { title?: string }).title).toBe('Publish "Boiler repair in Larkfield" → Northwind site');

    // A person approves the publish card: the action runs against the target.
    await decide({ kind: 'action', id: cardId }, 'approve', ORG, { reviewedBy: PERSON });
    const done = await until(atSignoff.id, 'completed');

    expect(done?.status).toBe('completed');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ repo: 'northwind-home/site', title: 'Add page: Boiler repair in Larkfield', branch: 'vocion/seo-boiler-repair-larkfield-p88' });
    expect(opened[0]!.files[0]!.path).toBe('src/content/blog/boiler-repair-larkfield.md');
    expect(done?.stepResults.publish).toMatchObject({
      status: 'completed',
      output: { ok: true, status: 'done', action: 'site.publish_page', result: { kind: 'github', url: 'https://github.com/northwind-home/site/pull/41', published: false } },
    });
  });

  it('with no publish target the publish step is skipped and nothing is proposed', async () => {
    const wf = guideWorkflow();
    await db.insert(workflowSchema).values({ orgId: ORG, slug: wf.slug, name: wf.name, status: 'active', trigger: wf.trigger, steps: wf.steps as never, ownerAgentSlug: wf.agent });
    agents({ 'serp-analyst': ['{"briefArtifactId": 30, "summary": "s"}'], 'seo-writer': ['{"draftArtifactId": 31}'], 'seo-editor': ['{"verdict":"pass","findings":[]}'] });

    const paused = await startWorkflow({ orgId: ORG, slug: 'seo-page', input: { page_id: 89, keyword: 'boiler service', batch_ref: 'SB-512', publish_target: 'none' } });
    const signoff = await getAskBySourceRef(ORG, `workflow-run:${paused.id}:signoff`);
    await decideAsk({ orgId: ORG, id: signoff!.id, decision: 'approve', decidedBy: PERSON, via: 'card' });
    const done = await until(paused.id, 'completed');

    expect(done?.stepResults.publish?.status).toBe('skipped');
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG))).toEqual([]);
    expect(opened).toEqual([]);
  });
});
