/**
 * Putting a dataset's cases in the customer's own AWS account.
 *
 * An AgentCore eval should be an AgentCore eval: a real dataset in Bedrock
 * AgentCore, with versions, that someone can open in the console. That is what
 * this module does, and it is worth being clear about what it does not do.
 * Scoring never reads the published dataset — `Evaluate` carries the expected
 * answer, the assertions and the expected trajectory in the request body — and
 * reproducibility already comes from `eval_run.datasetVersion`. So a publish
 * that fails is a sync problem, not a measurement problem, and the caller
 * records it and runs the dataset anyway.
 *
 * The lifecycle AWS gives us shapes everything here:
 *
 * - A dataset has a Draft and published integer versions. Examples are mutated
 *   on the Draft; `CreateDatasetVersion` freezes it.
 * - `exampleId` is AWS's, generated when an example is added. Our own
 *   `scenario_id` lives inside the example's content, so every diff starts by
 *   listing the Draft and matching on that field.
 * - Mutations are asynchronous and all-or-nothing, at most 1,000 examples and
 *   5 MB per request, and while one is in flight the dataset is `UPDATING` and
 *   every other write is refused.
 *
 * Which is why the diff is add / update / delete by id and never
 * delete-everything-then-add: an interrupted rewrite of the second kind leaves
 * a dataset holding fewer cases than either side ever declared, and the next
 * run would publish a version of that.
 */

import type { BedrockAgentCoreControlClient } from '@aws-sdk/client-bedrock-agentcore-control';
import type { EvalDatasetItem } from '../types';
import type { PublishDatasetRequest, PublishedDataset } from './types';
import type { AwsCredentials } from '@/services/ApiTokenService';
import { Buffer } from 'node:buffer';
import {
  AddDatasetExamplesCommand,

  CreateDatasetCommand,
  CreateDatasetVersionCommand,
  DeleteDatasetExamplesCommand,
  GetDatasetCommand,
  ListDatasetExamplesCommand,
  UpdateDatasetExamplesCommand,
} from '@aws-sdk/client-bedrock-agentcore-control';
import { bedrockRegion } from '@/libs/llm/bedrockCredentials';
import { resolveAwsCredentials } from '@/services/ApiTokenService';
import { clientTokenFor, controlClient } from './agentcoreControl';

/** The schema AgentCore expects for hand-written scenarios. */
const SCHEMA_TYPE = 'AGENTCORE_EVALUATION_PREDEFINED_V1';

/** AWS refuses more than this many examples in one request. */
const MAX_EXAMPLES_PER_REQUEST = 1000;

/** AWS refuses more than 5 MB of inline examples in one request. */
const MAX_INLINE_BYTES = 5 * 1024 * 1024;

/** AWS refuses a dataset description longer than this many characters. */
const MAX_DESCRIPTION_LENGTH = 200;

/** How long to wait for an asynchronous mutation to settle, and how often to look. */
const POLL_ATTEMPTS = 60;
const POLL_INTERVAL_MS = 2000;

/** A status AWS reports when the dataset is settled and usable. */
const SETTLED = 'ACTIVE';

/**
 * A publish that could not be completed.
 *
 * Its own type so the caller can record "this eval is not synced, and here is
 * why" without having to guess whether an error came from the publish or from
 * the scoring that follows it.
 */
export class EvalDatasetPublishError extends Error {
  override name = 'EvalDatasetPublishError';
}

/** One scenario in AgentCore's own vocabulary. */
type Scenario = {
  scenario_id: string;
  turns: Array<{ input: string; expected_response?: string }>;
  expected_trajectory?: string[];
  assertions?: string[];
};

/** An example already in the Draft, keyed back to the case that wrote it. */
type DraftExample = {
  exampleId: string;
  scenarioId: string;
  content: Record<string, unknown>;
};

/**
 * The id a case carries in AWS.
 *
 * Positional, and the same key `eval_case_result.itemIndex` already uses, so a
 * case can be followed from our run table into the AWS console. Reordering the
 * file therefore rewrites contents rather than moving ids, which is exactly
 * what our own case results do.
 * @param datasetSlug - The dataset the case belongs to.
 * @param index - Its position in the file, zero-based.
 */
export function scenarioIdFor(datasetSlug: string, index: number): string {
  return `${datasetSlug}-${index + 1}`;
}

/**
 * One authored case as AgentCore reads it.
 *
 * Only the ground truth someone actually wrote is included: a key set to
 * `undefined` would serialise as a field AWS then has to interpret, and an
 * empty assertions list reads as "nothing must be true" rather than "nobody
 * said".
 * @param item - The authored case.
 * @param datasetSlug - The dataset it belongs to.
 * @param index - Its position in the file, zero-based.
 */
