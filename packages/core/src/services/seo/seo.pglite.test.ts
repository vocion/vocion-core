/**
 * The SEO app end to end on PGlite: installed on a workspace with no folder
 * (Vocion Cloud), a batch planned for a client's project, the gate refusing a
 * draft past the sample, a person's sign-off and revise moving the pages, and
 * feedback filed before anything more is written. Every client, person and
 * site here is fictional.
 */
import type { RuntimeContext } from '@/services/agents/types';
import type { Ask } from '@/services/AskService';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, memoryNamespaceSchema, modelCallSchema, projectSchema, teamSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { installPluginBundles } = await import('@/services/plugins/installBundle');
const { getObjectTypeBySlug, updateBusinessObject } = await import('@/services/BusinessObjectService');
const { createDataRoom } = await import('@/services/DataRoomService');
const { createArtifact } = await import('@/services/ArtifactService');
const { seoTools } = await import('@/services/agents/tools/seo');
const { getSeoBatch, getSeoPage, listSeoPages } = await import('./records');
const { renderSerpBrief, renderSynthesis, withSynthesis } = await import('@/libs/tools/serp/brief');
const { onSeoAskSettled } = await import('./signoff');

const ORG = 'proj_seo_brightline';
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
  const t = seoTools(ctx(over)).find(x => x.name === name)! as unknown as { invoke: (input: Record<string, unknown>) => Promise<unknown> };
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
  const synthesis = written ? '**Intent.** To compare trail shoes before buying [1][2].' : '_Not written yet._';
  return markdown(`SERP brief: ${query}`, 'seo/serp', `# SERP brief: ${query}\n\n## Synthesis\n\n<!-- serp-synthesis -->\n${synthesis}\n<!-- /serp-synthesis -->\n`);
}

/**
 * A sign-off answered by a person, as `AskService` hands it over.
 * @param id - The ask id.
 * @param ref - Its source ref.
 * @param decision - approve | reject | other.
 * @param note - What they wrote.
 */
function answered(id: number, ref: string, decision: string, note: string | null = null): Ask {
  return { id, orgId: ORG, kind: 'signoff', sourceRef: ref, status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'done', decision, decisionNote: note, decidedBy: PERSON } as unknown as Ask;
}

/**
 * The sign-off ref the editor's receipt names.
 * @param receipt - What seo_save_review returned.
 */
function refIn(receipt: string): string {
  return /"source_ref":"([^"]+)"/.exec(receipt)![1]!;
}

let projectId = 0;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-seo', name: 'Brightline Studio', slug: 'brightline-seo' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seo', slug: 'brightline', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
});

describe('installing the SEO app on a workspace with no folder', () => {
  it('sets up everything the app needs: the seats, the records, the learning step, the trust bars and its lead', async () => {
    const res = await installPluginBundles({ orgId: ORG, plugins: ['seo'], appliedBy: 'user:mara' });

    expect(res.errors).toEqual([]);
    expect(res.plugins).toEqual(['data-rooms', 'wiki', 'seo']);
    expect(res.leadAdopted).toBe('seo-strategist');

    const agents = await db.select({ slug: agentSchema.slug, harness: agentSchema.harnessConfig }).from(agentSchema).where(eq(agentSchema.orgId, ORG));
    const writer = agents.find(a => a.slug === 'seo-writer');

    expect(agents.map(a => a.slug)).toEqual(expect.arrayContaining(['seo-strategist', 'serp-analyst', 'seo-writer', 'seo-editor']));
    expect(writer?.harness).toMatchObject({ model: 'claude-opus-5-5' });
    expect(await getObjectTypeBySlug(ORG, 'seo_batch')).toBeTruthy();
    expect(await getObjectTypeBySlug(ORG, 'seo_page')).toBeTruthy();
    expect(await getObjectTypeBySlug(ORG, 'data_room')).toBeTruthy();
    expect((await db.select().from(teamSchema).where(and(eq(teamSchema.orgId, ORG), eq(teamSchema.slug, 'seo')))).length).toBe(1);
    expect((await db.select().from(memoryNamespaceSchema).where(and(eq(memoryNamespaceSchema.orgId, ORG), eq(memoryNamespaceSchema.name, 'seo-feedback')))).length).toBe(1);

    const rules = await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG));

    expect(rules.find(r => r.actionId === 'objects.update_meta.seo_page')?.enabled).toBe('false');
  });
});

