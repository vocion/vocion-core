import type { CaseTranscript } from './transcripts';
import type { EvalCheck } from './types';
import { describe, expect, it } from 'vitest';
import { runCheck, scoreChecks } from './checks';

function transcript(overrides: Partial<CaseTranscript> = {}): CaseTranscript {
  return {
    itemIndex: 0,
    item: { input: 'refund my order 4471' },
    output: 'Refunded $42.10, back within 3-5 business days.',
    toolCalls: [],
    trajectory: ['lookup_order', 'issue_refund'],
    traceId: null,
    latencyMs: 1200,
    errored: false,
    errorMessage: '',
    usage: { model: 'm', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cents: 1, turns: 3, toolCalls: 2 },
    caseResultId: null,
    ...overrides,
  };
}

describe('runCheck', () => {
  it('passes toolCalled when the tool is in the trajectory and fails when it is not', () => {
    expect(runCheck(transcript(), { toolCalled: 'issue_refund' })?.passed).toBe(true);
    expect(runCheck(transcript(), { toolCalled: 'escalate' })?.passed).toBe(false);
  });

  it('names the tools actually used when toolCalled fails', () => {
    // A bare "failed" tells an engineer nothing; the whole point of a
    // deterministic check is that it can say exactly what happened instead.
    const outcome = runCheck(transcript(), { toolCalled: 'escalate' });

    expect(outcome?.explanation).toContain('lookup_order');
    expect(outcome?.explanation).toContain('issue_refund');
  });

  it('passes toolNotCalled only when the forbidden tool was avoided', () => {
    expect(runCheck(transcript(), { toolNotCalled: 'delete_account' })?.passed).toBe(true);
    expect(runCheck(transcript(), { toolNotCalled: 'issue_refund' })?.passed).toBe(false);
  });

  it('fails outputMatches when the pattern does not match', () => {
    // The check that matters. An operator that only ever passes is decorative,
    // and this suite would not catch a regression that made it always return
    // true.
    expect(runCheck(transcript(), { outputMatches: String.raw`\$[0-9,]+\.[0-9]{2}` })?.passed).toBe(true);
    expect(runCheck(transcript(), { outputMatches: String.raw`^Sorry` })?.passed).toBe(false);
  });

  it('reports an invalid regular expression as an authoring mistake, not an agent failure', () => {
    const outcome = runCheck(transcript(), { outputMatches: '([unclosed' });

    expect(outcome?.passed).toBe(false);
    expect(outcome?.explanation).toContain('Invalid regular expression');
  });

  it('passes outputNotContains only when the phrase is absent', () => {
    expect(runCheck(transcript(), { outputNotContains: 'I don\'t have access' })?.passed).toBe(true);
    expect(runCheck(transcript(), { outputNotContains: 'Refunded' })?.passed).toBe(false);
  });

  it('compares latency against the budget rather than reporting it', () => {
    expect(runCheck(transcript({ latencyMs: 900 }), { latencyUnderMs: 1000 })?.passed).toBe(true);
    expect(runCheck(transcript({ latencyMs: 4000 }), { latencyUnderMs: 1000 })?.passed).toBe(false);
  });

  it('treats a case with no recorded usage as zero turns rather than crashing', () => {
    // Errored and unpriced runs both leave usage null; a check that throws
    // here would take down the whole run over a missing number.
    expect(runCheck(transcript({ usage: null }), { turnsUnder: 2 })?.passed).toBe(true);
  });

  it('skips an operator it does not recognise instead of failing the run', () => {
    // A manifest written against a newer build must not break this one.
    const unknown = { somethingNew: 'value' } as unknown as EvalCheck;

    expect(runCheck(transcript(), unknown)).toBeNull();
  });
});

describe('scoreChecks', () => {
  it('produces one score per check, marked pass or fail', () => {
    const scores = scoreChecks(transcript({
      item: {
        input: 'refund my order 4471',
        checks: [{ toolCalled: 'issue_refund' }, { outputContains: 'never said this' }],
      },
    }));

    expect(scores).toHaveLength(2);
    expect(scores[0]?.value).toBe(1);
    expect(scores[0]?.label).toBe('pass');
    expect(scores[1]?.value).toBe(0);
    expect(scores[1]?.label).toBe('fail');
  });

  it('files every score against its own case', () => {
    const scores = scoreChecks(transcript({
      itemIndex: 7,
      item: { input: 'x', checks: [{ toolCalled: 'lookup_order' }] },
    }));

    expect(scores[0]?.itemIndex).toBe(7);
  });

  it('checks nothing on a case whose agent run threw', () => {
    // "Did not call the refund tool" is true of a crashed run and says nothing
    // about the agent. Reporting it as a failed check is noise that reads like
    // a finding.
    const scores = scoreChecks(transcript({
      errored: true,
      output: '',
      trajectory: [],
      item: { input: 'x', checks: [{ toolCalled: 'issue_refund' }] },
    }));

    expect(scores).toEqual([]);
  });

  it('returns nothing for a case that authored no checks', () => {
    expect(scoreChecks(transcript())).toEqual([]);
  });
});
