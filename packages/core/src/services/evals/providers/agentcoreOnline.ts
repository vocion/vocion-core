/**
 * Scoring live traffic continuously, with the cost that implies.
 *
 * The two paths next door grade cases somebody wrote. This one grades whatever
 * real people actually asked the agent, by standing configuration: AWS samples
 * a percentage of live sessions, scores them as they happen, and publishes the
 * results as CloudWatch metrics you can alarm on.
 *
 * Read the two limits before using any of this, because neither is obvious
 * from the API and both change what the number means.
 *
 * - **It cannot grade against an expected answer.** Nobody wrote down what the
 *   right reply was for a real customer's question, so every evaluator here
 *   judges a session against itself — was the reply responsive, was it
 *   grounded in what the tools returned. That is a health signal. It is not a
 *   pass rate, and a trajectory evaluator has nothing to match against.
 *   `refuseGroundTruthEvaluators` below is what stops someone configuring one
 *   by accident and reading its output as correctness.
 * - **It bills for as long as it exists.** Every sampled session costs judge
 *   tokens on the customer's account, every day, whether or not anyone looks
 *   at the number. The sampling percentage is the dial, and disabling is a
 *   single call — see `executionStatus` — so nothing here is a one-way door.
 *
 * Unlike batch, this lives on the control plane: a config is a resource with a
 * lifecycle, not a job. It is created once, enabled and disabled in place, and
 * deleted when nobody wants it any more.
 */

