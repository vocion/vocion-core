/**
 * What these tests defend.
 *
 * Batch evaluation fails quietly. A wrong service name, a session id that
 * matches no span, ground truth in the on-demand envelope — none of these are
 * rejected. The job runs, AWS reports success, and the average covers nothing.
 * So each test here names the silent failure it prevents.
 */

import type { GetBatchEvaluationCommandOutput } from '@aws-sdk/client-bedrock-agentcore';
import type { CaseTranscript } from '../transcripts';
import { describe, expect, it } from 'vitest';
import { batchEvaluationNameFor, buildBatchRequest, groundTruthFor, parseBatchResults } from './agentcoreBatch';

/**
 * A finished case, with whatever ground truth this test is about.
 * @param overrides - The parts of the case under test.
 */
function transcript(overrides: Partial<CaseTranscript> & { itemIndex: number }): CaseTranscript {
  return {
    item: { input: 'refund my order', expectedOutput: '', expectedTrajectory: [], assertions: [] },
    output: 'Refunded.',
    toolCalls: [],
    trajectory: [],
    traceId: null,
    latencyMs: 10,
    errored: false,
    errorMessage: '',
    usage: null,
    caseResultId: null,
    ...overrides,
  } as CaseTranscript;
}

/**
 * A polled job response.
 * @param overrides - The fields this test is about.
 */
function polled(overrides: Partial<GetBatchEvaluationCommandOutput>): GetBatchEvaluationCommandOutput {
  return { $metadata: {}, ...overrides } as GetBatchEvaluationCommandOutput;
}

const BASE = {
  batchEvaluationName: 'vocion_run41_refund_quality',
  evaluatorIds: ['Builtin.TrajectoryInOrderMatch'],
  serviceNames: ['vocion_agent_runtime_dev'],
  logGroupNames: ['aws/spans'],
  datasetSlug: 'refund-quality',
};

describe('groundTruthFor', () => {
  it('puts the expected answer inside a turn, not beside the session', () => {
    // The on-demand `Evaluate` call takes a top-level `expectedResponse`. The
    // batch API has no such field — it lives in `turns[].expectedResponse`.
    // Copying the on-demand envelope here sends ground truth AWS ignores, and
    // the evaluator then scores the session against nothing.
    const truth = groundTruthFor(transcript({
      itemIndex: 0,
      item: { input: 'refund my order', expectedOutput: 'Your refund is on the way.' },
    }));

    expect(truth?.inline?.turns?.[0]?.expectedResponse).toEqual({ text: 'Your refund is on the way.' });
    expect(truth?.inline).not.toHaveProperty('expectedResponse');
  });

  it('carries the prompt on the turn it belongs to', () => {
    const truth = groundTruthFor(transcript({
      itemIndex: 0,
      item: { input: 'refund my order', expectedOutput: 'Done.' },
    }));

    expect(truth?.inline?.turns?.[0]?.input).toEqual({ prompt: 'refund my order' });
  });

  it('sends the trajectory and the assertions alongside', () => {
    const truth = groundTruthFor(transcript({
      itemIndex: 0,
      item: {
        input: 'refund my order',
        expectedTrajectory: ['lookup_order', 'issue_refund'],
        assertions: ['names the refund amount'],
      },
    }));

    expect(truth?.inline?.expectedTrajectory).toEqual({ toolNames: ['lookup_order', 'issue_refund'] });
    expect(truth?.inline?.assertions).toEqual([{ text: 'names the refund amount' }]);
  });

  it('sends nothing at all when the case expects nothing', () => {
    // An empty ground truth is worse than none: a ground-truth evaluator
    // grades the session against a reference that says nothing, instead of
    // skipping the session.
    expect(groundTruthFor(transcript({ itemIndex: 0 }))).toBeUndefined();
  });
});

