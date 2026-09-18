/**
 * Turning continuous scoring of live traffic on, down, and off again.
 *
 * Everything here changes something that costs money for as long as it is
 * running, on the customer's own AWS bill, so the shape of this module is
 * built around that rather than around the API:
 *
 * - **Nothing happens implicitly.** No run starts this, no schedule starts
 *   this. It is turned on by a person and the row records that it was.
 * - **Created switched off.** `enableOnCreate` is false, so a configuration
 *   exists and can be inspected before it samples a single session. Turning
 *   it on is a second, deliberate call.
 * - **Off means disabled, not deleted.** Disabling stops the sampling and the
 *   bill while leaving the results readable and the configuration intact,
 *   which is what someone means by "turn it off" almost every time.
 * - **The state is refreshed, never assumed.** AWS owns this resource; it can
 *   fail to create, fail to update, or be changed in the console. The row is a
 *   mirror, and `syncOnlineConfig` is what makes it honest.
 */

import type { OnlineConfigState } from './providers/agentcoreOnline';
import process from 'node:process';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { bedrockRegion } from '@/libs/llm/bedrockCredentials';
import { evalOnlineConfigSchema } from '@/models/Schema';
import { resolveAwsCredentials } from '../ApiTokenService';
import {
  buildOnlineConfigRequest,
  createOnlineConfig,
  DEFAULT_SAMPLING_PERCENTAGE,
  deleteOnlineConfig,
  getOnlineConfig,
  onlineClient,
  refuseGroundTruthEvaluators,
  setOnlineConfigEnabled,
  setOnlineSampling,
} from './providers/agentcoreOnline';

/**
 * Evaluators to run against live traffic when nobody has named any.
 *
 * Judged-against-itself evaluators only, because that is all live traffic can
 * support. Deliberately narrow: each one is a paid LLM judge running on a
 * share of every real conversation, so a generous default would be spending a
 * customer's money on a decision they never made.
 */
const DEFAULT_ONLINE_EVALUATORS = ['Builtin.Correctness'];

/**
 * The role AWS assumes to read the spans and write the results.
 *
 * Created by `infra/agentcore/provision.sh`. There is no sensible default:
 * a wrong ARN fails the create with a clear message, while a guessed one could
 * point at a role with more access than this needs.
 */
function executionRoleArn(): string | null {
  return process.env.VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN ?? null;
}

/** Which `service.name` the agent runtime was deployed with. */
function spanServiceNames(): string[] {
  const configured = process.env.VOCION_AGENTCORE_SPAN_SERVICE_NAMES;
  if (configured) {
    return configured.split(',').map(name => name.trim()).filter(Boolean);
  }
  return [`vocion_agent_runtime_${process.env.VOCION_ENV ?? 'dev'}`];
}

/** Which log group Transaction Search writes the runtime's spans to. */
function spanLogGroups(): string[] {
  const configured = process.env.VOCION_AGENTCORE_SPAN_LOG_GROUPS;
  if (configured) {
    return configured.split(',').map(name => name.trim()).filter(Boolean);
  }
  return ['aws/spans'];
}

/** What a person gets back after asking for online evaluation. */
export type OnlineSetupResult = {
  /** The stored row's id, when a configuration exists. */
  id: number | null;
  state: OnlineConfigState | null;
  /** Evaluators that were asked for and cannot run here, with the reason. */
  refused: string[];
  /** Set when nothing could be set up, and why. */
  error: string | null;
};

/** What a caller may choose when setting this up. */
export type SetUpOnlineOptions = {
  orgId: string;
  /** Which evaluators to run. Ground-truth ones are refused, not silently dropped. */
  evaluatorIds?: string[];
  /** How much live traffic to score. Higher costs more, linearly. */
  samplingPercentage?: number;
  /** Start sampling immediately. Defaults to false — see the module docstring. */
  enableImmediately?: boolean;
};

/**
 * Create the standing configuration, switched off unless told otherwise.
 *
 * Idempotent per org and region: asking twice returns the configuration that
 * already exists rather than making a second one, because two configurations
 * over the same traffic sample it twice and bill for it twice.
 * @param options - Whose workspace, and how it should be configured.
 */
