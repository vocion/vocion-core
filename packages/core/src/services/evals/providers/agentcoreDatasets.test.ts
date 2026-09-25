/**
 * Publishing a dataset's cases into the customer's AWS account.
 *
 * Every rule here is one that costs somebody something when it breaks: a
 * second dataset created because a response was lost, a case deleted from AWS
 * that the file still declares, a run recorded as synced when AWS actually
 * said CREATE_FAILED, or an edit that quietly never reached the account it was
 * supposed to.
 *
 * No test makes a live AWS call. The SDK client is replaced wholesale and the
 * commands are inspected by their input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('@aws-sdk/client-bedrock-agentcore-control', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-bedrock-agentcore-control')>(
    '@aws-sdk/client-bedrock-agentcore-control',
  );
  return {
    ...actual,
    BedrockAgentCoreControlClient: class {
      send = send;
    },
  };
});

const resolveAwsCredentials = vi.fn(async () => ({ accessKeyId: 'AKIA', secretAccessKey: 'secret' }));
vi.mock('@/services/ApiTokenService', () => ({ resolveAwsCredentials }));
vi.mock('@/libs/llm/bedrockCredentials', () => ({ bedrockRegion: () => 'us-east-1' }));

const {
  AddDatasetExamplesCommand,
  CreateDatasetCommand,
  CreateDatasetVersionCommand,
  DeleteDatasetExamplesCommand,
  GetDatasetCommand,
  ListDatasetExamplesCommand,
  UpdateDatasetExamplesCommand,
} = await import('@aws-sdk/client-bedrock-agentcore-control');
const {
  awsDatasetDescription,
  awsDatasetName,
  casesHashFor,
  chunkScenarios,
  EvalDatasetPublishError,
  publishAgentcoreDataset,
  toScenario,
} = await import('./agentcoreDatasets');

const SLUG = 'refund-quality';
const NO_WAITING = { attempts: 5, intervalMs: 0 };

/**
 * One authored case, with whatever ground truth the test cares about.
 * @param input - What the agent is asked.
 * @param extra - Ground truth fields to attach.
 */
function item(input: string, extra: Record<string, unknown> = {}) {
  return { input, ...extra };
}

/**
 * A publish request for this dataset.
 * @param items - The cases to publish.
 * @param remoteId - What AWS called the dataset last time, if anything.
 */
function request(items: Array<ReturnType<typeof item>>, remoteId: string | null = null) {
  return {
    orgId: 'org_publish',
    datasetSlug: SLUG,
    datasetName: 'Refund quality',
    description: 'How refunds are handled',
    items,
    remoteId,
  };
}

/** The commands the SDK was asked to send, in order. */
function sentCommands() {
  return send.mock.calls.map(call => call[0]);
}

/**
 * Every command of one kind.
 * @param kind - The command class to keep.
 */
function commandsOf<T>(kind: new (...args: never[]) => T): T[] {
  return sentCommands().filter((command): command is T => command instanceof kind);
}

/**
 * Answer each command the way AWS would for a dataset that behaves.
 * @param draft - What ListDatasetExamples should return.
 * @param status - What GetDataset should report.
 */
function respondNormally(draft: Array<Record<string, unknown>> = [], status = 'ACTIVE') {
  send.mockImplementation(async (command: unknown) => {
    if (command instanceof CreateDatasetCommand) {
      return { datasetId: 'ds-new', status: 'CREATING' };
    }
    if (command instanceof GetDatasetCommand) {
      return { status };
    }
    if (command instanceof ListDatasetExamplesCommand) {
      return { examples: draft };
    }
    if (command instanceof CreateDatasetVersionCommand) {
      return { datasetVersion: '3', status: 'UPDATING' };
    }
    return {};
  });
}

beforeEach(() => {
  send.mockReset();
});

