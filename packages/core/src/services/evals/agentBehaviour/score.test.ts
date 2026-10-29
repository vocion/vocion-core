import type { CaseRun } from './score';
import { describe, expect, it } from 'vitest';
import { EVAL_CASES } from './dataset';
import { resultsMarkdown } from './report';
import { checkGate, gradeCase, isRefusal, spreadOf, summarize, summarizeRepeated, usedExpectedTool, wilson95 } from './score';

const run = (over: Partial<CaseRun>): CaseRun => ({
  caseId: 'pa-write-deal',
  agent: 'pipeline-analyst',
  kind: 'write',
  mode: 'core',
  level: 'standard',
  answer: 'Done.',
  calls: [],
  searches: 0,
  unknownTools: 0,
  toolErrors: 0,
  loaded: 30,
  deferred: 76,
  overBudget: false,
  firstTokenMs: 800,
  totalMs: 5000,
  cents: 3,
  inputTokens: 10_000,
  cacheReadTokens: 8_000,
  warm: true,
  ...over,
});

describe('a refusal', () => {
  it.each([
    'Unfortunately, I don\'t have a tool available to make direct updates to HubSpot deals.',
    'I can\'t create charts directly.',
    'Updating deals is not something I can do from here.',
    'You\'ll need to update it in HubSpot yourself.',
    'I am unable to send that.',
  ])('reads "%s" as a refusal', (answer) => {
    expect(isRefusal(answer)).toBe(true);
  });

  it.each([
    'Done: the Northwind deal is now $84,000.',
    'Here is what will change. Shall I go ahead?',
    'Yes, I can update deal fields in HubSpot for you: tell me the deal and the change.',
  ])('does not read "%s" as one', (answer) => {
    expect(isRefusal(answer)).toBe(false);
  });
});

describe('grading a case', () => {
  const write = EVAL_CASES.find(c => c.id === 'pa-write-deal')!;

  it('passes a write only with the expected action, called without an error', () => {
    expect(usedExpectedTool(write, run({ calls: [{ tool: 'recommend_action', input: { action_id: 'hubspot.update' }, error: false }] }))).toBe(true);
    expect(usedExpectedTool(write, run({ calls: [{ tool: 'recommend_action', input: { action_id: 'gmail.send' }, error: false }] }))).toBe(false);
    expect(usedExpectedTool(write, run({ calls: [{ tool: 'recommend_action', input: { action_id: 'hubspot.update' }, error: true }] }))).toBe(false);
  });

  it('counts a refusal without the work as a false refusal, and a refusal after doing it as none', () => {
    expect(gradeCase(write, run({ answer: 'I can\'t update HubSpot deals.' }))).toMatchObject({ aware: false, falseRefusal: true });
    expect(gradeCase(write, run({ answer: 'Done. I can\'t also email them, though.', calls: [{ tool: 'propose_action', input: { action_id: 'hubspot.update' }, error: false }] }))).toMatchObject({ aware: true, falseRefusal: false });
  });
});

describe('the gate', () => {
  const cases = EVAL_CASES.filter(c => c.id === 'pa-write-deal');
  const ok = { calls: [{ tool: 'recommend_action', input: { action_id: 'hubspot.update' }, error: false }] };

  it('passes core when it is aware, never refuses, errs no more, costs at most 2¢ more warm, and is not a second slower', () => {
    const rows = summarize(cases, [
      run({ mode: 'history', level: 'standard', answer: 'I can\'t do that.', cents: 2, firstTokenMs: 900 }),
      run({ mode: 'core', level: 'standard', ...ok, cents: 3.5, firstTokenMs: 1200 }),
    ]);

    expect(checkGate(rows).every(c => c.pass)).toBe(true);
  });

  it('fails on a false refusal, on cost and on latency', () => {
    const rows = summarize(cases, [
      run({ mode: 'history', level: 'standard', ...ok, cents: 2, firstTokenMs: 900 }),
      run({ mode: 'core', level: 'standard', answer: 'I can\'t do that.', cents: 5, firstTokenMs: 2500 }),
    ]);
    const failed = checkGate(rows).filter(c => !c.pass).map(c => c.name);

    expect(failed).toEqual(expect.arrayContaining(['standard: tool awareness >= 95%', 'standard: 0 false refusals', 'standard: at most +2¢ per warm turn', 'standard: first response at most 1 s slower']));
  });

  it('leaves a crashed run out of the grades and counts it', () => {
    const [row] = summarize(cases, [run({ crashed: 'overloaded' })]);

    expect(row).toMatchObject({ runs: 1, crashed: 1, falseRefusals: 0 });
  });
});

