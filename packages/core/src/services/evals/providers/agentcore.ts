/**
 * Scoring by AWS Bedrock AgentCore.
 *
 * AgentCore never runs our agent. It reads a transcript and says what it
 * thinks, which is why the same transcript can go to it and to our own judge
 * and the two scores stay comparable.
 *
 * We use the synchronous `Evaluate` call. It takes spans in the request body,
 * so nothing here needs CloudWatch, OpenTelemetry, or the agent to be hosted
 * on AgentCore Runtime. It also persists nothing on the AWS side — there is no
 * `GetEvaluation` for a synchronous call — so a score we do not write down is
 * simply gone. That is why this returns scores for the caller to store rather
 * than a handle to fetch later.
 *
 * What AgentCore is good at, and we are not: trajectory matching, which is the
 * only scoring it does without a model call, and judges with defined rating
 * scales. What it cannot do without the customer deploying a Lambda:
 * everything else deterministic — which is what our own `checks` are for.
 */

import type { EvaluationReferenceInput, EvaluationResultContent } from '@aws-sdk/client-bedrock-agentcore';
import type { DocumentType } from '@smithy/types';
import type { CaseTranscript } from '../transcripts';
import type { EvalScoreLevel, ProviderScore } from '../types';
import type { EvalScoreProvider, ProviderAvailability, ScoreRequest } from './types';
import type { AwsCredentials } from '@/services/ApiTokenService';
import process from 'node:process';
import { BedrockAgentCoreClient, EvaluateCommand } from '@aws-sdk/client-bedrock-agentcore';
import { mapWithConcurrency } from '@/libs/concurrency';
import { bedrockRegion } from '@/libs/llm/bedrockCredentials';
import { workspaceTimeZone } from '@/libs/time/workspaceTimeZone';
import { resolveAwsCredentials } from '@/services/ApiTokenService';
import { scoreChecks } from '../checks';
import { evalCaseSessionId } from '../sessionIds';
import { publishAgentcoreDataset } from './agentcoreDatasets';
import { resolveAgentcoreEvaluators } from './agentcoreEvaluators';
import { buildSessionSpans } from './agentcoreSpans';

/**
 * Regions where AgentCore Evaluations exists.
 *
 * Deliberately configurable, and deliberately not trusted as a constant: AWS
 * adds regions, and a hardcoded list that falls behind makes us tell customers
 * a working feature is unavailable. Set `VOCION_AGENTCORE_EVAL_REGIONS` to
 * override.
 *
 * The default below is the launch set and MUST be re-checked against the live
 * AWS region table before anyone relies on it. It errs toward being short: a
 * region wrongly missing gives a clear "not available here" message, while a
 * region wrongly included fails on every case and reads as the agent being
 * broken.
 */
const DEFAULT_EVAL_REGIONS = ['us-east-1', 'us-west-2', 'eu-central-1', 'ap-southeast-2'];

/**
 * Evaluators to run when a dataset has not named any.
 *
 * Trajectory matching only, because it is the one thing AgentCore scores with
 * no token cost and no rating-scale ambiguity, and because turning a paid LLM
 * judge on by default would spend a customer's money for a decision they never
 * made. Anything more is opted into in the dataset's manifest.
 */
const DEFAULT_EVALUATORS = ['Builtin.TrajectoryInOrderMatch'];

/** One evaluation call: one case, one evaluator. */
type EvaluateJob = {
  client: BedrockAgentCoreClient;
  evaluatorId: string;
  transcript: CaseTranscript;
  datasetSlug: string;
};

function configuredRegions(): string[] {
  const configured = process.env.VOCION_AGENTCORE_EVAL_REGIONS;
  if (!configured) {
    return DEFAULT_EVAL_REGIONS;
  }
  return configured.split(',').map(region => region.trim()).filter(Boolean);
}

/**
 * Whether this org can be scored by AgentCore, and if not, why.
 *
 * Checks the region as well as the credential. A credential in a region with
 * no AgentCore Evaluations looks available, then fails on every single case —
 * which a person reads as their agent being broken rather than their setup
 * being wrong. One honest sentence up front beats fifty error rows.
 *
 * The region is the deployment's, not the org's: `bedrockRegion()` reads the
 * process environment, which is how every other Bedrock call in this repo
 * resolves it. A deployment serving orgs whose AWS accounts live in different
 * regions would need a per-org region before this answer is right for all of
 * them.
 * @param orgId - Whose credentials to look for.
 */
