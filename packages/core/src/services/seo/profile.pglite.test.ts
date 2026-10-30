/**
 * Onboarding's SEO profile, end to end on PGlite: the tool reads the client's
 * home page and the site inventory, pre-fills the profile and puts ONE card
 * in front of the person. Sourced drafts persist separately before review. Their edit
 * on the card is what is saved; Undo puts back what was there; the bundle
 * every SEO seat reads prints it with what comes first; and no agent write
 * path can set it. Network is stubbed; every client and site is fictional.
 */
import type { RuntimeContext } from '@/services/agents/types';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const SITE = 'https://tally-books.example';
const HOME = `<html lang="en"><head><title>Tally Books — invoicing for agencies</title>
<meta name="description" content="Invoicing and time tracking for creative agencies.">
<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Tally Books"}</script></head>
<body><main><h1>Get paid faster</h1></main></body></html>`;
vi.mock('@/libs/tools/browse/registry', () => ({
  getBrowseProvider: () => ({ name: 'builtin', fetchHtml: async (url: string) => ({ url, html: HOME }) }),
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema } = await import('@/models/Schema');
const { fileRecommendation } = await import('@/services/chat/autoPropose');
const { isNeverAuto } = await import('@/libs/actions/neverAuto');
const { eq } = await import('drizzle-orm');
const { createDataRoom, getDataRoom, getDataRoomDetail, renderDataRoom, updateDataRoom } = await import('@/services/DataRoomService');
const { createArtifact } = await import('@/services/ArtifactService');
const { seoProposeProfileTool } = await import('@/services/agents/tools/seoProfile');
const { seoSaveProfileAction } = await import('@/libs/actions/seo-save-profile');
const { personOnlyRefusal } = await import('@/libs/actions/objects-update-meta');

const ORG = 'proj_seo_profile_brightline';
let projectId = 0;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-profile', name: 'Brightline Studio', slug: 'brightline-profile' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-profile', slug: 'brightline-profile', name: 'Brightline Studio', timeZone: 'America/Chicago', leadAgentSlug: 'workspace-lead' });
  projectId = (await createDataRoom(ORG, 'usr-mara', { title: 'Tally Books', client: 'Tally Books', domains: ['tally-books.example'] })).id;
  const { artifact } = await createArtifact({
    orgId: ORG,
    kind: 'markdown',
    title: 'Site inventory · tally-books.example',
    spec: { md: `| [/](${SITE}/) | 200 |\n| [/pricing](${SITE}/pricing) | 200 |\n| [/integrations/slack](${SITE}/integrations/slack) | 200 |` },
    author: { kind: 'agent', id: 'seo-strategist' },
  });
  await updateDataRoom(ORG, projectId, {
    siteInventory: { artifactId: artifact.id, site: SITE, readAt: '2026-10-29T09:00:00Z', pages: 3, from: 'sitemap' },
    competitors: { readAt: '2026-10-29T09:00:00Z', queries: ['agency invoicing'], isGoogleRanking: true, domains: [{ domain: 'ledgerly.example', ranked: [] }] },
  });
});

type Emitted = { type: string; recommendation?: { actionId: string; input: Parameters<typeof seoSaveProfileAction.execute>[1] } };

