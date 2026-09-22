/**
 * What the pass rate on a run row actually counts.
 *
 * It is the number the dashboard leads with and the number `eval:run` turns
 * into an exit code, so which scores it is made of is not a detail. The rule:
 * a score counts only when it said pass or fail — in those words, or as the 1
 * or 0 of one of AWS's programmatic trajectory matchers.
 */

import type { CaseTranscript } from './transcripts';
import type { ProviderScore } from './types';
import { describe, expect, it } from 'vitest';
import { summarizeProviderScores } from './scoring';

function transcript(itemIndex = 0): CaseTranscript {
  return {
    itemIndex,
    item: { input: 'ingest tonight\'s listings' },
    output: 'Proposed 2 events.',
    toolCalls: [],
    trajectory: ['fetch_url', 'propose_action'],
    traceId: null,
    latencyMs: 1000,
    errored: false,
    errorMessage: '',
    usage: { model: 'm', inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cents: 1, turns: 2, toolCalls: 2 },
    caseResultId: null,
  };
}

function score(overrides: Partial<ProviderScore>): ProviderScore {
  return {
    evaluatorSlug: 'check:toolCalled:fetch_url',
    evaluatorName: 'check',
    level: 'TOOL_CALL',
    value: 1,
    label: 'pass',
    explanation: '',
    itemIndex: 0,
    ...overrides,
  } as ProviderScore;
}

describe('summarizeProviderScores', () => {
  it('counts a pass and a fail, and nothing else', () => {
    const summary = summarizeProviderScores(
      [score({ label: 'pass' }), score({ label: 'fail', value: 0 })],
      [transcript()],
    );

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.passRate).toBe(0.5);
  });

  it('leaves an AWS rating out of the pass rate rather than counting it as a failure', () => {
    // AgentCore's scales are categorical — "Correct", "Mostly Correct" — and
    // mapping them onto pass/fail would need a threshold AWS never stated.
    // Counting them in the denominator made an AgentCore-graded run report a
    // pass rate dragged down by every score that did not speak our
    // vocabulary, which on an AWS-only dataset is all of them.
    const summary = summarizeProviderScores(
      [
        score({ label: 'pass' }),
        score({ evaluatorSlug: 'Builtin.ToolSelectionAccuracy', label: 'Mostly Correct', value: 0.8, level: 'TOOL_CALL' }),
      ],
      [transcript()],
    );

    expect(summary.passRate).toBe(1);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('leaves an errored evaluator out of both sides', () => {
    // An outage is not a quality regression.
    const summary = summarizeProviderScores(
      [
        score({ label: 'pass' }),
        score({ label: null, value: null, errorCode: 'ThrottlingException' }),
      ],
      [transcript()],
    );

    expect(summary.passRate).toBe(1);
    expect(summary.failed).toBe(0);
  });

  it('reports no pass rate, not zero, when AWS rated every case on its own scale', () => {
    // Zero reads as "everything failed" and fails every gate, so a dataset
    // graded only by AWS's ratings would redden every build it ran in.
    const summary = summarizeProviderScores(
      [score({ evaluatorSlug: 'Builtin.Helpfulness', label: 'Very Helpful', value: 0.83 })],
      [transcript()],
    );

    expect(summary.passRate).toBeNull();
    expect(summary.passed).toBe(0);
    expect(summary.scoresWithoutVerdict).toBe(1);
  });

  it('reports nothing scored when every evaluator errored', () => {
    // The gate needs this apart from "rated but not gated": an outage that
    // scored nothing must not pass the way an AWS-only dataset does.
    const summary = summarizeProviderScores(
      [score({ label: null, value: null, errorCode: 'ThrottlingException' })],
      [transcript()],
    );

    expect(summary.passRate).toBeNull();
    expect(summary.scoresWithoutVerdict).toBe(0);
  });

  it('counts a trajectory matcher that found the tools out of order as a failure', () => {
    // AWS labels these `Correct` or `Incorrect`, not pass or fail, and
    // leaving them out let a run that called propose_action before
    // lookup_objects pass the dataset built to catch exactly that.
    const summary = summarizeProviderScores(
      [
        score({ label: 'pass' }),
        score({ evaluatorSlug: 'Builtin.TrajectoryInOrderMatch', label: 'Incorrect', value: 0, level: 'SESSION' }),
      ],
      [transcript()],
    );

    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.passRate).toBe(0.5);
  });

  it('counts a trajectory matcher that found the tools in order as a pass', () => {
    const summary = summarizeProviderScores(
      [score({ evaluatorSlug: 'Builtin.TrajectoryExactOrderMatch', label: 'Correct', value: 1, level: 'SESSION' })],
      [transcript()],
    );

    expect(summary.passRate).toBe(1);
  });

  it('leaves a trajectory score between 0 and 1 out rather than guessing a threshold', () => {
    const summary = summarizeProviderScores(
      [score({ evaluatorSlug: 'Builtin.TrajectoryAnyOrderMatch', label: 'Partially Correct', value: 0.5, level: 'SESSION' })],
      [transcript()],
    );

    expect(summary.passRate).toBeNull();
    expect(summary.scoresWithoutVerdict).toBe(1);
  });
});
