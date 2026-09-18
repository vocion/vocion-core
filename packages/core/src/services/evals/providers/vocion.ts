/**
 * Our own scoring, behind the provider interface.
 *
 * Two different things, deliberately both here:
 *
 * - The LLM judge that has always graded eval cases. One call per case, a
 *   rubric if the case authored one, a verdict and a rationale back.
 * - The deterministic `checks`, which cost nothing and need no account. These
 *   exist because AgentCore's only non-model scorer is trajectory matching,
 *   and its only other deterministic option is a Lambda the customer deploys.
 *
 * Always available. Every org can use its own judge, so there is no credential
 * to check and no region to be wrong about — which is also why a workspace
 * with no AWS sees no provider filter at all rather than an empty one.
 */

import type { CaseTranscript } from '../transcripts';
import type { ProviderScore } from '../types';
import type { EvalScoreProvider, ProviderAvailability, ScoreRequest } from './types';
import { mapWithConcurrency } from '@/libs/concurrency';
import { scoreChecks } from '../checks';
import { DEFAULT_CASE_CONCURRENCY } from '../transcripts';
import { judgeTranscript } from './vocionJudge';

/** Everything one judge call needs, so the worker closes over nothing. */
type JudgeJob = {
  orgId: string;
  datasetSlug: string;
  transcript: CaseTranscript;
};

/**
 * Judge one case, then run its deterministic checks.
 *
 * A case whose agent run threw is recorded as an error rather than a zero. A
 * zero says "the agent answered badly"; an error says "there was no answer",
 * and a trend line that cannot tell them apart will show an outage as a
 * quality regression.
 * @param job - The case and the context the judge needs.
 */
async function scoreOneCase(job: JudgeJob): Promise<ProviderScore[]> {
  const { transcript } = job;
  if (transcript.errored) {
    return [{
      evaluatorSlug: 'vocion:judge',
      evaluatorName: 'Vocion judge',
      level: 'TRACE',
      value: null,
      label: 'error',
      explanation: transcript.errorMessage || 'the agent run failed',
      errorCode: 'AGENT_RUN_FAILED',
      errorMessage: transcript.errorMessage,
      itemIndex: transcript.itemIndex,
    }];
  }

  const judgement = await judgeTranscript({
    orgId: job.orgId,
    datasetSlug: job.datasetSlug,
    transcript,
  });

  return [
    {
      evaluatorSlug: 'vocion:judge',
      evaluatorName: 'Vocion judge',
      level: 'TRACE',
      value: judgement.score,
      label: judgement.verdict,
      explanation: judgement.rationale,
      itemIndex: transcript.itemIndex,
    },
    ...scoreChecks(transcript),
  ];
}

async function isAvailable(): Promise<ProviderAvailability> {
  return { available: true, reason: '' };
}

async function score(request: ScoreRequest): Promise<ProviderScore[]> {
  const jobs: JudgeJob[] = request.transcripts.map(transcript => ({
    orgId: request.orgId,
    datasetSlug: request.datasetSlug,
    transcript,
  }));
  const perCase = await mapWithConcurrency(jobs, DEFAULT_CASE_CONCURRENCY, scoreOneCase);
  return perCase.flat();
}

export const vocionProvider: EvalScoreProvider = {
  id: 'vocion',
  label: 'Vocion',
  isAvailable,
  score,
};
