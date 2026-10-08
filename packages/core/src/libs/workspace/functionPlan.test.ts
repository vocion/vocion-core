import type { FunctionPlan, PlanContext } from './functionPlan';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { catalogReader, planContextFor } from '@/services/apps/planContext';
import { editWorkspaceManifest } from './appTemplates';
import { FunctionPlanSchema, planContents, planLead, planProblems, renderFunctionPlan } from './functionPlan';
import { cannotRemove, planBlockers, removeFromPlan, renameInPlan } from './functionPlanEdits';
import { loadWorkspace } from './loader';

// A drafted plan, from schema to files: what a model must answer, what it may
// cite, how a person's edits keep it whole, and that what it renders loads in
// a real workspace beside a hired catalog role.

const INSTALLER = { email: 'lili.chen@northwind.example' };

/** A plan as a model would draft it for a small bookkeeping practice — one hired role, two new seats. */
function bookkeepingPlan(): FunctionPlan {
  return FunctionPlanSchema.parse({
    name: 'Northwind Bookkeeping',
    summary: 'Closes each client\'s month by the fifth working day and answers payroll questions within a day.',
    reuse: { template: { slug: 'support-org', why: 'Client questions run like a support desk.' }, plugins: [] },
    teams: [{
      slug: 'bookkeeping',
      name: 'Northwind Bookkeeping',
      description: 'Monthly closes and payroll questions for restaurant clients.',
      goal: 'Every client\'s month closed by the fifth working day.',
      lead: 'controller',
      measures: [
        { key: 'closes_on_time', label: 'Closes done by day five', target: 12, unit: 'closes', window: '30d', source: { kind: 'agent-reported', counts: 'closesOnTime' } },
        { key: 'answers_sent', label: 'Client answers a person sent', dimension: 'quality', target: 20, window: '30d', source: { kind: 'human-confirmed', actions: ['gmail.send'] } },
      ],
    }],
    agents: [
      { slug: 'controller', name: 'Controller', team: 'bookkeeping', role: 'Owns each client\'s close and the trail behind it.', goal: 'Closes on time with numbers that tie.', source: { kind: 'catalog', slug: 'controller', why: 'The catalog controller closes periods and leaves a trail.' }, dailyCents: 300 },
      { slug: 'payroll-desk', name: 'Payroll desk', team: 'bookkeeping', role: 'Answers client payroll questions with a draft a person sends.', goal: 'Every payroll question answered within a day.', source: { kind: 'new', systemPrompt: 'You answer restaurant clients\' payroll questions. Draft the reply, cite the rule, and never send it yourself — a person sends every reply.' }, dailyCents: 150 },
      { slug: 'deadline-watch', name: 'Deadline watch', team: 'bookkeeping', role: 'Reminds each client a week before every filing deadline.', goal: 'No client misses a filing deadline.', source: { kind: 'new', systemPrompt: 'You keep the filing calendar for every client and raise each deadline a week ahead as an ask for the controller.' }, dailyCents: 100 },
    ],
    missions: [
      { slug: 'close-by-day-five', name: 'Every month closed by day five', agent: 'controller', goal: 'Each client\'s month is closed and reconciled by the fifth working day.', successCriteria: ['Every close has a reconciliation attached'], schedule: '0 14 1-7 * 1-5' },
      { slug: 'no-missed-deadlines', name: 'No missed filing deadlines', agent: 'deadline-watch', goal: 'Every filing deadline is raised a week ahead.', successCriteria: ['Each deadline has an ask a week before it'], schedule: '0 13 * * 1' },
    ],
    automations: [
      { slug: 'monday-deadline-sweep', name: 'Monday deadline sweep', agent: 'deadline-watch', description: 'Checks the coming week\'s deadlines.', when: { schedule: '0 13 * * 1' }, checkMission: 'no-missed-deadlines', prompt: 'List the deadlines in the next fourteen days and raise any without an ask.' },
    ],
    trust: [
      { action: 'gmail.send', rung: 'execute-with-approval', autoApproveAbove: 0.99, risk: 'medium', why: 'Every reply to a client is a person\'s.' },
    ],
  });
}

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function ctx(): PlanContext {
  return planContextFor('company');
}

describe('the plan\'s schema', () => {
  it('parses a drafted plan and fills its defaults', () => {
    const plan = bookkeepingPlan();

    expect(plan.teams[0]!.measures[0]!.dimension).toBe('outcome');
    expect(plan.teams[0]!.measures[0]!.baseline).toBe(0);
  });

  it('refuses what a template would never ship: a trust bar that runs on its own, a slug with spaces, a seat with no budget', () => {
    const raw = JSON.parse(JSON.stringify(bookkeepingPlan()));
    raw.trust[0].rung = 'autonomous';
    raw.agents[1].slug = 'Payroll Desk';
    delete raw.agents[2].dailyCents;
    const parsed = FunctionPlanSchema.safeParse(raw);

    expect(parsed.success).toBe(false);

    const paths = parsed.error!.issues.map(i => i.path.join('.'));

    expect(paths).toEqual(expect.arrayContaining(['trust.0.rung', 'agents.1.slug', 'agents.2.dailyCents']));
  });

  it('refuses a budget above the cap and a trust bar under 0.9', () => {
    const raw = JSON.parse(JSON.stringify(bookkeepingPlan()));
    raw.agents[0].dailyCents = 5000;
    raw.trust[0].autoApproveAbove = 0.5;

    expect(FunctionPlanSchema.safeParse(raw).success).toBe(false);
  });
});