describe('toScenario', () => {
  it('puts each kind of ground truth where AWS reads it', () => {
    const scenario = toScenario(item('I was charged twice', {
      expectedOutput: 'Confirms the duplicate charge',
      expectedTrajectory: ['lookup_order', 'issue_refund'],
      assertions: ['Names the order number'],
    }), SLUG, 0);

    // These four field names are AWS's, and the built-in evaluators find
    // ground truth by them alone — a rename here silently turns Correctness
    // and the trajectory matchers into reference-free judges.
    expect(scenario).toEqual({
      scenario_id: 'refund-quality-1',
      turns: [{ input: 'I was charged twice', expected_response: 'Confirms the duplicate charge' }],
      expected_trajectory: ['lookup_order', 'issue_refund'],
      assertions: ['Names the order number'],
    });
  });

  it('leaves out the ground truth nobody wrote, rather than sending empty ones', () => {
    const scenario = toScenario(item('Just a question'), SLUG, 1);

    // An empty assertions list reads to a judge as "nothing has to be true",
    // which is a different measurement from "nobody said".
    expect(scenario).toEqual({ scenario_id: 'refund-quality-2', turns: [{ input: 'Just a question' }] });
    expect(Object.keys(scenario)).not.toContain('assertions');
  });

  it('refuses a case with no input before anything reaches AWS', () => {
    expect(() => toScenario(item('   '), SLUG, 2)).toThrow(EvalDatasetPublishError);
  });
});

describe('casesHashFor', () => {
  it('changes when a case changes and not when the wording around it does', () => {
    const before = casesHashFor([item('one', { expectedOutput: 'yes' })], SLUG);
    const same = casesHashFor([item('one', { expectedOutput: 'yes' })], SLUG);
    const edited = casesHashFor([item('one', { expectedOutput: 'no' })], SLUG);

    // The hash is what stops every scheduled run cutting a new version in
    // someone's AWS account for a dataset nobody touched.
    expect(same).toBe(before);
    expect(edited).not.toBe(before);
  });
});

