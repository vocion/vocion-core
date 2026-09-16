/**
 * Running a dataset once, scored by the grader it names.
 *
 * One grader per dataset, taken from `eval_dataset.provider`. The rules that
 * matter here are mostly about a retry: Temporal activities are at-least-once,
 * so this can genuinely be called twice with the same run group, and the whole
 * value of the trend line rests on the second call not looking like a second
 * measurement — no second run row, no second copy of every case.
 *
 * Also pinned: a grader this build has never heard of is refused rather than
 * silently swapped for our own judge, a grader that cannot run says so before
 * any case executes, and a dataset with nothing in it does not call a model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/AgentService', () => ({ runAgentDeep: vi.fn() }));
vi.mock('@/libs/workspace', () => ({ getCurrentWorkspaceSha: vi.fn(async () => 'sha-1') }));
vi.mock('@/services/MemoryService', () => ({ recordEpisode: vi.fn(async () => undefined) }));

const listAvailableProviders = vi.fn();
const getProvider = vi.fn();
vi.mock('@/services/evals/providers/registry', () => ({ listAvailableProviders, getProvider }));

const { db } = await import('@/libs/DB');
const { evalCaseResultSchema, evalDatasetSchema, evalRunSchema, evalScoreSchema } = await import('@/models/Schema');
const { runAgentDeep } = await import('@/services/AgentService');
const { eq } = await import('drizzle-orm');
const { EvalProviderUnavailableError, runDatasetAndScore, UnknownEvalProviderError } = await import('@/services/EvalService');

const mockAgent = vi.mocked(runAgentDeep);
const ORG = 'org_run_with_providers';
const SLUG = 'refund-quality';

/**
 * A provider that scores every case the same way, and remembers what it saw.
 * @param id - The provider id it registers under.
 * @param label - What a person would call it.
 */
function fakeProvider(id: string, label = id) {
  const score = vi.fn(async (request: { transcripts: Array<{ itemIndex: number }> }) =>
    request.transcripts.map(transcript => ({
      evaluatorSlug: id === 'vocion' ? 'vocion:judge' : `${id}:check`,
      evaluatorName: `${label} judge`,
      level: 'TRACE' as const,
      value: 1,
      label: 'pass',
      explanation: 'looked fine',
      itemIndex: transcript.itemIndex,
    })));
  return { id, label, isAvailable: vi.fn(async () => ({ available: true, reason: '' })), score };
}

async function seedDataset(items: Array<{ input: string }>, provider = 'vocion') {
  await db.delete(evalDatasetSchema);
  await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: SLUG,
    name: 'Refund quality',
    agentSlug: 'support-agent',
    provider,
    items,
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(evalScoreSchema);
  await db.delete(evalCaseResultSchema);
  await db.delete(evalRunSchema);
  await seedDataset([{ input: 'one' }, { input: 'two' }]);
  mockAgent.mockResolvedValue({
    response: 'here you go',
    toolCalls: [{ tool: 'issue_refund', input: {}, output: 'ok' }],
    traceId: 'trace-1',
    usage: { inputTokens: 10, outputTokens: 5, cents: 0.1, turns: 2 },
  } as never);
});

describe('runDatasetAndScore', () => {
  it('records one run, scored by the grader the dataset names', async () => {
    getProvider.mockReturnValue(fakeProvider('vocion'));

    const result = await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-1' });

    expect(result.run.providerId).toBe('vocion');

    const runs = await db.select().from(evalRunSchema);

    expect(runs).toHaveLength(1);
    expect(runs[0]!.runGroupId).toBe('group-1');
  });

  it('scores with the dataset\'s grader, not with whatever else is available', async () => {
    await seedDataset([{ input: 'one' }, { input: 'two' }], 'agentcore');
    getProvider.mockImplementation((id: string) => fakeProvider(id, id === 'agentcore' ? 'AgentCore' : id));

    const result = await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG });

    // The whole point of one grader per dataset: nothing else gets to file a
    // score against these cases.
    expect(result.run.providerId).toBe('agentcore');
    expect(getProvider).toHaveBeenCalledWith('agentcore');

    const runs = await db.select().from(evalRunSchema);

    expect(runs.map(run => run.provider)).toEqual(['agentcore']);
  });

  it('does not double the runs or the cases when the activity is retried', async () => {
    getProvider.mockReturnValue(fakeProvider('vocion'));

    await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-retry' });
    await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-retry' });

    const runs = await db.select().from(evalRunSchema);

    expect(runs).toHaveLength(1);

    // Two cases, not four: the retry replaces the dead attempt's rows.
    const cases = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, runs[0]!.id));

    expect(cases).toHaveLength(2);
    expect(cases.map(row => row.itemIndex).sort()).toEqual([0, 1]);
  });

  it('records the run as failed when its grader throws, rather than losing it', async () => {
    const broken = fakeProvider('agentcore', 'AgentCore');
    broken.score.mockRejectedValue(new Error('AWS is down'));
    await seedDataset([{ input: 'one' }, { input: 'two' }], 'agentcore');
    getProvider.mockReturnValue(broken);

    const result = await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-broken' });

    expect(result.run.error).toContain('AWS is down');

    const runs = await db.select().from(evalRunSchema);

    // The transcripts really were produced, so the run exists and says what
    // went wrong instead of vanishing.
    expect(runs[0]!.status).toBe('failed');
    expect(await db.select().from(evalCaseResultSchema)).toHaveLength(2);
  });

  it('refuses a grader nobody has heard of rather than quietly using another', async () => {
    await seedDataset([{ input: 'one' }], 'azure-foundry');
    getProvider.mockReturnValue(undefined);

    await expect(runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG }))
      .rejects
      .toBeInstanceOf(UnknownEvalProviderError);
  });

  it('stops before running a single case when the grader cannot run', async () => {
    const unavailable = fakeProvider('agentcore', 'AgentCore');
    unavailable.isAvailable.mockResolvedValue({ available: false, reason: 'no AWS credential is connected' });
    await seedDataset([{ input: 'one' }, { input: 'two' }], 'agentcore');
    getProvider.mockReturnValue(unavailable);

    await expect(runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG }))
      .rejects
      .toBeInstanceOf(EvalProviderUnavailableError);

    // Nobody pays for a run that could never have been scored.
    expect(mockAgent).not.toHaveBeenCalled();
    expect(await db.select().from(evalRunSchema)).toHaveLength(0);
  });

  it('runs no agent at all for a dataset with no cases', async () => {
    await seedDataset([]);
    getProvider.mockReturnValue(fakeProvider('vocion'));

    const result = await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG });

    expect(mockAgent).not.toHaveBeenCalled();
    expect(result.run.scoreCount).toBe(0);
    expect(await db.select().from(evalCaseResultSchema)).toHaveLength(0);
  });

  it('mirrors the Vocion judge onto the case row', async () => {
    getProvider.mockReturnValue(fakeProvider('vocion'));

    await runDatasetAndScore({ orgId: ORG, datasetSlug: SLUG });

    // modelUpgradeTest reads these columns directly, so they have to carry the
    // Vocion judge's verdict.
    const cases = await db.select().from(evalCaseResultSchema);

    expect(cases.every(row => row.verdict === 'pass')).toBe(true);

    const scores = await db.select().from(evalScoreSchema);

    expect(new Set(scores.map(score => score.provider))).toEqual(new Set(['vocion']));
  });
});
