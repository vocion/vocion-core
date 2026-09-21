/**
 * What `workspace:apply` does with a dataset's `evaluators` block.
 *
 * Two rules, and both are about the file being the truth. Apply writes desired
 * state and makes no AWS call — an unreachable endpoint must not stop a
 * workspace landing its agents and playbooks. And an evaluator taken out of
 * the file stops grading: left behind, it would keep being sent to AWS on
 * every run, so the scores would quietly measure something the workspace no
 * longer describes.
 *
 * A re-apply of an unchanged file must also not lose the remote id, or the
 * next run creates a second evaluator in the customer's account. For the same
 * reason an unauthored evaluator is retired rather than deleted: we never call
 * AWS `DeleteEvaluator`, so the row is the only thing that remembers which
 * evaluator in the account belongs to this dataset.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/temporal/client', () => ({
  getTemporalClient: vi.fn(async () => {
    throw new Error('temporal unavailable in tests');
  }),
}));

const { db } = await import('@/libs/DB');
const { evalDatasetSchema, evalEvaluatorSchema } = await import('@/models/Schema');
const { applyWorkspace } = await import('./applier');
const { loadWorkspace } = await import('./loader');
const { and, eq } = await import('drizzle-orm');

const ORG = 'org_eval_evaluators_apply';
const DATASET = 'refund-quality';
const dirs: string[] = [];

/**
 * A workspace with one agent and one eval dataset, whose evaluator block is
 * whatever the test passes.
 * @param evaluatorsYaml - The `evaluators:` block, or '' for none.
 * @param provider - The one grader the dataset says it is scored by.
 */
function writeFixture(evaluatorsYaml: string, provider = 'agentcore'): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-eval-evaluators-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: eval-evaluators\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(
    join(dir, 'agents', 'support-agent.yaml'),
    'slug: support-agent\nname: Support Agent\nsystemPrompt: Be helpful.\n',
  );
  mkdirSync(join(dir, 'evals'));
  writeFileSync(
    join(dir, 'evals', `${DATASET}.yaml`),
    `slug: ${DATASET}\nname: Refund quality\nagentSlug: support-agent\nprovider: ${provider}\n${evaluatorsYaml}items:\n  - input: I want a refund.\n`,
  );
  return dir;
}

async function apply(evaluatorsYaml: string, provider = 'agentcore') {
  const loaded = await loadWorkspace(writeFixture(evaluatorsYaml, provider));
  return applyWorkspace(loaded, { orgId: ORG });
}

async function storedEvaluators() {
  return db
    .select()
    .from(evalEvaluatorSchema)
    .where(and(eq(evalEvaluatorSchema.orgId, ORG), eq(evalEvaluatorSchema.datasetSlug, DATASET)));
}

/**
 * Only the evaluators that would actually grade a run right now.
 */
async function gradingEvaluators() {
  const rows = await storedEvaluators();
  return rows.filter(row => row.retiredAt === null);
}

const TWO_EVALUATORS = `evaluators:\n  - provider: agentcore\n    builtin: [Builtin.TrajectoryInOrderMatch]\n  - provider: agentcore\n    slug: tone-check\n    level: TRACE\n    instructions: Is the tone warm?\n`;
const ONE_EVALUATOR = `evaluators:\n  - provider: agentcore\n    builtin: [Builtin.TrajectoryInOrderMatch]\n`;

beforeEach(async () => {
  await db.delete(evalEvaluatorSchema);
  await db.delete(evalDatasetSchema);
});

afterAll(async () => {
  await db.delete(evalEvaluatorSchema);
  await db.delete(evalDatasetSchema);
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A workspace whose dataset carries deterministic checks on one case.
 * @param provider - The grader the dataset names.
 * @param checksOnCase - Which case gets the checks block, 1-based.
 */
function writeChecksFixture(provider: string, checksOnCase: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-eval-checks-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: eval-checks\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'support-agent.yaml'), 'slug: support-agent\nname: Support Agent\nsystemPrompt: Be helpful.\n');
  mkdirSync(join(dir, 'evals'));
  const cases = [1, 2].map((number) => {
    const checks = number === checksOnCase ? '    checks:\n      - outputContains: refund\n' : '';
    return `  - input: Case ${number}\n${checks}`;
  }).join('');
  writeFileSync(
    join(dir, 'evals', `${DATASET}.yaml`),
    `slug: ${DATASET}\nname: Refund quality\nagentSlug: support-agent\nprovider: ${provider}\nitems:\n${cases}`,
  );
  return dir;
}

/**
 * A dataset file that names a pass threshold, or names none at all.
 * @param threshold - The YAML line's value, or null to leave the field out.
 */
