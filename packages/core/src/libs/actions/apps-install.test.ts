/**
 * `apps.install` against PGlite and a real workspace folder: a drafted plan
 * and a template stand up the same kind of records through the same path, as
 * the person's own action; Undo puts the whole install back as one unit
 * (keeping a file someone changed since); installing twice is installing
 * once; another project sees nothing; and an agent may only offer it.
 */
import type { Principal } from '@/services/authz';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { db } = await import('@/libs/DB');
const { actionRunSchema, agentBudgetSchema, agentSchema, automationSchema, missionSchema, playbookSchema, projectSchema, teamSchema, tenantAccountSchema, trustRuleSchema, userSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { executeAction, proposeAction, undoAction } = await import('@/services/ActionService');

const ORG_A = 'proj_northwind_books';
const ORG_B = 'proj_kestrel_books';
const PERSON = { id: 'usr-lili-books', name: 'Lili Chen', email: 'lili.chen@northwind.example' };
const MANIFEST = (orgId: string, name: string) => `version: 1\n# ${name}\norgId: ${orgId}\nname: ${name}\n`;

const PLAN = {
  name: 'Northwind Bookkeeping',
  summary: 'Closes each client\'s month by the fifth working day.',
  teams: [{ slug: 'bookkeeping', name: 'Northwind Bookkeeping', description: 'Monthly closes and payroll questions.', goal: 'Every month closed by day five.', lead: 'controller', measures: [{ key: 'closes_on_time', label: 'Closes on time', target: 12, source: { kind: 'agent-reported', counts: 'closesOnTime' } }] }],
  agents: [
    { slug: 'controller', name: 'Controller', team: 'bookkeeping', role: 'Owns the close.', goal: 'Closes on time.', source: { kind: 'catalog', slug: 'controller', why: 'The catalog controller closes periods.' }, dailyCents: 300 },
    { slug: 'payroll-desk', name: 'Payroll desk', team: 'bookkeeping', role: 'Answers payroll questions.', goal: 'Answers within a day.', source: { kind: 'new', systemPrompt: 'You draft answers to restaurant clients\' payroll questions; a person sends every reply.' }, dailyCents: 150 },
  ],
  missions: [{ slug: 'close-by-day-five', name: 'Closed by day five', agent: 'controller', goal: 'Every month closed by day five.', successCriteria: ['A reconciliation on every close'], schedule: '0 14 1-7 * 1-5' }],
  automations: [{ slug: 'payroll-morning-sweep', name: 'Payroll morning sweep', agent: 'controller', description: 'Checks the close every weekday morning.', when: { schedule: '0 13 * * 1-5' }, checkMission: 'close-by-day-five', prompt: 'Draft an answer to every payroll question that came in overnight.' }],
  trust: [{ action: 'gmail.send', rung: 'execute-with-approval', autoApproveAbove: 0.99, why: 'Every reply is a person\'s.' }],
};

const dirs: Record<string, string> = {};
const person = (orgId: string): Principal => ({ kind: 'user', id: PERSON.id, role: 'admin', scope: { orgId } });
const create = (orgId = ORG_A, plan: Record<string, unknown> = PLAN) => proposeAction({ orgId, actionId: 'apps.install', input: { appId: 'company', plan }, principal: person(orgId), invokedBy: PERSON.id });

beforeEach(async () => {
  for (const table of [actionRunSchema, workspaceVersionSchema, trustRuleSchema, agentBudgetSchema, automationSchema, missionSchema, teamSchema, agentSchema, playbookSchema, projectSchema, tenantAccountSchema, userSchema]) {
    await db.delete(table);
  }
  await db.insert(userSchema).values(PERSON);
  await db.insert(tenantAccountSchema).values({ id: 'acct-books', name: 'Northwind', slug: 'northwind-books' });
  await db.insert(projectSchema).values([
    { id: ORG_A, accountId: 'acct-books', slug: 'northwind-books', name: 'Northwind Traders' },
    { id: ORG_B, accountId: 'acct-books', slug: 'kestrel-books', name: 'Kestrel Capital' },
  ]);
  for (const [orgId, slug, name] of [[ORG_A, 'northwind-books', 'Northwind Traders'], [ORG_B, 'kestrel-books', 'Kestrel Capital']] as const) {
    if (dirs[slug]) {
      rmSync(dirs[slug]!, { recursive: true, force: true });
    }
    dirs[slug] = mkdtempSync(join(tmpdir(), 'apps-install-'));
    writeFileSync(join(dirs[slug]!, 'workspace.yaml'), MANIFEST(orgId, name));
  }
  // Each project names its own folder, the way a multi-workspace host does.
  process.env.VOCION_WORKSPACE_MAP = `northwind-books:${dirs['northwind-books']},kestrel-books:${dirs['kestrel-books']}`;
});

afterAll(() => {
  delete process.env.VOCION_WORKSPACE_MAP;
  for (const dir of Object.values(dirs)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('creating a drafted plan', () => {
  it('runs as the person\'s action and stands the function up: the hired role, the new seats, missions, automations, bars and budgets', async () => {
    const res = await create();

    expect(res.status).toBe('done');

    const receipt = res.result as { template: string; contents: { agents: string[] }; applied: { errors: unknown[] } };

    expect(receipt.template).toBe('blank');
    expect(receipt.applied.errors).toEqual([]);

    const [team] = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));

    expect(team).toMatchObject({ slug: 'bookkeeping', leadAgentSlug: 'controller', accountableUserId: PERSON.id });

    const agents = await db.select({ slug: agentSchema.slug, active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, ORG_A));

    expect(agents.map(a => a.slug).sort()).toEqual(['controller', 'payroll-desk']);
    expect((await db.select().from(missionSchema).where(eq(missionSchema.orgId, ORG_A))).map(m => m.slug)).toEqual(['close-by-day-five']);
    expect((await db.select().from(automationSchema).where(eq(automationSchema.orgId, ORG_A))).map(a => a.slug)).toEqual(['payroll-morning-sweep']);
    expect((await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG_A))).map(r => [r.actionId, r.enabled])).toEqual([['gmail.send', 'false']]);
    expect((await db.select({ slug: agentBudgetSchema.agentSlug }).from(agentBudgetSchema).where(eq(agentBudgetSchema.orgId, ORG_A))).map(b => b.slug)).toEqual(expect.arrayContaining(['controller', 'payroll-desk']));
    // The workspace owns it as files — the hired role with its catalog skills.
    expect(existsSync(join(dirs['northwind-books']!, 'agents/controller.yaml'))).toBe(true);
    expect(existsSync(join(dirs['northwind-books']!, 'skills/period-close/SKILL.md'))).toBe(true);
  });

  it('undoes as one unit: files, teams, agents, missions, automations, bars and budgets all go back', async () => {
    const res = await create();
    const undone = await undoAction(res.runId, ORG_A, { by: PERSON.id });

    expect(undone.status).toBe('undone');

    const dir = dirs['northwind-books']!;

    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toBe(MANIFEST(ORG_A, 'Northwind Traders'));
    expect(existsSync(join(dir, 'agents'))).toBe(false);
    expect(existsSync(join(dir, 'trust.yaml'))).toBe(false);
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual([]);
    expect((await db.select({ active: agentSchema.active }).from(agentSchema).where(eq(agentSchema.orgId, ORG_A))).every(a => a.active === 'false')).toBe(true);
    expect((await db.select({ status: missionSchema.status }).from(missionSchema).where(eq(missionSchema.orgId, ORG_A))).every(m => m.status === 'disabled')).toBe(true);
    expect((await db.select({ status: automationSchema.status }).from(automationSchema).where(eq(automationSchema.orgId, ORG_A))).every(a => a.status === 'disabled')).toBe(true);
    expect(await db.select().from(trustRuleSchema).where(eq(trustRuleSchema.orgId, ORG_A))).toEqual([]);
    expect(await db.select().from(agentBudgetSchema).where(and(eq(agentBudgetSchema.orgId, ORG_A), eq(agentBudgetSchema.agentSlug, 'payroll-desk')))).toEqual([]);
  });

  it('will not undo over a file someone changed after the install — it names it and changes nothing', async () => {
    const res = await create();
    const teamFile = join(dirs['northwind-books']!, 'teams/bookkeeping.yaml');
    const edited = `${readFileSync(teamFile, 'utf8')}# ours now\n`;
    writeFileSync(teamFile, edited);

    const refusal = await undoAction(res.runId, ORG_A, { by: PERSON.id }).catch(e => e);

    expect(refusal.message).toContain('teams/bookkeeping.yaml');
    expect(readFileSync(teamFile, 'utf8')).toBe(edited);
    expect(existsSync(join(dirs['northwind-books']!, 'agents/controller.yaml'))).toBe(true);
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toHaveLength(1);
  });

  it('is idempotent: creating the same plan twice adds nothing the second time', async () => {
    await create();
    const second = await create();

    const receipt = second.result as { files: { created: string[]; unchanged: string[] }; applied: { teams: { created: number }; agents: { created: number } } };

    expect(receipt.files.created).toEqual([]);
    expect(receipt.applied.teams.created).toBe(0);
    expect(receipt.applied.agents.created).toBe(0);
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toHaveLength(1);
  });

  it('is tenant-scoped: it writes to its own project\'s folder and rows, and another project\'s plan stays its own', async () => {
    await create(ORG_A);

    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_B))).toEqual([]);
    expect(existsSync(join(dirs['kestrel-books']!, 'teams'))).toBe(false);

    const b = await create(ORG_B, { ...PLAN, name: 'Kestrel Books', teams: [{ ...PLAN.teams[0], name: 'Kestrel Books' }] });
    await undoAction(b.runId, ORG_B, { by: PERSON.id });

    // Undoing B's install leaves A's standing.
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toHaveLength(1);
    expect(existsSync(join(dirs['northwind-books']!, 'teams/bookkeeping.yaml'))).toBe(true);
  });

  it('refuses a plan that does not hold together, before anything is written', async () => {
    const error = await create(ORG_A, { ...PLAN, teams: [{ ...PLAN.teams[0], lead: 'nobody' }] }).catch(e => e);

    expect(error.message).toMatch(/led by "nobody"/);
    expect(existsSync(join(dirs['northwind-books']!, 'teams'))).toBe(false);
  });
});