export async function setUpOnlineEvaluation(options: SetUpOnlineOptions): Promise<OnlineSetupResult> {
  const region = bedrockRegion();
  const existing = await readRow(options.orgId, region);
  if (existing) {
    return { id: existing.id, state: await syncOnlineConfig(options.orgId), refused: [], error: null };
  }

  const roleArn = executionRoleArn();
  if (!roleArn) {
    return {
      id: null,
      state: null,
      refused: [],
      error: 'No evaluation execution role is configured. Set VOCION_AGENTCORE_EVAL_EXECUTION_ROLE_ARN '
        + 'to the role infra/agentcore/provision.sh creates.',
    };
  }
  const credentials = await resolveAwsCredentials(options.orgId);
  if (!credentials) {
    return { id: null, state: null, refused: [], error: 'No AWS credential is connected for this workspace.' };
  }

  const asked = options.evaluatorIds?.length ? options.evaluatorIds : DEFAULT_ONLINE_EVALUATORS;
  const { refused, reason } = refuseGroundTruthEvaluators(asked);

  try {
    const request = buildOnlineConfigRequest({
      name: `vocion-online-${options.orgId}`.replace(/[^\w-]/g, '-').slice(0, 100),
      executionRoleArn: roleArn,
      serviceNames: spanServiceNames(),
      logGroupNames: spanLogGroups(),
      evaluatorIds: asked,
      samplingPercentage: options.samplingPercentage ?? DEFAULT_SAMPLING_PERCENTAGE,
      enableOnCreate: options.enableImmediately ?? false,
      description: 'Vocion — continuous scoring of live agent traffic',
    });
    const created = await createOnlineConfig(onlineClient(region, credentials), request);
    const [row] = await db
      .insert(evalOnlineConfigSchema)
      .values({
        orgId: options.orgId,
        region,
        configId: created.configId,
        configArn: created.configArn,
        status: created.status,
        enabled: created.enabled,
        samplingPercentage: options.samplingPercentage ?? DEFAULT_SAMPLING_PERCENTAGE,
        evaluatorIds: request.evaluators?.map(evaluator => evaluator.evaluatorId!) ?? [],
        syncedAt: new Date(),
      })
      .returning();
    return {
      id: row?.id ?? null,
      state: await syncOnlineConfig(options.orgId),
      refused,
      error: refused.length ? reason : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[evals] could not set up online evaluation', error);
    return { id: null, state: null, refused, error: message };
  }
}

/**
 * Start or stop the sampling, leaving the configuration in place.
 *
 * This is the switch that decides whether anyone is being charged. Returns the
 * state AWS reports afterwards rather than what we asked for, so a failed
 * update cannot leave the page claiming it is off while it is still running.
 * @param orgId - Whose workspace.
 * @param enabled - Whether it should be scoring live traffic.
 */
export async function setOnlineEvaluationEnabled(orgId: string, enabled: boolean): Promise<OnlineConfigState | null> {
  const region = bedrockRegion();
  const row = await readRow(orgId, region);
  if (!row) {
    return null;
  }
  const credentials = await resolveAwsCredentials(orgId);
  if (!credentials) {
    throw new Error('No AWS credential is connected for this workspace.');
  }
  await setOnlineConfigEnabled(onlineClient(region, credentials), row.configId, enabled);
  return syncOnlineConfig(orgId);
}

/**
 * Change how much live traffic is scored.
 *
 * The other half of the cost dial, and usually the better answer to a bill
 * that came in higher than expected — turning sampling down keeps the signal,
 * turning it off loses it.
 * @param orgId - Whose workspace.
 * @param samplingPercentage - How much live traffic to score, 0 to 100.
 */
export async function setOnlineEvaluationSampling(
  orgId: string,
  samplingPercentage: number,
): Promise<OnlineConfigState | null> {
  const region = bedrockRegion();
  const row = await readRow(orgId, region);
  if (!row) {
    return null;
  }
  const credentials = await resolveAwsCredentials(orgId);
  if (!credentials) {
    throw new Error('No AWS credential is connected for this workspace.');
  }
  await setOnlineSampling(onlineClient(region, credentials), row.configId, samplingPercentage);
  await db
    .update(evalOnlineConfigSchema)
    .set({ samplingPercentage })
    .where(eq(evalOnlineConfigSchema.id, row.id));
  return syncOnlineConfig(orgId);
}

/**
 * Ask AWS what state the configuration is really in, and store the answer.
 *
 * Worth doing before showing anyone a number, because AWS owns this resource:
 * a create can fail asynchronously, an update can be rejected, and somebody
 * can change it in the console. A row that was written optimistically and
 * never checked would tell a person their traffic is being scored when it is
 * not, or worse, that it is not when it is.
 * @param orgId - Whose workspace.
 */
export async function syncOnlineConfig(orgId: string): Promise<OnlineConfigState | null> {
  const region = bedrockRegion();
  const row = await readRow(orgId, region);
  if (!row) {
    return null;
  }
  const credentials = await resolveAwsCredentials(orgId);
  if (!credentials) {
    return null;
  }
  try {
    const state = await getOnlineConfig(onlineClient(region, credentials), row.configId);
    await db
      .update(evalOnlineConfigSchema)
      .set({
        status: state.status,
        enabled: state.enabled,
        samplingPercentage: state.samplingPercentage ?? row.samplingPercentage,
        evaluatorIds: state.evaluatorIds,
        outputLogGroup: state.outputLogGroup,
        failureReason: state.failureReason,
        syncedAt: new Date(),
      })
      .where(eq(evalOnlineConfigSchema.id, row.id));
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[evals] could not read the online evaluation config', error);
    await db
      .update(evalOnlineConfigSchema)
      .set({ failureReason: message, syncedAt: new Date() })
      .where(eq(evalOnlineConfigSchema.id, row.id));
    return null;
  }
}

/**
 * Remove the configuration from the customer's account entirely.
 *
 * Almost always the wrong call — disabling stops the bill and keeps the
 * history — so this exists for a workspace that is finished with the feature
 * and wants nothing left behind. The local row goes only once AWS has
 * confirmed, so a failed delete does not hide a resource that is still there
 * and still billable.
 * @param orgId - Whose workspace.
 */
export async function tearDownOnlineEvaluation(orgId: string): Promise<void> {
  const region = bedrockRegion();
  const row = await readRow(orgId, region);
  if (!row) {
    return;
  }
  const credentials = await resolveAwsCredentials(orgId);
  if (!credentials) {
    throw new Error('No AWS credential is connected for this workspace.');
  }
  await deleteOnlineConfig(onlineClient(region, credentials), row.configId);
  await db.delete(evalOnlineConfigSchema).where(eq(evalOnlineConfigSchema.id, row.id));
}

/** What the page needs to show the state of continuous scoring. */
export type OnlineEvaluationSummary = {
  configId: string;
  configArn: string;
  region: string;
  status: string;
  /** Whether it is sampling traffic right now, and therefore billing. */
  enabled: boolean;
  samplingPercentage: number;
  evaluatorIds: string[];
  outputLogGroup: string | null;
  failureReason: string | null;
  syncedAt: Date | null;
};

/**
 * The stored state of online evaluation for this workspace, without calling AWS.
 *
 * Null means nobody has set it up, which is the normal case.
 * @param orgId - Whose workspace.
 */
export async function describeOnlineEvaluation(orgId: string): Promise<OnlineEvaluationSummary | null> {
  const row = await readRow(orgId, bedrockRegion());
  if (!row) {
    return null;
  }
  return {
    configId: row.configId,
    configArn: row.configArn,
    region: row.region,
    status: row.status,
    enabled: row.enabled,
    samplingPercentage: row.samplingPercentage,
    evaluatorIds: row.evaluatorIds,
    outputLogGroup: row.outputLogGroup,
    failureReason: row.failureReason,
    syncedAt: row.syncedAt,
  };
}

/**
 * The stored row for one workspace and region.
 * @param orgId - Whose workspace.
 * @param region - Which region's configuration.
 */
async function readRow(orgId: string, region: string) {
  const [row] = await db
    .select()
    .from(evalOnlineConfigSchema)
    .where(and(eq(evalOnlineConfigSchema.orgId, orgId), eq(evalOnlineConfigSchema.region, region)));
  return row ?? null;
}