async function isAvailable(orgId: string): Promise<ProviderAvailability> {
  const credentials = await resolveAwsCredentials(orgId);
  if (!credentials) {
    return { available: false, reason: 'No AWS credential is connected for this workspace.' };
  }
  const region = bedrockRegion();
  if (!configuredRegions().includes(region)) {
    return {
      available: false,
      reason: `AgentCore Evaluations is not available in ${region}. Set VOCION_AGENTCORE_EVAL_REGIONS if AWS has since added it.`,
    };
  }
  return { available: true, reason: '' };
}

/**
 * Which evaluators this dataset asked for.
 *
 * The dataset's own `evaluators` block wins; the environment variable is a
 * deployment-wide fallback for a workspace that authored none, and the
 * trajectory default is what everyone else gets. Precedence in that order
 * because the file is the thing a person edited on purpose.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset.
 * @param credentials - Needed to create a custom evaluator in AWS.
 * @param region - Where to talk to AWS.
 */
export async function evaluatorIdsFor(
  orgId: string,
  datasetSlug: string,
  credentials: AwsCredentials,
  region: string,
): Promise<string[]> {
  const authored = await resolveAgentcoreEvaluators(orgId, datasetSlug, credentials, region);
  if (authored.length > 0) {
    return authored;
  }
  const configured = process.env.VOCION_AGENTCORE_EVALUATORS;
  if (configured) {
    return configured.split(',').map(id => id.trim()).filter(Boolean);
  }
  return DEFAULT_EVALUATORS;
}

/**
 * AgentCore's level strings, defaulting to TRACE when it says nothing.
 * @param evaluatorId - The evaluator AWS returned this score for.
 */
function levelOf(evaluatorId: string): EvalScoreLevel {
  if (evaluatorId.includes('Trajectory') || evaluatorId.includes('GoalSuccess')) {
    return 'SESSION';
  }
  if (evaluatorId.includes('Tool') || evaluatorId.includes('Skill')) {
    return 'TOOL_CALL';
  }
  return 'TRACE';
}

/**
 * Turn one AWS result into one of our score rows.
 *
 * A result carrying an error code is recorded as an error, never as a score of
 * zero — "the evaluator could not run" and "the agent scored nothing" look the
 * same on a chart and mean opposite things.
 * @param result - One entry from `EvaluateResponse.evaluationResults`.
 * @param transcript - The case it was about.
 */
export function toProviderScore(result: EvaluationResultContent, transcript: CaseTranscript): ProviderScore {
  const evaluatorSlug = result.evaluatorId ?? result.evaluatorName ?? 'unknown';
  return {
    evaluatorSlug,
    evaluatorName: result.evaluatorName ?? null,
    evaluatorArn: result.evaluatorArn ?? null,
    level: levelOf(evaluatorSlug),
    value: result.errorCode ? null : result.value ?? null,
    label: result.errorCode ? null : result.label ?? null,
    explanation: result.explanation ?? null,
    tokenUsage: result.tokenUsage
      ? {
          inputTokens: result.tokenUsage.inputTokens,
          outputTokens: result.tokenUsage.outputTokens,
          totalTokens: result.tokenUsage.totalTokens,
        }
      : null,
    errorCode: result.errorCode ?? null,
    errorMessage: result.errorMessage ?? null,
    itemIndex: transcript.itemIndex,
  };
}

/**
 * Read a whole `Evaluate` response into score rows.
 *
 * An empty or absent `evaluationResults` yields nothing rather than throwing.
 * AWS returning no opinion is a real answer, and it must not take down the
 * run's other scores.
 * @param results - `EvaluateResponse.evaluationResults`, possibly undefined.
 * @param transcript - The case the call was about.
 */
export function parseEvaluateResults(
  results: EvaluationResultContent[] | undefined,
  transcript: CaseTranscript,
): ProviderScore[] {
  if (!results || results.length === 0) {
    return [];
  }
  return results.map(result => toProviderScore(result, transcript));
}

/**
 * Score one case with one evaluator.
 *
 * Catches its own failures: a single evaluator erroring must not lose the
 * scores every other case already produced.
 * @param job - Client, evaluator and the case to score.
 */
async function evaluateOne(job: EvaluateJob): Promise<ProviderScore[]> {
  const sessionId = evalCaseSessionId(job.datasetSlug, job.transcript.itemIndex);
  const spans = buildSessionSpans(job.transcript, sessionId);
  try {
    const response = await job.client.send(new EvaluateCommand({
      evaluatorId: job.evaluatorId,
      // `sessionSpans` is typed as free-form documents on the wire. Our
      // SpanDocument is that shape, spelled out so it is readable here.
      evaluationInput: { sessionSpans: spans as unknown as DocumentType[] },
      evaluationReferenceInputs: referenceInputsFor(job.transcript, sessionId, levelOf(job.evaluatorId)),
    }));
    return parseEvaluateResults(response.evaluationResults, job.transcript);
  } catch (error) {
    const message = (error as Error).message ?? 'AgentCore evaluation failed';
    console.error(`[evals] AgentCore ${job.evaluatorId} failed on case ${job.transcript.itemIndex}`, error);
    return [{
      evaluatorSlug: job.evaluatorId,
      evaluatorName: job.evaluatorId,
      level: levelOf(job.evaluatorId),
      value: null,
      label: null,
      explanation: null,
      errorCode: 'AGENTCORE_EVALUATE_FAILED',
      errorMessage: message,
      itemIndex: job.transcript.itemIndex,
    }];
  }
}

