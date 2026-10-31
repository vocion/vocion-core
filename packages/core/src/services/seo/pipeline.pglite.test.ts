import type { RuntimeContext } from '@/services/agents/types';
import type { AgentTurnRequest } from '@/services/workflows/agentRunner';
/**
 * The SEO page pipeline as workflows, end to end on PGlite with the SEO app
 * installed: approving a keyword plan starts one run per released page
 * (`seo-batch` → `seo-page`); the writer drafts and the editor reviews inside
 * the run (the editor sends it back once, then passes it), filing nothing; the
 * person signs off ONCE on the run's approve step; the sign-off is recorded
 * on the page in code, bound to the words; and `site.publish_page` runs on
 * the SEO plugin's trust rule, with no second card, as an unmerged pull
 * request. A page sent back at sign-off gets its note on the page and a
 * redraft run that files the note first. The agents are stand-ins that call
 * the real SEO tools; GitHub is a fake. Every name here is fictional.
 */
import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('@/services/workflows/agentRunner', () => ({ runAgentTurn: vi.fn() }));
const opened = vi.hoisted(() => [] as Array<{ pageRecordId: number; by: string | null }>);
vi.mock('@/services/publish/sitePublish', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/services/publish/sitePublish')>();
  return {
    ...real,
    githubPreflight: vi.fn(async () => ({ file: { path: 'src/content/services/x.mdx', format: 'mdx', content: 'x' }, branch: 'vocion/seo-x', base: 'main', exists: false })),
    publishToGithub: vi.fn(async (_org: string, plan: { page: { recordId: number } }, by: string | null) => {
      opened.push({ pageRecordId: plan.page.recordId, by });
      return { repo: 'northwind-home/site', url: 'https://github.com/northwind-home/site/pull/7', number: 7, branch: 'vocion/seo-x', path: 'src/content/services/x.mdx', created: true, replaced: false };
    }),
    followPull: vi.fn(async () => true),
  };
});

