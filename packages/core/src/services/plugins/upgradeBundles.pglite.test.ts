/**
 * An installed app follows core's new version — on PGlite, against the SEO and
 * marketing plugins as they ship. "An older release" is simulated by putting
 * the rows and the install's record back to what older templates would have
 * written. Every workspace, person and agent name here is fictional.
 */
import type { AppBundleRecord } from '@/libs/workspace/bundleTrack';
import { and, desc, eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, automationSchema, autonomyPolicySchema, projectSchema, tenantAccountSchema, trustRuleSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { installPluginBundles, pluginTemplateHash, retirePluginBundles } = await import('./installBundle');
const { upgradeInstalledApps, APP_UPGRADE_BY } = await import('./upgradeBundles');
const { valueHash } = await import('@/libs/workspace/bundleTrack');
const { loadPlugin } = await import('@/libs/workspace/plugins');

const SEO = 'proj_upgrade_northwind';
const ADS = 'proj_upgrade_contoso';
const OFF = 'proj_upgrade_bellwater';
const REPO = 'proj_upgrade_harbor';
const OLD = 'proj_upgrade_kestrel';
const SEO_PLUGINS = ['data-rooms', 'wiki', 'seo'];

const agentRow = async (orgId: string, slug: string) => (await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))))[0]!;
const automationRow = async (orgId: string, slug: string) => (await db.select().from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, slug))))[0];
const versions = async (orgId: string) => db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, orgId)).orderBy(desc(workspaceVersionSchema.appliedAt), desc(workspaceVersionSchema.id));
const grantTools = (row: { harnessConfig: unknown }) => (row.harnessConfig as { grantTools?: string[] } | null)?.grantTools ?? [];

/**
 * Put a workspace back to what an older release of `plugin` installed: its
 * record names other templates, and each row given here holds the older
 * value, recorded as what the bundle wrote.
 * @param orgId - The workspace.
 * @param plugin - The plugin whose templates "changed".
 * @param older - What the older templates wrote.
 * @param older.agents - Agent slug → older fields.
 * @param older.automations - Automation slug → older fields.
 * @param older.dropped - Automation slugs the older templates shipped and the new ones do not.
 */
async function asIfInstalledFromOlderRelease(orgId: string, plugin: string, older: { agents?: Record<string, Record<string, unknown>>; automations?: Record<string, Record<string, unknown>>; dropped?: string[] }): Promise<void> {
  const [row] = (await versions(orgId)).filter(v => v.sourcePath?.startsWith('app:'));
  const bundle = structuredClone(row!.bundle!) as AppBundleRecord;
  bundle.hashes[plugin] = 'older-templates';
  for (const [slug, fields] of Object.entries(older.agents ?? {})) {
    await db.update(agentSchema).set(fields).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)));
    Object.assign(bundle.fields.agent![slug]!, Object.fromEntries(Object.entries(fields).map(([f, v]) => [f, valueHash(v)])));
  }
  for (const [slug, fields] of Object.entries(older.automations ?? {})) {
    await db.update(automationSchema).set(fields).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, slug)));
    Object.assign(bundle.fields.automation![slug]!, Object.fromEntries(Object.entries(fields).map(([f, v]) => [f, valueHash(v)])));
  }
  for (const slug of older.dropped ?? []) {
    await db.insert(automationSchema).values({ orgId, slug, name: 'Old digest', status: 'active', whenConfig: { event: 'test.event' }, doConfig: { prompt: 'Write the old digest.' } });
    bundle.contents[plugin]!.automations.push(slug);
  }
  await db.update(workspaceVersionSchema).set({ bundle }).where(eq(workspaceVersionSchema.id, row!.id));
}

let freshStrategist: Awaited<ReturnType<typeof agentRow>>;
let freshGuard: NonNullable<Awaited<ReturnType<typeof automationRow>>>;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-upgrade', name: 'Northwind Cloud', slug: 'northwind-upgrade' });
  await db.insert(projectSchema).values([
    { id: SEO, accountId: 'acct-upgrade', slug: 'northwind', name: 'Northwind', timeZone: 'America/Los_Angeles', enabledPlugins: SEO_PLUGINS },
    { id: ADS, accountId: 'acct-upgrade', slug: 'contoso', name: 'Contoso Supply', timeZone: 'America/New_York', enabledPlugins: ['marketing'] },
    { id: OFF, accountId: 'acct-upgrade', slug: 'bellwater', name: 'Bellwater Hall', enabledPlugins: ['marketing'] },
    { id: REPO, accountId: 'acct-upgrade', slug: 'harbor', name: 'Harbor', enabledPlugins: ['marketing'] },
    { id: OLD, accountId: 'acct-upgrade', slug: 'kestrel', name: 'Kestrel Capital', enabledPlugins: ['marketing'] },
  ]);
  await installPluginBundles({ orgId: SEO, plugins: ['seo'], appliedBy: 'user:mara' });
  for (const orgId of [ADS, OFF, REPO, OLD]) {
    await installPluginBundles({ orgId, plugins: ['marketing'], appliedBy: 'user:mara' });
  }
  freshStrategist = await agentRow(SEO, 'seo-strategist');
  freshGuard = (await automationRow(ADS, 'marketing-guard'))!;
});

