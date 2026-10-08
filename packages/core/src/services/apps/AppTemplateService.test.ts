/**
 * A company function stood up in one move — through the real pipeline:
 * the shipped Company templates written into a temporary workspace folder,
 * loaded, and applied against PGlite. Idempotent (twice is once), tenant-
 * scoped (another project sees nothing), the installer accountable, a
 * person's edit kept, and a refusal that leaves nothing behind.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { agentBudgetSchema, agentSchema, automationSchema, missionSchema, playbookSchema, projectSchema, teamSchema, tenantAccountSchema, trustRuleSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { AppTemplateError, appTemplatesForProject, installAppTemplate } = await import('./AppTemplateService');

const ORG_A = 'proj_northwind_support';
const ORG_B = 'proj_kestrel_ops';
const INSTALLER = { id: 'usr-lili', name: 'Lili Chen', email: 'lili.chen@northwind.example' };
const dirs: string[] = [];

function workspace(orgId: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'company-app-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\n# ${name}'s workspace\norgId: ${orgId}\nname: ${name}\n`);
  return dir;
}

const install = (dir: string, orgId = ORG_A, answers: Record<string, unknown> = { company: 'Northwind', goal: 'Every customer hears back within one business day.' }) =>
  installAppTemplate({ orgId, workspaceDir: dir, workspaceName: 'Northwind Traders', appId: 'company', templateSlug: 'support-org', answers, installer: { email: INSTALLER.email, name: INSTALLER.name }, appliedBy: `user:${INSTALLER.id}` });

beforeEach(async () => {
  for (const table of [workspaceVersionSchema, trustRuleSchema, agentBudgetSchema, automationSchema, missionSchema, teamSchema, agentSchema, playbookSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
  await db.insert(userSchema).values(INSTALLER);
  await db.insert(tenantAccountSchema).values({ id: 'acct-northwind', name: 'Northwind', slug: 'northwind' });
  await db.insert(projectSchema).values([
    { id: ORG_A, accountId: 'acct-northwind', slug: 'northwind-support', name: 'Northwind Traders' },
    { id: ORG_B, accountId: 'acct-northwind', slug: 'kestrel-ops', name: 'Kestrel Ops' },
  ]);
});

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('installing a Company template', () => {
  it('stands the function up in one move: teams under a lead, the installer accountable, missions, automations, trust and budgets', async () => {
    const dir = workspace(ORG_A, 'Northwind Traders');
    const receipt = await install(dir);

    expect(receipt.applied.errors).toEqual([]);
    expect(receipt.pluginsAdded).toContain('company');
    expect(receipt.accountableUserSet).toBe(INSTALLER.email);
    expect(receipt.files.created.length).toBeGreaterThan(0);

    const teams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));

    expect(teams.map(t => t.slug).sort()).toEqual(receipt.contents.teams.slice().sort());

    for (const team of teams) {
      expect(team.accountableUserId, team.slug).toBe(INSTALLER.id);
      expect(team.leadAgentSlug, team.slug).toBeTruthy();
      expect(team.name, team.slug).toContain('Northwind');
      expect(team.measures.length, team.slug).toBeGreaterThan(0);
    }
    const agents = await db.select({ slug: agentSchema.slug }).from(agentSchema).where(eq(agentSchema.orgId, ORG_A));

    expect(agents.map(a => a.slug)).toEqual(expect.arrayContaining(receipt.contents.agents));

    const missions = await db.select({ slug: missionSchema.slug }).from(missionSchema).where(eq(missionSchema.orgId, ORG_A));

    expect(missions.map(m => m.slug)).toEqual(expect.arrayContaining(receipt.contents.missions));

    const automations = await db.select({ slug: automationSchema.slug }).from(automationSchema).where(eq(automationSchema.orgId, ORG_A));

    expect(automations.map(a => a.slug)).toEqual(expect.arrayContaining(receipt.contents.automations));

    const budgets = await db.select({ agentSlug: agentBudgetSchema.agentSlug }).from(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, ORG_A));

    expect(budgets.map(b => b.agentSlug)).toEqual(expect.arrayContaining(receipt.contents.budgets));

    // Conservative rungs: every bar it brings starts off.
    const rules = await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG_A));

    expect(rules.map(r => r.actionId)).toEqual(expect.arrayContaining(receipt.contents.trustRules));
    expect(rules.every(r => r.enabled === 'false')).toBe(true);

    const [project] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG_A));

    expect(project!.enabledPlugins).toContain('company');
    expect(project!.accountableUserId).toBe(INSTALLER.id);

    // The workspace's own file now says it — and keeps its comment.
    const manifest = readFileSync(join(dir, 'workspace.yaml'), 'utf8');

    expect(manifest).toContain('company');
    expect(manifest).toContain('# Northwind Traders\'s workspace');
  });

  it('is idempotent: installing twice is installing once', async () => {
    const dir = workspace(ORG_A, 'Northwind Traders');
    const first = await install(dir);
    const manifestAfterFirst = readFileSync(join(dir, 'workspace.yaml'), 'utf8');
    const trustAfterFirst = readFileSync(join(dir, 'trust.yaml'), 'utf8');
    const teamsAfterFirst = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));

    const second = await install(dir);

    expect(second.applied.errors).toEqual([]);
    expect(second.files.created).toEqual([]);
    expect(second.files.kept).toEqual([]);
    expect(second.files.unchanged.sort()).toEqual(first.files.created.filter(p => p !== 'trust.yaml' && p !== 'workspace.yaml').sort());
    expect(second.pluginsAdded).toEqual([]);
    expect(second.trustRulesAdded).toEqual([]);
    expect(second.leadSet).toBeNull();
    expect(second.accountableUserSet).toBeNull();
    expect(second.applied.teams.created).toBe(0);
    expect(second.applied.agents.created).toBe(0);
    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toBe(manifestAfterFirst);
    expect(readFileSync(join(dir, 'trust.yaml'), 'utf8')).toBe(trustAfterFirst);

    const teamsAfterSecond = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));

    expect(teamsAfterSecond.map(t => [t.id, t.slug, t.accountableUserId])).toEqual(teamsAfterFirst.map(t => [t.id, t.slug, t.accountableUserId]));
  });

  it('is tenant-scoped: another project sees nothing, and its own install lands only on itself', async () => {
    await install(workspace(ORG_A, 'Northwind Traders'));

    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_B))).toEqual([]);
    expect(await db.select().from(agentSchema).where(eq(agentSchema.orgId, ORG_B))).toEqual([]);
    expect(await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG_B))).toEqual([]);

    const [b] = await db.select().from(projectSchema).where(eq(projectSchema.id, ORG_B));

    expect(b!.enabledPlugins).toEqual([]);

    // B installs into its own folder; A's rows are untouched.
    const aTeams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));
    await install(workspace(ORG_B, 'Kestrel Ops'), ORG_B, { company: 'Kestrel', goal: 'Every escalation owned within an hour.' });

    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual(aTeams);

    const bTeams = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_B));

    expect(bTeams.every(t => t.name.includes('Kestrel'))).toBe(true);
  });

  it('keeps a file a person changed since, and says so', async () => {
    const dir = workspace(ORG_A, 'Northwind Traders');
    const first = await install(dir);
    const teamFile = first.files.created.find(p => p.startsWith('teams/'))!;
    const edited = `${readFileSync(join(dir, teamFile), 'utf8')}\n# our own note\n`;
    writeFileSync(join(dir, teamFile), edited);

    const second = await install(dir, ORG_A, { company: 'Northwind Retail', goal: 'Every customer hears back within four hours.' });

    expect(second.files.kept).toContain(teamFile);
    expect(readFileSync(join(dir, teamFile), 'utf8')).toBe(edited);
  });

  it('refuses an interview it cannot fill, and writes nothing', async () => {
    const dir = workspace(ORG_A, 'Northwind Traders');
    const before = readFileSync(join(dir, 'workspace.yaml'), 'utf8');

    const refusal = await install(dir, ORG_A, { company: 'x'.repeat(1000) }).catch(e => e);

    expect(refusal).toBeInstanceOf(AppTemplateError);
    expect(refusal.code).toBe('answers');
    expect(refusal.problems.company).toMatch(/under/);
    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'teams'))).toBe(false);
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual([]);
  });

  it('puts every file back when the result would not load', async () => {
    const dir = workspace(ORG_A, 'Northwind Traders');
    // A broken file of the workspace's own, already there: the template's
    // files would join a workspace that cannot load.
    mkdirSync(join(dir, 'missions'), { recursive: true });
    writeFileSync(join(dir, 'missions', 'broken.yaml'), 'slug: broken\nname: [not a string\n');
    const before = readFileSync(join(dir, 'workspace.yaml'), 'utf8');

    const refusal = await install(dir).catch(e => e);

    expect(refusal).toBeInstanceOf(AppTemplateError);
    expect(refusal.code).toBe('invalid');
    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toBe(before);
    expect(existsSync(join(dir, 'teams'))).toBe(false);
    expect(existsSync(join(dir, 'trust.yaml'))).toBe(false);
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual([]);
  });

  it('names an unknown template', async () => {
    const refusal = await installAppTemplate({ orgId: ORG_A, workspaceDir: workspace(ORG_A, 'Northwind'), workspaceName: 'Northwind', appId: 'company', templateSlug: 'bakery', answers: {}, installer: INSTALLER, appliedBy: 'test' }).catch(e => e);

    expect(refusal).toBeInstanceOf(AppTemplateError);
    expect(refusal.code).toBe('unknown');
  });
});

describe('the start page\'s view', () => {
  it('lists the templates with their questions, and marks one set up only when its teams exist here', async () => {
    const before = await appTemplatesForProject(ORG_A, 'company', { email: INSTALLER.email, name: INSTALLER.name });

    expect(before!.templates.map(t => t.slug)).toEqual(['software-company', 'marketing-agency', 'support-org']);
    expect(before!.templates.every(t => !t.installed)).toBe(true);

    const company = before!.templates[0]!.interview.find(q => q.key === 'company')!;

    expect(company.defaultValue).toBe('Northwind Traders');

    await install(workspace(ORG_A, 'Northwind Traders'));

    const after = await appTemplatesForProject(ORG_A, 'company', { email: INSTALLER.email, name: INSTALLER.name });

    expect(after!.templates.find(t => t.slug === 'support-org')!.installed).toBe(true);
    expect(after!.templates.find(t => t.slug === 'marketing-agency')!.installed).toBe(false);

    // Another project has none of it.
    const other = await appTemplatesForProject(ORG_B, 'company', { email: INSTALLER.email, name: INSTALLER.name });

    expect(other!.templates.every(t => !t.installed)).toBe(true);
    expect(await db.select().from(teamSchema).where(and(eq(teamSchema.orgId, ORG_B)))).toEqual([]);
  });

  it('is nothing for an app that does not exist', async () => {
    expect(await appTemplatesForProject(ORG_A, 'no-such-app', { email: INSTALLER.email, name: INSTALLER.name })).toBeNull();
  });
});
