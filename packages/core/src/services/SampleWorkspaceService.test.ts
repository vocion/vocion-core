/**
 * teams.seedSample enforcement + shape (F1 slice 4): the gate is
 * server-side (any existing team rejects, idempotence included), the
 * bundle applies through the real loadWorkspace → applyWorkspace
 * pipeline against PGlite, and the result names what was created.
 * Negative fixtures (lead-less team / team-less workspace) load through
 * the same service via the test-only bundlePath override.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, skillSchema, teamSchema, tenantAccountSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { SAMPLE_USERS, SampleSeedBlockedError, seedSampleWorkspace } = await import('@/services/SampleWorkspaceService');
const { getWorkspaceLead, listTeams } = await import('@/services/TeamService');

const ORG = 'proj_seed_sample';
const ADMIN = { id: 'usr-seed-admin', name: 'Chris Fitkin', email: 'chris@example.com' };

const DEGRADED_FIXTURE = 'packages/core/templates/workspaces/fixtures/meridian-degraded';
const EMPTY_FIXTURE = 'packages/core/templates/workspaces/fixtures/meridian-empty';

async function cleanDb() {
  for (const table of [workspaceVersionSchema, teamSchema, agentSchema, skillSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
}

beforeEach(async () => {
  await cleanDb();
  await db.insert(userSchema).values(ADMIN);
  await db.insert(tenantAccountSchema).values({ id: 'acct-seed', name: 'Seed Test', slug: 'seed-test' });
  await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-seed', slug: 'seed-test', name: 'Seed Test' });
});

describe('seedSampleWorkspace gating', () => {
  it('rejects a workspace that already has ANY team — server-enforced, not just UI', async () => {
    await db.insert(teamSchema).values({ orgId: ORG, slug: 'existing', name: 'Existing' });

    await expect(seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email }))
      .rejects
      .toBeInstanceOf(SampleSeedBlockedError);

    // Nothing was applied.
    expect(await db.select().from(agentSchema).where(eq(agentSchema.orgId, ORG))).toEqual([]);
  });

  it('rejects a second seed (idempotence: the first seed creates teams, which trips the gate)', async () => {
    await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email });

    await expect(seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email }))
      .rejects
      .toBeInstanceOf(SampleSeedBlockedError);
  });
});

describe('seedSampleWorkspace on an empty workspace', () => {
  it('applies the Meridian bundle through the real pipeline and returns what was created', async () => {
    const result = await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email });

    expect(result.errors).toEqual([]);
    expect(result.teams.sort()).toEqual(['deal-desk', 'founder-gtm', 'marketing', 'revenue-ops']);
    expect(result.agents).toContain('revenue-director');
    expect(result.agents).toHaveLength(14);
    expect(result.counts.teams).toEqual({ created: 4, updated: 0, unchanged: 0 });
    expect(result.counts.agents.created).toBe(14);
    expect(result.counts.skills.created).toBe(2);
    expect(result.sha).toMatch(/^[0-9a-f]{8,}/);

    // The apply is audited like any other apply.
    const versions = await db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, ORG));

    expect(versions).toHaveLength(1);
    expect(versions[0]!.appliedBy).toBe('teams-seed-sample');
  });

  it('resolves accountability: caller is the workspace default, Marketing overrides with the sample user', async () => {
    await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email });

    const workspace = await getWorkspaceLead(ORG);

    expect(workspace.lead?.slug).toBe('revenue-director');
    expect(workspace.accountable).toMatchObject({ email: ADMIN.email, source: 'workspace' });

    const teams = await listTeams(ORG);
    const marketing = teams.find(t => t.slug === 'marketing')!;
    const revenueOps = teams.find(t => t.slug === 'revenue-ops')!;

    expect(marketing.accountable).toMatchObject({ name: 'Lili Chen', email: SAMPLE_USERS[0].email, source: 'team' });
    expect(revenueOps.accountable).toMatchObject({ email: ADMIN.email, source: 'workspace' });
    // Every team resolves a lead — full consult coverage.
    expect(teams.every(t => t.lead !== null)).toBe(true);
  });

  it('creates the sample user idempotently and without a password (display-only)', async () => {
    await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email });

    const [lili] = await db.select().from(userSchema).where(eq(userSchema.email, SAMPLE_USERS[0].email));

    expect(lili).toMatchObject({ name: 'Lili Chen', passwordHash: null });
  });

  it('tolerates a null owner email: applies cleanly with no workspace default (never invents an owner)', async () => {
    const result = await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: null });

    expect(result.errors).toEqual([]);

    const workspace = await getWorkspaceLead(ORG);

    expect(workspace.accountable).toBeNull();
  });
});

describe('negative fixtures (test-only bundlePath override)', () => {
  it('degraded fixture: a lead-less team applies and reads back as "no lead yet"', async () => {
    const result = await seedSampleWorkspace({ orgId: ORG, bundlePath: DEGRADED_FIXTURE });

    expect(result.errors).toEqual([]);
    expect(result.teams).toEqual(['warehouse']);

    const [warehouse] = await listTeams(ORG);

    expect(warehouse!.lead).toBeNull();
    expect(warehouse!.leadAgentSlug).toBeNull();
    expect(warehouse!.members.map(m => m.slug)).toEqual(['stock-checker']);
    expect((await getWorkspaceLead(ORG)).lead).toBeNull();
  });

  it('empty fixture: agents but zero teams — and a later real seed still passes the gate', async () => {
    const first = await seedSampleWorkspace({ orgId: ORG, bundlePath: EMPTY_FIXTURE });

    expect(first.teams).toEqual([]);
    expect(await listTeams(ORG)).toEqual([]);

    // Zero teams means the gate is still open for the real sample.
    const second = await seedSampleWorkspace({ orgId: ORG, workspaceOwnerEmail: ADMIN.email });

    expect(second.counts.teams.created).toBe(4);
  });
});
