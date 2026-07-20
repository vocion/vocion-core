/**
 * Teams authoring round-trip (acceptance #8–9): a workspace declaring
 * `lead:`, a workspace `accountableUser:`, and teams applies cleanly;
 * re-applying is a no-op; and the export mapping reproduces the authored
 * YAML — with inherited accountability NOT baked in as explicit values.
 * DB is the PGlite mock; Temporal is stubbed unreachable (the applier
 * skips schedule reconciliation by design).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
}));

const { db } = await import('@/libs/DB');
const { agentSchema, projectSchema, teamSchema, tenantAccountSchema, userSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { projectLeadToManifestKeys, teamRowToManifest } = await import('./team-export');

const { eq } = await import('drizzle-orm');

const ORG = 'proj_roundtrip';
const CHRIS = { id: 'usr-rt-chris', name: 'Chris Fitkin', email: 'chris@metacto.com' };
const LILI = { id: 'usr-rt-lili', name: 'Lili Chen', email: 'lili@metacto.com' };

const REVENUE_OPS_YAML = 'name: Revenue Operations\ndescription: Pipeline, follow-ups, and buyer insight.\nlead: revenue-lead\n';
const MARKETING_YAML = `name: Marketing\nlead: marketing-lead\naccountableUser: ${LILI.email}\n`;

function writeFixtureWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-team-rt-'));
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: roundtrip\nlead: revenue-director\naccountableUser: ${CHRIS.email}\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'revenue-director.yaml'), 'slug: revenue-director\nname: Revenue Director\nsystemPrompt: You run the workspace.\n');
  writeFileSync(join(dir, 'agents', 'revenue-lead.yaml'), 'slug: revenue-lead\nname: Revenue Lead\nsystemPrompt: You lead revenue ops.\n');
  writeFileSync(join(dir, 'agents', 'pipeline-analyst.yaml'), 'slug: pipeline-analyst\nname: Pipeline Analyst\nsystemPrompt: You analyze.\nparent: revenue-lead\nteam: revenue-ops\n');
  writeFileSync(join(dir, 'agents', 'marketing-lead.yaml'), 'slug: marketing-lead\nname: Marketing Lead\nsystemPrompt: You lead marketing.\n');
  mkdirSync(join(dir, 'teams'));
  writeFileSync(join(dir, 'teams', 'revenue-ops.yaml'), REVENUE_OPS_YAML);
  writeFileSync(join(dir, 'teams', 'marketing.yaml'), MARKETING_YAML);
  return dir;
}

async function cleanDb() {
  for (const table of [teamSchema, agentSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
}

const dir = writeFixtureWorkspace();

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await cleanDb();
});

describe('teams workspace apply → export round-trip', () => {
  it('applies teams, workspace lead, and accountability; re-apply is a no-op; export does not bake inheritance in', async () => {
    await cleanDb();
    await db.insert(userSchema).values([CHRIS, LILI]);
    await db.insert(tenantAccountSchema).values({ id: 'acct-rt', name: 'MetaCTO', slug: 'metacto-rt' });
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-rt', slug: 'roundtrip', name: 'Roundtrip' });

    const loaded = loadWorkspace(dir);
    const first = await applyWorkspace(loaded, { orgId: ORG, appliedBy: 'vitest' });

    expect(first.errors).toEqual([]);
    expect(first.counts.teams).toEqual({ created: 2, updated: 0, unchanged: 0 });
    expect(first.counts.agents.created).toBe(4);

    // Team rows: explicit owner stored; inherited owner stored as NULL.
    const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG)).orderBy(teamSchema.slug);

    expect(teams.map(t => ({ slug: t.slug, lead: t.leadAgentSlug, owner: t.accountableUserId }))).toEqual([
      { slug: 'marketing', lead: 'marketing-lead', owner: LILI.id },
      { slug: 'revenue-ops', lead: 'revenue-lead', owner: null },
    ]);

    // Workspace lead + default owner landed on the project row.
    const [project] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG));

    expect(project).toMatchObject({ leadAgentSlug: 'revenue-director', accountableUserId: CHRIS.id });

    // Agent membership: authored `team:` applied; each lead auto-assigned
    // to the team it leads; agents outside any team stay NULL.
    const agents = await db.select({ slug: agentSchema.slug, teamSlug: agentSchema.teamSlug }).from(agentSchema).where(eq(agentSchema.orgId, ORG));
    const bySlug = Object.fromEntries(agents.map(a => [a.slug, a.teamSlug]));

    expect(bySlug).toEqual({
      'revenue-director': null,
      'revenue-lead': 'revenue-ops',
      'pipeline-analyst': 'revenue-ops',
      'marketing-lead': 'marketing',
    });

    // Acceptance #9 (apply side): re-applying the same workspace is a no-op.
    const second = await applyWorkspace(loaded, { orgId: ORG, appliedBy: 'vitest' });

    expect(second.errors).toEqual([]);
    expect(second.counts.teams).toEqual({ created: 0, updated: 0, unchanged: 2 });
    expect(second.counts.agents).toEqual({ created: 0, updated: 0, unchanged: 4 });

    // Acceptance #9 (export side): the export mapping reproduces the
    // authored YAML — same keys, and NO accountableUser materialized on
    // the inheriting team.
    const emailByUserId = new Map([[CHRIS.id, CHRIS.email], [LILI.id, LILI.email]]);
    const exported = Object.fromEntries(teams.map(t => [t.slug, teamRowToManifest(t, emailByUserId)]));

    expect(exported['revenue-ops']).toEqual(parseYaml(REVENUE_OPS_YAML));
    expect(exported.marketing).toEqual(parseYaml(MARKETING_YAML));
    expect(exported['revenue-ops']).not.toHaveProperty('accountableUser');

    expect(projectLeadToManifestKeys(project!, emailByUserId)).toEqual({
      lead: 'revenue-director',
      accountableUser: CHRIS.email,
    });
  });

  it('reports an unresolvable accountableUser as a non-fatal error and stores no owner', async () => {
    await cleanDb();
    await db.insert(tenantAccountSchema).values({ id: 'acct-rt2', name: 'MetaCTO', slug: 'metacto-rt2' });
    await db.insert(projectSchema).values({ id: ORG, accountId: 'acct-rt2', slug: 'roundtrip', name: 'Roundtrip' });

    const loaded = loadWorkspace(dir); // chris@/lili@ not seeded this time
    const result = await applyWorkspace(loaded, { orgId: ORG, appliedBy: 'vitest' });

    expect(result.errors.map(e => `${e.resource}/${e.slug}`)).toEqual(
      expect.arrayContaining(['workspace/workspace.yaml', 'team/marketing']),
    );
    expect(result.errors.every(e => e.message.includes('does not match any user'))).toBe(true);

    const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG));

    expect(teams.every(t => t.accountableUserId === null)).toBe(true);

    const [project] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG));

    // Lead still applies; the unresolved owner stores NULL, not garbage.
    expect(project).toMatchObject({ leadAgentSlug: 'revenue-director', accountableUserId: null });
  });
});
