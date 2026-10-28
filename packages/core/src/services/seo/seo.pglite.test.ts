/**
 * The SEO app end to end on PGlite: installed on a workspace with no folder
 * (Vocion Cloud), a keyword plan signed off before anything is briefed, the
 * project's gate holding a second batch until the first sample is approved,
 * asks filed and withdrawn by code, a sign-off bound to the draft's words,
 * feedback filed where it says, and a person's settings out of an agent's
 * reach. Every client, person and site here is fictional.
 */
import type { NextRequest } from 'next/server';
import type { RuntimeContext } from '@/services/agents/types';
import type { Ask } from '@/services/AskService';
import { and, eq, like } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// The follow-up the strategist is woken by is an event; record it rather than run an agent.
const emitted = vi.hoisted(() => [] as Array<{ type: string; payload?: Record<string, unknown> }>);
vi.mock('@/services/EventService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/EventService')>();
  return { ...actual, emitEvent: vi.fn(async (input: { type: string; payload?: Record<string, unknown> }) => {
    emitted.push(input);
    return { eventId: 0, dispatched: [] };
  }) };
});
// Duplicate judging is a model call; every proposed rule is new here.
vi.mock('@/services/feedback/duplicateDetection', async importOriginal => ({
  ...await importOriginal<typeof import('@/services/feedback/duplicateDetection')>(),
  findDuplicateRule: vi.fn(async () => ({ duplicate: false, reason: 'test' })),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, askSchema, automationSchema, learningCandidateSchema, modelCallSchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { getObjectTypeBySlug } = await import('@/services/BusinessObjectService');
const { createDataRoom, getDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
const { createArtifact, updateArtifact } = await import('@/services/ArtifactService');
const { seoTools } = await import('@/services/agents/tools/seo');
const { updateProjectTool } = await import('@/services/agents/tools/projects');
const { objectsUpdateMetaAction } = await import('@/libs/actions/objects-update-meta');
const { patchProject } = await import('@/app/api/v1/projects/[id]/handlers');
const { decideCandidate } = await import('@/services/LearningCandidateService');
const { getSeoBatch, getSeoPage, listSeoPages, patchSeoPage, readSeoGate } = await import('./records');
const { onSeoAskSettled } = await import('./signoff');
const { reportSeoRun } = await import('./work');
const { renderSerpBrief, renderSynthesis, withSynthesis } = await import('@/libs/tools/serp/brief');

const ORG = 'proj_seo_brightline';
const WRITER_RUN = 501;
const EDITOR_RUN = 502;
const BACKGROUND_TOOLS = new Set(['seo_save_draft', 'seo_save_review']);
const SITE = { id: 'site', kind: 'github', label: 'Website', config: { repo: 'northwind-home/site', path: 'src/content/services/{slug}.mdx' } };
const PERSON = 'usr-seo-mara';

const ctx = (over: Partial<RuntimeContext> = {}): RuntimeContext => ({
  orgId: ORG,
  userId: PERSON,
  agentSlug: 'seo-strategist',
  conversationId: 9101,
  connectorSources: [],
  searchConfig: {},
  harnessConfig: { model: 'claude-opus-5-5' },
  enabledPlugins: ['data-rooms', 'wiki', 'seo'],
  objectTypeSlugs: ['seo_batch', 'seo_page', 'data_room'],
  emit: () => {},
  ...over,
} as RuntimeContext);

/**
 * Run one SEO tool by name.
 * @param name - The tool.
 * @param args - Its arguments.
 * @param over - Context changes.
 */
async function call(name: string, args: Record<string, unknown>, over: Partial<RuntimeContext> = {}): Promise<string> {
  // Drafting and review run in the background run, never a chat turn: give them one unless the test says otherwise.
  const run = BACKGROUND_TOOLS.has(name) && !('missionRunId' in over) ? { missionRunId: WRITER_RUN } : {};
  const t = seoTools(ctx({ ...run, ...over })).find(x => x.name === name)! as unknown as { invoke: (input: Record<string, unknown>) => Promise<unknown> };
  return String(await t.invoke(args));
}

async function markdown(title: string, folder?: string, md = `# ${title}`): Promise<number> {
  const { artifact } = await createArtifact({ orgId: ORG, kind: 'markdown', title, spec: { md }, folder: folder ?? null, author: { kind: 'agent', id: 'agent:seo-writer' } });
  return artifact.id;
}

/**
 * A SERP brief as serp_compare files it, with its synthesis written or not.
 * @param query - The keyword.
 * @param written - Whether the synthesis is in.
 */
async function serpBrief(query: string, written = true): Promise<number> {
  const synthesis = written ? '**Intent.** To find a local tradesperson today [1][2].' : '_Not written yet._';
  return markdown(`SERP brief: ${query}`, 'seo/serp', `# SERP brief: ${query}\n\n## Synthesis\n\n<!-- serp-synthesis -->\n${synthesis}\n<!-- /serp-synthesis -->\n`);
}

/**
 * The asks filed with a source ref starting so, oldest first.
 * @param prefix - The start of the ref.
 */
async function asksLike(prefix: string): Promise<Ask[]> {
  return (await db.select().from(askSchema).where(and(eq(askSchema.orgId, ORG), like(askSchema.sourceRef, `${prefix}%`)))).sort((a, b) => a.id - b.id);
}

/**
 * A person answers an ask, as `AskService` hands it over once decided.
 * @param ask - The open ask.
 * @param decision - approve | reject | other.
 * @param note - What they wrote.
 */
async function answer(ask: Ask, decision: string, note: string | null = null): Promise<Ask> {
  const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'done';
  const [row] = await db.update(askSchema).set({ status, decision, decisionNote: note, decidedBy: PERSON, decidedAt: new Date() }).where(eq(askSchema.id, ask.id)).returning();
  await onSeoAskSettled(row!);
  return row!;
}

/**
 * The one open sign-off of a page.
 * @param pageId - The page.
 */
async function openAskFor(pageId: number): Promise<Ask> {
  const open = (await asksLike(`seo-page:${pageId}:`)).filter(a => a.status === 'open');

  expect(open).toHaveLength(1);

  return open[0]!;
}

const meta = (slug: string) => ({ meta_title: `${slug.replace(/-/g, ' ')} | Northwind`, meta_description: `Same-day ${slug.replace(/-/g, ' ')} from Northwind Home Services.`, slug });

/**
 * Research, brief, draft and pass one page: its sign-off ends up filed.
 * @param pageId - The page.
 * @param keyword - Its keyword, for the artifacts.
 */
async function writeAndPass(pageId: number, keyword: string): Promise<void> {
  await call('seo_save_research', { page_id: pageId, serp_artifact_id: await serpBrief(keyword) }, { agentSlug: 'serp-analyst' });
  await call('seo_save_brief', { page_id: pageId, brief_artifact_id: await markdown(`Brief ${keyword}`, 'seo/briefs') });

  expect(await call('seo_save_draft', { page_id: pageId, draft_artifact_id: await markdown(`Draft ${keyword}`, 'seo/drafts'), ...meta(keyword.replace(/\s+/g, '-')) }, { agentSlug: 'seo-writer' })).toContain('round');
  expect(await call('seo_save_review', { page_id: pageId, verdict: 'pass', notes: 'Rules, brief and SERP brief checked.' }, { agentSlug: 'seo-editor', harnessConfig: { model: 'claude-sonnet-5-5' }, missionRunId: EDITOR_RUN })).toContain('sign-off is filed');
}

let projectId = 0;
let otherProjectId = 0;
let firstBatch = 0;
let secondBatch = 0;
let pages: Awaited<ReturnType<typeof listSeoPages>> = [];

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-seo', name: 'Brightline Studio', slug: 'brightline-seo' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seo', slug: 'brightline', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
});

describe('installing the SEO app on a workspace with no folder', () => {
  it('sets up everything the app needs: the seats, the records, the learning step, the trust bars, its lead and its follow-up', async () => {
    const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' });

    expect(res.errors).toEqual([]);
    expect(res.plugins).toEqual(['data-rooms', 'wiki', 'seo']);
    expect(res.leadAdopted).toBe('seo-strategist');

    const agents = await db.select({ slug: agentSchema.slug, harness: agentSchema.harnessConfig }).from(agentSchema).where(eq(agentSchema.orgId, ORG));

    expect(agents.map(a => a.slug)).toEqual(expect.arrayContaining(['seo-strategist', 'serp-analyst', 'seo-writer', 'seo-editor']));
    expect(agents.find(a => a.slug === 'seo-writer')?.harness).toMatchObject({ model: 'claude-opus-5-5' });
    expect(await getObjectTypeBySlug(ORG, 'seo_batch')).toBeTruthy();
    expect(await getObjectTypeBySlug(ORG, 'seo_page')).toBeTruthy();

    const rules = await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG));

    expect(rules.find(r => r.actionId === 'objects.update_meta.seo_page')?.enabled).toBe('false');
    expect((await db.select().from(automationSchema).where(and(eq(automationSchema.orgId, ORG), eq(automationSchema.slug, 'seo-continue')))).length).toBe(1);
  });
});