function writeThresholdFixture(threshold: number | null): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-eval-threshold-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${ORG}\nname: eval-threshold\n`);
  mkdirSync(join(dir, 'agents'));
  writeFileSync(join(dir, 'agents', 'support-agent.yaml'), 'slug: support-agent\nname: Support Agent\nsystemPrompt: Be helpful.\n');
  mkdirSync(join(dir, 'evals'));
  const thresholdLine = threshold === null ? '' : `passThreshold: ${threshold}\n`;
  writeFileSync(
    join(dir, 'evals', `${DATASET}.yaml`),
    `slug: ${DATASET}\nname: Refund quality\nagentSlug: support-agent\nprovider: vocion\n${thresholdLine}items:\n  - input: Case 1\n`,
  );
  return dir;
}

describe('workspace apply — eval evaluators', () => {
  it('applies deterministic checks on a dataset AgentCore scores', async () => {
    // They used to be refused here, because only our own judge ran them. They
    // now run over the transcript whoever grades the case, so a dataset can
    // send its cases to AWS and still assert the things no model should be
    // asked to judge — the shape of the dedup key, say.
    const dir = writeChecksFixture('agentcore', 1);
    const loaded = await loadWorkspace(dir);

    await applyWorkspace(loaded, { orgId: ORG });

    const [stored] = await db
      .select({ items: evalDatasetSchema.items })
      .from(evalDatasetSchema)
      .where(and(eq(evalDatasetSchema.orgId, ORG), eq(evalDatasetSchema.slug, DATASET)));

    expect(stored?.items?.[0]?.checks).toEqual([{ outputContains: 'refund' }]);
  });

  it('still applies a Vocion dataset that uses checks', async () => {
    // The same block on the other grader, so neither path can regress into
    // dropping checks on the floor.
    const dir = writeChecksFixture('vocion', 1);
    const loaded = await loadWorkspace(dir);

    await applyWorkspace(loaded, { orgId: ORG });

    const [stored] = await db
      .select({ items: evalDatasetSchema.items })
      .from(evalDatasetSchema)
      .where(and(eq(evalDatasetSchema.orgId, ORG), eq(evalDatasetSchema.slug, DATASET)));

    expect(stored?.items?.[0]?.checks).toEqual([{ outputContains: 'refund' }]);
  });

  it('stores the pass rate a dataset asks to be held to', async () => {
    // The runner's floor is one number for every dataset everywhere. A set
    // spread over a dozen live websites loses a case whenever one of them
    // redesigns a page, and a gate that fails a build for that gets ignored.
    await applyWorkspace(await loadWorkspace(writeThresholdFixture(0.6)), { orgId: ORG });

    const [stored] = await db
      .select({ passThreshold: evalDatasetSchema.passThreshold })
      .from(evalDatasetSchema)
      .where(and(eq(evalDatasetSchema.orgId, ORG), eq(evalDatasetSchema.slug, DATASET)));

    expect(stored?.passThreshold).toBeCloseTo(0.6, 5);
  });

  it('leaves the threshold unset when the file names none, so the runner default still applies', async () => {
    await applyWorkspace(await loadWorkspace(writeThresholdFixture(null)), { orgId: ORG });

    const [stored] = await db
      .select({ passThreshold: evalDatasetSchema.passThreshold })
      .from(evalDatasetSchema)
      .where(and(eq(evalDatasetSchema.orgId, ORG), eq(evalDatasetSchema.slug, DATASET)));

    expect(stored?.passThreshold).toBeNull();
  });

  it('refuses a pass rate outside 0 to 1, where it could never be met or never be missed', async () => {
    await expect(async () => loadWorkspace(writeThresholdFixture(1.5))).rejects.toThrow();
  });

  it('refuses a file whose evaluator is for a grader the dataset does not use', async () => {
    // An eval lives in one place. An AgentCore evaluator on a Vocion dataset
    // would never be asked for a score, so applying the file would leave
    // someone waiting for a number that cannot arrive.
    await expect(apply(ONE_EVALUATOR, 'vocion')).rejects.toThrow(/graded by vocion/);

    expect(await storedEvaluators()).toHaveLength(0);
  });

  it('records what the file asked for, and calls nothing remote', async () => {
    await apply(TWO_EVALUATORS);

    const rows = await storedEvaluators();

    expect(rows.map(row => row.slug).sort()).toEqual(['Builtin.TrajectoryInOrderMatch', 'tone-check']);
    // Nothing has been created in AWS yet — that happens on the way into a run.
    expect(rows.every(row => row.remoteId === null && row.syncedAt === null)).toBe(true);
  });

  it('keeps the remote id when the same file is applied again', async () => {
    await apply(TWO_EVALUATORS);
    await db
      .update(evalEvaluatorSchema)
      .set({ remoteId: 'ev-123', remoteArn: 'arn:aws:ev-123', syncedAt: new Date() })
      .where(eq(evalEvaluatorSchema.slug, 'tone-check'));

    await apply(TWO_EVALUATORS);

    const rows = await storedEvaluators();

    // Losing this would make the next run create a second evaluator in the
    // customer's AWS account.
    expect(rows.find(row => row.slug === 'tone-check')?.remoteId).toBe('ev-123');
  });

  it('stops grading with an evaluator the file no longer declares', async () => {
    await apply(TWO_EVALUATORS);

    expect(await gradingEvaluators()).toHaveLength(2);

    await apply(ONE_EVALUATOR);

    expect((await gradingEvaluators()).map(row => row.slug)).toEqual(['Builtin.TrajectoryInOrderMatch']);
  });

  it('stops grading with them all when the block is removed entirely', async () => {
    await apply(TWO_EVALUATORS);

    await apply('');

    expect(await gradingEvaluators()).toHaveLength(0);
  });

  it('remembers the AWS evaluator behind one it retired, and brings it back', async () => {
    await apply(TWO_EVALUATORS);
    await db
      .update(evalEvaluatorSchema)
      .set({ remoteId: 'ev-456', remoteArn: 'arn:aws:ev-456', syncedAt: new Date() })
      .where(eq(evalEvaluatorSchema.slug, 'tone-check'));

    await apply(ONE_EVALUATOR);

    const retired = (await storedEvaluators()).find(row => row.slug === 'tone-check');

    // Deleting the row would strand `ev-456` in the customer's account, and the
    // next create would collide with the name AWS already has.
    expect(retired?.retiredAt).not.toBeNull();
    expect(retired?.remoteId).toBe('ev-456');

    await apply(TWO_EVALUATORS);

    const revived = (await gradingEvaluators()).find(row => row.slug === 'tone-check');

    expect(revived?.remoteId).toBe('ev-456');
  });
});