export function toScenario(item: EvalDatasetItem, datasetSlug: string, index: number): Scenario {
  if (!item.input?.trim()) {
    throw new EvalDatasetPublishError(
      `case ${index + 1} of ${datasetSlug} has no input, and AWS has nothing to send the agent`,
    );
  }
  return {
    scenario_id: scenarioIdFor(datasetSlug, index),
    turns: [{
      input: item.input,
      ...(item.expectedOutput ? { expected_response: item.expectedOutput } : {}),
    }],
    ...(item.expectedTrajectory?.length ? { expected_trajectory: item.expectedTrajectory } : {}),
    ...(item.assertions?.length ? { assertions: item.assertions } : {}),
  };
}

/**
 * Every case as AgentCore reads it.
 * @param items - The authored cases.
 * @param datasetSlug - The dataset they belong to.
 */
export function toScenarios(items: EvalDatasetItem[], datasetSlug: string): Scenario[] {
  return items.map((item, index) => toScenario(item, datasetSlug, index));
}

/**
 * What we last published, as one string.
 *
 * Covers the published content and nothing else, so renaming a dataset's
 * description does not cut a new version in someone's AWS account, while
 * changing a single expected answer does.
 * @param items - The authored cases.
 * @param datasetSlug - The dataset they belong to.
 */
export function casesHashFor(items: EvalDatasetItem[], datasetSlug: string): string {
  return clientTokenFor(JSON.stringify(toScenarios(items, datasetSlug)));
}

/**
 * Split a list into requests AWS will accept.
 *
 * Both ceilings matter and they are not the same one: a thousand short cases
 * and forty long ones can each be the limit that bites. A single case larger
 * than the whole request budget cannot be sent at all, and says so here rather
 * than as a 4xx with AWS's wording.
 * @param scenarios - The scenarios to send.
 * @param datasetSlug - Named in the error, so the message identifies the file.
 */