const { db } = await import('@/libs/DB');
const { askSchema, projectSchema, tenantAccountSchema, workflowRunSchema, workflowSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { createDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
const { createArtifact } = await import('@/services/ArtifactService');
const { seoTools } = await import('@/services/agents/tools/seo');
const { decideAsk } = await import('@/services/AskService');
const { getSeoPage, listSeoPages, patchSeoPage } = await import('./records');
const { runAgentTurn } = await import('@/services/workflows/agentRunner');

const ORG = 'proj_seo_pipeline_northwind';
const PERSON = 'usr-pipeline-dana';
let clientProjectId = 0;
const SITE = { id: 'site', kind: 'github', label: 'Website', config: { repo: 'northwind-home/site', path: 'src/content/services/{slug}.mdx' } };
const turn = vi.mocked(runAgentTurn);

const ctx = (userId: string, agentSlug: string, over: Partial<RuntimeContext> = {}) => ({ orgId: ORG, userId, agentSlug, connectorSources: [], searchConfig: {}, harnessConfig: { model: 'claude-opus-5-5' }, enabledPlugins: ['data-rooms', 'wiki', 'seo'], emit: () => {}, ...over }) as unknown as RuntimeContext;
async function tool(c: RuntimeContext, name: string, args: Record<string, unknown>): Promise<string> {
  const t = seoTools(c).find(x => x.name === name)! as unknown as { invoke: (a: Record<string, unknown>) => Promise<unknown> };
  return String(await t.invoke(args));
}
const pageOf = (req: AgentTurnRequest) => Number(/page (\d+)/.exec(req.message)?.[1] ?? /page #?(\d+)/i.exec(req.message)?.[1]);

/**
 * The stand-in agents: the writer saves a draft with the real tool, the
 * editor reviews with the real tool (one send-back on each page's first
 * draft), and the strategist files the person's note.
 */
function standIns() {
  const reviews = new Map<number, number>();
  turn.mockImplementation(async (req) => {
    const pageId = pageOf(req);
    const c = ctx(req.userId, req.agentSlug);
    if (req.agentSlug === 'seo-writer') {
      const { artifact } = await createArtifact({ orgId: ORG, kind: 'markdown', title: `Draft ${pageId}`, spec: { md: `# Page ${pageId}\n\nWords, written ${Date.now()}.` }, folder: 'seo/drafts', author: { kind: 'agent', id: 'agent:seo-writer' } });
      const out = await tool(c, 'seo_save_draft', { page_id: pageId, draft_artifact_id: artifact.id, meta_title: `Boiler repair ${pageId} | Northwind`, meta_description: 'Same-day boiler repair from Northwind Home Services.', slug: `boiler-repair-${pageId}` });
      return { text: `${out}\n\`\`\`json\n{"draftArtifactId": ${artifact.id}}\n\`\`\``, traceId: 't', toolCalls: 1 };
    }
    if (req.agentSlug === 'seo-editor') {
      const n = (reviews.get(pageId) ?? 0) + 1;
      reviews.set(pageId, n);
      const verdict = n === 1 ? 'fix' : 'pass';
      const out = await tool(c, 'seo_save_review', { page_id: pageId, verdict, findings: verdict === 'fix' ? [{ issue: 'No local proof', fix: 'Add a Riverton job.' }] : [], notes: 'Checked.' });
      const final = /"final": true/.test(out);
      return { text: `${out}\n\`\`\`json\n{"verdict": "${verdict}", "final": ${final}, "findings": ${verdict === 'fix' ? '["No local proof"]' : '[]'}}\n\`\`\``, traceId: 't', toolCalls: 1 };
    }
    if (req.agentSlug === 'seo-strategist') {
      const page = await getSeoPage(ORG, pageId);
      const note = page?.meta.feedback?.at(-1);
      return { text: `Filed: ${note?.note ?? 'nothing'}\n\`\`\`json\n{"filed": true}\n\`\`\``, traceId: 't', toolCalls: 1 };
    }
    throw new Error(`no stand-in for ${req.agentSlug}`);
  });
}

async function runsOf(slug: string) {
  return db.select({ id: workflowRunSchema.id, status: workflowRunSchema.status, pauseReason: workflowRunSchema.pauseReason, input: workflowRunSchema.input, error: workflowRunSchema.error }).from(workflowRunSchema).innerJoin(workflowSchema, eq(workflowSchema.id, workflowRunSchema.workflowId)).where(and(eq(workflowRunSchema.orgId, ORG), eq(workflowSchema.slug, slug)));
}

async function until<T>(read: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  let v = await read();
  for (let i = 0; i < 400 && !ok(v); i++) {
    await new Promise(r => setTimeout(r, 20));
    v = await read();
  }
  return v;
}

let batchId = 0;
let pages: Array<{ id: number }> = [];

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-pipeline', name: 'Brightline Studio', slug: 'brightline-pipeline' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-pipeline', slug: 'brightline-pipeline', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });

  expect((await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:dana' })).errors).toEqual([]);

  const projectId = (await createDataRoom(ORG, PERSON, { title: 'Northwind Home Services', domains: ['northwind-home.example'] })).id;
  clientProjectId = projectId;
  await updateDataRoom(ORG, projectId, { publishTargets: [SITE as never], seoGate: { sample: 2, tranche: 10 } });
  standIns();
  const out = await tool(ctx(PERSON, 'seo-strategist', { conversationId: undefined }), 'seo_plan_batch', { project_id: projectId, topic: 'Boiler repair', pages: [{ keyword: 'boiler servicing', page_type: 'service' }, { keyword: 'boiler pressure', page_type: 'blog' }] });
  batchId = Number(/batch #(\d+)/.exec(out)![1]);
  pages = await listSeoPages(ORG, batchId);
  // Research and brief are each the step before: given here, so the runs start at the draft.
  for (const p of pages) {
    const { artifact: serp } = await createArtifact({ orgId: ORG, kind: 'markdown', title: 'SERP', spec: { md: 'serp' }, author: { kind: 'agent', id: 'agent:serp-analyst' } });
    const { artifact: brief } = await createArtifact({ orgId: ORG, kind: 'markdown', title: 'Brief', spec: { md: 'brief' }, author: { kind: 'agent', id: 'agent:seo-strategist' } });
    await patchSeoPage(ORG, p as never, { serpArtifactId: serp.id, briefArtifactId: brief.id, status: 'briefed' });
  }
});

describe('the SEO page pipeline, as workflows', () => {
  it('approving the plan starts one run per released page; each drafts, is reviewed in the run and waits on the person\'s one sign-off', async () => {
    const [plan] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), like(askSchema.sourceRef, `seo-plan:${batchId}:%`)));
    await decideAsk({ orgId: ORG, id: plan!.id, decision: 'approve', decidedBy: PERSON, via: 'card' });

    const waiting = await until(() => runsOf('seo-page'), rs => rs.length === 2 && rs.every(r => r.pauseReason === 'awaiting_approval:signoff'));

    expect(waiting.map(r => r.pauseReason)).toEqual(['awaiting_approval:signoff', 'awaiting_approval:signoff']);
    expect((await runsOf('seo-batch')).length).toBe(1);

    // The editor sent each back once and passed the revision; no SEO sign-off card was filed: the run's step is the sign-off.
    for (const p of pages) {
      const page = (await getSeoPage(ORG, p.id))!;

      expect(page.meta.status).toBe('in_review');
      expect(page.meta.signoffAsk?.askId).toBe(0);
    }

    expect(await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), like(askSchema.sourceRef, 'seo-page:%')))).toEqual([]);
  });

  it('a sign-off approves the page once: recorded on the page, bound to the words, and published as a pull request with no second card', async () => {
    const [run] = (await runsOf('seo-page')).filter(r => Number((r.input as { page_id: number }).page_id) === pages[0]!.id);
    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `workflow-run:${run!.id}:signoff`)));
    await decideAsk({ orgId: ORG, id: ask!.id, decision: 'approve', decidedBy: PERSON, via: 'card' });

    const done = await until(async () => (await runsOf('seo-page')).find(r => r.id === run!.id)!, r => r.status !== 'running' && r.status !== 'paused');

    expect({ status: done.status, pauseReason: done.pauseReason, error: done.error }).toEqual({ status: 'completed', pauseReason: null, error: null });

    const page = (await getSeoPage(ORG, pages[0]!.id))!;

    expect(page.meta.signoff).toMatchObject({ decision: 'approve', by: PERSON, hash: page.meta.signoffAsk?.hash });
    // Run on the plugin's trust rule after the person's sign-off: no reviewer, no second card.
    expect(opened).toEqual([{ pageRecordId: pages[0]!.id, by: null }]);
    expect(await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.status, 'open'), like(askSchema.title, '%Publish%')))).toEqual([]);
    expect(page.meta.status).toBe('publishing');
  });

  it('a sign-off sent back puts the note on the page and starts its redraft run, which files the note first', async () => {
    const [run] = (await runsOf('seo-page')).filter(r => Number((r.input as { page_id: number }).page_id) === pages[1]!.id);
    const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `workflow-run:${run!.id}:signoff`)));
    await decideAsk({ orgId: ORG, id: ask!.id, decision: 'reject', note: 'Say what a pressure drop costs.', decidedBy: PERSON, via: 'card' });

    const redraft = await until(async () => (await runsOf('seo-page')).find(r => (r.input as { reason?: string }).reason === 'redraft'), r => Boolean(r));

    expect(redraft?.input).toMatchObject({ page_id: pages[1]!.id, reason: 'redraft' });

    const page = (await getSeoPage(ORG, pages[1]!.id))!;

    expect(page.meta.feedback?.at(-1)).toMatchObject({ note: 'Say what a pressure drop costs.', by: PERSON });

    const calls = turn.mock.calls.map(c => c[0]).filter(r => r.runId === redraft!.id);
    await until(async () => turn.mock.calls.filter(c => c[0].runId === redraft!.id).length, n => n > 0);

    expect([...calls, ...turn.mock.calls.map(c => c[0]).filter(r => r.runId === redraft!.id)][0]?.agentSlug).toBe('seo-strategist');
  });
});