import type {
  CreateOnlineEvaluationConfigCommandInput,
  GetOnlineEvaluationConfigCommandOutput,
} from '@aws-sdk/client-bedrock-agentcore-control';
import {
  BedrockAgentCoreControlClient,
  CreateOnlineEvaluationConfigCommand,
  DeleteOnlineEvaluationConfigCommand,
  GetOnlineEvaluationConfigCommand,
  UpdateOnlineEvaluationConfigCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';

/**
 * Evaluators that need a right answer to compare against.
 *
 * Matched by substring rather than by an exhaustive list of ids, because AWS
 * adds evaluators and a list that falls behind would let a new trajectory
 * evaluator through — which is the failure this exists to prevent. A name
 * wrongly caught gives a clear refusal a person can argue with; a name wrongly
 * let through publishes a meaningless metric that looks like correctness.
 */
const GROUND_TRUTH_MARKERS = ['Trajectory', 'ExactMatch', 'InOrderMatch', 'GoalSuccess'];

/** How much live traffic to score when nobody has said. */
export const DEFAULT_SAMPLING_PERCENTAGE = 5;

/**
 * Split the evaluators into the ones that work here and the ones that cannot.
 *
 * Returns both halves rather than throwing, so a caller can run the usable
 * ones and tell someone precisely which of their choices were dropped and
 * why. Silently filtering would leave a person believing their trajectory
 * evaluator was running on production traffic.
 * @param evaluatorIds - What the caller asked for.
 */
export function refuseGroundTruthEvaluators(evaluatorIds: string[]): {
  usable: string[];
  refused: string[];
  reason: string;
} {
  const refused = evaluatorIds.filter(id => GROUND_TRUTH_MARKERS.some(marker => id.includes(marker)));
  const usable = evaluatorIds.filter(id => !refused.includes(id));
  return {
    usable,
    refused,
    reason: refused.length
      ? `${refused.join(', ')} need an expected answer to compare against, and live traffic has none. `
      + 'Score those with a dataset instead; online evaluation can only judge a session against itself.'
      : '',
  };
}

/** What a caller needs to describe a standing configuration. */
export type OnlineConfigOptions = {
  /** Names the config in AWS. */
  name: string;
  /** The role AWS assumes to read the spans and write the results. */
  executionRoleArn: string;
  /** `service.name` the runtime was deployed with. */
  serviceNames: string[];
  /** Where Transaction Search writes spans, normally `aws/spans`. */
  logGroupNames: string[];
  /** Which evaluators to run. Ground-truth ones are refused before this. */
  evaluatorIds: string[];
  /** How much live traffic to score, 0 to 100. */
  samplingPercentage?: number;
  /** How long a session may stay open before it is scored as it stands. */
  sessionTimeoutMinutes?: number;
  /**
   * Whether to start scoring immediately.
   *
   * Defaults to false, deliberately. Creating a config that is already running
   * means the first anyone knows about the bill is the bill. Create it, look
   * at it, then enable it.
   */
  enableOnCreate?: boolean;
  description?: string;
  clientToken?: string;
};

/**
 * Build the create request, without sending it.
 *
 * Throws when every evaluator asked for needs ground truth. A config with no
 * evaluators is accepted by AWS and scores nothing forever, which is a
 * standing bill for no signal — worth refusing loudly at the point someone can
 * still fix it.
 * @param options - The configuration to describe.
 */
export function buildOnlineConfigRequest(
  options: OnlineConfigOptions,
): CreateOnlineEvaluationConfigCommandInput {
  const { usable, refused, reason } = refuseGroundTruthEvaluators(options.evaluatorIds);
  if (usable.length === 0) {
    throw new Error(
      refused.length
        ? `Online evaluation cannot run any of the evaluators asked for. ${reason}`
        : 'Online evaluation needs at least one evaluator.',
    );
  }

  const sampling = options.samplingPercentage ?? DEFAULT_SAMPLING_PERCENTAGE;
  if (sampling <= 0 || sampling > 100) {
    throw new Error(`Sampling percentage must be between 0 and 100, not ${sampling}.`);
  }

  return {
    onlineEvaluationConfigName: options.name,
    ...(options.description ? { description: options.description } : {}),
    ...(options.clientToken ? { clientToken: options.clientToken } : {}),
    rule: {
      samplingConfig: { samplingPercentage: sampling },
      ...(options.sessionTimeoutMinutes
        ? { sessionConfig: { sessionTimeoutMinutes: options.sessionTimeoutMinutes } }
        : {}),
    },
    dataSourceConfig: {
      cloudWatchLogs: {
        serviceNames: options.serviceNames,
        logGroupNames: options.logGroupNames,
      },
    },
    evaluators: usable.map(evaluatorId => ({ evaluatorId })),
    evaluationExecutionRoleArn: options.executionRoleArn,
    // Never defaults to running. See the option's doc comment.
    enableOnCreate: options.enableOnCreate ?? false,
  };
}

/** Where a standing configuration stands. */
export type OnlineConfigState = {
  configId: string;
  configArn: string;
  /** The resource's own lifecycle: CREATING, ACTIVE, UPDATE_FAILED… */
  status: string;
  /** Whether it is actually scoring traffic right now, and being billed for. */
  enabled: boolean;
  samplingPercentage: number | null;
  evaluatorIds: string[];
  /** Where AWS writes the per-session results, for a person to open. */
  outputLogGroup: string | null;
  failureReason: string | null;
};

/**
 * Read a config into something worth storing.
 * @param response - What AWS returned about the config.
 */
export function parseOnlineConfig(response: GetOnlineEvaluationConfigCommandOutput): OnlineConfigState {
  return {
    configId: response.onlineEvaluationConfigId ?? '',
    configArn: response.onlineEvaluationConfigArn ?? '',
    status: response.status ?? 'UNKNOWN',
    // The two statuses answer different questions and both matter: a config
    // can be ACTIVE as a resource while switched off, which costs nothing, and
    // that distinction is the whole cost story.
    enabled: response.executionStatus === 'ENABLED',
    samplingPercentage: response.rule?.samplingConfig?.samplingPercentage ?? null,
    evaluatorIds: (response.evaluators ?? [])
      .map(evaluator => evaluator.evaluatorId)
      .filter((id): id is string => Boolean(id)),
    outputLogGroup: response.outputConfig?.cloudWatchConfig?.logGroupName ?? null,
    failureReason: response.failureReason ?? null,
  };
}

/**
 * Create the configuration.
 * @param client - A control-plane client for the org's own account.
 * @param request - Built by `buildOnlineConfigRequest`.
 */
export async function createOnlineConfig(
  client: BedrockAgentCoreControlClient,
  request: CreateOnlineEvaluationConfigCommandInput,
): Promise<{ configId: string; configArn: string; status: string; enabled: boolean }> {
  const response = await client.send(new CreateOnlineEvaluationConfigCommand(request));
  if (!response.onlineEvaluationConfigId || !response.onlineEvaluationConfigArn) {
    throw new Error('AgentCore created an online evaluation config but named no id.');
  }
  return {
    configId: response.onlineEvaluationConfigId,
    configArn: response.onlineEvaluationConfigArn,
    status: response.status ?? 'UNKNOWN',
    enabled: response.executionStatus === 'ENABLED',
  };
}

/**
 * Read the configuration back.
 * @param client - A control-plane client for the org's own account.
 * @param configId - Which configuration.
 */
export async function getOnlineConfig(
  client: BedrockAgentCoreControlClient,
  configId: string,
): Promise<OnlineConfigState> {
  const response = await client.send(new GetOnlineEvaluationConfigCommand({
    onlineEvaluationConfigId: configId,
  }));
  return parseOnlineConfig(response);
}

/**
 * Start or stop scoring, without deleting anything.
 *
 * This is the cost switch. Disabling leaves the configuration in place and its
 * past results readable while nothing new is sampled and nothing new is
 * billed, which is what someone almost always means by "turn it off".
 * @param client - A control-plane client for the org's own account.
 * @param configId - Which configuration.
 * @param enabled - Whether it should be scoring.
 */
export async function setOnlineConfigEnabled(
  client: BedrockAgentCoreControlClient,
  configId: string,
  enabled: boolean,
): Promise<void> {
  await client.send(new UpdateOnlineEvaluationConfigCommand({
    onlineEvaluationConfigId: configId,
    executionStatus: enabled ? 'ENABLED' : 'DISABLED',
  }));
}

/**
 * Change how much traffic is scored.
 *
 * Separate from enabling because it is the other half of the cost dial, and
 * because turning sampling down is usually the right answer to a bill that is
 * bigger than expected — cheaper than losing the signal entirely.
 * @param client - A control-plane client for the org's own account.
 * @param configId - Which configuration.
 * @param samplingPercentage - How much live traffic to score, 0 to 100.
 */
export async function setOnlineSampling(
  client: BedrockAgentCoreControlClient,
  configId: string,
  samplingPercentage: number,
): Promise<void> {
  if (samplingPercentage <= 0 || samplingPercentage > 100) {
    throw new Error(`Sampling percentage must be between 0 and 100, not ${samplingPercentage}.`);
  }
  await client.send(new UpdateOnlineEvaluationConfigCommand({
    onlineEvaluationConfigId: configId,
    rule: { samplingConfig: { samplingPercentage } },
  }));
}

/**
 * Remove the configuration for good.
 *
 * Almost always the wrong call: disabling stops the bill and keeps the history
 * readable, while deleting throws away the configuration someone tuned. Kept
 * because a workspace that is finished with the feature should be able to
 * leave nothing behind in the customer's account.
 * @param client - A control-plane client for the org's own account.
 * @param configId - Which configuration.
 */
export async function deleteOnlineConfig(
  client: BedrockAgentCoreControlClient,
  configId: string,
): Promise<void> {
  await client.send(new DeleteOnlineEvaluationConfigCommand({
    onlineEvaluationConfigId: configId,
  }));
}

/**
 * A control-plane client for one org's own AWS account.
 *
 * Same credential rule as everywhere else here: the org's stored key pair,
 * never the platform's own identity.
 * @param region - Which region's AgentCore to talk to.
 * @param credentials - The org's own access key.
 * @param credentials.accessKeyId - The key id.
 * @param credentials.secretAccessKey - The secret.
 */
export function onlineClient(
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string },
): BedrockAgentCoreControlClient {
  return new BedrockAgentCoreControlClient({ region, credentials });
}