/**
 * Ground truth for this case, in the fields this evaluator's level accepts.
 *
 * AWS validates the reference against the level and refuses the whole request
 * for a field that does not belong there: a SESSION-level evaluator sent an
 * `expectedResponse` answers
 * `Fields {'expectedResponse'} are not valid for SESSION-level context`, and
 * the case is not scored at all. A dataset carrying both an expected answer
 * and an expected trajectory — the normal case — would otherwise fail every
 * case against a trajectory evaluator while passing every mocked test.
 *
 * So the level decides: SESSION grades what the agent did, and takes the
 * trajectory and the assertions; TRACE and TOOL grade what it said, and take
 * the expected answer and the assertions.
 *
 * `context` binds the reference to a session rather than carrying the input
 * text — AWS types it as a span context, so the tie between "what we expected"
 * and "which run we expected it of" is the session id, not a copy of the
 * prompt.
 * @param transcript - The case, and whatever ground truth it authored.
 * @param sessionId - The session the spans were sent under.
 * @param level - The grain this evaluator judges at.
 */
export function referenceInputsFor(
  transcript: CaseTranscript,
  sessionId: string,
  level: EvalScoreLevel,
): EvaluationReferenceInput[] | undefined {
  const { item } = transcript;
  const wantsTrajectory = level === 'SESSION';
  const trajectory = wantsTrajectory ? item.expectedTrajectory ?? [] : [];
  const expectedResponse = wantsTrajectory ? '' : item.expectedOutput ?? '';
  const assertions = item.assertions ?? [];
  if (!trajectory.length && !assertions.length && !expectedResponse) {
    return undefined;
  }
  return [{
    context: { spanContext: { sessionId } },
    ...(expectedResponse ? { expectedResponse: { text: expectedResponse } } : {}),
    ...(assertions.length ? { assertions: assertions.map(text => ({ text })) } : {}),
    ...(trajectory.length ? { expectedTrajectory: { toolNames: trajectory } } : {}),
  }];
}

async function score(request: ScoreRequest): Promise<ProviderScore[]> {
  const credentials = await resolveAwsCredentials(request.orgId);
  if (!credentials) {
    throw new Error('No AWS credential is connected for this workspace.');
  }
  const region = bedrockRegion();
  const client = new BedrockAgentCoreClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });

  const evaluatorIds = await evaluatorIdsFor(request.orgId, request.datasetSlug, credentials, region);
  const jobs: EvaluateJob[] = [];
  for (const transcript of request.transcripts) {
    // An errored case has no trajectory to match and no answer to judge.
    // Sending it invites a zero that reads as "answered badly".
    if (transcript.errored) {
      continue;
    }
    for (const evaluatorId of evaluatorIds) {
      jobs.push({ client, evaluatorId, transcript, datasetSlug: request.datasetSlug });
    }
  }

  const scores = await mapWithConcurrency(jobs, 8, evaluateOne);

  // Deterministic checks run here too, not only under the Vocion grader.
  // They read the transcript, which is ours whoever grades the case, and they
  // answer the questions no judge should be asked in the first place — was
  // the dedup key these three fields in this order, did every proposal carry
  // a suggested decision. Refusing them on an AgentCore dataset meant a team
  // had to pick between AWS's evaluators and any assertion about what the
  // agent actually passed to a tool.
  // Read the clock and the workspace's zone once, so every case in the run
  // agrees on what today is for `timezone: workspace`.
  const clock = { now: new Date(), workspaceTimeZone: await workspaceTimeZone(request.orgId) };
  const checkScores = request.transcripts.flatMap(transcript => scoreChecks(transcript, clock));
  return [...scores.flat(), ...checkScores];
}

export const agentcoreProvider: EvalScoreProvider = {
  id: 'agentcore',
  label: 'AgentCore',
  isAvailable,
  score,
  // The cases also live in the customer's account, as a real AgentCore dataset
  // with versions. Nothing here reads it — `score` sends the ground truth with
  // every request — so it is for provenance, for the console, and for the day
  // an AWS-side batch job runs these same cases.
  publishDataset: publishAgentcoreDataset,
};
