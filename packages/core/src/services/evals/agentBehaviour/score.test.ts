import type { CaseRun } from './score';
import { describe, expect, it } from 'vitest';
import { EVAL_CASES } from './dataset';
import { checkGate, gradeCase, isRefusal, summarize, usedExpectedTool } from './score';

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
    expect(gradeCase(write, run({ answer: 'I can\'t update HubSpot deals.' }))).toEqual({ aware: false, falseRefusal: true });
    expect(gradeCase(write, run({ answer: 'Done. I can\'t also email them, though.', calls: [{ tool: 'propose_action', input: { action_id: 'hubspot.update' }, error: false }] }))).toEqual({ aware: true, falseRefusal: false });
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
