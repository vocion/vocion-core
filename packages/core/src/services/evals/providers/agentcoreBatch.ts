/**
 * Grading the spans the agent actually emitted, in the customer's own account.
 *
 * The on-demand path next door synthesizes spans from a finished transcript
 * and posts them in the request body. AWS scores them and stores nothing, so
 * the only record of that score is the row Vocion writes. That is a weak claim
 * to a client's security team: our tool says our agent is good.
 *
 * Batch evaluation answers the other way round. AWS reads the spans the agent
 * runtime really wrote into CloudWatch, scores them server-side, keeps the job
 * and writes per-session detail to a log group the customer owns. Nobody has
 * to take our word for it, and the same job can be re-run by someone who does
 * not have Vocion at all.
 *
 * Four things about this API decide the shape of everything below.
 *
 * - **It is asynchronous and slow.** A job is started, then polled. It cannot
 *   be a `score()` on the provider interface, which returns scores from one
 *   call — which is why this module is not a provider. The durable wait lives
 *   in the Temporal workflow.
 * - **The result is per-evaluator averages, not per-case scores.** The
 *   per-session detail goes to the CloudWatch log group named in
 *   `outputConfig`. So a batch score is a different kind of number from an
 *   on-demand one and is stored under its own provider id, never mixed in.
 * - **It finds sessions by matching what the runtime emits.** `serviceNames`
 *   has to be the `service.name` the runtime was deployed with and
 *   `logGroupNames` the group Transaction Search writes to. Get either wrong
 *   and the job succeeds having evaluated nothing, which reads like a pass.
 * - **Ground truth is shaped differently from the on-demand call.** There the
 *   expected answer is a top-level `expectedResponse`; here it belongs inside
 *   `turns[].expectedResponse`, and the trajectory and assertions sit beside
 *   it under `groundTruth.inline`. Same facts, different envelope.
 */

import type {
  GetBatchEvaluationCommandOutput,
  SessionMetadataShape,
  StartBatchEvaluationCommandInput,
} from '@aws-sdk/client-bedrock-agentcore';
import type { CaseTranscript } from '../transcripts';
import type { ProviderScore } from '../types';
import {
  BedrockAgentCoreClient,
  GetBatchEvaluationCommand,
  StartBatchEvaluationCommand,
} from '@aws-sdk/client-bedrock-agentcore';
import { evalCaseSessionId } from '../sessionIds';

/**
 * The provider id batch scores are stored under.
 *
 * Deliberately not `agentcore`. A batch score is an average over sessions and
 * an on-demand score is one case's result, so filing them together would put
 * two different kinds of number on one trend line and nobody could tell which
 * was which. Separate ids keep them comparable side by side instead.
 */
export const AGENTCORE_BATCH_PROVIDER = 'agentcore-batch';

/** Statuses that mean the job has stopped and will not change again. */
const TERMINAL_STATUSES = new Set([
  'COMPLETED',
  'COMPLETED_WITH_ERRORS',
  'FAILED',
  'STOPPED',
]);

/** What a caller needs to describe the job it wants started. */
export type BatchRequestOptions = {
  /** Names the job in AWS. Must be unique per account. */
  batchEvaluationName: string;
  /** Which evaluators to run — the same ids the on-demand path uses. */
  evaluatorIds: string[];
  /** `service.name` the runtime was deployed with, e.g. `vocion_agent_runtime_dev`. */
  serviceNames: string[];
  /** Where Transaction Search writes spans, normally `aws/spans`. */
  logGroupNames: string[];
  /** The dataset whose cases these are — decides the session ids. */
  datasetSlug: string;
  /** The finished cases, carrying whatever ground truth was authored. */
  transcripts: CaseTranscript[];
  /** Narrows the search to when these cases ran. */
  timeRange?: { startTime: Date; endTime: Date };
  /** Makes a retried start reuse the job it already created. */
  clientToken?: string;
  description?: string;
};

/**
 * The ground truth for one case, in the envelope batch evaluation expects.
 *
 * Returns undefined when the case authored nothing to check against. Sending
 * an empty ground truth is worse than sending none: AWS then has a reference
 * to compare with that says nothing, and a ground-truth evaluator scores the
 * session against it rather than skipping the session.
 *
 * Unlike the on-demand path this sends every kind of ground truth the case
 * has, and lets AWS pick what each evaluator can use. There the level had to
 * be decided by us because `Evaluate` rejects a field an evaluator cannot read
 * — here the job runs several evaluators over one reference, so choosing for
 * them would starve the others.
 * @param transcript - The case and what it expected.
 */
