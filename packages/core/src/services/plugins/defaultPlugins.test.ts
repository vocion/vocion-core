/**
 * Plugins on by default, on PGlite: the Workspace manager reaches a shared
 * workspace through the app install path, once; a person who turns it off
 * keeps it off; a personal workspace is never touched. Fictional names only.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { agentSchema, automationSchema, missionSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { defaultOnPluginSlugs, ensureDefaultPluginsFor, missingDefaults } = await import('./defaultPlugins');
const { togglePluginForProject } = await import('@/services/PluginService');

const SHARED = 'proj_defaults_northwind';
const PERSONAL = 'proj_defaults_personal';

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-defaults', name: 'Northwind', slug: 'northwind-defaults' });
  await db.insert(projectSchema).values([
    { id: SHARED, accountId: 'acct-defaults', slug: 'northwind-defaults', name: 'Northwind', kind: 'shared', timeZone: 'America/Chicago' },
    { id: PERSONAL, accountId: 'acct-defaults', slug: 'personal-defaults', name: 'Personal', kind: 'personal' },
  ]);
});

describe('which plugins are on by default', () => {
  it('is the Workspace manager, declared in its own plugin.yaml', () => {
    expect(defaultOnPluginSlugs()).toContain('workspace-manager');
  });

  it('gives a workspace only what it does not have and never had', () => {
    expect(missingDefaults(['workspace-manager'], [], [])).toEqual(['workspace-manager']);
    expect(missingDefaults(['workspace-manager'], ['workspace-manager'], [])).toEqual([]);
    // Installed once and turned off since: off sticks.
    expect(missingDefaults(['workspace-manager'], [], ['workspace-manager'])).toEqual([]);
  });
});

describe('turning them on', () => {
  it('installs the Workspace manager in a shared workspace: the agent, its mission and its two automations in the workspace\'s zone', async () => {
    expect(await ensureDefaultPluginsFor(SHARED)).toEqual(['workspace-manager']);

    const [project] = await db.select({ enabled: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, SHARED));

    expect(project!.enabled).toContain('workspace-manager');

    const [agent] = await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, SHARED), eq(agentSchema.slug, 'workspace-manager')));

    expect((agent!.harnessConfig as { grantTools?: string[] }).grantTools).toContain('run_usage_review');

    const automations = await db.select().from(automationSchema).where(eq(automationSchema.orgId, SHARED));
    const check = automations.find(a => a.slug === 'usage-review-check')!;
    const review = automations.find(a => a.slug === 'usage-review')!;

    expect(check.whenConfig).toMatchObject({ schedule: '0 6 * * *', timezone: 'America/Chicago' });
    expect(check.doConfig).toMatchObject({ job: 'usage-review-check' });
    expect(review.whenConfig).toMatchObject({ event: 'usage.review_due' });
    expect(review.doConfig).toMatchObject({ checkMission: 'daily-usage-review', requireTool: 'run_usage_review' });
    expect(await db.select().from(missionSchema).where(and(eq(missionSchema.orgId, SHARED), eq(missionSchema.slug, 'daily-usage-review')))).toHaveLength(1);

    // Once: a second pass finds nothing to do.
    expect(await ensureDefaultPluginsFor(SHARED)).toBeNull();
  });

  it('keeps it off once a person turned it off', async () => {
    await togglePluginForProject({ orgId: SHARED, projectSlug: 'northwind-defaults', workspaceDir: null, slug: 'workspace-manager', enabled: false, appliedBy: 'user-ada' });

    expect(await ensureDefaultPluginsFor(SHARED)).toBeNull();

    const [project] = await db.select({ enabled: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, SHARED));

    expect(project!.enabled ?? []).not.toContain('workspace-manager');
  });

  it('never touches a personal workspace', async () => {
    expect(await ensureDefaultPluginsFor(PERSONAL)).toBeNull();
  });
});