describe('a keyword plan a person signs off before anything is briefed', () => {
  it('plans a batch in review and files ONE sign-off showing the keyword map, in code', async () => {
    const room = await createDataRoom(ORG, PERSON, { title: 'Northwind Home Services', domains: ['northwind-home.example'] });
    projectId = room.id;
    otherProjectId = (await createDataRoom(ORG, PERSON, { title: 'Kestrel Gear' })).id;
    await db.insert(modelCallSchema).values([
      { orgId: ORG, feature: 'agent.turn', conversationId: 9101, model: 'claude-opus-5-5', agentSlug: 'seo-strategist' },
      { orgId: ORG, feature: 'agent.turn', runKind: 'mission_run', runId: String(WRITER_RUN), model: 'claude-opus-5-5', agentSlug: 'seo-writer' },
    ]);

    const out = await call('seo_plan_batch', {
      project_id: projectId,
      topic: 'Boiler repair',
      why: 'Local intent dominates; the client has no location pages.',
      pages: [
        { keyword: 'boiler repair riverton', page_type: 'location', location: 'Riverton', intent: 'transactional', cluster: 'boiler repair' },
        { keyword: 'boiler repair lakeside', page_type: 'location', location: 'Lakeside', intent: 'transactional', cluster: 'boiler repair' },
        { keyword: 'boiler repair hillcrest', page_type: 'location', location: 'Hillcrest', intent: 'transactional', cluster: 'boiler repair' },
        { keyword: 'boiler servicing', page_type: 'service', intent: 'commercial', cluster: 'boiler care', existing_url: 'https://northwind-home.example/boilers' },
        { keyword: 'why is my boiler losing pressure', page_type: 'blog', intent: 'informational', cluster: 'boiler care' },
      ],
    });
    firstBatch = Number(/batch #(\d+)/.exec(out)![1]);

    expect(out).toContain('Filed the keyword plan\'s sign-off');

    const batch = await getSeoBatch(ORG, firstBatch);

    expect(batch?.meta.status).toBe('plan_review');
    expect(batch?.meta.gate?.line).toBe('5 pages planned · waiting on your sign-off on the keyword plan');

    const [ask, ...more] = await asksLike(`seo-plan:${firstBatch}:`);

    expect(more).toEqual([]);
    expect(ask).toMatchObject({ kind: 'signoff', sourceRef: `seo-plan:${firstBatch}:1`, status: 'open', groupKey: `seo-batch:${firstBatch}` });
    expect(ask!.contextMd).toContain('| 4 | boiler servicing | service | — | commercial | boiler care | refresh https://northwind-home.example/boilers |');
    // The card says what an answer does: approval resumes the work.
    expect(ask!.outcomes).toMatchObject({ onApprove: expect.stringContaining('The briefs start'), onRevise: expect.stringContaining('re-plans with your note') });

    pages = await listSeoPages(ORG, firstBatch);

    expect(pages.map(p => p.meta.released)).toEqual([false, false, false, false, false]);
    expect(pages[0]!.meta.models?.plan).toMatchObject({ name: 'Opus 5.5', source: 'ledger' });
  });

  it('refuses a brief and a draft until the plan is approved; research may go on', async () => {
    expect(await call('seo_save_research', { page_id: pages[0]!.id, serp_artifact_id: await serpBrief('boiler repair riverton') })).toContain('is on page');
    expect(await call('seo_save_brief', { page_id: pages[0]!.id, brief_artifact_id: await markdown('Brief') })).toMatch(/^Not saved: the keyword plan .* is waiting on a person's sign-off/);
    expect(await call('seo_save_draft', { page_id: pages[0]!.id, draft_artifact_id: await markdown('Draft'), ...meta('x') })).toMatch(/^Not saved: the keyword plan/);
  });

  it('Revise holds the batch with the note, and a revised plan files its own sign-off', async () => {
    const [ask] = await asksLike(`seo-plan:${firstBatch}:`);
    await answer(ask!, 'other', 'Add a page for Brookfield too.');

    expect((await getSeoBatch(ORG, firstBatch))?.meta.plan).toMatchObject({ state: 'revise', note: 'Add a page for Brookfield too.' });
    expect(await call('seo_save_brief', { page_id: pages[0]!.id, brief_artifact_id: await markdown('Brief') })).toContain('was sent back ("Add a page for Brookfield too.")');
    expect(emitted.filter(e => e.type === 'seo.work_queued').at(-1)).toMatchObject({ payload: { reason: 'signoff', kind: 'plan', plan: 'revise', batchId: firstBatch } });

    const revised = await call('seo_plan_batch', {
      batch_id: firstBatch,
      topic: 'Boiler repair',
      pages: [
        { keyword: 'boiler repair riverton', page_type: 'location', location: 'Riverton' },
        { keyword: 'boiler repair lakeside', page_type: 'location', location: 'Lakeside' },
        { keyword: 'boiler repair brookfield', page_type: 'location', location: 'Brookfield' },
        { keyword: 'boiler servicing', page_type: 'service', existing_url: 'https://northwind-home.example/boilers' },
        { keyword: 'why is my boiler losing pressure', page_type: 'blog' },
        { keyword: 'boiler repair cost', page_type: 'blog' },
      ],
    });

    expect(revised).toContain('Revised the keyword plan');

    const round2 = (await asksLike(`seo-plan:${firstBatch}:2`))[0]!;
    await answer(round2, 'approve');
    pages = await listSeoPages(ORG, firstBatch);

    expect((await getSeoBatch(ORG, firstBatch))?.meta.plan?.state).toBe('approved');
    // The sample: one page of each type — the first location, the service, the first post.
    expect(pages.filter(p => p.meta.released).map(p => p.meta.keyword)).toEqual(['boiler repair riverton', 'boiler servicing', 'why is my boiler losing pressure']);
  });
});

describe('the gate is the project\'s', () => {
  it('a second batch for the same client drafts nothing until the first sample is signed off', async () => {
    const out = await call('seo_plan_batch', { project_id: projectId, topic: 'Heat pumps', pages: [{ keyword: 'heat pump installation', page_type: 'service' }, { keyword: 'heat pump grants', page_type: 'blog' }] });
    secondBatch = Number(/batch #(\d+)/.exec(out)![1]);
    await answer((await asksLike(`seo-plan:${secondBatch}:`))[0]!, 'approve');
    const [second] = await listSeoPages(ORG, secondBatch);
    await call('seo_save_brief', { page_id: second!.id, brief_artifact_id: await markdown('Brief heat pumps') });

    expect(await call('seo_save_draft', { page_id: second!.id, draft_artifact_id: await markdown('Draft heat pumps'), ...meta('heat-pump-installation') })).toMatch(/^Not saved: .*past the sample: a person has to sign off on the project's sample first/);
    expect((await getSeoBatch(ORG, secondBatch))?.meta.gate?.line).toBe('0 of 2 written · nothing released until the project\'s sample is signed off');
  });
});

describe('the sample, with its sign-offs filed by code', () => {
  it('checks the meta in code and stores it on the page', async () => {
    const page = pages[0]!;
    await call('seo_save_brief', { page_id: page.id, brief_artifact_id: await markdown('Brief Riverton', 'seo/briefs', '# Brief\n\n## Local substance\n\nTwo jobs in Riverton from the project\'s notes.') });
    const draft = await markdown('Draft Riverton', 'seo/drafts');

    expect(await call('seo_save_draft', { page_id: page.id, draft_artifact_id: draft, meta_title: 'x'.repeat(61), meta_description: 'ok', slug: 'Boiler Repair' })).toMatch(/^Not saved: .*meta_title is 61 characters; at most 60; slug "Boiler Repair" is not kebab-case/);
    expect(await call('seo_save_draft', { page_id: page.id, draft_artifact_id: draft, meta_title: 'Boiler repair in Riverton, same day | Northwind Home Co.', meta_description: 'Same-day boiler repair in Riverton.', slug: 'boiler-repair-riverton' }, { agentSlug: 'seo-writer' })).toContain('close to the 60');
    expect((await getSeoPage(ORG, page.id))?.meta).toMatchObject({ metaTitle: 'Boiler repair in Riverton, same day | Northwind Home Co.', metaDescription: 'Same-day boiler repair in Riverton.', slug: 'boiler-repair-riverton' });
  });

  it('a pass files the sign-off itself; a later review withdraws it; the redraft gets its own', async () => {
    const page = pages[0]!;
    await call('seo_save_review', { page_id: page.id, verdict: 'pass', notes: 'Checked.' }, { agentSlug: 'seo-editor' });
    const first = await openAskFor(page.id);
    const draft = (await getSeoPage(ORG, page.id))!.meta.draftArtifactId!;

    expect(first).toMatchObject({ kind: 'signoff', sourceRef: `seo-page:${page.id}:${draft}:1`, groupKey: `seo-batch:${firstBatch}`, agentSlug: 'seo-editor' });
    expect(first.objectRefs).toEqual([{ type: 'artifact', id: String(draft) }, { type: 'object', id: String(page.id) }]);
    expect((await getSeoPage(ORG, page.id))?.meta.signoffAsk).toMatchObject({ askId: first.id, version: 1 });

    // The editor looks again and sends it back: the open ask is withdrawn.
    expect(await call('seo_save_review', { page_id: page.id, verdict: 'fix', notes: 'The answer is in paragraph three.' }, { agentSlug: 'seo-editor' })).toContain('drafting again');
    expect((await db.select().from(askSchema).where(eq(askSchema.id, first.id)))[0]?.status).toBe('superseded');

    expect(await call('seo_save_draft', { page_id: page.id, draft_artifact_id: draft }, { agentSlug: 'seo-writer' })).toContain('round 2');

    await call('seo_save_review', { page_id: page.id, verdict: 'pass', notes: 'Fixed.' }, { agentSlug: 'seo-editor' });

    expect((await openAskFor(page.id)).sourceRef).toBe(`seo-page:${page.id}:${draft}:2`);
  });

  it('holds everything past the sample until a person signs off on every page of it', async () => {
    await writeAndPass(pages[3]!.id, 'boiler servicing');
    await writeAndPass(pages[4]!.id, 'why is my boiler losing pressure');

    const batch = await getSeoBatch(ORG, firstBatch);

    expect(batch?.meta.gate?.line).toBe('3 of 6 written · waiting on your feedback on the sample of 3');
    expect(batch?.meta.waitingOnYou).toBe(3);
    // The editor's turn had no ledger row, so its model is the seat's, and says so.
    expect((await getSeoPage(ORG, pages[3]!.id))?.meta.modelsLine).toBe('Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5 (configured)');

    await answer(await openAskFor(pages[0]!.id), 'approve');
    await answer(await openAskFor(pages[3]!.id), 'approve');
    await answer(await openAskFor(pages[4]!.id), 'other', 'Northwind never says "cheap"; say "fairly priced".');

    expect((await getSeoPage(ORG, pages[0]!.id))?.meta.signoff).toMatchObject({ decision: 'approve', version: 1 });
    expect((await getSeoPage(ORG, pages[4]!.id))?.meta.status).toBe('changes_requested');
    expect((await getSeoBatch(ORG, firstBatch))?.meta.gate?.line).toBe('3 of 6 written · 1 page has feedback to file before more are written');
    // The note holds every batch of the project, not only its own.
    expect((await getSeoBatch(ORG, secondBatch))?.meta.gate?.line).toContain('feedback to file');
    expect(emitted.filter(e => e.type === 'seo.work_queued' && e.payload?.reason === 'signoff' && e.payload?.kind === 'page').map(e => e.payload?.signoff)).toEqual(['approve', 'approve', 'revise']);
  });
});

describe('feedback goes to the right client and is really filed', () => {
  const note = 'Northwind never says "cheap"; say "fairly priced".';
  const rule = 'Never say "cheap"; say "fairly priced".';

  it('refuses another client\'s project, and words that are not on the page\'s own project', async () => {
    const page = pages[4]!;

    expect(await call('seo_record_feedback', { page_id: page.id, note, scope: 'client', filed_to: `project:${otherProjectId}`, filed_text: rule })).toMatch(new RegExp(`^Not recorded: page #${page.id} belongs to project ${projectId}`));
    expect(await call('seo_record_feedback', { page_id: page.id, note, scope: 'client', filed_to: `project:${projectId}`, filed_text: rule })).toMatch(/^Not recorded as filed: .* is not on project/);
    expect(await call('seo_save_draft', { page_id: page.id, draft_artifact_id: (await getSeoPage(ORG, page.id))!.meta.draftArtifactId! })).toMatch(/has to be filed/);
  });

  it('an SEO seat names the page\'s project on update_project; the rule on it counts as filed', async () => {
    const update = updateProjectTool(ctx()) as unknown as { invoke: (a: Record<string, unknown>) => Promise<unknown> };

    expect(String(await update.invoke({ add_rules: [rule] }))).toContain('name project_id');

    await update.invoke({ project_id: projectId, add_rules: [rule] });

    expect(await call('seo_record_feedback', { page_id: pages[4]!.id, note, scope: 'client', filed_to: `project:${projectId}`, filed_text: rule })).toContain(`filed to project:${projectId}`);
    expect(await call('seo_save_draft', { page_id: pages[4]!.id, draft_artifact_id: (await getSeoPage(ORG, pages[4]!.id))!.meta.draftArtifactId! })).toContain('round 2');
  });

  it('a filing that no longer holds stops counting: take the rule off the project and the gate holds again', async () => {
    const update = updateProjectTool(ctx()) as unknown as { invoke: (a: Record<string, unknown>) => Promise<unknown> };
    await call('seo_save_review', { page_id: pages[4]!.id, verdict: 'fix', notes: 'Still says cheap.' }, { agentSlug: 'seo-editor' });
    await patchSeoPage(ORG, pages[4]!, { status: 'changes_requested' });

    expect((await readSeoGate(ORG, firstBatch))?.project.feedbackToFile).toEqual([]);

    await update.invoke({ project_id: projectId, remove_rules: [rule] });

    expect((await readSeoGate(ORG, firstBatch))?.project.feedbackToFile).toEqual([pages[4]!.id]);

    await update.invoke({ project_id: projectId, add_rules: [rule] });
  });

  it('craft goes to the learning step as a candidate tagged with the project; a client\'s candidate reaches only that client', async () => {
    const page = pages[0]!;

    expect(await call('seo_record_feedback', { page_id: page.id, note: 'Open with the answer.', scope: 'general', filed_to: 'learning:seo-feedback', filed_text: 'Answer the query in the first sentence.' })).toMatch(/filed to learning:seo-feedback \(candidate #\d+/);
    expect(await call('seo_record_feedback', { page_id: page.id, note: 'Mention the 24-hour line.', scope: 'client', filed_to: 'learning:seo-feedback', filed_text: 'Mention the 24-hour emergency line on every location page.' })).toContain('candidate #');

    const candidates = await db.select().from(learningCandidateSchema).where(and(eq(learningCandidateSchema.orgId, ORG), eq(learningCandidateSchema.stepName, 'seo-feedback')));
    const general = candidates.find(c => c.ruleText.startsWith('Answer the query'))!;
    const client = candidates.find(c => c.ruleText.startsWith('Mention the 24-hour'))!;

    expect(general).toMatchObject({ scopeKind: null, sourceRef: `seo-page:${page.id}:project:${projectId}` });
    expect(client).toMatchObject({ scopeKind: 'object', scopeRef: `data_room/${projectId}` });

    await decideCandidate({ orgId: ORG, id: client.id, decision: 'approve', decidedBy: PERSON });
    const here = JSON.parse(await call('seo_next_pages', { batch_id: firstBatch }));
    const otherBatch = Number(/batch #(\d+)/.exec(await call('seo_plan_batch', { project_id: otherProjectId, topic: 'Tents', pages: [{ keyword: 'two person tent' }] }))![1]);
    const there = JSON.parse(await call('seo_next_pages', { batch_id: otherBatch }));

    expect(here.clientRulesFromSignoffs).toEqual(['Mention the 24-hour emergency line on every location page.']);
    expect(there.clientRulesFromSignoffs).toBeUndefined();
  });
});

describe('a sign-off is bound to the words', () => {
  it('an edit to an approved draft puts the page back to review with a new ask, and the gate stops counting it', async () => {
    const page = pages[0]!;
    const draft = (await getSeoPage(ORG, page.id))!.meta.draftArtifactId!;
    const before = (await readSeoGate(ORG, firstBatch))!.project.approved;
    await updateArtifact({ orgId: ORG, id: draft, contentMarkdown: '# Boiler repair in Riverton\n\nNow with a cheaper offer.', author: { kind: 'agent', id: 'agent:seo-writer' } });

    await vi.waitFor(async () => expect((await getSeoPage(ORG, page.id))?.meta.status).toBe('in_review'));

    const after = await getSeoPage(ORG, page.id);

    expect(after?.meta.draftRound).toBe(3);
    expect(after?.meta.signoff).toBeUndefined();
    expect((await openAskFor(page.id)).sourceRef).toBe(`seo-page:${page.id}:${draft}:3`);
    expect((await readSeoGate(ORG, firstBatch))!.project.approved).toBe(before - 1);
  });
});

describe('writes that cannot wipe a sign-off', () => {
  it('a tool writing from a stale read keeps the sign-off that landed meanwhile', async () => {
    const page = pages[0]!;
    const stale = (await getSeoPage(ORG, page.id))!;
    await answer(await openAskFor(page.id), 'approve');
    await patchSeoPage(ORG, stale, { review: { verdict: 'pass', notes: 'late', at: '' } });

    expect((await getSeoPage(ORG, page.id))?.meta).toMatchObject({ status: 'approved', signoff: { decision: 'approve' }, review: { notes: 'late' } });
  });

  it('two writers at once each keep their own keys', async () => {
    const page = (await getSeoPage(ORG, pages[1]!.id))!;
    await Promise.all([
      patchSeoPage(ORG, page, current => ({ feedback: [...(current.feedback ?? []), { at: '', by: PERSON, note: 'one', filedTo: null }] })),
      patchSeoPage(ORG, page, current => ({ feedback: [...(current.feedback ?? []), { at: '', by: PERSON, note: 'two', filedTo: null }] })),
      patchSeoPage(ORG, page, { location: 'Lakeside East' }),
    ]);
    const after = await getSeoPage(ORG, page.id);

    expect(after?.meta.feedback?.map(f => f.note).sort()).toEqual(['one', 'two']);
    expect(after?.meta.location).toBe('Lakeside East');
  });
});

describe('the gate sizes and publish targets are a person\'s', () => {
  it('refuses an agent\'s write to seoGate or publishTargets, whatever the bar', async () => {
    const refusal = await objectsUpdateMetaAction.precheck!({ orgId: ORG, proposedBy: 'agent:seo-strategist' }, { objectType: 'data_room', id: projectId, set: { seoGate: { sample: 100, tranche: 100 } }, reason: 'faster' });

    expect(refusal).toContain('set by a person on the project page');
  });

  it('a person sets them on the project page; a token may not', async () => {
    const req = (body: unknown) => new Request('http://localhost/api/v1/projects/1', { method: 'PATCH', body: JSON.stringify(body) }) as unknown as NextRequest;
    const person = { orgId: ORG, actorId: PERSON, source: 'session' as const, principal: { kind: 'user', id: PERSON, role: 'admin', scope: { orgId: ORG } } } as never;
    const token = { orgId: ORG, actorId: 'token:7', source: 'token' as const, principal: { kind: 'agent', id: 'token:7', scope: { orgId: ORG } } } as never;

    expect((await patchProject(token, String(projectId), req({ seoGate: { sample: 1, tranche: 1 } }))).status).toBe(403);
    // Each target is checked by publishing's own schema: a GitHub target names its repository and path.
    expect((await patchProject(person, String(projectId), req({ publishTargets: [{ id: 'site', kind: 'github', label: 'Website' }] }))).status).toBe(400);
    expect((await patchProject(person, String(projectId), req({ seoGate: { sample: 5, tranche: 20 }, publishTargets: [SITE] }))).status).toBe(200);
    expect((await getDataRoom(ORG, projectId))?.meta).toMatchObject({ seoGate: { sample: 5, tranche: 20 }, publishTargets: [{ id: 'site', kind: 'github' }] });
  });
});

describe('publishing reads the sign-off this app writes', () => {
  it('a signed-off page plans to publish; the sign-off carries the version and the hash publishing checks', async () => {
    const { contentHashOf, planPublish } = await import('@/services/publish/sitePublish');
    const page = (await getSeoPage(ORG, pages[3]!.id))!;
    const { getArtifact } = await import('@/services/ArtifactService');
    const draft = (await getArtifact({ orgId: ORG, id: page.meta.draftArtifactId! }))!;

    expect(page.meta.signoff).toMatchObject({ decision: 'approve', version: draft.currentVersion, contentHash: await contentHashOf(String(draft.spec.md)) });
    expect(page.meta).toMatchObject({ metaTitle: expect.any(String), metaDescription: expect.any(String), slug: 'boiler-servicing' });

    const planned = await planPublish(ORG, { pageRecordId: page.id });

    expect(planned).toMatchObject({ ok: true, plan: { page: { slug: 'boiler-servicing', metaTitle: page.meta.metaTitle } } });
  });

  it('an edit after the sign-off makes site.publish_page refuse, until a person signs the new words off', async () => {
    const { planPublish } = await import('@/services/publish/sitePublish');
    const page = (await getSeoPage(ORG, pages[3]!.id))!;
    await updateArtifact({ orgId: ORG, id: page.meta.draftArtifactId!, contentMarkdown: '# Boiler servicing\n\nNow with a cheaper offer.', author: { kind: 'human', id: PERSON } });

    const right = await planPublish(ORG, { pageRecordId: page.id });

    expect(right.ok).toBe(false);
    expect(right.ok ? '' : right.why).toMatch(/changed after it was signed off|not the text that was signed off|not signed off/);

    await vi.waitFor(async () => expect((await getSeoPage(ORG, page.id))?.meta.status).toBe('in_review'));

    const later = await planPublish(ORG, { pageRecordId: page.id });

    expect(later.ok ? '' : later.why).toMatch(/is not signed off/);

    await answer(await openAskFor(page.id), 'approve');

    expect((await planPublish(ORG, { pageRecordId: page.id })).ok).toBe(true);
  });
});

/**
 * A SERP brief exactly as serp_compare renders it, synthesis written.
 * @param query - What was searched.
 * @param google - Whether it was Google's ranking.
 */
async function renderedBrief(query: string, google = true): Promise<number> {
  const md = renderSerpBrief({ query, provider: google ? 'serper' : 'web_search:brave', isGoogleRanking: google, device: 'desktop', organic: [], peopleAlsoAsk: [], relatedSearches: [], adsCount: null, retrievedAt: '2026-10-27T14:05:12.000Z', billedUnits: 1 }, []);
  return markdown(`SERP brief: ${query}`, 'seo/serp', withSynthesis(md, renderSynthesis({ intent: 'Find a plumber nearby today.', commonSubtopics: [], gaps: [] }, []))!);
}

const cityPage = (city: string) => `# Water heater repair in ${city}

Contoso Plumbing repairs tank and tankless water heaters across ${city}. Our licensed plumbers arrive the same day, diagnose the fault, and quote before any work starts.

## Common water heater problems

No hot water usually means a failed heating element or a pilot that will not stay lit. Rumbling means sediment has built up in the tank and needs a flush.`;

describe('location pages', () => {
  let home = 0;
  let batchId = 0;

  it('plans location pages with their place, and refuses one with no place', async () => {
    home = (await createDataRoom(ORG, PERSON, { title: 'Contoso Plumbing', domains: ['contoso-plumbing.example'] })).id;

    expect(await call('seo_plan_batch', { project_id: home, topic: 'Water heaters', pages: [{ keyword: 'water heater repair fairview', page_type: 'location' }] })).toMatch(/^Not planned: .*no location/);

    const out = await call('seo_plan_batch', {
      project_id: home,
      topic: 'Water heaters',
      pages: [
        { keyword: 'water heater repair fairview', page_type: 'location', location: 'Fairview', slug: 'fairview/water-heater-repair' },
        { keyword: 'water heater repair lakeside', page_type: 'location', location: 'Lakeside', slug: 'lakeside/water-heater-repair' },
        { keyword: 'tankless water heater repair', page_type: 'service', existing_url: 'https://contoso-plumbing.example/tankless', refresh: true },
      ],
    });
    batchId = Number(/batch #(\d+)/.exec(out)![1]);

    expect(out).toContain('2 location pages');
    expect(out).toContain('STOP HERE');

    const pages = await listSeoPages(ORG, batchId);

    expect(pages.map(p => [p.meta.pageType, p.meta.location, p.meta.target])).toEqual([
      ['location', 'Fairview', 'fairview/water-heater-repair'],
      ['location', 'Lakeside', 'lakeside/water-heater-repair'],
      ['service', undefined, 'https://contoso-plumbing.example/tankless'],
    ]);

    await answer((await asksLike(`seo-plan:${batchId}:`))[0]!, 'approve');
  });

  it('refuses a keyword another open batch already plans, or a URL another page targets, unless it is a refresh', async () => {
    const again = await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'Water heater repair Fairview' }] });

    expect(again).toMatch(/^Not planned: "Water heater repair Fairview" is already page #\d+ \(planned in batch #\d+\)/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'fairview water heaters', slug: '/fairview/water-heater-repair/' }] })).toMatch(/already targets/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'water heater repair fairview', refresh: true }] })).toMatch(/^Not planned: .*no existing_url/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'Refresh', pages: [{ keyword: 'water heater repair fairview', refresh: true, existing_url: 'https://contoso-plumbing.example/fairview/water-heater-repair' }] })).toMatch(/^Planned batch/);
  });

  it('researches each location page on its own city\'s Google results', async () => {
    const [fairview, lakeside] = await listSeoPages(ORG, batchId);

    expect(await call('seo_save_research', { page_id: fairview!.id, serp_artifact_id: await renderedBrief('water heater repair') })).toMatch(/^Not saved: .*does not name Fairview/);
    expect(await call('seo_save_research', { page_id: fairview!.id, serp_artifact_id: await renderedBrief('water heater repair fairview', false) })).toMatch(/^Not saved: .*web search results, not Google's ranking/);

    const fairviewBrief = await renderedBrief('water heater repair fairview');

    expect(await call('seo_save_research', { page_id: fairview!.id, serp_artifact_id: fairviewBrief })).toContain('(researched)');
    expect(await call('seo_save_research', { page_id: lakeside!.id, serp_artifact_id: fairviewBrief })).toMatch(/^Not saved: .*does not name Lakeside/);
    expect(await call('seo_save_research', { page_id: lakeside!.id, serp_artifact_id: await renderedBrief('Water heater repair in Lakeside') })).toContain('(researched)');
  });

  it('wants local substance in a location page\'s brief', async () => {
    const [fairview, lakeside] = await listSeoPages(ORG, batchId);

    expect(await call('seo_save_brief', { page_id: fairview!.id, brief_artifact_id: await markdown('Brief Fairview') })).toMatch(/^Not saved: .*no "Local substance" section/);

    for (const p of [fairview!, lakeside!]) {
      expect(await call('seo_save_brief', { page_id: p.id, brief_artifact_id: await markdown(`Brief ${p.meta.location}`, 'seo/briefs', `# Brief\n\n## 3. Local substance\n\nTwo jobs in ${p.meta.location} from the project's notes.`) })).toContain('It may be drafted now');
    }
  });

  it('fails a location page that is its sibling with the city swapped, whatever the editor said; the planned slug is the one checked', async () => {
    const [fairview, lakeside] = await listSeoPages(ORG, batchId);
    const pageMeta = (city: string) => ({ meta_title: `Water heater repair in ${city}`, meta_description: `Same-day water heater repair in ${city}.` });

    expect(await call('seo_save_draft', { page_id: fairview!.id, draft_artifact_id: await markdown('Draft Fairview', 'seo/drafts', cityPage('Fairview')), ...pageMeta('Fairview'), slug: 'lakeside/water-heater-repair' })).toMatch(/slug "lakeside\/water-heater-repair" is already used/);

    await call('seo_save_draft', { page_id: fairview!.id, draft_artifact_id: await markdown('Draft Fairview', 'seo/drafts', cityPage('Fairview')), ...pageMeta('Fairview') });

    expect((await getSeoPage(ORG, fairview!.id))?.meta.slug).toBe('fairview/water-heater-repair');
    // The first location page has no drafted sibling yet: the editor's pass stands.
    expect(await call('seo_save_review', { page_id: fairview!.id, verdict: 'pass', notes: 'Checked.' })).toContain('sign-off is filed');

    await call('seo_save_draft', { page_id: lakeside!.id, draft_artifact_id: await markdown('Draft Lakeside', 'seo/drafts', cityPage('Lakeside')), ...pageMeta('Lakeside') });
    const out = await call('seo_save_review', { page_id: lakeside!.id, verdict: 'pass', notes: 'Checked.' });

    expect(out).toMatch(new RegExp(`^Not passed: Too similar to page #${fairview!.id} "water heater repair fairview" \\(100% the same once city names are masked\\)`));
    expect(out).toContain('drafting again');

    const after = await getSeoPage(ORG, lakeside!.id);

    expect(after?.meta.status).toBe('drafting');
    expect(after?.meta.review).toMatchObject({ verdict: 'fix', similarTo: [{ pageId: fairview!.id, similarity: 1 }] });
    expect((await asksLike(`seo-page:${lakeside!.id}:`)).filter(a => a.status === 'open')).toEqual([]);
  });
});

describe('writing runs in the background, and the editor\'s loop is code', () => {
  let batchId = 0;
  let pageId = 0;

  it('refuses drafting and review in a chat turn; seo_start_writing queues the released pages and follows the conversation', async () => {
    const project = (await createDataRoom(ORG, PERSON, { title: 'Bellwater Hall' })).id;
    batchId = Number(/batch #(\d+)/.exec(await call('seo_plan_batch', { project_id: project, topic: 'Weddings', pages: [{ keyword: 'wedding venue checklist', page_type: 'blog' }] }))![1]);

    expect(await call('seo_start_writing', { batch_id: batchId })).toMatch(/^Nothing queued: .*keyword plan waits/);

    await answer((await asksLike(`seo-plan:${batchId}:`))[0]!, 'approve');
    pageId = (await listSeoPages(ORG, batchId))[0]!.id;
    await call('seo_save_brief', { page_id: pageId, brief_artifact_id: await markdown('Brief checklist') });

    expect(await call('seo_save_draft', { page_id: pageId, draft_artifact_id: await markdown('Draft checklist', 'seo/drafts'), ...meta('wedding-venue-checklist') }, { missionRunId: undefined })).toMatch(/^Not saved: writing and reviewing run in the background/);
    expect(await call('seo_start_writing', { batch_id: batchId }, { conversationId: 9200 })).toMatch(/^Queued 1 page of batch/);
    expect(emitted.filter(e => e.type === 'seo.work_queued').at(-1)).toMatchObject({ payload: { reason: 'write', batchId, writable: 1 } });
    expect((await getSeoBatch(ORG, batchId))?.meta.conversationId).toBe(9200);
  });

  it('a fix queues the writer\'s revision with the findings; a long review is kept whole, never refused', async () => {
    await call('seo_save_draft', { page_id: pageId, draft_artifact_id: await markdown('Draft checklist', 'seo/drafts'), ...meta('wedding-venue-checklist') });
    const out = await call('seo_save_review', {
      page_id: pageId,
      verdict: 'fix',
      notes: 'Checked against the rules. '.repeat(400),
      findings: [{ issue: 'The H1 does not answer the query.', location: 'H1', fix: 'Lead with the checklist.' }, { issue: 'x'.repeat(2000) }],
    });

    expect(out).toContain('round 1 of 3');

    const page = await getSeoPage(ORG, pageId);

    expect(page?.meta.status).toBe('drafting');
    expect(page?.meta.editorRounds).toBe(1);
    expect(page?.meta.review?.findings?.[1]?.issue).toHaveLength(600);
    expect(page?.meta.review?.notes.length).toBeLessThanOrEqual(4000);
    expect(page?.meta.review?.notesArtifactId).toBeGreaterThan(0);
    expect(emitted.filter(e => e.type === 'seo.work_queued').at(-1)).toMatchObject({ payload: { reason: 'revise', pageId, round: 1, of: 3 } });
    expect(String(emitted.filter(e => e.type === 'seo.work_queued').at(-1)?.payload?.findings)).toContain('1. The H1 does not answer the query. (H1) — fix: Lead with the checklist.');
  });

  it('after the last round the sign-off is filed anyway, with the open findings shown, so the person decides', async () => {
    const draft = (await getSeoPage(ORG, pageId))!.meta.draftArtifactId!;
    for (const round of [2, 3]) {
      await call('seo_save_draft', { page_id: pageId, draft_artifact_id: draft });
      const out = await call('seo_save_review', { page_id: pageId, verdict: 'fix', findings: [{ issue: `Still no venue capacity (round ${round}).` }] });

      expect(out).toContain(round === 3 ? 'rounds on page' : `round ${round} of 3`);
    }
    const ask = await openAskFor(pageId);

    expect(ask.contextMd).toContain('Open findings (the editor\'s rounds ran out)');
    expect(ask.contextMd).toContain('Still no venue capacity (round 3).');
    expect((await getSeoPage(ORG, pageId))?.meta.status).toBe('in_review');

    await answer(ask, 'other', 'Add the capacity table.');

    expect((await getSeoPage(ORG, pageId))?.meta.editorRounds).toBe(0);
  });
});

describe('the editor reads the page it reviews', () => {
  let batchId = 0;
  let pageIds: number[] = [];

  it('a batch of three blog posts samples all three, each signed by the project\'s authors', async () => {
    const project = (await createDataRoom(ORG, PERSON, { title: 'Larkfield Systems' })).id;
    await updateDataRoom(ORG, project, { authors: [
      { name: 'Dana Reyes', title: 'Head of Engineering', url: 'https://larkfield.example/team/dana', default: true },
      { name: 'Sam Okafor', title: 'Field Lead', topics: ['heat pumps'] },
    ] });
    const out = await call('seo_plan_batch', { project_id: project, topic: 'Heat pumps', pages: [
      { keyword: 'heat pump noise', page_type: 'blog', author: 'sam okafor' },
      { keyword: 'heat pump sizing', page_type: 'blog' },
      { keyword: 'heat pump defrost cycle', page_type: 'blog' },
    ] });
    batchId = Number(/batch #(\d+)/.exec(out)![1]);

    expect(out).not.toContain('byline');

    await answer((await asksLike(`seo-plan:${batchId}:`))[0]!, 'approve');
    const pages = await listSeoPages(ORG, batchId);
    pageIds = pages.map(p => p.id);

    expect(pages.map(p => p.meta.released)).toEqual([true, true, true]);
    expect(pages.map(p => p.meta.author?.name)).toEqual(['Sam Okafor', 'Dana Reyes', 'Dana Reyes']);
    expect(pages[1]!.meta.author).toMatchObject({ from: 'default', url: 'https://larkfield.example/team/dana' });
    expect(JSON.parse(await call('seo_next_pages', { batch_id: batchId })).sample).toMatchObject({ size: 3, pages: pageIds });
  });

  it('seo_read_page hands the editor the record, the findings and the whole SERP brief, brief and draft', async () => {
    const [first] = pageIds;
    const serp = await serpBrief('heat pump noise');
    await call('seo_save_research', { page_id: first, serp_artifact_id: serp });
    const brief = await markdown('Brief heat pump noise', 'seo/briefs', '# Brief\n\nAnswer: most noise is the defrost cycle.');
    await call('seo_save_brief', { page_id: first, brief_artifact_id: brief });
    const draftMd = `# Why is my heat pump noisy?\n\n${'A steady hum is normal. '.repeat(900)}THE LAST LINE.`;
    const draft = await markdown('Draft heat pump noise', 'seo/drafts', draftMd);
    await call('seo_save_draft', { page_id: first, draft_artifact_id: draft, ...meta('heat-pump-noise') }, { agentSlug: 'seo-writer' });
    await call('seo_save_review', { page_id: first, verdict: 'fix', findings: [{ issue: 'The intro does not name the defrost cycle.', location: 'Intro' }] }, { agentSlug: 'seo-editor' });

    const read = await call('seo_read_page', { page: first }, { agentSlug: 'seo-editor', missionRunId: EDITOR_RUN });

    expect(read).toContain('**Keyword:** heat pump noise');
    expect(read).toContain('**Byline:** Sam Okafor, Field Lead');
    expect(read).toContain('The intro does not name the defrost cycle. (Intro)');
    expect(read).toContain(`## SERP brief — artifact #${serp}, version 1`);
    expect(read).toContain(`## Page brief — artifact #${brief}, version 1`);
    expect(read).toContain('Answer: most noise is the defrost cycle.');
    expect(read).toContain(`## Draft — artifact #${draft}, version 1`);
    // A long draft is cut where it says, and the same tool reads on.
    expect(read).toContain(`seo_read_page { page: ${first}, part: "draft", offset: 16000 }`);
    expect(read).not.toContain('THE LAST LINE.');
    expect(await call('seo_read_page', { page: first, part: 'draft', offset: 16000 })).toContain('THE LAST LINE.');
  });

  it('refuses a page of another workspace', async () => {
    expect(await call('seo_read_page', { page: pageIds[0] }, { orgId: 'proj_seo_elsewhere' })).toBe(`#${pageIds[0]} is not an SEO page in this workspace.`);
  });

  it('a background run says where the batch stands once, and nothing when nothing changed', async () => {
    await call('seo_start_writing', { batch_id: batchId }, { conversationId: 9300 });
    const said: string[] = [];
    const tell = async (_org: string, _batch: number, text: string) => {
      said.push(text);
    };

    expect(await reportSeoRun(ORG, batchId, tell)).toBe('said');
    expect(said[0]).toContain('Larkfield Systems: Heat pumps:');
    expect(await reportSeoRun(ORG, batchId, tell)).toBe('silent');
    expect(said).toHaveLength(1);

    // Something moved: the next run says so.
    await call('seo_save_brief', { page_id: pageIds[1], brief_artifact_id: await markdown('Brief sizing', 'seo/briefs') });
    await call('seo_save_draft', { page_id: pageIds[1], draft_artifact_id: await markdown('Draft sizing', 'seo/drafts'), ...meta('heat-pump-sizing') }, { agentSlug: 'seo-writer' });

    expect(await reportSeoRun(ORG, batchId, tell)).toBe('said');
    expect(said).toHaveLength(2);
  });
});
