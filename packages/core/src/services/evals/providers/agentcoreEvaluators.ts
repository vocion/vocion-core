/**
 * Getting a dataset's authored evaluators into the customer's AWS account.
 *
 * Two kinds live in `eval_evaluator`, and they need opposite things:
 *
 * - A built-in (`Builtin.TrajectoryInOrderMatch` and friends) is named, not
 *   defined. There is nothing to create; the name goes straight into
 *   `Evaluate`.
 * - A custom one — a judge with instructions, or a Lambda someone deployed —
 *   is a real resource in AWS. It has to exist before a run can name it, and
 *   it must not be created twice.
 *
 * Creating them here rather than in `workspace:apply` is the same split
 * `libs/sources/upsert.ts` and `SourceSyncService` already use: apply writes
 * what the file asked for and never touches the network, so an unreachable AWS
 * endpoint cannot stop a workspace landing its agents and its playbooks. The
 * remote create happens on the way into a run, where a failure is about one
 * provider and says so.
 *
 * Idempotency has two layers, because either alone is not enough. The stored
 * `remoteId` stops a second create when the row survived; the deterministic
 * `clientToken` stops one when AWS accepted a create whose response we never
 * saw — a timeout on the first attempt, a retry on the second.
 */

import type { EvaluatorConfig } from '@aws-sdk/client-bedrock-agentcore-control';
import type { AwsCredentials } from '@/services/ApiTokenService';
import { createHash } from 'node:crypto';
import {
  BedrockAgentCoreControlClient,
  CreateEvaluatorCommand,
  UpdateEvaluatorCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evalEvaluatorSchema } from '@/models/Schema';

/** One evaluator row, as the database stores it. */
type EvaluatorRow = typeof evalEvaluatorSchema.$inferSelect;

/** The config an authored custom evaluator carries. */
type AuthoredConfig = {
  instructions?: string;
  ratingScale?: { categorical?: Array<{ label: string; description?: string }>; numerical?: Array<{ value: number; description?: string }> };
  model?: string;
  lambdaArn?: string;
};

/** What a judge grades on when the dataset does not say. */
const DEFAULT_JUDGE_MODEL = 'global.anthropic.claude-sonnet-4-6';

/** The longest evaluator name AWS accepts. */
const MAX_EVALUATOR_NAME_LENGTH = 48;

/** How much of the identity hash ends every evaluator name, to keep it unique. */
const EVALUATOR_NAME_HASH_LENGTH = 8;

/**
 * A built-in is named by AWS, so we pass the name through untouched.
 * @param row - The stored evaluator.
 */
function isBuiltin(row: EvaluatorRow): boolean {
  return row.slug.startsWith('Builtin.');
}

/**
 * Whether the authored config has changed since the last successful sync.
 *
 * `updatedAt` moves on every apply that touched the row, so an unchanged file
 * re-applied does not push an update to AWS for a config that is already
 * there.
 * @param row - The stored evaluator.
 */
function needsPush(row: EvaluatorRow): boolean {
  if (!row.remoteId) {
    return true;
  }
  if (!row.syncedAt) {
    return true;
  }
  // Strictly greater, and the sync writes both stamps to the same instant, so
  // an unchanged file re-applied does not push an update to AWS every run.
  return row.updatedAt.getTime() > row.syncedAt.getTime();
}

/**
 * A token AWS can use to recognise a repeat of the same create.
 *
 * Derived from what the evaluator is rather than generated, so the retry of a
 * create whose response we lost carries the same token as the original and
 * AWS returns the existing evaluator instead of making a second one.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset.
 * @param slug - Which evaluator.
 */
function clientTokenFor(orgId: string, datasetSlug: string, slug: string): string {
  return createHash('sha256').update(`${orgId}:${datasetSlug}:${slug}`).digest('hex');
}

