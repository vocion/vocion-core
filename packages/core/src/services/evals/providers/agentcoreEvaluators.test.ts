/**
 * Syncing a dataset's custom evaluators into the customer's AWS account.
 *
 * The rules here are about not lying and not duplicating: a built-in is a name
 * and needs no AWS call at all, a custom evaluator is created exactly once
 * however many runs name it, a config someone edited is pushed as an update
 * rather than a second evaluator, and one that could not be synced is left out
 * of the run with the reason written down — scoring against an evaluator that
 * is not the one the file describes would be worse than not scoring.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

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

const { db } = await import('@/libs/DB');
const { evalEvaluatorSchema } = await import('@/models/Schema');
type Aws = typeof import('@aws-sdk/client-bedrock-agentcore-control');
type CreateCommand = InstanceType<Aws['CreateEvaluatorCommand']>;
const { UpdateEvaluatorCommand } = await import('@aws-sdk/client-bedrock-agentcore-control');
const { eq } = await import('drizzle-orm');
const { awsEvaluatorName, resolveAgentcoreEvaluators } = await import('./agentcoreEvaluators');

/** The pattern AWS validates `evaluatorName` against, anchored. */
const AWS_EVALUATOR_NAME = /^[a-z]\w{0,47}$/i;

const ORG = 'org_agentcore_evaluators';
const DATASET = 'pw-quality';
const CREDENTIALS = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };
const REGION = 'us-east-1';

async function insertEvaluator(values: {
  slug: string;
  config?: Record<string, unknown>;
  level?: string | null;
  remoteId?: string | null;
  syncedAt?: Date | null;
}) {
  const [row] = await db.insert(evalEvaluatorSchema).values({
    orgId: ORG,
    datasetSlug: DATASET,
    provider: 'agentcore',
    slug: values.slug,
    level: values.level ?? null,
    config: values.config ?? {},
    remoteId: values.remoteId ?? null,
    syncedAt: values.syncedAt ?? null,
  }).returning({ id: evalEvaluatorSchema.id });
  return row!.id;
}

const resolve = () => resolveAgentcoreEvaluators(ORG, DATASET, CREDENTIALS, REGION);

beforeEach(async () => {
  send.mockReset();
  await db.delete(evalEvaluatorSchema);
});