describe('publishAgentcoreDataset', () => {
  it('creates the dataset once, with its cases, and cuts a version', async () => {
    respondNormally();

    const published = await publishAgentcoreDataset(request([item('one'), item('two')]), NO_WAITING);

    expect(published).toEqual({ remoteId: 'ds-new', remoteVersion: '3', status: 'ACTIVE' });

    const creates = commandsOf(CreateDatasetCommand);

    expect(creates).toHaveLength(1);
    expect(creates[0]!.input.schemaType).toBe('AGENTCORE_EVALUATION_PREDEFINED_V1');
    expect(creates[0]!.input.source?.inlineExamples?.examples).toHaveLength(2);
    expect(commandsOf(CreateDatasetVersionCommand)).toHaveLength(1);
  });

  it('gives a repeated create the same token, so a lost response is not a second dataset', async () => {
    respondNormally();
    await publishAgentcoreDataset(request([item('one')]), NO_WAITING);
    const first = commandsOf(CreateDatasetCommand)[0]!.input.clientToken;

    send.mockReset();
    respondNormally();
    await publishAgentcoreDataset(request([item('one')]), NO_WAITING);

    // AWS deduplicates on this token. A random one would leave the customer
    // with two datasets and our row pointing at whichever answered last.
    expect(commandsOf(CreateDatasetCommand)[0]!.input.clientToken).toBe(first);
  });

  it('sends AWS a description it will accept when the authored one is long', async () => {
    respondNormally();
    const long = { ...request([item('one')]), description: 'Checks the ingestion report. '.repeat(20) };

    await publishAgentcoreDataset(long, NO_WAITING);

    expect(commandsOf(CreateDatasetCommand)[0]!.input.description!.length).toBeLessThanOrEqual(200);
  });

  it('updates the case that changed and leaves the one that did not alone', async () => {
    respondNormally([
      { exampleId: 'ex-1', scenario_id: 'refund-quality-1', turns: [{ input: 'one' }] },
      { exampleId: 'ex-2', scenario_id: 'refund-quality-2', turns: [{ input: 'two' }] },
    ]);

    await publishAgentcoreDataset(request([item('one'), item('two changed')], 'ds-1'), NO_WAITING);

    const updates = commandsOf(UpdateDatasetExamplesCommand);

    expect(updates).toHaveLength(1);
    expect(updates[0]!.input.examples).toEqual([{
      scenario_id: 'refund-quality-2',
      turns: [{ input: 'two changed' }],
      exampleId: 'ex-2',
    }]);
    // Nothing was added and nothing was removed: the other case is untouched.
    expect(commandsOf(AddDatasetExamplesCommand)).toHaveLength(0);
    expect(commandsOf(DeleteDatasetExamplesCommand)).toHaveLength(0);
  });

  it('deletes the case the file dropped, so AWS stops scoring it', async () => {
    respondNormally([
      { exampleId: 'ex-1', scenario_id: 'refund-quality-1', turns: [{ input: 'one' }] },
      { exampleId: 'ex-2', scenario_id: 'refund-quality-2', turns: [{ input: 'two' }] },
    ]);

    await publishAgentcoreDataset(request([item('one')], 'ds-1'), NO_WAITING);

    const deletes = commandsOf(DeleteDatasetExamplesCommand);

    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.input.exampleIds).toEqual(['ex-2']);
  });

  it('adds a case the account has never seen', async () => {
    respondNormally([
      { exampleId: 'ex-1', scenario_id: 'refund-quality-1', turns: [{ input: 'one' }] },
    ]);

    await publishAgentcoreDataset(request([item('one'), item('two')], 'ds-1'), NO_WAITING);

    const adds = commandsOf(AddDatasetExamplesCommand);

    expect(adds).toHaveLength(1);
    expect(adds[0]!.input.source?.inlineExamples?.examples).toEqual([
      { scenario_id: 'refund-quality-2', turns: [{ input: 'two' }] },
    ]);
  });

  it('fails the publish when AWS ends up refusing the dataset', async () => {
    respondNormally([], 'CREATE_FAILED');

    await expect(publishAgentcoreDataset(request([item('one')]), NO_WAITING))
      .rejects
      .toThrow(/CREATE_FAILED/);
  });

  it('says which dataset stalled rather than waiting forever', async () => {
    respondNormally([], 'CREATING');

    // A 202 means accepted, not done. Without a bounded wait a stuck dataset
    // holds the whole run open.
    await expect(publishAgentcoreDataset(request([item('one')]), NO_WAITING))
      .rejects
      .toThrow(/still working on refund-quality/);
  });

  it('creates the dataset again when AWS no longer has the one we recorded', async () => {
    const missing = new Error('dataset not found');
    missing.name = 'ResourceNotFoundException';
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListDatasetExamplesCommand) {
        throw missing;
      }
      if (command instanceof CreateDatasetCommand) {
        return { datasetId: 'ds-remade', status: 'CREATING' };
      }
      if (command instanceof GetDatasetCommand) {
        return { status: 'ACTIVE' };
      }
      if (command instanceof CreateDatasetVersionCommand) {
        return { datasetVersion: '1' };
      }
      return {};
    });

    // Deleted in the console, or a credential that now points somewhere else.
    // Looping against an id nobody has would strand the eval forever.
    const published = await publishAgentcoreDataset(request([item('one')], 'ds-gone'), NO_WAITING);

    expect(published.remoteId).toBe('ds-remade');
  });

  it('splits a dataset too large for one request, and still cuts one version', async () => {
    respondNormally();
    const many = Array.from({ length: 1200 }, (_, index) => item(`case ${index}`));

    await publishAgentcoreDataset(request(many), NO_WAITING);

    // 1,000 in the create, the rest added after — one version for the lot, not
    // one per batch, so the trend line gets a single point.
    expect(commandsOf(CreateDatasetCommand)[0]!.input.source?.inlineExamples?.examples).toHaveLength(1000);
    expect(commandsOf(AddDatasetExamplesCommand)).toHaveLength(1);
    expect(commandsOf(AddDatasetExamplesCommand)[0]!.input.source?.inlineExamples?.examples).toHaveLength(200);
    expect(commandsOf(CreateDatasetVersionCommand)).toHaveLength(1);
  });

  it('reads every page of the draft before deciding what to delete', async () => {
    let listed = 0;
    send.mockImplementation(async (command: unknown) => {
      if (command instanceof ListDatasetExamplesCommand) {
        listed += 1;
        return listed === 1
          ? {
              examples: [{ exampleId: 'ex-1', scenario_id: 'refund-quality-1', turns: [{ input: 'one' }] }],
              nextToken: 'more',
            }
          : { examples: [{ exampleId: 'ex-2', scenario_id: 'refund-quality-2', turns: [{ input: 'two' }] }] };
      }
      if (command instanceof GetDatasetCommand) {
        return { status: 'ACTIVE' };
      }
      if (command instanceof CreateDatasetVersionCommand) {
        return { datasetVersion: '2' };
      }
      return {};
    });

    await publishAgentcoreDataset(request([item('one'), item('two')], 'ds-1'), NO_WAITING);

    // Stopping at the first page would read the second page's cases as
    // missing and delete every one of them.
    expect(listed).toBe(2);
    expect(commandsOf(DeleteDatasetExamplesCommand)).toHaveLength(0);
    expect(commandsOf(UpdateDatasetExamplesCommand)).toHaveLength(0);
  });

  it('refuses to publish without an AWS credential, before any command is built', async () => {
    resolveAwsCredentials.mockResolvedValueOnce(null as never);

    await expect(publishAgentcoreDataset(request([item('one')]), NO_WAITING))
      .rejects
      .toThrow(EvalDatasetPublishError);

    expect(send).not.toHaveBeenCalled();
  });
});