describe('what a plan may cite', () => {
  it('passes a plan that reuses a real catalog role, a real template and real actions', () => {
    expect(planProblems(bookkeepingPlan(), ctx())).toEqual([]);
  });

  it('names every reference that does not hold', () => {
    const plan = bookkeepingPlan();
    plan.teams[0]!.lead = 'payroll-ghost';
    plan.agents[0] = { ...plan.agents[0]!, source: { kind: 'catalog', slug: 'chief-bookkeeper', why: 'x' } };
    plan.agents[1] = { ...plan.agents[1]!, slug: 'copywriter' };
    plan.missions[0] = { ...plan.missions[0]!, agent: 'nobody' };
    plan.trust[0] = { ...plan.trust[0]!, action: 'fax.send' };
    plan.reuse.plugins.push({ slug: 'bakery', why: 'x' });
    const problems = planProblems(plan, ctx()).join('\n');

    expect(problems).toContain('team "bookkeeping" is led by "payroll-ghost"');
    expect(problems).toContain('cites catalog role "chief-bookkeeper"');
    expect(problems).toContain('new agent "copywriter" takes a slug');
    expect(problems).toContain('mission "close-by-day-five" belongs to "nobody"');
    expect(problems).toContain('trust bar "fax.send"');
    expect(problems).toContain('plugin "bakery"');
  });
});

describe('a person\'s edits on the preview', () => {
  it('renames without touching a slug', () => {
    const plan = renameInPlan(bookkeepingPlan(), 'agent', 'payroll-desk', 'Payroll questions');

    expect(plan.agents.find(a => a.slug === 'payroll-desk')!.name).toBe('Payroll questions');
  });

  it('removes an agent with what only existed for it, and never a team\'s lead on its own', () => {
    const plan = removeFromPlan(bookkeepingPlan(), 'agent', 'deadline-watch');

    expect(plan.agents.map(a => a.slug)).toEqual(['controller', 'payroll-desk']);
    expect(plan.missions.map(m => m.slug)).toEqual(['close-by-day-five']);
    expect(plan.automations).toEqual([]);
    expect(cannotRemove(plan, 'agent', 'controller')).toMatch(/leads Northwind Bookkeeping/);
    expect(removeFromPlan(plan, 'agent', 'controller')).toBe(plan);
    expect(planProblems(plan, ctx())).toEqual([]);
  });

  it('removes a mission with the automations that keep it, and says when a plan has nothing left it owes', () => {
    const plan = removeFromPlan(bookkeepingPlan(), 'mission', 'no-missed-deadlines');

    expect(plan.automations).toEqual([]);
    expect(cannotRemove(plan, 'mission', 'close-by-day-five')).toMatch(/at least one mission/);
    expect(planBlockers(plan)).toEqual([]);
    expect(planBlockers({ ...plan, missions: [] })).toEqual([expect.stringMatching(/at least one mission/)]);
  });
});

describe('rendering a plan', () => {
  it('writes the same files a template ships — the installer accountable, a cap on every seat, every bar off — and they load beside the hired role', () => {
    const plan = bookkeepingPlan();
    const files = renderFunctionPlan(plan, { installer: INSTALLER, catalog: catalogReader() });
    const byPath = new Map(files.map(f => [f.path, f.content]));

    const team = parseYaml(byPath.get('teams/bookkeeping.yaml')!) as Record<string, unknown>;

    expect(team).toMatchObject({ lead: 'controller', accountableUser: INSTALLER.email, goal: plan.teams[0]!.goal });

    const hired = parseYaml(byPath.get('agents/controller.yaml')!) as Record<string, unknown>;

    expect(hired).toMatchObject({ slug: 'controller', team: 'bookkeeping', budget: { dailyCents: 300, monthlyCents: 6600 } });
    expect(String(hired.systemPrompt)).toContain('You close the books');
    // The hired role's skills come with it.
    expect([...byPath.keys()].some(p => p.startsWith('skills/period-close/'))).toBe(true);
    expect(byPath.get('agents/payroll-desk.system-prompt.md')).toContain('Every payroll question answered within a day.');
    expect((parseYaml(byPath.get('trust.yaml')!) as { rules: Array<{ enabled: boolean }> }).rules.every(r => r.enabled === false)).toBe(true);
    expect(planLead(plan)).toBe('controller');
    expect(planContents(plan, files).skills).toContain('period-close');

    const dir = mkdtempSync(join(tmpdir(), 'function-plan-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'workspace.yaml'), editWorkspaceManifest('version: 1\norgId: proj_northwind\nname: Northwind Traders\n', { plugins: ['company'], lead: planLead(plan), accountableUser: INSTALLER.email }).content);
    for (const f of files) {
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    const ws = loadWorkspace(dir);

    expect(ws.agents.map(a => a.slug).sort()).toEqual(['controller', 'deadline-watch', 'payroll-desk']);
    expect(ws.teams[0]!.accountableUser).toBe(INSTALLER.email);
    expect(ws.automations.map(a => a.slug)).toEqual(['monday-deadline-sweep']);
  });
});
