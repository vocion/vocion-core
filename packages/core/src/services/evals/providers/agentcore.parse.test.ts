import type { EvaluationResultContent } from '@aws-sdk/client-bedrock-agentcore';
import type { CaseTranscript } from '../transcripts';
import { describe, expect, it } from 'vitest';
import { parseEvaluateResults, toProviderScore } from './agentcore';

function transcript(itemIndex = 0): CaseTranscript {
  return {
    itemIndex,
    item: { input: 'refund my order 4471' },
    output: 'Refunded $42.10.',
    toolCalls: [],
    trajectory: ['lookup_order', 'issue_refund'],
    traceId: null,
    latencyMs: 1200,
    errored: false,
    errorMessage: '',
    usage: null,
    caseResultId: null,
  };
}

/**
 * A well-formed result, as the SDK types it.
 * @param overrides
 */
function result(overrides: Partial<EvaluationResultContent> = {}): EvaluationResultContent {
  return {
    evaluatorId: 'Builtin.ToolSelectionAccuracy',
    evaluatorName: 'Tool selection accuracy',
    evaluatorArn: 'arn:aws:bedrock-agentcore:us-west-2:1:evaluator/tool-selection',
    value: 0.8,
    label: 'Mostly Correct',
    explanation: 'Called the right tools but in a surprising order.',
    context: undefined,
    tokenUsage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    ...overrides,
  } as EvaluationResultContent;
}

describe('toProviderScore', () => {
  it('keeps the provider label exactly as it came back', () => {
    // Rating scales differ per evaluator, so "Mostly Correct" cannot be mapped
    // to pass/fail without inventing a threshold AWS never stated.
    const score = toProviderScore(result(), transcript());

    expect(score.label).toBe('Mostly Correct');
    expect(score.value).toBe(0.8);
  });

  it('records an errored result as an error rather than a score of zero', () => {
    // A zero says the agent did badly. An error says the evaluator never ran.
    // Conflating them makes an AWS outage look like a quality regression.
    const score = toProviderScore(
      result({ errorCode: 'ThrottlingException', errorMessage: 'rate exceeded', value: 0, label: 'Incorrect' }),
      transcript(),
    );

    expect(score.errorCode).toBe('ThrottlingException');
    expect(score.value).toBeNull();
    expect(score.label).toBeNull();
  });

  it('files the score against the case it was about', () => {
    expect(toProviderScore(result(), transcript(4)).itemIndex).toBe(4);
  });

  it('classifies trajectory and tool evaluators at the right grain', () => {
    expect(toProviderScore(result({ evaluatorId: 'Builtin.TrajectoryInOrderMatch' }), transcript()).level).toBe('SESSION');
    expect(toProviderScore(result({ evaluatorId: 'Builtin.ToolParameterAccuracy' }), transcript()).level).toBe('TOOL_CALL');
    expect(toProviderScore(result({ evaluatorId: 'Builtin.Correctness' }), transcript()).level).toBe('TRACE');
  });

  it('falls back to a name when AWS omits the evaluator id', () => {
    const score = toProviderScore(result({ evaluatorId: undefined }), transcript());

    expect(score.evaluatorSlug).toBe('Tool selection accuracy');
  });
});

describe('parseEvaluateResults', () => {
  it('maps every result in the array', () => {
    // One case graded by two evaluators is two scores. Collapsing them to one
    // is what the eval_score table exists to avoid.
    const scores = parseEvaluateResults(
      [result(), result({ evaluatorId: 'Builtin.Correctness', label: 'Perfectly Correct', value: 1 })],
      transcript(),
    );

    expect(scores).toHaveLength(2);
    expect(scores.map(score => score.evaluatorSlug)).toEqual([
      'Builtin.ToolSelectionAccuracy',
      'Builtin.Correctness',
    ]);
  });

  it('returns nothing for an empty result set rather than throwing', () => {
    expect(parseEvaluateResults([], transcript())).toEqual([]);
  });

  it('returns nothing when AWS omits the results field entirely', () => {
    // The field is optional in the SDK's own types, so this is a shape we will
    // eventually be handed; a crash here would lose the whole run's scores.
    expect(parseEvaluateResults(undefined, transcript())).toEqual([]);
  });

  it('survives a result with almost every field missing', () => {
    const scores = parseEvaluateResults([{} as EvaluationResultContent], transcript());

    expect(scores).toHaveLength(1);
    expect(scores[0]?.evaluatorSlug).toBe('unknown');
    expect(scores[0]?.value).toBeNull();
  });
});