describe('a batch through the gate', () => {
  it('plans a batch for a project, with the sample released and the planning model recorded from the ledger', async () => {
    const room = await createDataRoom(ORG, PERSON, { title: 'Northwind Outfitters', domains: ['northwind-outfitters.example'] });
    projectId = room.id;
    await db.insert(modelCallSchema).values({ orgId: ORG, feature: 'agent.turn', conversationId: 9101, model: 'claude-opus-5-5', agentSlug: 'seo-strategist' });

    const out = await call('seo_plan_batch', {
      project_id: projectId,
      topic: 'Trail shoes',
      pages: ['trail running shoes', 'waterproof trail shoes', 'trail shoes for wide feet', 'how to clean trail shoes', 'trail vs road shoes'].map(keyword => ({ keyword })),
    });

    expect(out).toContain('with 5 pages');
    expect(out).toContain('0 of 5 written · writing a sample of 3 for your feedback first');

    const pages = await listSeoPages(ORG, Number(/batch #(\d+)/.exec(out)![1]));

    expect(pages.map(p => p.meta.released)).toEqual([true, true, true, false, false]);
    expect(pages[0]!.meta.models?.plan).toMatchObject({ id: 'claude-opus-5-5', name: 'Opus 5.5', source: 'ledger' });
    expect(pages[0]!.meta.projectId).toBe(projectId);
  });

  it('takes only a SERP brief serp_compare filed, with its synthesis written', async () => {
    const pages = await listSeoPages(ORG, await firstBatch());

    expect(await call('seo_save_research', { page_id: pages[0]!.id, serp_artifact_id: await markdown('Notes') })).toMatch(/^Not saved: .*not a SERP brief/);
    expect(await call('seo_save_research', { page_id: pages[0]!.id, serp_artifact_id: await serpBrief('trail running shoes', false) })).toMatch(/^Not saved: .*no synthesis yet/);
    expect((await getSeoPage(ORG, pages[0]!.id))?.meta.status).toBe('proposed');
  });

  it('refuses a draft past the sample, and a draft with no brief', async () => {
    const pages = await listSeoPages(ORG, await firstBatch());
    const draft = await markdown('Draft');

    expect(await call('seo_save_draft', { page_id: pages[3]!.id, draft_artifact_id: draft })).toMatch(/^Not saved: .*past the sample/);
    expect(await call('seo_save_draft', { page_id: pages[0]!.id, draft_artifact_id: draft })).toMatch(/^Not saved: .*no brief/);
  });

  it('writes the sample, and holds everything past it until a person signs off on all three', async () => {
    const batchId = await firstBatch();
    const pages = await listSeoPages(ORG, batchId);
    const refs: string[] = [];
    for (const page of pages.slice(0, 3)) {
      if (page === pages[0]) {
        // The editor sends the first draft back once; the writer may redraft it at once.
        await call('seo_save_research', { page_id: page.id, serp_artifact_id: await serpBrief('first') });
        await call('seo_save_brief', { page_id: page.id, brief_artifact_id: await markdown('Brief first') });
        await call('seo_save_draft', { page_id: page.id, draft_artifact_id: await markdown('Draft first') });

        expect(await call('seo_save_review', { page_id: page.id, verdict: 'fix', notes: 'The query is answered in paragraph three.' })).toContain('drafting again');
      }
      await call('seo_save_research', { page_id: page.id, serp_artifact_id: await serpBrief(page.meta.keyword) }, { agentSlug: 'serp-analyst' });
      await call('seo_save_brief', { page_id: page.id, brief_artifact_id: await markdown(`Brief ${page.meta.keyword}`) });

      expect(await call('seo_save_draft', { page_id: page.id, draft_artifact_id: await markdown(`Draft ${page.meta.keyword}`) }, { agentSlug: 'seo-writer' })).toContain(page === pages[0] ? 'round 2' : 'round 1');

      refs.push(refIn(await call('seo_save_review', { page_id: page.id, verdict: 'pass', notes: 'Rules, brief and SERP brief checked.' }, { agentSlug: 'seo-editor', harnessConfig: { model: 'claude-sonnet-5-5' }, conversationId: 9102 })));
    }

    const batch = await getSeoBatch(ORG, batchId);

    expect(batch?.meta.gate?.line).toBe('3 of 5 written · waiting on your feedback on the first 3');
    expect(batch?.meta.waitingOnYou).toBe(3);
    // The editor's turn had no ledger row, so its model is the seat's, and says so.
    expect((await getSeoPage(ORG, pages[0]!.id))?.meta.modelsLine).toBe('Plan Opus 5.5 · Write Opus 5.5 · Review Sonnet 5.5 (configured)');

    // Two approved, one sent back with a note.
    await onSeoAskSettled(answered(1, refs[0]!, 'approve'));
    await onSeoAskSettled(answered(2, refs[1]!, 'approve'));
    await onSeoAskSettled(answered(3, refs[2]!, 'other', 'Northwind never says "cheap"; say "good value".'));

    const sentBack = await getSeoPage(ORG, pages[2]!.id);

    expect(sentBack?.meta.status).toBe('changes_requested');
    expect(sentBack?.meta.feedback?.[0]).toMatchObject({ note: 'Northwind never says "cheap"; say "good value".', filedTo: null, askId: 3 });
    expect((await getSeoBatch(ORG, batchId))?.meta.gate?.line).toBe('3 of 5 written · 1 page has feedback to file before more are written');
    // Not even the page itself is redrafted before its feedback is filed.
    expect(await call('seo_save_draft', { page_id: pages[2]!.id, draft_artifact_id: await markdown('Redraft') })).toMatch(/^Not saved: .*has to be filed/);

    // Filed to the client's project, and the page says where.
    expect(await call('seo_record_feedback', { page_id: pages[2]!.id, note: 'Northwind never says "cheap"; say "good value".', scope: 'client', filed_to: `project:${projectId}` })).toContain(`filed to project:${projectId}`);

    // The redraft is round 2 of the same artifact, with its own sign-off.
    const draftId = sentBack!.meta.draftArtifactId!;

    expect(await call('seo_save_draft', { page_id: pages[2]!.id, draft_artifact_id: draftId })).toContain('round 2');

    const ref = refIn(await call('seo_save_review', { page_id: pages[2]!.id, verdict: 'pass', notes: 'Rule applied.' }));

    expect(ref).toBe(`seo-page:${pages[2]!.id}:${draftId}:2`);

    // An answer about the first round no longer moves the page.
    await onSeoAskSettled(answered(4, refs[2]!, 'approve'));

    expect((await getSeoBatch(ORG, batchId))?.meta.gate?.stage).toBe('sample');

    await onSeoAskSettled(answered(5, ref, 'approve'));

    const after = await getSeoBatch(ORG, batchId);

    // Sample approved: the rest of this small batch is released.
    expect(after?.meta.gate?.stage).toBe('tranche');
    expect((await listSeoPages(ORG, batchId)).map(p => p.meta.released)).toEqual([true, true, true, true, true]);
  });

  it('reads the gate sizes from the project, never from the call', async () => {
    const room = await createDataRoom(ORG, PERSON, { title: 'Kestrel Gear' });
    await updateBusinessObject({ id: room.id, metadata: { ...room.meta, seoGate: { sample: 1, tranche: 2 } } }, ORG);
    const out = await call('seo_plan_batch', { project_id: room.id, topic: 'Tents', pages: [{ keyword: 'two person tent' }, { keyword: 'ultralight tent' }] });

    expect(out).toContain('writing a sample of 1 for your feedback first');
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

Northwind Home Services repairs tank and tankless water heaters across ${city}. Our licensed plumbers arrive the same day, diagnose the fault, and quote before any work starts.

## Common water heater problems

No hot water usually means a failed heating element or a pilot that will not stay lit. Rumbling means sediment has built up in the tank and needs a flush.`;

describe('location pages', () => {
  let home = 0;
  let batchId = 0;

  it('plans location pages with their place, and refuses one with no place', async () => {
    home = (await createDataRoom(ORG, PERSON, { title: 'Northwind Home Services', domains: ['northwind-home.example'] })).id;

    expect(await call('seo_plan_batch', { project_id: home, topic: 'Water heaters', pages: [{ keyword: 'water heater repair fairview', page_type: 'location' }] })).toMatch(/^Not planned: .*no location/);

    const out = await call('seo_plan_batch', {
      project_id: home,
      topic: 'Water heaters',
      pages: [
        { keyword: 'water heater repair fairview', page_type: 'location', location: 'Fairview', slug: 'fairview/water-heater-repair' },
        { keyword: 'water heater repair lakeside', page_type: 'location', location: 'Lakeside', slug: 'lakeside/water-heater-repair' },
        { keyword: 'tankless water heater repair', page_type: 'service', existing_url: 'https://northwind-home.example/tankless', refresh: true },
      ],
    });
    batchId = Number(/batch #(\d+)/.exec(out)![1]);

    expect(out).toContain('2 location pages');

    const pages = await listSeoPages(ORG, batchId);

    expect(pages.map(p => [p.meta.pageType, p.meta.location, p.meta.target])).toEqual([
      ['location', 'Fairview', 'fairview/water-heater-repair'],
      ['location', 'Lakeside', 'lakeside/water-heater-repair'],
      ['service', undefined, 'https://northwind-home.example/tankless'],
    ]);
  });

  it('refuses a keyword another open batch already plans, or a URL another page targets, unless it is a refresh', async () => {
    const again = await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'Water heater repair Fairview' }] });

    expect(again).toMatch(/^Not planned: "Water heater repair Fairview" is already page #\d+ \(planned in batch #\d+\)/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'fairview water heaters', slug: '/fairview/water-heater-repair/' }] })).toMatch(/already targets/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'More', pages: [{ keyword: 'water heater repair fairview', refresh: true }] })).toMatch(/^Not planned: .*no existing_url/);
    expect(await call('seo_plan_batch', { project_id: home, topic: 'Refresh', pages: [{ keyword: 'water heater repair fairview', refresh: true, existing_url: 'https://northwind-home.example/fairview/water-heater-repair' }] })).toMatch(/^Planned batch/);
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

  it('fails a location page that is its sibling with the city swapped, whatever the editor said', async () => {
    const [fairview, lakeside] = await listSeoPages(ORG, batchId);
    await call('seo_save_draft', { page_id: fairview!.id, draft_artifact_id: await markdown('Draft Fairview', 'seo/drafts', cityPage('Fairview')) });

    // The first location page has no drafted sibling yet: the editor's pass stands.
    expect(await call('seo_save_review', { page_id: fairview!.id, verdict: 'pass', notes: 'Checked.' })).toContain('file_ask');

    await call('seo_save_draft', { page_id: lakeside!.id, draft_artifact_id: await markdown('Draft Lakeside', 'seo/drafts', cityPage('Lakeside')) });
    const out = await call('seo_save_review', { page_id: lakeside!.id, verdict: 'pass', notes: 'Checked.' });

    expect(out).toMatch(new RegExp(`^Not passed: Too similar to page #${fairview!.id} "water heater repair fairview" \\(100% the same once city names are masked\\)`));
    expect(out).toContain('drafting again');

    const after = await getSeoPage(ORG, lakeside!.id);

    expect(after?.meta.status).toBe('drafting');
    expect(after?.meta.review).toMatchObject({ verdict: 'fix', similarTo: [{ pageId: fairview!.id, similarity: 1 }] });
  });
});

async function firstBatch(): Promise<number> {
  const { listBusinessObjects } = await import('@/services/BusinessObjectService');
  const rows = await listBusinessObjects(ORG, 'seo_batch');
  return rows.sort((a, b) => a.id - b.id)[0]!.id;
}