export function groundTruthFor(transcript: CaseTranscript): SessionMetadataShape['groundTruth'] | undefined {
  const { item } = transcript;
  const trajectory = item.expectedTrajectory ?? [];
  const assertions = item.assertions ?? [];
  const expectedResponse = item.expectedOutput ?? '';
  if (!trajectory.length && !assertions.length && !expectedResponse) {
    return undefined;
  }
  return {
    inline: {
      ...(assertions.length ? { assertions: assertions.map(text => ({ text })) } : {}),
      ...(trajectory.length ? { expectedTrajectory: { toolNames: trajectory } } : {}),
      // The expected answer belongs to a turn here, not to the session — the
      // batch API has no top-level `expectedResponse`, unlike `Evaluate`.
      ...(expectedResponse
        ? { turns: [{ input: { prompt: item.input }, expectedResponse: { text: expectedResponse } }] }
        : {}),
    },
  };
}

/**
 * Build the start request, without sending it.
 *
 * Separate from the call so the request shape can be tested without AWS. Every
 * mistake this module can make that AWS would not reject — a session id that
 * matches no span, ground truth in the wrong envelope, a service name that
 * finds nothing — is visible in this return value.
 *
 * Cases that errored are left out. A case that threw has no spans worth
 * grading, and including its session invites a zero that reads as a bad answer
 * rather than a broken run.
 * @param options - The job to describe.
 */
export function buildBatchRequest(options: BatchRequestOptions): StartBatchEvaluationCommandInput {
  const sessionMetadata: SessionMetadataShape[] = [];
  for (const transcript of options.transcripts) {
    if (transcript.errored) {
      continue;
    }
    const groundTruth = groundTruthFor(transcript);
    sessionMetadata.push({
      sessionId: evalCaseSessionId(options.datasetSlug, transcript.itemIndex),
      testScenarioId: `${options.datasetSlug}-case-${transcript.itemIndex}`,
      ...(groundTruth ? { groundTruth } : {}),
    });
  }

  return {
    batchEvaluationName: options.batchEvaluationName,
    evaluators: options.evaluatorIds.map(evaluatorId => ({ evaluatorId })),
    dataSourceConfig: {
      cloudWatchLogs: {
        serviceNames: options.serviceNames,
        logGroupNames: options.logGroupNames,
        filterConfig: {
          // Named explicitly rather than left to the time range alone: the log
          // group holds every session the agent ever served, and a window is a
          // blunt filter that would pull in real customer traffic beside the
          // cases we meant to grade.
          sessionIds: sessionMetadata.map(entry => entry.sessionId!),
          ...(options.timeRange ? { timeRange: options.timeRange } : {}),
        },
      },
    },
    ...(sessionMetadata.length ? { evaluationMetadata: { sessionMetadata } } : {}),
    ...(options.clientToken ? { clientToken: options.clientToken } : {}),
    ...(options.description ? { description: options.description } : {}),
  };
}

/** Where a polled job stands, and what it has produced if it is finished. */
export type BatchProgress = {
  status: string;
  /** True once the job has stopped and will not change again. */
  terminal: boolean;
  /** Set when the job stopped in a state that is not a clean success. */
  failure: string | null;
  /** Per-evaluator averages, empty until the job finishes. */
  scores: ProviderScore[];
  /** How many sessions AWS found, graded, failed on and skipped. */
  sessions: {
    total: number;
    completed: number;
    failed: number;
    ignored: number;
  };
  /** Where AWS wrote the per-session detail, for a person to open. */
  output: { logGroupName: string; logStreamName: string } | null;
};

/**
 * Read a polled job into something worth storing.
 *
 * Deliberately reports `COMPLETED_WITH_ERRORS` as a failure reason while still
 * returning the scores it produced. Some sessions were graded and some were
 * not, so throwing away the numbers loses real measurement, and calling it a
 * clean pass hides that the average covers fewer cases than the dataset has.
 *
 * A job that completed having evaluated nothing is also a failure, and it is
 * the most likely one: it is what a wrong service name or log group looks
 * like. AWS calls that success, because it did find zero sessions and grade
 * all of them.
 * @param response - What `GetBatchEvaluation` returned.
 */