describe('the wider grades', () => {
  const find = (id: string) => EVAL_CASES.find(c => c.id === id)!;

  it('fails an argument check when the expected tool was called with the wrong value, and skips it when never called', () => {
    const c = find('pa-args-company-id');

    expect(gradeCase(c, run({ caseId: c.id, calls: [{ tool: 'hubspot_company_deals', input: { company_id: 'C-200' }, error: false }] })).argsOk).toBe(false);
    expect(gradeCase(c, run({ caseId: c.id, calls: [{ tool: 'hubspot_company_deals', input: { company_id: 'C-201' }, error: false }] })).argsOk).toBe(true);
    expect(gradeCase(c, run({ caseId: c.id, calls: [] })).argsOk).toBeNull();
  });

  it('passes grounding only when the record is said and the guess is not repeated as fact', () => {
    const c = find('pa-ground-stage');

    expect(gradeCase(c, run({ caseId: c.id, answer: 'Not yet: the Atlas pilot is still in Proposal, closing 2026-11-14.' })).grounded).toBe(true);
    expect(gradeCase(c, run({ caseId: c.id, answer: 'Yes, it is in Negotiation, though HubSpot shows Proposal.' })).grounded).toBe(false);
    expect(gradeCase(c, run({ caseId: c.id, answer: 'Yes, it moved to Negotiation last week.' })).grounded).toBe(false);
  });

  it('calls "noted" without a save a made-up save, and the same words after one a real save', () => {
    const c = find('wl-save-format');
    const said = 'Noted — I will use tables from now on.';

    expect(gradeCase(c, run({ caseId: c.id, answer: said })).madeUpSave).toBe(true);
    expect(gradeCase(c, run({ caseId: c.id, answer: said, calls: [{ tool: 'remember_preference', input: { preference: 'Tables over bullets' }, error: false }] })).madeUpSave).toBe(false);
    expect(gradeCase(c, run({ caseId: c.id, answer: said, calls: [{ tool: 'remember_preference', input: {}, error: true }] })).madeUpSave).toBe(true);
  });
});

describe('repeats', () => {
  it('spreads a figure over repetitions', () => {
    expect(spreadOf([0.9, 1, 0.8])).toEqual({ mean: expect.closeTo(0.9, 6), sd: expect.closeTo(0.1, 6), min: 0.8, max: 1, n: 3 });
    expect(spreadOf([0.5])).toMatchObject({ mean: 0.5, sd: 0, n: 1 });
  });

  it('gives an honest interval at the edges: 45 of 45 is not certainty', () => {
    const [lo, hi] = wilson95(45, 45);

    expect(hi).toBe(1);
    expect(lo).toBeGreaterThan(0.9);
    expect(lo).toBeLessThan(0.95);
  });

  it('pools runs, spreads them by rep and names the cases that pass only sometimes', () => {
    const c = EVAL_CASES.find(x => x.id === 'pa-longtail-chart')!;
    const good = { tool: 'render_chart', input: { type: 'bar', title: 'Discovery Proposal Negotiation Contract sent' }, error: false };
    const runs = [0, 1, 2].map(rep => run({ caseId: c.id, rep, calls: rep === 1 ? [] : [good] }));
    const [row] = summarizeRepeated(EVAL_CASES, runs);

    expect(row!.reps).toBe(3);
    expect(row!.pooled.awareness).toBeCloseTo(2 / 3);
    expect(row!.spread.awareness).toMatchObject({ min: 0, max: 1, n: 3 });
    expect(row!.flaky).toEqual([{ caseId: c.id, passed: 2, of: 3 }]);
    expect(row!.alwaysFailed).toEqual([]);
  });

  it('writes a markdown table with the spread and the gate', () => {
    const runs = ['history', 'core'].flatMap(mode => [0, 1].map(rep => run({ mode: mode as 'core', rep, calls: [{ tool: 'recommend_action', input: { action_id: 'hubspot.update', action_input: { amount: 84000, closedate: '2026-12-15' } }, error: false }] })));
    const repeated = summarizeRepeated(EVAL_CASES, runs);
    const md = resultsMarkdown(repeated, checkGate(repeated.map(r => r.pooled)));

    expect(md).toContain('| core | standard | 2 | 2 (0) | 100%');
    expect(md).toContain('standard: tool awareness >= 95% | yes');
  });
});
