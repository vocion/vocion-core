import type { EvaluationResultContent } from '@aws-sdk/client-bedrock-agentcore';
import type { CaseTranscript } from '../transcripts';
import { describe, expect, it } from 'vitest';
import { parseEvaluateResults, referenceInputsFor, toProviderScore } from './agentcore';

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
 * @param overrides - Fields to change on the otherwise valid result.
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

describe('referenceInputsFor', () => {
  /** A case that authored every kind of ground truth at once. */
  function fullyAuthored(): CaseTranscript {
    return {
      ...transcript(),
      item: {
        input: 'refund my order 4471',
        expectedOutput: 'Refunded $42.10.',
        expectedTrajectory: ['lookup_order', 'issue_refund'],
        assertions: ['names the amount'],
      },
    };
  }

  it('sends a session-level evaluator the trajectory and not the expected answer', () => {
    // AWS refuses the whole request otherwise — "Fields {'expectedResponse'}
    // are not valid for SESSION-level context" — and the case goes unscored,
    // which is worse than scoring it badly.
    const [reference] = referenceInputsFor(fullyAuthored(), 'session-1', 'SESSION')!;

    expect(reference?.expectedTrajectory?.toolNames).toEqual(['lookup_order', 'issue_refund']);
    expect(reference?.expectedResponse).toBeUndefined();
    expect(reference?.assertions).toHaveLength(1);
  });

  it('sends a trace-level evaluator the expected answer and not the trajectory', () => {
    const [reference] = referenceInputsFor(fullyAuthored(), 'session-1', 'TRACE')!;

    expect(reference?.expectedResponse?.text).toBe('Refunded $42.10.');
    expect(reference?.expectedTrajectory).toBeUndefined();
  });

  it('ties the ground truth to the session the spans were sent under', () => {
    // A mismatch here is answered with "contexts that do not match any
    // session", so the reference is silently dropped.
    const [reference] = referenceInputsFor(fullyAuthored(), 'session-7', 'SESSION')!;

    expect(reference?.context?.spanContext?.sessionId).toBe('session-7');
  });

  it('sends nothing at all for a case with no ground truth for this level', () => {
    // An empty reference is not the same as none: AWS validates the shape, and
    // a case that only authored an expected answer has nothing to say to a
    // trajectory evaluator.
    const onlyAnswer = { ...transcript(), item: { input: 'hi', expectedOutput: 'hello' } };

    expect(referenceInputsFor(onlyAnswer, 'session-1', 'SESSION')).toBeUndefined();
  });
});