describe('onboarding\'s SEO profile', () => {
  it('prepares a sourced draft automatically and asks for business goals rather than inventing them', async () => {
    const emitted: Emitted[] = [];
    const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext;

    const out = String(await seoProposeProfileTool(ctx).invoke({ project_id: projectId, industry: 'Accounting software', audience: 'Owners of creative agencies', read_from: { audience: `${SITE}/about`, industry: `${SITE}/about` } }));

    expect(out).toContain('What should SEO achieve for this client first');
    expect(emitted).toHaveLength(0);

    const prepared = (await getDataRoom(ORG, projectId))!.meta.seoProfileDraft!;

    expect(prepared.profile.goals).toBeUndefined();
    expect(prepared.profile.savedBy).toBeUndefined();
    expect(prepared.preparedBy).toBe('seo-strategist');
    expect(prepared.profile.audience).toBe('Owners of creative agencies');
    expect(renderDataRoom((await getDataRoomDetail(ORG, projectId))!)).not.toContain('## SEO profile');
    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile).toBeUndefined();

    await seoProposeProfileTool(ctx).invoke({ project_id: projectId, goals: ['organic_leads', 'ai_answers'], read_from: { goals: 'The person’s onboarding message' } });

    const cards = emitted.filter(e => e.type === 'recommended_action');

    expect(cards).toHaveLength(1);
    expect(cards[0]!.recommendation!.actionId).toBe('seo.save_profile');

    const draft = cards[0]!.recommendation!.input.profile;

    expect(draft).toMatchObject({
      clientType: 'b2b_saas',
      goals: ['organic_leads', 'ai_answers'],
      industry: 'Accounting software',
      audience: 'Owners of creative agencies',
      offering: 'Invoicing and time tracking for creative agencies.',
      language: 'en',
      website: SITE,
      competitors: ['ledgerly.example'],
    });
    expect(draft.evidence).toMatchObject({ clientType: 'SoftwareApplication schema on the home page; pages /pricing, /integrations', audience: `${SITE}/about` });
    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile).toBeUndefined();
  });

  it('saves what the person edited on the card, prints it in the bundle, and Undo puts back what was there', async () => {
    const emitted: Emitted[] = [];
    const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext;
    await seoProposeProfileTool(ctx).invoke({ project_id: projectId, goals: ['organic_leads', 'ai_answers'], read_from: { goals: 'The person’s onboarding message' } });
    const input = emitted[0]!.recommendation!.input;
    const card = await seoSaveProfileAction.reviewCard!({ orgId: ORG } as never, input);
    const body = (card.content![0] as { body: string }).body.replace(/^Goals.*$/m, 'Goals, most important first: AI answers, Organic leads').replace(/^Tone: .*$/m, 'Tone: plain, direct');

    expect(card.verbs?.approve).toBe('Save the profile');

    const edited = seoSaveProfileAction.applyContentEdits!(input, [{ id: 'profile', body }]);
    const result = await seoSaveProfileAction.execute({ orgId: ORG, reviewedBy: 'usr-mara' } as never, edited);
    const saved = (await getDataRoom(ORG, projectId))!.meta.seoProfile!;

    expect(result?.savedProfile).toEqual(saved);
    expect(saved).toMatchObject({ clientType: 'b2b_saas', goals: ['ai_answers', 'organic_leads'], tone: 'plain, direct', savedBy: 'usr-mara' });
    expect((await getDataRoom(ORG, projectId))!.meta.seoProfileDraft).toBeUndefined();
    expect(saved.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const md = renderDataRoom((await getDataRoomDetail(ORG, projectId))!);

    expect(md).toContain('## SEO profile');
    expect(md).toMatch(/1\. Named in AI answers: track the prompts/);

    await seoSaveProfileAction.undo!({ orgId: ORG } as never, edited, result);

    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile).toBeUndefined();
  });

  it('is never an agent\'s write: update_object refuses it, and the action always waits for a person', () => {
    expect(personOnlyRefusal('data_room', { seoProfile: { clientType: 'other' } })).toMatch(/seoProfile is set by a person/);
    expect(seoSaveProfileAction.approvalRequired).toBe(true);
    expect(isNeverAuto(seoSaveProfileAction)).toBe(true);
  });

  it('never runs on its own, even at the highest trust a workspace can give it: the card waits for a person', async () => {
    // The most a workspace can say: a trust rule with no bar, and the autonomous rung.
    await db.insert(trustRuleSchema).values({ orgId: ORG, actionId: 'seo.save_profile', threshold: 0, enabled: 'true' });
    await db.insert(autonomyPolicySchema).values({ orgId: ORG, actionId: 'seo.save_profile', rung: 'autonomous', riskTier: 'low', minConfidence: 0 });
    const emitted: Emitted[] = [];
    await seoProposeProfileTool({ orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext).invoke({ project_id: projectId, goals: ['organic_leads', 'ai_answers'], read_from: { goals: 'The person’s onboarding message' } });
    const rec = emitted[0]!.recommendation!;

    // Filed the way a chat turn files a recommendation, at full confidence, with the person's turn behind it.
    const filed = await fileRecommendation({ orgId: ORG, userId: 'usr-mara', conversationId: null, rec: { ...rec, label: 'Save the SEO profile', confidence: 1, agentSlug: 'seo-strategist' } as never });

    expect(filed?.status).toBe('pending');
    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile).toBeUndefined();

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.id, filed!.runId));

    expect(run).toMatchObject({ status: 'pending', actionId: 'seo.save_profile' });
  });

  it('records who pressed Save, and refuses to run with no person behind it', async () => {
    const emitted: Emitted[] = [];
    await seoProposeProfileTool({ orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext).invoke({ project_id: projectId, goals: ['organic_leads', 'ai_answers'], read_from: { goals: 'The person’s onboarding message' } });
    const input = emitted[0]!.recommendation!.input;

    // An agent's decision, or a trust rule's, is never written under the person's name.
    for (const reviewedBy of [undefined, 'agent:seo-strategist', 'trust-ladder']) {
      await expect(seoSaveProfileAction.execute({ orgId: ORG, ...(reviewedBy ? { reviewedBy } : {}), origin: { userId: 'usr-mara' }, invokedBy: 'usr-mara' } as never, input)).rejects.toThrow(/saved by a person pressing Save/);
    }

    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile).toBeUndefined();

    await seoSaveProfileAction.execute({ orgId: ORG, reviewedBy: 'usr-dana' } as never, input);

    expect((await getDataRoom(ORG, projectId))!.meta.seoProfile?.savedBy).toBe('usr-dana');
  });

  it('does not repeat approval for an unchanged human-approved profile, and isolates sourced changes', async () => {
    const before = (await getDataRoom(ORG, projectId))!.meta.seoProfile!;
    const emitted: Emitted[] = [];
    const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext;
    const unchanged = String(await seoProposeProfileTool(ctx).invoke({ project_id: projectId }));

    expect(unchanged).toContain('No new approval is needed');
    expect(emitted).toHaveLength(0);

    await seoProposeProfileTool(ctx).invoke({ project_id: projectId, goals: before.goals, read_from: { goals: 'The same approved priorities' } });

    expect(emitted).toHaveLength(0);

    await seoProposeProfileTool(ctx).invoke({ project_id: projectId, tone: 'precise', read_from: { tone: `${SITE}/voice` } });
    const room = (await getDataRoom(ORG, projectId))!;

    expect(room.meta.seoProfile).toEqual(before);
    expect(room.meta.seoProfileDraft?.profile.tone).toBe('precise');
    expect(room.meta.seoProfileDraft?.profile.savedBy).toBeUndefined();
    expect(emitted).toHaveLength(1);
  });

  it('excludes unsourced agent additions and does not infer goals or mutate another workspace', async () => {
    const fresh = (await createDataRoom(ORG, 'usr-mara', { title: 'Fresh Books', domains: ['fresh-books.example'] })).id;
    const emitted: Emitted[] = [];
    const ctx = { orgId: ORG, userId: 'usr-mara', agentSlug: 'seo-strategist', emit: (e: Emitted) => emitted.push(e) } as unknown as RuntimeContext;
    await seoProposeProfileTool(ctx).invoke({ project_id: fresh, audience: 'Invented audience', goals: ['rankings'] });
    const room = (await getDataRoom(ORG, fresh))!;

    expect(room.meta.seoProfileDraft?.profile.audience).toBeUndefined();
    expect(room.meta.seoProfileDraft?.profile.goals).toBeUndefined();
    expect(room.meta.seoProfile).toBeUndefined();
    expect(emitted).toHaveLength(0);

    const denied = String(await seoProposeProfileTool({ ...ctx, orgId: 'other-workspace' }).invoke({ project_id: fresh }));

    expect(denied).toContain('No project');
    expect((await getDataRoom(ORG, fresh))!.meta.seoProfileDraft).toEqual(room.meta.seoProfileDraft);
  });
});