describe('a template through the same path', () => {
  it('stands up and undoes the same way', async () => {
    const res = await proposeAction({ orgId: ORG_A, actionId: 'apps.install', input: { appId: 'company', template: 'support-org', answers: { company: 'Northwind' } }, principal: person(ORG_A), invokedBy: PERSON.id });

    expect(res.status).toBe('done');
    expect((await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).map(t => t.slug)).toEqual(['support']);

    await undoAction(res.runId, ORG_A, { by: PERSON.id });

    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual([]);
  });
});

describe('from chat', () => {
  it('an agent may only offer it: its proposal waits, and the person who approves it is accountable', async () => {
    const agent: Principal = { kind: 'agent', id: 'agent:onboarding-lead', grants: ['*'], autonomy: 5, scope: { orgId: ORG_A } };
    const offered = await proposeAction({ orgId: ORG_A, actionId: 'apps.install', input: { appId: 'company', plan: PLAN }, principal: agent, invokedBy: 'agent:onboarding-lead', proposal: { confidence: 1, suggestedDecision: 'approve', suggestedDecisionReason: 'Drafted from what you described.' } });

    expect(offered.status).toBe('pending');
    expect(await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A))).toEqual([]);

    await db.update(actionRunSchema).set({ status: 'approved' }).where(eq(actionRunSchema.id, offered.runId));
    const approved = await executeAction(offered.runId, ORG_A, { reviewedBy: PERSON.id });

    expect(approved.status).toBe('done');

    const [team] = await db.select().from(teamSchema).where(eq(teamSchema.orgId, ORG_A));

    expect(team!.accountableUserId).toBe(PERSON.id);
  });
});