export function parseBatchResults(response: GetBatchEvaluationCommandOutput): BatchProgress {
  const status = response.status ?? 'UNKNOWN';
  const terminal = TERMINAL_STATUSES.has(status);
  const results = response.evaluationResults;
  const sessions = {
    total: results?.totalNumberOfSessions ?? 0,
    completed: results?.numberOfSessionsCompleted ?? 0,
    failed: results?.numberOfSessionsFailed ?? 0,
    ignored: results?.numberOfSessionsIgnored ?? 0,
  };

  const scores: ProviderScore[] = [];
  for (const summary of results?.evaluatorSummaries ?? []) {
    if (!summary.evaluatorId) {
      continue;
    }
    scores.push({
      evaluatorSlug: summary.evaluatorId,
      evaluatorName: summary.evaluatorId,
      level: 'SESSION',
      value: summary.statistics?.averageScore ?? null,
      label: null,
      explanation: `Average over ${summary.totalEvaluated ?? 0} session(s)${
        summary.totalFailed ? `, ${summary.totalFailed} failed` : ''}`,
    });
  }

  return {
    status,
    terminal,
    failure: failureReasonFor(status, terminal, sessions, response.errorDetails),
    scores,
    sessions,
    output: response.outputConfig?.cloudWatchConfig?.logGroupName
      && response.outputConfig.cloudWatchConfig.logStreamName
      ? {
          logGroupName: response.outputConfig.cloudWatchConfig.logGroupName,
          logStreamName: response.outputConfig.cloudWatchConfig.logStreamName,
        }
      : null,
  };
}

/**
 * Why this job is not a clean success, or null when it is one.
 * @param status - The job's status word.
 * @param terminal - Whether it has stopped.
 * @param sessions - How many sessions it found and graded.
 * @param errorDetails - Whatever AWS said went wrong.
 */
function failureReasonFor(
  status: string,
  terminal: boolean,
  sessions: BatchProgress['sessions'],
  errorDetails: string[] | undefined,
): string | null {
  if (!terminal) {
    return null;
  }
  const detail = errorDetails?.length ? ` ${errorDetails.join('; ')}` : '';
  if (status === 'FAILED' || status === 'STOPPED') {
    return `Batch evaluation ${status.toLowerCase()}.${detail}`;
  }
  if (status === 'COMPLETED_WITH_ERRORS') {
    return `Batch evaluation finished with errors on ${sessions.failed} of ${sessions.total} session(s).${detail}`;
  }
  if (sessions.total === 0) {
    return 'Batch evaluation found no sessions. The service name, the log group or the session ids do not match what the agent runtime emitted.';
  }
  return null;
}

/**
 * Start a job and hand back what AWS called it.
 * @param client - An AgentCore client for the org's own account.
 * @param request - Built by `buildBatchRequest`.
 */
export async function startBatchEvaluation(
  client: BedrockAgentCoreClient,
  request: StartBatchEvaluationCommandInput,
): Promise<{ batchEvaluationId: string; batchEvaluationArn: string }> {
  const response = await client.send(new StartBatchEvaluationCommand(request));
  if (!response.batchEvaluationId || !response.batchEvaluationArn) {
    throw new Error('AgentCore started a batch evaluation but named no job.');
  }
  return {
    batchEvaluationId: response.batchEvaluationId,
    batchEvaluationArn: response.batchEvaluationArn,
  };
}

/**
 * Ask where a job has got to.
 * @param client - An AgentCore client for the org's own account.
 * @param batchEvaluationId - The job to poll.
 */
export async function getBatchEvaluation(
  client: BedrockAgentCoreClient,
  batchEvaluationId: string,
): Promise<BatchProgress> {
  const response = await client.send(new GetBatchEvaluationCommand({ batchEvaluationId }));
  return parseBatchResults(response);
}

/**
 * An AgentCore client for one org's own AWS account.
 *
 * Same credential rule as the on-demand path: the org's stored key pair, never
 * the platform's own identity, because the server's credentials hold the KMS
 * key and the deployment role.
 * @param region - Which region's AgentCore to talk to.
 * @param credentials - The org's own access key.
 * @param credentials.accessKeyId - The key id.
 * @param credentials.secretAccessKey - The secret.
 */
export function batchClient(
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string },
): BedrockAgentCoreClient {
  return new BedrockAgentCoreClient({ region, credentials });
}