describe('resolveAgentcoreEvaluators', () => {
  it('says nothing when the dataset authored no evaluators, so the caller can default', async () => {
    expect(await resolve()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('passes a built-in through by name without calling AWS', async () => {
    await insertEvaluator({ slug: 'Builtin.TrajectoryInOrderMatch' });

    expect(await resolve()).toEqual(['Builtin.TrajectoryInOrderMatch']);
    expect(send).not.toHaveBeenCalled();
  });

  it('creates a custom judge once and reuses the id on the next run', async () => {
    await insertEvaluator({ slug: 'tone-check', config: { instructions: 'Is the tone right?' }, level: 'TRACE' });
    send.mockResolvedValue({ evaluatorId: 'ev-123', evaluatorArn: 'arn:aws:...:ev-123' });

    expect(await resolve()).toEqual(['ev-123']);
    expect(send).toHaveBeenCalledTimes(1);

    send.mockClear();

    expect(await resolve()).toEqual(['ev-123']);
    expect(send).not.toHaveBeenCalled();
  });

  it('updates the evaluator AWS already has when the config changed', async () => {
    const id = await insertEvaluator({
      slug: 'tone-check',
      config: { instructions: 'Is the tone right?' },
      remoteId: 'ev-123',
      syncedAt: new Date(Date.now() - 60_000),
    });
    // What a re-apply of an edited manifest does to the row.
    await db.update(evalEvaluatorSchema)
      .set({ config: { instructions: 'Is the tone warm?' }, updatedAt: new Date() })
      .where(eq(evalEvaluatorSchema.id, id));
    send.mockResolvedValue({ evaluatorArn: 'arn:aws:...:ev-123' });

    expect(await resolve()).toEqual(['ev-123']);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toBeInstanceOf(UpdateEvaluatorCommand);
  });

  it('sends a Lambda evaluator as code, never as a judge', async () => {
    await insertEvaluator({ slug: 'refund-rules', config: { lambdaArn: 'arn:aws:lambda:us-east-1:1:function:x' } });
    send.mockResolvedValue({ evaluatorId: 'ev-lambda' });

    await resolve();

    const command = send.mock.calls[0]![0] as CreateCommand;

    expect(command.input.evaluatorConfig).toEqual({
      codeBased: { lambdaConfig: { lambdaArn: 'arn:aws:lambda:us-east-1:1:function:x' } },
    });
  });

  it('gives AWS the same token on a retried create, so a lost response cannot make two', async () => {
    await insertEvaluator({ slug: 'tone-check', config: { instructions: 'Is the tone right?' } });
    send.mockRejectedValueOnce(new Error('timeout'));
    await resolve();
    const firstToken = (send.mock.calls[0]![0] as CreateCommand).input.clientToken;

    send.mockReset();
    send.mockResolvedValue({ evaluatorId: 'ev-123' });
    await resolve();
    const secondToken = (send.mock.calls[0]![0] as CreateCommand).input.clientToken;

    expect(secondToken).toBe(firstToken);
  });

  it('leaves a failed evaluator out of the run and records why', async () => {
    const id = await insertEvaluator({ slug: 'tone-check', config: { instructions: 'Is the tone right?' } });
    await insertEvaluator({ slug: 'Builtin.TrajectoryInOrderMatch' });
    send.mockRejectedValue(new Error('AccessDeniedException: not allowed'));

    expect(await resolve()).toEqual(['Builtin.TrajectoryInOrderMatch']);

    const [row] = await db.select().from(evalEvaluatorSchema).where(eq(evalEvaluatorSchema.id, id));

    expect(row?.syncError).toContain('AccessDeniedException');
    expect(row?.remoteId).toBeNull();
  });

  it('refuses an evaluator that defines nothing to grade with', async () => {
    const id = await insertEvaluator({ slug: 'empty-check', config: {} });

    expect(await resolve()).toEqual([]);

    const [row] = await db.select().from(evalEvaluatorSchema).where(eq(evalEvaluatorSchema.id, id));

    expect(row?.syncError).toContain('neither instructions nor a lambdaArn');
  });

  it('names a hyphenated evaluator the way AWS requires', async () => {
    // A slug like `ingestion-report` is ordinary authoring. AWS refuses any
    // hyphen in the name, so sending it through would fail every create.
    await insertEvaluator({ slug: 'ingestion-report', config: { instructions: 'Is the report complete?' } });
    send.mockResolvedValue({ evaluatorId: 'ev-123' });

    await resolve();

    expect((send.mock.calls[0]![0] as CreateCommand).input.evaluatorName).toMatch(AWS_EVALUATOR_NAME);
  });
});

describe('awsEvaluatorName', () => {
  it('stays inside what AWS accepts even when the org and slugs are long', () => {
    const name = awsEvaluatorName('org_'.padEnd(60, 'x'), 'event-ingestion-quality-review', 'ingestion-report');

    expect(name).toMatch(AWS_EVALUATOR_NAME);
  });

  it('keeps two evaluators apart when their names only differ after the cut', () => {
    // Both share the first 48 characters, so a plain cut would give AWS the
    // same name twice and the second create would fail as a duplicate.
    const longDataset = 'a-dataset-slug-long-enough-to-fill-the-whole-name';

    expect(awsEvaluatorName(ORG, longDataset, 'tone-check'))
      .not
      .toBe(awsEvaluatorName(ORG, longDataset, 'tone-check-strict'));
  });

  it('produces a legal name from slugs that start with a digit or hold no ASCII at all', () => {
    expect(awsEvaluatorName('2024', '9-lives', '1st-pass')).toMatch(AWS_EVALUATOR_NAME);
    expect(awsEvaluatorName('', '', '')).toMatch(AWS_EVALUATOR_NAME);
    expect(awsEvaluatorName(ORG, 'qualité', 'ton-vérifié')).toMatch(AWS_EVALUATOR_NAME);
  });

  it('keeps apart slugs that differ only in characters AWS cannot hold', () => {
    // Both collapse to the same readable text, so only the hash tells them apart.
    expect(awsEvaluatorName(ORG, DATASET, 'tone.check')).not.toBe(awsEvaluatorName(ORG, DATASET, 'tone-check'));
  });

  it('gives the same evaluator the same name every time', () => {
    expect(awsEvaluatorName(ORG, DATASET, 'tone-check')).toBe(awsEvaluatorName(ORG, DATASET, 'tone-check'));
  });
});
