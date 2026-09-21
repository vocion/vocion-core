/**
 * Deterministic checks under the AgentCore grader.
 *
 * They used to run only under our own judge, so a dataset that wanted AWS's
 * evaluators had to give up every assertion about what the agent passed to a
 * tool — and those are exactly the assertions no model should be asked to
 * make. The transcript is ours whoever grades the case, so the checks read it
 * either way.
 */

import type { CaseTranscript } from '../transcripts';
import { describe, expect, it, vi } from 'vitest';

const send = vi.fn(async () => ({
  evaluationResults: [{
    evaluatorId: 'Builtin.TrajectoryInOrderMatch',
    evaluatorName: 'Trajectory in order',
    evaluatorArn: 'arn:aws:bedrock-agentcore:us-west-2:1:evaluator/trajectory',
    value: 1,
    label: 'Correct',
    explanation: 'Tools were called in the expected order.',
  }],
}));

vi.mock('@aws-sdk/client-bedrock-agentcore', () => ({
  BedrockAgentCoreClient: class {
    send = send;
  },
  EvaluateCommand: class {
    constructor(public input: unknown) {}
  },
}));

vi.mock('@/services/ApiTokenService', () => ({
  resolveAwsCredentials: async () => ({ accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' }),
}));

vi.mock('./agentcoreEvaluators', () => ({
  resolveAgentcoreEvaluators: async () => [],
}));

const { agentcoreProvider } = await import('./agentcore');

function transcript(): CaseTranscript {
  return {
    itemIndex: 0,
    item: {
      input: 'Ingest tonight\'s listings',
      checks: [
        { toolCalledWith: { tool: 'propose_action', path: 'dedupOn', equals: ['title', 'startDate', 'venueName'] } },
        { toolNotCalled: 'web_search' },
      ],
    },
    output: 'Proposed 1 event.',
    toolCalls: [
      { tool: 'fetch_url', input: { url: 'https://example.org/events' }, output: 'page text' },
      { tool: 'propose_action', input: { dedupOn: ['title', 'startDate', 'venueName'] }, output: 'proposed' },
    ],
    trajectory: ['fetch_url', 'propose_action'],
    traceId: null,
    latencyMs: 900,
    errored: false,
    errorMessage: '',
    usage: null,
    caseResultId: null,
  };
}

describe('agentcore provider', () => {
  it('returns its own deterministic checks alongside the AWS evaluator scores', async () => {
    const scores = await agentcoreProvider.score({
      orgId: 'org_t',
      agentSlug: 'ingestion-lead',
      datasetSlug: 'event-extraction',
      transcripts: [transcript()],
    });

    const slugs = scores.map(score => score.evaluatorSlug);

    expect(slugs).toContain('Builtin.TrajectoryInOrderMatch');
    expect(slugs).toContain('check:toolCalledWith:propose_action.dedupOn');
    expect(slugs).toContain('check:toolNotCalled:web_search');
    expect(scores.every(score => score.itemIndex === 0)).toBe(true);
  });

  it('fails the check, not the run, when the agent broke the rule AWS cannot see', async () => {
    // The dedup key is inside the tool arguments. AWS's evaluators read the
    // trajectory and the answer text, so without this the wrong key scores a
    // clean pass.
    const broken = transcript();
    broken.toolCalls[1] = { tool: 'propose_action', input: { dedupOn: ['title', 'start', 'venueName'] }, output: 'proposed' };

    const scores = await agentcoreProvider.score({
      orgId: 'org_t',
      agentSlug: 'ingestion-lead',
      datasetSlug: 'event-extraction',
      transcripts: [broken],
    });

    const dedupKeyScore = scores.find(score => score.evaluatorSlug === 'check:toolCalledWith:propose_action.dedupOn');

    expect(dedupKeyScore?.label).toBe('fail');
    expect(scores.find(score => score.evaluatorSlug === 'Builtin.TrajectoryInOrderMatch')?.label).toBe('Correct');
  });
});
