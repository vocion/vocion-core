/**
 * Drafting a plan from a person's words: the model's answer is typed or it is
 * sent back once with its problems; a second miss fails in words; a spent
 * budget refuses before any model call; and a missing description or answer
 * comes back on its field. The model is scripted; the schema, the citations
 * and the catalog are real.
 */
import type { DraftDeps } from './FunctionDraftService';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
const { draftFunctionPlan, draftSystem, FunctionDraftError, readDraft } = await import('./FunctionDraftService');

const PERSON = { email: 'lili.chen@northwind.example', name: 'Lili Chen' };
const DESCRIPTION = 'A two-person bookkeeping practice for restaurants: monthly closes, payroll questions, and a reminder before every tax deadline.';

const PLAN = {
  name: 'Northwind Bookkeeping',
  summary: 'Closes each client\'s month by day five.',
  teams: [{ slug: 'bookkeeping', name: 'Northwind Bookkeeping', description: 'Closes and payroll.', goal: 'Every month closed by day five.', lead: 'controller', measures: [{ key: 'closes_on_time', label: 'Closes on time', target: 12, source: { kind: 'agent-reported', counts: 'closesOnTime' } }] }],
  agents: [
    { slug: 'controller', name: 'Controller', team: 'bookkeeping', role: 'Owns the close.', goal: 'Closes on time.', source: { kind: 'catalog', slug: 'controller', why: 'It closes periods.' }, dailyCents: 300 },
    { slug: 'payroll-desk', name: 'Payroll desk', team: 'bookkeeping', role: 'Answers payroll questions.', goal: 'Answers within a day.', source: { kind: 'new', systemPrompt: 'You draft answers to payroll questions; a person sends every reply to a client.' }, dailyCents: 150 },
  ],
  missions: [{ slug: 'close-by-day-five', name: 'Closed by day five', agent: 'controller', goal: 'Every month closed by day five.', successCriteria: ['A reconciliation on every close'], schedule: '0 14 1-7 * 1-5' }],
};

function deps(answers: string[], budget: string | null = null): DraftDeps & { calls: Array<{ system: string; human: string }> } {
  const calls: Array<{ system: string; human: string }> = [];
  return {
    calls,
    budget: async () => budget,
    complete: async (system, human) => {
      calls.push({ system, human });
      return answers[calls.length - 1] ?? '';
    },
  };
}

const draft = (d: DraftDeps, over: Partial<Parameters<typeof draftFunctionPlan>[0]> = {}) => draftFunctionPlan({ orgId: 'proj_northwind', appId: 'company', description: DESCRIPTION, answers: { goal: 'Every client\'s month closed by day five.' }, installer: PERSON, workspaceName: 'Northwind Traders', ...over }, d);

describe('reading the model\'s answer', () => {
  it('takes one JSON object, fenced or not, and holds it to the schema and to what ships', () => {
    expect('plan' in readDraft(`\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``, 'company')).toBe(true);
    expect(readDraft('Here is a lovely plan for you!', 'company')).toEqual({ problems: ['the answer was not one JSON object'] });

    const cited = readDraft(JSON.stringify({ ...PLAN, agents: [{ ...PLAN.agents[0], source: { kind: 'catalog', slug: 'head-chef', why: 'x' } }, PLAN.agents[1]] }), 'company');

    expect('problems' in cited && cited.problems.join(' ')).toContain('cites catalog role "head-chef"');
  });
});

describe('drafting', () => {
  it('drafts a typed plan from the person\'s words, offering the catalog, the plugins and the templates to reuse', async () => {
    const d = deps([JSON.stringify(PLAN)]);
    const { plan, attempts } = await draft(d);

    expect(attempts).toBe(1);
    expect(plan.agents.map(a => a.source.kind)).toEqual(['catalog', 'new']);
    expect(d.calls[0]!.human).toContain(DESCRIPTION);
    expect(d.calls[0]!.human).toContain('Northwind Traders');
    expect(d.calls[0]!.system).toContain('controller —');
    expect(d.calls[0]!.system).toContain('software-factory —');
    expect(d.calls[0]!.system).toContain('support-org —');
    expect(d.calls[0]!.system).toContain('Drafting a company function');
  });

  it('sends an unusable answer back once with every problem named, then takes the corrected one', async () => {
    const d = deps([JSON.stringify({ ...PLAN, teams: [{ ...PLAN.teams[0], lead: 'nobody' }] }), JSON.stringify(PLAN)]);
    const { attempts } = await draft(d);

    expect(attempts).toBe(2);
    expect(d.calls[1]!.human).toContain('YOUR LAST ANSWER COULD NOT BE USED');
    expect(d.calls[1]!.human).toContain('led by "nobody"');
  });

  it('fails in words when the second answer is unusable too — and proposes nothing', async () => {
    const error = await draft(deps(['nope', '{"name":"x"}'])).catch(e => e);

    expect(error).toBeInstanceOf(FunctionDraftError);
    expect(error.code).toBe('invalid');
    expect(error.message).toMatch(/unusable twice/);
  });

  it('refuses while the budget is spent, before any model call', async () => {
    const d = deps([JSON.stringify(PLAN)], 'This workspace\'s spend budget is spent for the period, so no draft was written.');
    const error = await draft(d).catch(e => e);

    expect(error).toBeInstanceOf(FunctionDraftError);
    expect(error.code).toBe('budget');
    expect(d.calls).toEqual([]);
  });

  it('asks for more on the field that needs it, before any model call', async () => {
    const d = deps([JSON.stringify(PLAN)]);
    const error = await draft(d, { description: 'books', answers: { goal: '' } }).catch(e => e);

    expect(error.code).toBe('answers');
    expect(error.problems.description).toMatch(/say a little more/);
    expect(error.problems.goal).toBe('needs an answer');
    expect(d.calls).toEqual([]);
  });

  it('names an app with no blank start', async () => {
    const error = await draft(deps([]), { appId: 'gtm' }).catch(e => e);

    expect(error.code).toBe('unknown');
  });

  it('asks for conservative bars and modest budgets in the instruction itself', () => {
    const system = draftSystem({ appId: 'company', brief: null });

    expect(system).toContain('autoApproveAbove at least 0.9');
    expect(system).toContain('50 to 500 cents');
    expect(system).toContain('gmail.send');
  });
});