/**
 * The name this evaluator carries in AWS.
 *
 * Namespaced by org and dataset because AWS requires evaluator names to be
 * unique per account, and two Vocion workspaces in one AWS account authoring
 * `tone-check` is an ordinary thing to do, not a mistake.
 *
 * AWS accepts `[a-zA-Z][a-zA-Z0-9_]{0,47}`: no hyphens, at most 48
 * characters. An org id plus two slugs is often longer than that, and cutting
 * it short alone would let two evaluators whose names share a long prefix
 * land on the same AWS name. So the readable part is cut to fit and the name
 * always ends with a short hash of the full identity, which keeps it unique.
 * @param orgId - Whose workspace.
 * @param datasetSlug - The dataset that declares the evaluator.
 * @param slug - The evaluator's own slug.
 */
export function awsEvaluatorName(orgId: string, datasetSlug: string, slug: string): string {
  const hash = clientTokenFor(orgId, datasetSlug, slug).slice(0, EVALUATOR_NAME_HASH_LENGTH);
  const readableLength = MAX_EVALUATOR_NAME_LENGTH - EVALUATOR_NAME_HASH_LENGTH - 1;
  const readable = `vocion_${orgId}_${datasetSlug}_${slug}`
    .replace(/[^a-z0-9]+/gi, '_')
    .slice(0, readableLength)
    .replace(/_+$/, '');
  return `${readable}_${hash}`;
}

/**
 * Turn our stored config into the shape AWS's API wants.
 *
 * A `lambdaArn` wins over instructions: an evaluator that names a Lambda is a
 * `codeBased` one, and quietly grading it with a judge instead would be a
 * different measurement wearing the same name.
 * @param row - The stored evaluator.
 */
function toEvaluatorConfig(row: EvaluatorRow): EvaluatorConfig {
  const config = row.config as AuthoredConfig;
  if (config.lambdaArn) {
    return { codeBased: { lambdaConfig: { lambdaArn: config.lambdaArn } } };
  }
  if (!config.instructions) {
    throw new Error(`evaluator ${row.slug} has neither instructions nor a lambdaArn`);
  }
  return {
    llmAsAJudge: {
      instructions: config.instructions,
      ratingScale: toRatingScale(config.ratingScale),
      modelConfig: { bedrockEvaluatorModelConfig: { modelId: config.model ?? DEFAULT_JUDGE_MODEL } },
    },
  };
}

/**
 * The rating scale, defaulting to plain pass/fail.
 *
 * A judge with no scale has nothing to answer with, and pass/fail is what the
 * rest of the eval page already speaks — a run mixing a 1–5 scale into the
 * same pass rate would be comparing two different questions.
 * @param scale - What the manifest authored, if anything.
 */
function toRatingScale(scale: AuthoredConfig['ratingScale']) {
  if (scale?.numerical?.length) {
    return {
      numerical: scale.numerical.map(entry => ({
        value: entry.value,
        label: String(entry.value),
        definition: entry.description ?? String(entry.value),
      })),
    };
  }
  if (scale?.categorical?.length) {
    return {
      categorical: scale.categorical.map(entry => ({
        label: entry.label,
        definition: entry.description ?? entry.label,
      })),
    };
  }
  return {
    categorical: [
      { label: 'pass', definition: 'The response meets the instructions.' },
      { label: 'fail', definition: 'The response does not meet the instructions.' },
    ],
  };
}

/**
 * Create or update one custom evaluator in AWS and record what happened.
 *
 * Returns the id to run with, or null when the push failed. A failure is
 * written to `sync_error` and swallowed: one broken evaluator must not cost a
 * dataset every other score in the same run, and the row saying why beats a
 * row that merely looks unsynced.
 * @param client - The control-plane client.
 * @param row - The evaluator to push.
 */