it('does not turn completed drafting runs, unmerged publication or rejected content into roadmap delivery', async () => {
  const { upsertStrategy } = await import('./strategy');
  const { readSeoRoadmap } = await import('./roadmap');
  await upsertStrategy(ORG, { id: clientProjectId, title: 'Northwind Home Services' }, { roadmap: { revision: 0, outcomes: [], initiatives: pages.map((p, i) => ({ id: `page-${p.id}`, label: i ? 'Rejected page' : 'Unmerged publication', lane: 'now', dependsOn: [], acceptanceCriteria: 'Approved content live', recordIds: [p.id], evidence: [], status: 'in_progress' })) } } as never, PERSON);
  const delivery = await readSeoRoadmap(ORG, clientProjectId, PERSON);

  expect(delivery.roadmap.initiatives).toHaveLength(2);
  expect(delivery.roadmap.initiatives.every(i => i.status !== 'done')).toBe(true);
  expect(delivery.roadmap.outcomes).toEqual([]);
  expect(opened).toHaveLength(1);
});

it('keeps delivery incomplete when the external publisher fails after human sign-off', async () => {
  const { publishToGithub } = await import('@/services/publish/sitePublish');
  const { readSeoRoadmap } = await import('./roadmap');
  const redraft = await until(async () => (await runsOf('seo-page')).find(r => (r.input as { reason?: string }).reason === 'redraft'), r => r?.pauseReason === 'awaiting_approval:signoff');

  expect(redraft?.pauseReason).toBe('awaiting_approval:signoff');

  vi.mocked(publishToGithub).mockRejectedValueOnce(new Error('Publisher temporarily unavailable'));
  const [ask] = await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), eq(askSchema.sourceRef, `workflow-run:${redraft!.id}:signoff`)));
  await decideAsk({ orgId: ORG, id: ask!.id, decision: 'approve', decidedBy: PERSON, via: 'card' });
  await until(async () => (await runsOf('seo-page')).find(r => r.id === redraft!.id)!, r => r.status !== 'running' && r.status !== 'paused');
  const page = (await getSeoPage(ORG, pages[1]!.id))!;
  const delivery = await readSeoRoadmap(ORG, clientProjectId, PERSON);

  expect(page.meta.status).not.toBe('published');
  expect(page.meta.pullRequestUrl).toBeFalsy();
  expect(delivery.roadmap.initiatives.find(i => i.recordIds.includes(page.id))?.status).not.toBe('done');
  expect(opened).toHaveLength(1);
});

