/**
 * Turning an app on in a workspace with no folder (Vocion Cloud) sets the
 * whole app up — on PGlite, against the marketing plugin as it ships. Every
 * workspace, person and agent name here is fictional.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, automationSchema, missionSchema, projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { togglePluginForProject, addPluginsForProject } = await import('@/services/PluginService');
const { installManifest, installPluginBundles, leadToAdopt } = await import('./installBundle');

const CLOUD = 'proj_install_northwind';
const LED = 'proj_install_kestrel';
const REPO = 'proj_install_harbor';

const agentRow = async (orgId: string, slug: string) => (await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug))))[0];
const automationsOf = async (orgId: string) => db.select().from(automationSchema).where(eq(automationSchema.orgId, orgId));
const missionOf = async (orgId: string, slug: string) => (await db.select().from(missionSchema).where(and(eq(missionSchema.orgId, orgId), eq(missionSchema.slug, slug))))[0];
const leadOf = async (orgId: string) => (await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)))[0]?.lead ?? null;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-install', name: 'Northwind Cloud', slug: 'northwind-install' });
  await db.insert(projectSchema).values([
    // Made in the app: no folder, the generic lead core seeds, Pacific time.
    { id: CLOUD, accountId: 'acct-install', slug: 'northwind', name: 'Northwind', timeZone: 'America/Los_Angeles', leadAgentSlug: 'workspace-lead' },
    // A person chose this workspace's lead.
    { id: LED, accountId: 'acct-install', slug: 'kestrel', name: 'Kestrel', timeZone: 'America/New_York', leadAgentSlug: 'ops-lead' },
    // Applied from its folder in a workspace repo.
    { id: REPO, accountId: 'acct-install', slug: 'harbor', name: 'Harbor' },
  ]);
  await db.insert(agentSchema).values([
    { orgId: CLOUD, slug: 'workspace-lead', name: 'Workspace lead', systemPrompt: 'x', active: 'true' },
    { orgId: CLOUD, slug: 'research-helper', name: 'Research helper', systemPrompt: 'x', active: 'true' },
    { orgId: LED, slug: 'ops-lead', name: 'Ops lead', systemPrompt: 'x', active: 'true' },
  ]);
  await db.insert(workspaceVersionSchema).values({ orgId: REPO, sha: 'repo-sha', status: 'applied', sourcePath: '/workspace/harbor', appliedBy: 'deploy' });
});

afterEach(() => {
  delete process.env.VOCION_SCHEDULE_OWNER;
});

describe('turning an app on in a workspace with no folder', () => {
  it('sets up its agent, mission and automations, in the workspace\'s time zone, and its lead leads', async () => {
    const res = await togglePluginForProject({ orgId: CLOUD, projectSlug: 'northwind', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'user:mara' });

    expect(res.mode).toBe('project');
    expect(res.installed).toMatchObject({ plugins: ['marketing'], errors: 0, leadAdopted: 'marketing-lead' });
    expect(res.note).toContain('set up its agents, missions and automations');
    expect(res.note).not.toContain('applied from git');

    expect((await agentRow(CLOUD, 'marketing-lead'))?.active).toBe('true');
    expect((await missionOf(CLOUD, 'daily-marketing-update'))?.status).toBe('active');

    const automations = await automationsOf(CLOUD);
    const scheduled = automations.filter(a => (a.whenConfig as { schedule?: string }).schedule);

    expect(automations.length).toBeGreaterThanOrEqual(3);
    expect(scheduled.length).toBeGreaterThan(0);
    // `timezone: workspace` is read as this workspace's clock.
    expect(scheduled.every(a => (a.whenConfig as { timezone?: string }).timezone === 'America/Los_Angeles')).toBe(true);
    expect(await leadOf(CLOUD)).toBe('marketing-lead');

    // Recorded as an install, never as a folder apply.
    const [version] = await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, CLOUD));

    expect(version?.sourcePath).toBe('app:marketing');
  });

  it('touches nothing else in the workspace', async () => {
    expect((await agentRow(CLOUD, 'research-helper'))?.active).toBe('true');
    expect((await agentRow(CLOUD, 'workspace-lead'))?.active).toBe('true');
  });

  it('is idempotent: setting it up again creates nothing', async () => {
    const before = (await automationsOf(CLOUD)).length;
    const again = await installPluginBundles({ orgId: CLOUD, plugins: ['marketing'], appliedBy: 'test' });

    expect(again.counts.agents.created).toBe(0);
    expect(again.counts.missions.created).toBe(0);
    expect(again.counts.automations.created).toBe(0);
    expect((await automationsOf(CLOUD)).length).toBe(before);
  });

  it('turned off, it is put away and kept; turned on again, the same rows come back', async () => {
    const off = await togglePluginForProject({ orgId: CLOUD, projectSlug: 'northwind', workspaceDir: null, slug: 'marketing', enabled: false, appliedBy: 'user:mara' });

    expect(off.installed).toMatchObject({ leadRestored: 'workspace-lead' });
    expect(off.note).toContain('Nothing was deleted');
    expect((await agentRow(CLOUD, 'marketing-lead'))?.active).toBe('false');
    expect((await missionOf(CLOUD, 'daily-marketing-update'))?.status).toBe('disabled');
    expect((await automationsOf(CLOUD)).every(a => a.status === 'disabled')).toBe(true);
    expect(await leadOf(CLOUD)).toBe('workspace-lead');

    const ids = (await automationsOf(CLOUD)).map(a => a.id).sort();
    await addPluginsForProject({ orgId: CLOUD, projectSlug: 'northwind', workspaceDir: null, slugs: ['marketing'], appliedBy: 'user:mara' });

    expect((await agentRow(CLOUD, 'marketing-lead'))?.active).toBe('true');
    expect((await missionOf(CLOUD, 'daily-marketing-update'))?.status).toBe('active');
    expect((await automationsOf(CLOUD)).map(a => a.id).sort()).toEqual(ids);
    expect(await leadOf(CLOUD)).toBe('marketing-lead');
  });

  it('never replaces a lead a person chose', async () => {
    const res = await togglePluginForProject({ orgId: LED, projectSlug: 'kestrel', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'test' });

    expect(res.installed).toMatchObject({ leadAdopted: null });
    expect(await leadOf(LED)).toBe('ops-lead');

    const scheduled = (await automationsOf(LED)).filter(a => (a.whenConfig as { schedule?: string }).schedule);

    expect(scheduled.every(a => (a.whenConfig as { timezone?: string }).timezone === 'America/New_York')).toBe(true);
  });
});

describe('a workspace applied from its folder', () => {
  it('keeps today\'s behaviour: the column changes, the repo is named, nothing is set up', async () => {
    const res = await togglePluginForProject({ orgId: REPO, projectSlug: 'harbor', workspaceDir: null, slug: 'marketing', enabled: true, appliedBy: 'test' });

    expect(res.installed).toBeUndefined();
    expect(res.note).toContain('applied from git');
    expect(await agentRow(REPO, 'marketing-lead')).toBeUndefined();
    expect(await automationsOf(REPO)).toEqual([]);
  });
});

describe('the pieces', () => {
  it('reads the bundle through a manifest with the project\'s clock', () => {
    expect(installManifest({ orgId: 'o', name: 'N', timeZone: 'Europe/Lisbon' }, ['marketing'])).toEqual({ version: 2, orgId: 'o', name: 'N', plugins: ['marketing'], defaults: { timezone: 'Europe/Lisbon' } });
    expect(installManifest({ orgId: 'o', name: 'N', timeZone: null }, ['marketing'])).not.toHaveProperty('defaults');
  });

  it('adopts a plugin\'s lead only over no lead or the generic one', () => {
    expect(leadToAdopt(null, [{ lead: 'marketing-lead' }])).toBe('marketing-lead');
    expect(leadToAdopt('workspace-lead', [{}, { lead: 'marketing-lead' }])).toBe('marketing-lead');
    expect(leadToAdopt('ops-lead', [{ lead: 'marketing-lead' }])).toBeNull();
    expect(leadToAdopt(null, [{}])).toBeNull();
  });
});