async function pushEvaluator(client: BedrockAgentCoreControlClient, row: EvaluatorRow): Promise<string | null> {
  try {
    const config = toEvaluatorConfig(row);
    const level = (row.level ?? 'TRACE') as 'TOOL_CALL' | 'TRACE' | 'SESSION';

    if (row.remoteId) {
      // The update's token folds in `updatedAt`, so a retry of THIS edit
      // reuses it while the next edit gets a fresh one — the create's token,
      // which must never change, is derived from identity alone.
      await client.send(new UpdateEvaluatorCommand({
        evaluatorId: row.remoteId,
        evaluatorConfig: config,
        level,
        clientToken: clientTokenFor(row.orgId, row.datasetSlug, `${row.slug}:${row.updatedAt.getTime()}`),
      }));
      // `updatedAt` is written explicitly rather than left to its auto-update:
      // otherwise this very write bumps it past `syncedAt`, and the row looks
      // out of date the moment it is brought up to date.
      const syncedAt = new Date();
      await db
        .update(evalEvaluatorSchema)
        .set({ syncedAt, updatedAt: syncedAt, syncError: null })
        .where(eq(evalEvaluatorSchema.id, row.id));
      return row.remoteId;
    }

    const created = await client.send(new CreateEvaluatorCommand({
      evaluatorName: awsEvaluatorName(row.orgId, row.datasetSlug, row.slug),
      evaluatorConfig: config,
      level,
      clientToken: clientTokenFor(row.orgId, row.datasetSlug, row.slug),
    }));
    if (!created.evaluatorId) {
      throw new Error('AWS created the evaluator but returned no id');
    }
    const syncedAt = new Date();
    await db
      .update(evalEvaluatorSchema)
      .set({
        remoteId: created.evaluatorId,
        remoteArn: created.evaluatorArn ?? null,
        syncedAt,
        updatedAt: syncedAt,
        syncError: null,
      })
      .where(eq(evalEvaluatorSchema.id, row.id));
    return created.evaluatorId;
  } catch (error) {
    const message = (error as Error).message ?? 'could not sync the evaluator';
    console.error(`[evals] could not sync AgentCore evaluator ${row.slug} for ${row.orgId}`, error);
    await db
      .update(evalEvaluatorSchema)
      .set({ syncError: message })
      .where(eq(evalEvaluatorSchema.id, row.id));
    return row.remoteId;
  }
}

/**
 * Which evaluator ids this dataset should be scored with.
 *
 * Built-ins pass straight through; custom ones are created or updated in AWS
 * first and contribute the id AWS gave them. An evaluator that could not be
 * synced and has never been synced contributes nothing — running without it is
 * a smaller lie than scoring against an evaluator that is not the one the file
 * describes.
 *
 * An empty result means the dataset authored no AgentCore evaluators, and the
 * caller falls back to its own default.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Which dataset.
 * @param credentials - The org's AWS credentials.
 * @param region - Where to talk to AWS.
 */
export async function resolveAgentcoreEvaluators(
  orgId: string,
  datasetSlug: string,
  credentials: AwsCredentials,
  region: string,
): Promise<string[]> {
  const rows = await db
    .select()
    .from(evalEvaluatorSchema)
    .where(and(
      eq(evalEvaluatorSchema.orgId, orgId),
      eq(evalEvaluatorSchema.datasetSlug, datasetSlug),
      eq(evalEvaluatorSchema.provider, 'agentcore'),
      // Retired evaluators keep their remote id so they can come back, but
      // they must not be sent to AWS or scored against in the meantime.
      isNull(evalEvaluatorSchema.retiredAt),
    ));
  if (rows.length === 0) {
    return [];
  }

  const builtins = rows.filter(isBuiltin).map(row => row.slug);
  const custom = rows.filter(row => !isBuiltin(row));
  if (custom.length === 0) {
    return builtins;
  }

  const client = new BedrockAgentCoreControlClient({
    region,
    credentials: {
      accessKeyId: credentials.accessKeyId,
      secretAccessKey: credentials.secretAccessKey,
    },
  });

  const customIds: string[] = [];
  for (const row of custom) {
    // One at a time: these are writes to the customer's account, and a burst
    // of creates against a per-account limit is a worse failure than a run
    // that took a second longer to start.
    const id = needsPush(row) ? await pushEvaluator(client, row) : row.remoteId;
    if (id) {
      customIds.push(id);
    }
  }

  return [...builtins, ...customIds];
}