describe('awsDatasetName', () => {
  it('turns an org and a slug into something AWS will accept', () => {
    const name = awsDatasetName('org_2abcDEF', 'refund-quality');

    // Letters, digits and underscores only, and it must start with a letter.
    expect(name).toMatch(/^[a-z]\w*$/i);
    expect(name).toContain('refund_quality');
  });

  it('keeps two orgs with the same dataset slug apart', () => {
    // The name is immutable in AWS, so a collision here means one workspace
    // silently grading against another's cases.
    expect(awsDatasetName('org_aaa', 'refund-quality')).not.toBe(awsDatasetName('org_bbb', 'refund-quality'));
  });

  it('still produces a legal name when the slug starts with a digit', () => {
    expect(awsDatasetName('2024', '9-lives')).toMatch(/^[a-z]/i);
  });

  it('falls back to a hashed name when nothing usable survives', () => {
    const name = awsDatasetName('!!!', '???');

    expect(name).toMatch(/^eval_[a-f0-9]{8}$/);
  });

  it('stays inside the length AWS allows', () => {
    const name = awsDatasetName('org_'.padEnd(80, 'x'), 'a-very-long-dataset-slug-indeed');

    expect(name.length).toBeLessThanOrEqual(48);
  });
});

describe('awsDatasetDescription', () => {
  it('leaves a description that already fits exactly as written', () => {
    const fits = 'x'.repeat(200);

    expect(awsDatasetDescription(fits)).toBe(fits);
  });

  it('cuts a long description to the 200 characters AWS accepts, and says it was cut', () => {
    const cut = awsDatasetDescription('word '.repeat(80));

    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.startsWith('word word')).toBe(true);
  });

  it('never splits an emoji at the boundary into half a character', () => {
    // 198 letters then emoji two UTF-16 units wide: keeping half of one
    // would send AWS a broken character.
    const cut = awsDatasetDescription(`${'a'.repeat(198)}😀😀😀`);

    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('chunkScenarios', () => {
  it('refuses a single case too large for any request', () => {
    const huge = { scenario_id: 'big', turns: [{ input: 'x'.repeat(6 * 1024 * 1024) }] };

    // Sending it would come back as AWS's own 4xx with AWS's wording, which
    // names neither the dataset nor the case.
    expect(() => chunkScenarios([huge as never], SLUG)).toThrow(EvalDatasetPublishError);
    expect(() => chunkScenarios([huge as never], SLUG)).toThrow(/5 MB/);
  });

  it('splits at AWS\'s thousand-example ceiling', () => {
    const scenarios = Array.from({ length: 2001 }, (_, index) => ({
      scenario_id: `case-${index}`,
      turns: [{ input: 'short' }],
    }));

    const batches = chunkScenarios(scenarios as never, SLUG);

    expect(batches).toHaveLength(3);
    expect(batches[0]).toHaveLength(1000);
    expect(batches[2]).toHaveLength(1);
  });
});