it('tracks real project task decisions without treating dropped work as completion or fixing an audit', async () => {
  const { addOpenItem } = await import('@/services/DataRoomService');
  const { upsertStrategy } = await import('./strategy');
  const { readSeoRoadmap } = await import('./roadmap');
  const { fileAudit, getAudit } = await import('./audits');
  const audit = (await fileAudit(ORG, { project: { id: clientProjectId, title: 'Northwind Home Services' }, site: 'https://northwind-home.example', checkedAt: '2026-10-30T10:00:00.000Z', pagesRead: 1, by: PERSON, findings: [{ key: 'canonical_elsewhere', check: 'canonical_elsewhere', title: 'Canonical mismatch', category: 'technical', severity: 'high', evidence: 'Canonical points elsewhere', checkedAt: '2026-10-30T10:00:00.000Z', status: 'open' }] }))!.audit;
  const done = await addOpenItem(ORG, clientProjectId, { title: 'Implement canonical correction' }, PERSON);
  const dropped = await addOpenItem(ORG, clientProjectId, { title: 'Obsolete implementation task' }, PERSON);
  const otherClient = await createDataRoom(ORG, PERSON, { title: 'Unrelated client', domains: ['unrelated.example'] });
  const foreign = await addOpenItem(ORG, otherClient.id, { title: 'Other client private task' }, PERSON);
  const base = { lane: 'now' as const, dependsOn: [], acceptanceCriteria: 'Implementation task done; audit recheck remains separate', recordIds: [], evidence: [], status: 'in_progress' as const };
  await upsertStrategy(ORG, { id: clientProjectId, title: 'Northwind Home Services' }, { roadmap: { revision: 1, outcomes: [], initiatives: [{ ...base, id: 'implement', label: 'Implement correction', taskIds: [done.id] }, { ...base, id: 'obsolete', label: 'Old task', taskIds: [dropped.id] }] } } as never, PERSON);
  const before = await readSeoRoadmap(ORG, clientProjectId, PERSON);

  expect(before.roadmap.initiatives.every(i => i.status !== 'done')).toBe(true);
  expect(before.availableTasks.some(t => t.id === foreign.id)).toBe(false);

  await decideAsk({ orgId: ORG, id: done.id, decision: 'done', decidedBy: PERSON, via: 'card' });
  await decideAsk({ orgId: ORG, id: dropped.id, decision: 'drop', decidedBy: PERSON, via: 'card' });
  const after = await readSeoRoadmap(ORG, clientProjectId, PERSON);

  expect(after.roadmap.initiatives.find(i => i.id === 'implement')?.status).toBe('done');
  expect(after.roadmap.initiatives.find(i => i.id === 'obsolete')?.status).not.toBe('done');
  expect(after.linkedTasks.find(t => t.id === dropped.id)?.status).toBe('answered');
  expect((await getAudit(ORG, audit.id))?.meta.findings[0]?.status).toBe('open');
  expect(after.roadmap.outcomes).toEqual([]);
});
