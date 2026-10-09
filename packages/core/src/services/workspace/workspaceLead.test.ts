/**
 * The workspace lead core seeds into a new shared workspace, against PGlite.
 *
 * The cases that matter are the ones that would fail silently: a second lead
 * in a workspace that already has a team, a lead written into somebody else's
 * workspace, a personal workspace given a stranger, a second row on a double
 * click. Each is asked directly.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { agentSchema, playbookSchema, projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { ensureWorkspaceLead, workspaceLeadTemplate, workspaceSetupSkillTemplate } = await import('./workspaceLead');
const { onlyTheSeededLead, seededLeadSurvives, WORKSPACE_LEAD_SLUG, WORKSPACE_SETUP_SKILL } = await import('@/libs/workspace/workspaceLead');
const { mountSkills } = await import('@/services/playbooks/mount');

const NORTHWIND = 'acct-northwind-lead';
const SUPPORT = 'proj-lead-support'; // shared, new
const DELIVERY = 'proj-lead-delivery'; // shared, new — the neighbour
const PERSONAL = 'proj-lead-personal'; // a person's own

async function agentsOf(projectId: string) {
  return db.select().from(agentSchema).where(eq(agentSchema.orgId, projectId));
}

async function skillsOf(projectId: string) {
  return db.select().from(playbookSchema).where(eq(playbookSchema.orgId, projectId));
}

async function leadOf(projectId: string): Promise<string | null> {
  const [row] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, projectId));
  return row?.lead ?? null;
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: NORTHWIND, name: 'Northwind', slug: 'northwind-lead' });
});

beforeEach(async () => {
  await db.delete(agentSchema);
  await db.delete(playbookSchema);
  await db.delete(projectSchema);
  await db.insert(projectSchema).values([
    { id: SUPPORT, accountId: NORTHWIND, slug: 'support', name: 'Northwind Support' },
    { id: DELIVERY, accountId: NORTHWIND, slug: 'delivery', name: 'Northwind Delivery' },
    { id: PERSONAL, accountId: NORTHWIND, slug: 'dana', name: 'Dana', kind: 'personal' },
  ]);
});

describe('the template', () => {
  it('is the one shared definition the chat and the applier read', () => {
    expect(workspaceLeadTemplate().slug).toBe(WORKSPACE_LEAD_SLUG);
    expect(workspaceLeadTemplate().skills).toEqual([WORKSPACE_SETUP_SKILL]);
    expect(workspaceSetupSkillTemplate().manifest.slug).toBe(WORKSPACE_SETUP_SKILL);
  });

  it('holds the setup tools and nothing else beyond the defaults', () => {
    expect(workspaceLeadTemplate().harness.grantTools).toEqual(['setup_options', 'propose_setup', 'propose_brand']);
  });

  it('names no company, app, plugin, connector or catalog role — what it sets up comes from the person and the installation', async () => {
    const [{ listAppIds }, { listPluginSlugs }, { listConnectors }, { listCatalog }] = await Promise.all([
      import('@/libs/workspace/apps'),
      import('@/libs/workspace/plugins'),
      import('@/libs/sources/registry'),
      import('@/services/CatalogService'),
    ]);
    const text = `${workspaceLeadTemplate().systemPrompt}\n${workspaceSetupSkillTemplate().body}`.toLowerCase();
    // Whole words only: "github" in the prose is a concretion, "hub" in "hubspot" is not ours to judge.
    const named = [
      ...listAppIds().filter(id => id !== 'workforce'),
      ...listPluginSlugs(),
      ...listConnectors().map(c => c.slug),
      ...listCatalog().map(e => e.slug),
    ].filter(slug => new RegExp(`(^|[^a-z-])${slug.replace(/-/g, '\\-')}([^a-z-]|$)`).test(text));

    expect(named).toEqual([]);
  });
});

describe('ensureWorkspaceLead', () => {
  it('gives a new shared workspace its lead, its setup skill, and makes it the lead', async () => {
    expect(await ensureWorkspaceLead(SUPPORT)).toBe(true);

    const [agent] = await agentsOf(SUPPORT);

    expect(agent).toMatchObject({ slug: WORKSPACE_LEAD_SLUG, name: 'Lead', role: 'lead', active: 'true', projectId: SUPPORT });
    expect(agent?.skillSlugs).toEqual([WORKSPACE_SETUP_SKILL]);
    expect(agent?.harnessConfig).toMatchObject({ grantTools: ['setup_options', 'propose_setup', 'propose_brand'] });

    const [skill] = await skillsOf(SUPPORT);

    expect(skill).toMatchObject({ slug: WORKSPACE_SETUP_SKILL, kind: 'skill', origin: 'core', projectId: SUPPORT });
    expect(await leadOf(SUPPORT)).toBe(WORKSPACE_LEAD_SLUG);
  });

  it('is idempotent: twice, or three times at once, is once', async () => {
    await ensureWorkspaceLead(SUPPORT);
    await ensureWorkspaceLead(SUPPORT);
    await Promise.all([ensureWorkspaceLead(SUPPORT), ensureWorkspaceLead(SUPPORT), ensureWorkspaceLead(SUPPORT)]);

    expect(await agentsOf(SUPPORT)).toHaveLength(1);
    expect(await skillsOf(SUPPORT)).toHaveLength(1);
  });

  it('is tenant-scoped: seeding one workspace writes nothing into its neighbour', async () => {
    await ensureWorkspaceLead(SUPPORT);

    expect(await agentsOf(DELIVERY)).toHaveLength(0);
    expect(await skillsOf(DELIVERY)).toHaveLength(0);
    expect(await leadOf(DELIVERY)).toBeNull();

    // …and the neighbour's own seed is its own row, not a shared one.
    await ensureWorkspaceLead(DELIVERY);
    const rows = await db.select({ orgId: agentSchema.orgId }).from(agentSchema).where(eq(agentSchema.slug, WORKSPACE_LEAD_SLUG));

    expect(rows.map(r => r.orgId).sort()).toEqual([DELIVERY, SUPPORT].sort());
  });

  it('leaves a personal workspace alone — it has its own assistant', async () => {
    expect(await ensureWorkspaceLead(PERSONAL)).toBe(false);
    expect(await agentsOf(PERSONAL)).toHaveLength(0);
  });

  it('never gives a workspace that has any agent a second lead — an authored one, or one retired', async () => {
    await db.insert(agentSchema).values({ orgId: SUPPORT, projectId: SUPPORT, slug: 'support-lead', name: 'Support lead', systemPrompt: 'x', active: 'false' });

    expect(await ensureWorkspaceLead(SUPPORT)).toBe(false);
    expect((await agentsOf(SUPPORT)).map(a => a.slug)).toEqual(['support-lead']);
    expect(await skillsOf(SUPPORT)).toHaveLength(0);
  });

  it('keeps a lead the workspace already named', async () => {
    await db.update(projectSchema).set({ leadAgentSlug: 'chosen-lead' }).where(eq(projectSchema.id, SUPPORT));
    await ensureWorkspaceLead(SUPPORT);

    expect(await leadOf(SUPPORT)).toBe('chosen-lead');
  });

  it('answers false for a workspace that does not exist, and writes nothing', async () => {
    expect(await ensureWorkspaceLead('proj-lead-missing')).toBe(false);
    expect(await db.select().from(agentSchema).where(and(eq(agentSchema.orgId, 'proj-lead-missing')))).toHaveLength(0);
  });

  it('mounts the setup skill from the template — no workspace folder needed', async () => {
    await ensureWorkspaceLead(SUPPORT);
    const mounted = await mountSkills({ orgId: SUPPORT, skillSlugs: [WORKSPACE_SETUP_SKILL], playbookSlugs: [] });
    const body = mounted[`/skills/${WORKSPACE_SETUP_SKILL}/SKILL.md`];

    expect(body).toContain('propose_setup');
    expect(body).toContain('three questions at most');
  });
});

describe('the rules the chat and the applier read', () => {
  it('a roster of only the seeded lead is a first day; anything more is a team', () => {
    expect(onlyTheSeededLead([WORKSPACE_LEAD_SLUG])).toBe(true);
    expect(onlyTheSeededLead([WORKSPACE_LEAD_SLUG, 'reporting-analyst'])).toBe(false);
    expect(onlyTheSeededLead(['support-lead'])).toBe(false);
    expect(onlyTheSeededLead([])).toBe(false);
  });

  it('the seeded lead outlives an apply until the workspace names a lead of its own', () => {
    expect(seededLeadSurvives(null)).toBe(true);
    expect(seededLeadSurvives(undefined)).toBe(true);
    expect(seededLeadSurvives(WORKSPACE_LEAD_SLUG)).toBe(true);
    expect(seededLeadSurvives('support-lead')).toBe(false);
  });
});