describe('buildBatchRequest', () => {
  it('addresses each case by the same session id the runtime emitted', () => {
    // This is the join. The runtime stamps `session.id` from the id core sent
    // it, derived the same way (`evalCaseSessionId`). If these drifted apart
    // the job would find no sessions and still report success.
    const request = buildBatchRequest({
      ...BASE,
      transcripts: [transcript({ itemIndex: 0 }), transcript({ itemIndex: 1 })],
    });
    const ids = request.evaluationMetadata?.sessionMetadata?.map(entry => entry.sessionId);

    expect(ids).toEqual(['refund-quality-0', 'refund-quality-1']);
    expect(request.dataSourceConfig?.cloudWatchLogs?.filterConfig?.sessionIds)
      .toEqual(['refund-quality-0', 'refund-quality-1']);
  });

  it('names the sessions explicitly rather than trusting a time window', () => {
    // The log group holds every session the agent ever served. Filtering by
    // window alone would pull real customer conversations into a dataset's
    // score — and bill the client for grading them.
    const request = buildBatchRequest({
      ...BASE,
      transcripts: [transcript({ itemIndex: 0 })],
      timeRange: { startTime: new Date('2026-09-17T00:00:00Z'), endTime: new Date('2026-09-17T01:00:00Z') },
    });

    expect(request.dataSourceConfig?.cloudWatchLogs?.filterConfig?.sessionIds).toHaveLength(1);
  });

  it('leaves out a case that errored', () => {
    // A case that threw emitted no usable spans. Its session would score zero,
    // which reads as a bad answer rather than a broken run.
    const request = buildBatchRequest({
      ...BASE,
      transcripts: [
        transcript({ itemIndex: 0 }),
        transcript({ itemIndex: 1, errored: true, errorMessage: 'tool endpoint refused' }),
      ],
    });

    expect(request.evaluationMetadata?.sessionMetadata).toHaveLength(1);
    expect(request.evaluationMetadata?.sessionMetadata?.[0]?.sessionId).toBe('refund-quality-0');
  });

  it('points at the service name and log group the runtime writes to', () => {
    const request = buildBatchRequest({ ...BASE, transcripts: [transcript({ itemIndex: 0 })] });

    expect(request.dataSourceConfig?.cloudWatchLogs?.serviceNames).toEqual(['vocion_agent_runtime_dev']);
    expect(request.dataSourceConfig?.cloudWatchLogs?.logGroupNames).toEqual(['aws/spans']);
  });

  it('passes the idempotency token through', () => {
    // A retried start must reuse the job it already made, not bill for a
    // second one over the same sessions.
    const request = buildBatchRequest({
      ...BASE,
      transcripts: [transcript({ itemIndex: 0 })],
      clientToken: 'run-4821',
    });

    expect(request.clientToken).toBe('run-4821');
  });
});