export function chunkScenarios(scenarios: Scenario[], datasetSlug: string): Scenario[][] {
  const batches: Scenario[][] = [];
  let batch: Scenario[] = [];
  let bytes = 0;
  for (const scenario of scenarios) {
    const size = Buffer.byteLength(JSON.stringify(scenario), 'utf8');
    if (size > MAX_INLINE_BYTES) {
      throw new EvalDatasetPublishError(
        `case ${scenario.scenario_id} of ${datasetSlug} is larger than AWS's 5 MB limit for one request`,
      );
    }
    if (batch.length >= MAX_EXAMPLES_PER_REQUEST || bytes + size > MAX_INLINE_BYTES) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(scenario);
    bytes += size;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

/** How long to wait between polls, injectable so tests do not sleep. */
export type PollOptions = { attempts?: number; intervalMs?: number };

/**
 * Pause without blocking the event loop.
 * @param ms - How long to wait.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Wait for an asynchronous mutation to settle.
 *
 * AWS answers a create or an example change with a 202 and moves the dataset
 * through `CREATING` or `UPDATING`, so a successful response means the request
 * was accepted and nothing more. Waiting matters because the next write is
 * refused while one is in flight, and because a dataset that ends in
 * `CREATE_FAILED` would otherwise be recorded as published.
 * @param client - The control-plane client.
 * @param datasetId - The dataset to watch.
 * @param datasetSlug - Ours, for a message that names the file someone edited.
 * @param options - Poll budget, injectable for tests.
 */
export async function waitUntilSettled(
  client: BedrockAgentCoreControlClient,
  datasetId: string,
  datasetSlug: string,
  options: PollOptions = {},
): Promise<string> {
  const attempts = options.attempts ?? POLL_ATTEMPTS;
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  let status = '';
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await client.send(new GetDatasetCommand({ datasetId }));
    status = response.status ?? '';
    if (status === SETTLED) {
      return status;
    }
    if (status.endsWith('_FAILED')) {
      throw new EvalDatasetPublishError(
        `AWS could not accept ${datasetSlug}: dataset ${datasetId} is ${status}${response.failureReason ? ` (${response.failureReason})` : ''}`,
      );
    }
    await sleep(intervalMs);
  }
  throw new EvalDatasetPublishError(
    `AWS is still working on ${datasetSlug}: dataset ${datasetId} was ${status || 'unknown'} after ${attempts} checks`,
  );
}

/**
 * The Draft's examples, keyed by the scenario id we gave them.
 *
 * Paginated because a dataset can hold more examples than one page returns,
 * and a half-read Draft would make the diff delete everything it did not see.
 * @param client - The control-plane client.
 * @param datasetId - The dataset to read.
 */
export async function listDraftExamples(
  client: BedrockAgentCoreControlClient,
  datasetId: string,
): Promise<Map<string, DraftExample>> {
  const byScenarioId = new Map<string, DraftExample>();
  let nextToken: string | undefined;
  do {
    const response = await client.send(new ListDatasetExamplesCommand({ datasetId, nextToken }));
    for (const raw of response.examples ?? []) {
      const content = raw as Record<string, unknown>;
      const exampleId = typeof content.exampleId === 'string' ? content.exampleId : null;
      const scenarioId = typeof content.scenario_id === 'string' ? content.scenario_id : null;
      if (!exampleId || !scenarioId) {
        continue;
      }
      // A Draft edited by hand in the console can hold two examples claiming
      // the same scenario id. Keeping the first means the diff updates one of
      // them and deletes the other, which converges rather than throwing at
      // someone who did nothing wrong.
      if (!byScenarioId.has(scenarioId)) {
        byScenarioId.set(scenarioId, { exampleId, scenarioId, content });
      }
    }
    nextToken = response.nextToken;
  } while (nextToken);
  return byScenarioId;
}

/**
 * Whether the Draft's copy of a case already says what the file says.
 *
 * Compares only the fields we publish, because AWS's copy carries its own
 * `exampleId` and whatever else it decides to add.
 * @param existing - The example as AWS holds it.
 * @param scenario - The example as the file describes it.
 */
function matchesScenario(existing: DraftExample, scenario: Scenario): boolean {
  const published: Record<string, unknown> = {};
  for (const key of Object.keys(scenario)) {
    published[key] = existing.content[key];
  }
  return JSON.stringify(published) === JSON.stringify(scenario);
}

/**
 * Add, change and remove examples until the Draft matches the file.
 *
 * Each request carries a token derived from its own payload, not from the
 * publish as a whole: a crash between the delete and the version cut has to be
 * able to retry the tail without that token having already been spent on a
 * different request.
 * @param client - The control-plane client.
 * @param datasetId - The dataset in AWS.
 * @param datasetSlug - Ours, for messages and tokens.
 * @param scenarios - Every case, as the file describes them.
 * @param options - Poll budget, injectable for tests.
 */
export async function applyDraftDiff(
  client: BedrockAgentCoreControlClient,
  datasetId: string,
  datasetSlug: string,
  scenarios: Scenario[],
  options: PollOptions = {},
): Promise<void> {
  const existing = await listDraftExamples(client, datasetId);
  const wanted = new Set(scenarios.map(scenario => scenario.scenario_id));

  const toAdd = scenarios.filter(scenario => !existing.has(scenario.scenario_id));
  const toUpdate = scenarios
    .filter((scenario) => {
      const match = existing.get(scenario.scenario_id);
      return match !== undefined && !matchesScenario(match, scenario);
    })
    .map(scenario => ({ ...scenario, exampleId: existing.get(scenario.scenario_id)!.exampleId }));
  const toDelete = [...existing.values()]
    .filter(example => !wanted.has(example.scenarioId))
    .map(example => example.exampleId);

  for (const batch of chunkScenarios(toAdd, datasetSlug)) {
    await client.send(new AddDatasetExamplesCommand({
      datasetId,
      clientToken: clientTokenFor('add', datasetSlug, JSON.stringify(batch)),
      source: { inlineExamples: { examples: batch } },
    }));
    await waitUntilSettled(client, datasetId, datasetSlug, options);
  }

  for (const batch of chunkScenarios(toUpdate, datasetSlug)) {
    await client.send(new UpdateDatasetExamplesCommand({
      datasetId,
      clientToken: clientTokenFor('update', datasetSlug, JSON.stringify(batch)),
      examples: batch,
    }));
    await waitUntilSettled(client, datasetId, datasetSlug, options);
  }

  if (toDelete.length > 0) {
    for (let start = 0; start < toDelete.length; start += MAX_EXAMPLES_PER_REQUEST) {
      const batch = toDelete.slice(start, start + MAX_EXAMPLES_PER_REQUEST);
      await client.send(new DeleteDatasetExamplesCommand({
        datasetId,
        clientToken: clientTokenFor('delete', datasetSlug, batch.join(',')),
        exampleIds: batch,
      }));
      await waitUntilSettled(client, datasetId, datasetSlug, options);
    }
  }
}

/**
 * Make the dataset, with its first cases in the create itself.
 * @param client - The control-plane client.
 * @param request - What to publish.
 * @param scenarios - Every case, as the file describes them.
 * @param options - Poll budget, injectable for tests.
 */
async function createWithCases(
  client: BedrockAgentCoreControlClient,
  request: PublishDatasetRequest,
  scenarios: Scenario[],
  options: PollOptions,
): Promise<string> {
  const batches = chunkScenarios(scenarios, request.datasetSlug);
  const first = batches[0] ?? [];
  const created = await client.send(new CreateDatasetCommand({
    clientToken: clientTokenFor('create', request.orgId, request.datasetSlug),
    datasetName: awsDatasetName(request.orgId, request.datasetSlug),
    ...(request.description ? { description: awsDatasetDescription(request.description) } : {}),
    schemaType: SCHEMA_TYPE,
    source: { inlineExamples: { examples: first } },
  }));
  const datasetId = created.datasetId;
  if (!datasetId) {
    throw new EvalDatasetPublishError(`AWS accepted ${request.datasetSlug} but returned no dataset id`);
  }
  await waitUntilSettled(client, datasetId, request.datasetSlug, options);
  for (const batch of batches.slice(1)) {
    await client.send(new AddDatasetExamplesCommand({
      datasetId,
      clientToken: clientTokenFor('add', request.datasetSlug, JSON.stringify(batch)),
      source: { inlineExamples: { examples: batch } },
    }));
    await waitUntilSettled(client, datasetId, request.datasetSlug, options);
  }
  return datasetId;
}

/**
 * The name this dataset carries in AWS.
 *
 * AWS allows letters, digits and underscores only, and the name is immutable,
 * so it carries the org as well as the slug: two workspaces with a
 * `refund-quality` dataset in one AWS account must not land on the same
 * resource.
 * @param orgId - Whose workspace.
 * @param datasetSlug - Ours.
 */
export function awsDatasetName(orgId: string, datasetSlug: string): string {
  const safe = `${orgId}_${datasetSlug}`.replace(/[^a-z0-9]+/gi, '_').replace(/^[^a-z]+/i, '');
  return safe.slice(0, 48) || `eval_${clientTokenFor(orgId, datasetSlug).slice(0, 8)}`;
}

/**
 * The description AWS keeps for the dataset.
 *
 * AWS caps it at 200 characters, and an authored description is often longer.
 * Only AWS's copy is shortened: the full text stays in Vocion, which is where
 * people read it. The limit is measured in UTF-16 units, the stricter of the
 * two ways AWS could count, but the cut falls between code points, so a
 * surrogate pair at the boundary is never split into invalid UTF-16. A joined
 * emoji sequence (a flag, a family) can still lose its tail, which only
 * changes how the last glyph looks in AWS's copy.
 * @param description - The description as authored.
 */
export function awsDatasetDescription(description: string): string {
  if (description.length <= MAX_DESCRIPTION_LENGTH) {
    return description;
  }
  const ellipsis = '…';
  let kept = '';
  for (const character of description) {
    if (kept.length + character.length + ellipsis.length > MAX_DESCRIPTION_LENGTH) {
      break;
    }
    kept += character;
  }
  return `${kept.trimEnd()}${ellipsis}`;
}

/**
 * Whether AWS is telling us the dataset we recorded is not there.
 *
 * Deleted in the console, or a credential that now points at a different
 * account. Either way the honest answer is that we have not published here,
 * so the publish starts again rather than looping against a resource nobody
 * has.
 * @param error - Whatever the SDK threw.
 */
function isMissingRemote(error: unknown): boolean {
  return error instanceof Error && error.name === 'ResourceNotFoundException';
}

/**
 * Put a dataset's cases in the customer's AWS account and cut a version.
 *
 * The caller decides whether anything needs publishing by comparing the cases
 * hash; by the time this runs, something has changed or nothing has ever been
 * sent.
 * @param request - The dataset, its cases, and what we published last time.
 * @param options - Poll budget, injectable for tests.
 */
export async function publishAgentcoreDataset(
  request: PublishDatasetRequest,
  options: PollOptions = {},
): Promise<PublishedDataset> {
  const credentials = await resolveAwsCredentials(request.orgId);
  if (!credentials) {
    throw new EvalDatasetPublishError('No AWS credential is connected for this workspace.');
  }
  const client = controlClient(credentials as AwsCredentials, bedrockRegion());
  const scenarios = toScenarios(request.items, request.datasetSlug);

  let datasetId = request.remoteId;
  if (datasetId) {
    try {
      await applyDraftDiff(client, datasetId, request.datasetSlug, scenarios, options);
    } catch (error) {
      if (!isMissingRemote(error)) {
        throw error;
      }
      console.error(`[evals] AWS no longer has dataset ${datasetId} for ${request.datasetSlug}; creating it again`, error);
      datasetId = null;
    }
  }
  if (!datasetId) {
    datasetId = await createWithCases(client, request, scenarios, options);
  }

  const version = await client.send(new CreateDatasetVersionCommand({
    datasetId,
    clientToken: clientTokenFor('version', request.datasetSlug, casesHashFor(request.items, request.datasetSlug)),
  }));
  const status = await waitUntilSettled(client, datasetId, request.datasetSlug, options);
  if (!version.datasetVersion) {
    throw new EvalDatasetPublishError(`AWS published ${request.datasetSlug} but named no version`);
  }
  return { remoteId: datasetId, remoteVersion: version.datasetVersion, status };
}