describe('an install records what it wrote', () => {
  it('names each plugin\'s templates, what they ship and what each owned field holds', async () => {
    const [row] = await versions(SEO);

    expect(row?.sourcePath).toBe('app:data-rooms,wiki,seo');
    expect(row?.sha).toMatch(/^app-[0-9a-f]{12}\+data-rooms@/);
    expect(row?.bundle?.hashes.seo).toBe(pluginTemplateHash(loadPlugin('seo')));
    expect(row?.bundle?.contents.seo?.agents).toContain('seo-strategist');
    expect(row?.bundle?.fields.agent?.['seo-strategist']?.systemPrompt).toBe(valueHash(freshStrategist.systemPrompt));
    expect(row?.bundle?.fields.agent?.['seo-strategist']).not.toHaveProperty('active');
  });
});

describe('an installed app follows core\'s new version', () => {
  it('leaves an app whose templates did not change alone: no write, no version row', async () => {
    const before = await versions(ADS);
    const out = await upgradeInstalledApps({ orgIds: [ADS] });

    expect(out).toEqual({ checked: 1, upgraded: [], failed: [] });
    expect(await versions(ADS)).toHaveLength(before.length);
  });

  it('brings an agent\'s granted tools and prompt up to the new templates, and keeps a person\'s own prompt', async () => {
    const olderHarness = { ...(freshStrategist.harnessConfig as Record<string, unknown>), grantTools: ['serp'] };
    await asIfInstalledFromOlderRelease(SEO, 'seo', {
      agents: {
        'seo-strategist': { systemPrompt: 'You plan SEO pages.', harnessConfig: olderHarness },
        'seo-writer': { systemPrompt: 'You write SEO pages.' },
      },
    });
    // After the older install, a person rewrote the writer's prompt in the app.
    await db.update(agentSchema).set({ systemPrompt: 'Write like Mara: short sentences, no jargon.' }).where(and(eq(agentSchema.orgId, SEO), eq(agentSchema.slug, 'seo-writer')));
    // …and promoted the page writes a rung, in the app.
    await db.insert(autonomyPolicySchema).values({ orgId: SEO, actionId: 'objects.update_meta.seo_page', rung: 'execute-within-bounds', riskTier: 'medium', source: 'app', promotedBy: 'user:mara' }).onConflictDoUpdate({ target: [autonomyPolicySchema.orgId, autonomyPolicySchema.actionId], set: { rung: 'execute-within-bounds', source: 'app', promotedBy: 'user:mara' } });
    await db.update(trustRuleSchema).set({ enabled: 'true' }).where(and(eq(trustRuleSchema.orgId, SEO), eq(trustRuleSchema.actionId, 'objects.update_meta.seo_page')));

    const out = await upgradeInstalledApps({ orgIds: [SEO] });

    expect('upgraded' in out && out.upgraded).toHaveLength(1);

    const strategist = await agentRow(SEO, 'seo-strategist');

    expect(grantTools(strategist)).toEqual(expect.arrayContaining(['serp', 'site_inventory', 'record_competitors']));
    expect(strategist.systemPrompt).toBe(freshStrategist.systemPrompt);
    expect((await agentRow(SEO, 'seo-writer')).systemPrompt).toBe('Write like Mara: short sentences, no jargon.');

    const [policy] = await db.select().from(autonomyPolicySchema).where(and(eq(autonomyPolicySchema.orgId, SEO), eq(autonomyPolicySchema.actionId, 'objects.update_meta.seo_page')));

    expect(policy).toMatchObject({ rung: 'execute-within-bounds', source: 'app' });

    // Recorded as the app moving, with what was kept.
    const [row] = await versions(SEO);

    expect(row).toMatchObject({ sourcePath: 'app:data-rooms,wiki,seo', appliedBy: APP_UPGRADE_BY, status: 'applied' });
    expect(row?.bundle?.from?.seo).toBe('older-templates');
    expect(row?.bundle?.hashes.seo).toBe(pluginTemplateHash(loadPlugin('seo')));
    expect(row?.bundle?.kept).toEqual(expect.arrayContaining([
      { resource: 'agent', slug: 'seo-writer', field: 'systemPrompt' },
      { resource: 'trustRule', slug: 'objects.update_meta.seo_page', field: 'rung' },
    ]));
    expect(row?.bundle?.kept).not.toContainEqual(expect.objectContaining({ slug: 'seo-strategist' }));
  });

  it('keeps the person\'s prompt on the next release too', async () => {
    await asIfInstalledFromOlderRelease(SEO, 'seo', {});
    await upgradeInstalledApps({ orgIds: [SEO] });

    expect((await agentRow(SEO, 'seo-writer')).systemPrompt).toBe('Write like Mara: short sentences, no jargon.');
    expect((await versions(SEO))[0]?.bundle?.kept).toContainEqual({ resource: 'agent', slug: 'seo-writer', field: 'systemPrompt' });
  });

  it('keeps a schedule a person changed, takes the rest, and disables what the new templates dropped', async () => {
    await asIfInstalledFromOlderRelease(ADS, 'marketing', {
      automations: { 'marketing-guard': { doConfig: { job: 'ads-guard-v0' } } },
      dropped: ['marketing-old-digest'],
    });
    const personal = { ...(freshGuard.whenConfig as Record<string, unknown>), schedule: '0 9 * * 1-5' };
    await db.update(automationSchema).set({ whenConfig: personal }).where(and(eq(automationSchema.orgId, ADS), eq(automationSchema.slug, 'marketing-guard')));

    const out = await upgradeInstalledApps({ orgIds: [ADS] });

    expect('upgraded' in out && out.upgraded[0]?.retired.automations).toEqual(['marketing-old-digest']);

    const guard = await automationRow(ADS, 'marketing-guard');

    expect(guard?.whenConfig).toEqual(personal);
    expect(guard?.doConfig).toEqual(freshGuard.doConfig);
    // Disabled the way turning the app off disables it; the row is kept.
    expect((await automationRow(ADS, 'marketing-old-digest'))?.status).toBe('disabled');
  });

  it('brings an install from before records existed up to date, the templates winning', async () => {
    await db.update(workspaceVersionSchema).set({ bundle: null }).where(eq(workspaceVersionSchema.orgId, OLD));
    await db.update(agentSchema).set({ systemPrompt: 'You run paid search.' }).where(and(eq(agentSchema.orgId, OLD), eq(agentSchema.slug, 'marketing-lead')));

    await upgradeInstalledApps({ orgIds: [OLD] });

    expect((await agentRow(OLD, 'marketing-lead')).systemPrompt).toBe((await agentRow(ADS, 'marketing-lead')).systemPrompt);
    expect((await versions(OLD))[0]?.bundle?.from).toEqual({ marketing: null });
  });

  it('never touches a workspace applied from its folder', async () => {
    await db.insert(workspaceVersionSchema).values({ orgId: REPO, sha: 'repo-sha', status: 'applied', sourcePath: '/workspace/harbor', appliedBy: 'deploy' });
    await asIfInstalledFromOlderRelease(REPO, 'marketing', { agents: { 'marketing-lead': { systemPrompt: 'Folder prompt.' } } });
    const before = await versions(REPO);

    await upgradeInstalledApps({ orgIds: [REPO] });

    expect((await agentRow(REPO, 'marketing-lead')).systemPrompt).toBe('Folder prompt.');
    expect(await versions(REPO)).toHaveLength(before.length);
  });

  it('never touches an app that was turned off', async () => {
    await asIfInstalledFromOlderRelease(OFF, 'marketing', { agents: { 'marketing-lead': { systemPrompt: 'Old prompt.' } } });
    await retirePluginBundles({ orgId: OFF, plugins: ['marketing'], stillOn: [] });
    await db.update(projectSchema).set({ enabledPlugins: [] }).where(eq(projectSchema.id, OFF));
    const before = await versions(OFF);

    await upgradeInstalledApps({ orgIds: [OFF] });

    expect(await agentRow(OFF, 'marketing-lead')).toMatchObject({ systemPrompt: 'Old prompt.', active: 'false' });
    expect(await versions(OFF)).toHaveLength(before.length);
  });

  it('is idempotent: a second pass over every workspace changes nothing', async () => {
    await asIfInstalledFromOlderRelease(ADS, 'marketing', {});
    const first = await upgradeInstalledApps();
    const count = async () => (await db.select({ n: sql<number>`count(*)::int` }).from(workspaceVersionSchema))[0]!.n;
    const rows = await count();
    const second = await upgradeInstalledApps();

    expect('upgraded' in first && first.upgraded.map(u => u.orgId)).toEqual([ADS]);
    expect(second).toMatchObject({ upgraded: [], failed: [] });
    expect(await count()).toBe(rows);
  });

  it('runs one pass at a time', async () => {
    const both = await Promise.all([upgradeInstalledApps(), upgradeInstalledApps()]);

    expect(both.filter(r => 'skipped' in r)).toEqual([{ skipped: 'locked' }]);
  });
});