describe('parseBatchResults', () => {
  it('is not terminal while the job is still running', () => {
    const progress = parseBatchResults(polled({ status: 'IN_PROGRESS' }));

    expect(progress.terminal).toBe(false);
    expect(progress.failure).toBeNull();
  });

  it('turns each evaluator summary into one average score', () => {
    const progress = parseBatchResults(polled({
      status: 'COMPLETED',
      evaluationResults: {
        totalNumberOfSessions: 4,
        numberOfSessionsCompleted: 4,
        evaluatorSummaries: [
          { evaluatorId: 'Builtin.TrajectoryInOrderMatch', totalEvaluated: 4, statistics: { averageScore: 0.75 } },
        ],
      },
    }));

    expect(progress.terminal).toBe(true);
    expect(progress.failure).toBeNull();
    expect(progress.scores).toHaveLength(1);
    expect(progress.scores[0]?.value).toBe(0.75);
    expect(progress.scores[0]?.evaluatorSlug).toBe('Builtin.TrajectoryInOrderMatch');
  });

  it('calls a job that graded nothing a failure', () => {
    // The most likely way this breaks, and AWS calls it success: it found zero
    // sessions and graded all of them. A wrong service name, a wrong log group
    // or a session id that matches no span all look exactly like this.
    const progress = parseBatchResults(polled({
      status: 'COMPLETED',
      evaluationResults: { totalNumberOfSessions: 0, numberOfSessionsCompleted: 0 },
    }));

    expect(progress.terminal).toBe(true);
    expect(progress.failure).toContain('found no sessions');
  });

  it('keeps the scores from a job that finished with errors', () => {
    // Some sessions were graded and some were not. Throwing the numbers away
    // loses real measurement; calling it a clean pass hides that the average
    // covers fewer cases than the dataset has.
    const progress = parseBatchResults(polled({
      status: 'COMPLETED_WITH_ERRORS',
      errorDetails: ['session refund-quality-2 had no spans'],
      evaluationResults: {
        totalNumberOfSessions: 4,
        numberOfSessionsCompleted: 3,
        numberOfSessionsFailed: 1,
        evaluatorSummaries: [
          { evaluatorId: 'Builtin.Correctness', totalEvaluated: 3, totalFailed: 1, statistics: { averageScore: 0.6 } },
        ],
      },
    }));

    expect(progress.terminal).toBe(true);
    expect(progress.scores).toHaveLength(1);
    expect(progress.scores[0]?.value).toBe(0.6);
    expect(progress.failure).toContain('1 of 4');
    expect(progress.failure).toContain('had no spans');
  });

  it('reports a failed job as a failure with what AWS said', () => {
    const progress = parseBatchResults(polled({
      status: 'FAILED',
      errorDetails: ['access denied reading aws/spans'],
    }));

    expect(progress.terminal).toBe(true);
    expect(progress.failure).toContain('failed');
    expect(progress.failure).toContain('access denied reading aws/spans');
    expect(progress.scores).toHaveLength(0);
  });

  it('records where AWS wrote the per-session detail', () => {
    // The whole point of the batch path: a person opens this log group in
    // their own account and reads the result without going through Vocion.
    const progress = parseBatchResults(polled({
      status: 'COMPLETED',
      evaluationResults: { totalNumberOfSessions: 1, numberOfSessionsCompleted: 1 },
      outputConfig: { cloudWatchConfig: { logGroupName: '/aws/bedrock-agentcore/evaluations', logStreamName: 'job-1' } },
    }));

    expect(progress.output).toEqual({
      logGroupName: '/aws/bedrock-agentcore/evaluations',
      logStreamName: 'job-1',
    });
  });
});

describe('batchEvaluationNameFor', () => {
  it('produces a name AWS will accept from a hyphenated slug', () => {
    // Found by a live call, not by a test: AWS rejects anything outside
    // /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/ with a 400, and every dataset slug in the
    // product is hyphenated. The previous name was `vocion-<slug>-run-<id>`,
    // so no batch job could ever have started.
    const name = batchEvaluationNameFor('refund-quality-2026', 41);

    expect(name).toMatch(/^[a-z]\w{0,47}$/i);
    expect(name).not.toContain('-');
  });

  it('keeps the run id when the slug is too long to fit', () => {
    // The name is cut from the right, so a long slug would eat the run id and
    // two runs of one dataset would collide on a name AWS wants unique.
    const name = batchEvaluationNameFor('a-very-long-dataset-slug-that-will-not-fit-in-forty-eight', 7);

    expect(name).toMatch(/^[a-z]\w{0,47}$/i);
    expect(name).toContain('run7');
  });

  it('never ends on the separator left by truncation', () => {
    const name = batchEvaluationNameFor(`${'x'.repeat(30)}-tail`, 1);

    expect(name.endsWith('_')).toBe(false);
  });
});

describe('buildBatchRequest name validation', () => {
  it('refuses a name AWS would reject, before spending a call', () => {
    expect(() => buildBatchRequest({
      ...BASE,
      batchEvaluationName: 'refund-quality-2026-09-17',
      transcripts: [transcript({ itemIndex: 0 })],
    })).toThrow(/letters, digits and underscores/);
  });
});
