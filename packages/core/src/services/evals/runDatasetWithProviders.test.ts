/**
 * Running a dataset once and letting several graders score it.
 *
 * The rules that matter here are all about a retry. Temporal activities are
 * at-least-once, so `runDatasetWithProviders` can genuinely be called twice
 * with the same run group, and the whole value of the trend line rests on the
 * second call not looking like a second measurement: no second run row, no
 * second copy of every case, and the same provider still owning the
 * transcripts even if the set of available graders changed in between.
 *
 * Also pinned: one grader failing costs only its own scores, an unknown
 * grader is refused rather than silently dropped, and a dataset with nothing
 * in it does not call a model.
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
const { EvalPrimaryProviderUnavailableError, runDatasetWithProviders, UnknownEvalProviderError } = await import('@/services/EvalService');

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

async function seedDataset(items: Array<{ input: string }>) {
  await db.delete(evalDatasetSchema);
  await db.insert(evalDatasetSchema).values({
    orgId: ORG,
    slug: SLUG,
    name: 'Refund quality',
    agentSlug: 'support-agent',
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

describe('runDatasetWithProviders', () => {
  it('records one run per grader, sharing the run group', async () => {
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion'), fakeProvider('agentcore', 'AgentCore')]);

    const result = await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-1' });

    expect(result.providerRuns.map(run => run.providerId)).toEqual(['vocion', 'agentcore']);

    const runs = await db.select().from(evalRunSchema);

    expect(runs).toHaveLength(2);
    expect(new Set(runs.map(run => run.runGroupId))).toEqual(new Set(['group-1']));
  });

  it('does not double the runs or the cases when the activity is retried', async () => {
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion'), fakeProvider('agentcore', 'AgentCore')]);

    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-retry' });
    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-retry' });

    const runs = await db.select().from(evalRunSchema);

    expect(runs).toHaveLength(2);

    // Two cases, not four: the retry replaces the dead attempt's rows.
    const primaryRunId = runs.find(run => run.provider === 'vocion')!.id;
    const cases = await db.select().from(evalCaseResultSchema).where(eq(evalCaseResultSchema.runId, primaryRunId));

    expect(cases).toHaveLength(2);
    expect(cases.map(row => row.itemIndex).sort()).toEqual([0, 1]);
  });

  it('keeps the transcripts with the grader that already owns them', async () => {
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion'), fakeProvider('agentcore', 'AgentCore')]);
    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-flip' });
    const [firstOwner] = await db.select().from(evalRunSchema).orderBy(evalRunSchema.id);

    // The retry sees a different order — a credential that appeared between
    // attempts would do this. The owner must not change underneath the cases.
    listAvailableProviders.mockResolvedValue([fakeProvider('agentcore', 'AgentCore'), fakeProvider('vocion')]);
    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-flip' });

    const runs = await db.select().from(evalRunSchema);

    expect(runs).toHaveLength(2);

    const caseRows = await db.select().from(evalCaseResultSchema);

    expect(new Set(caseRows.map(row => row.runId))).toEqual(new Set([firstOwner!.id]));
  });

  it('refuses to hand a retry\'s transcripts to a different grader', async () => {
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion'), fakeProvider('agentcore', 'AgentCore')]);
    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-lost-owner' });
    const before = await db.select().from(evalCaseResultSchema);

    // The owner's credential went away between attempts. Promoting AgentCore
    // would delete and rewrite the case rows its own scores already point at,
    // so the attempt has to stop instead.
    listAvailableProviders.mockResolvedValue([fakeProvider('agentcore', 'AgentCore')]);

    await expect(runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-lost-owner' }))
      .rejects
      .toBeInstanceOf(EvalPrimaryProviderUnavailableError);

    const after = await db.select().from(evalCaseResultSchema);

    expect(after.map(row => row.id).sort()).toEqual(before.map(row => row.id).sort());
  });

  it('keeps one grader\'s scores when another one fails', async () => {
    const working = fakeProvider('vocion');
    const broken = fakeProvider('agentcore', 'AgentCore');
    broken.score.mockRejectedValue(new Error('AWS is down'));
    listAvailableProviders.mockResolvedValue([working, broken]);

    const result = await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, runGroupId: 'group-broken' });

    expect(result.providerRuns.find(run => run.providerId === 'vocion')?.scoreCount).toBe(2);
    expect(result.providerRuns.find(run => run.providerId === 'agentcore')?.error).toContain('AWS is down');

    const runs = await db.select().from(evalRunSchema);

    expect(runs.find(run => run.provider === 'vocion')?.status).toBe('succeeded');
    expect(runs.find(run => run.provider === 'agentcore')?.status).toBe('failed');
  });

  it('refuses a grader nobody has heard of rather than quietly using another', async () => {
    getProvider.mockReturnValue(undefined);

    await expect(runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG, providerIds: ['azure'] }))
      .rejects
      .toBeInstanceOf(UnknownEvalProviderError);
  });

  it('runs no agent at all for a dataset with no cases', async () => {
    await seedDataset([]);
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion')]);

    const result = await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG });

    expect(mockAgent).not.toHaveBeenCalled();
    expect(result.providerRuns[0]?.scoreCount).toBe(0);
    expect(await db.select().from(evalCaseResultSchema)).toHaveLength(0);
  });

  it('mirrors the Vocion judge onto the case row, and no other grader does', async () => {
    listAvailableProviders.mockResolvedValue([fakeProvider('vocion'), fakeProvider('agentcore', 'AgentCore')]);

    await runDatasetWithProviders({ orgId: ORG, datasetSlug: SLUG });

    // modelUpgradeTest reads these columns directly, so they have to carry the
    // Vocion judge's verdict and nothing else.
    const cases = await db.select().from(evalCaseResultSchema);

    expect(cases.every(row => row.verdict === 'pass')).toBe(true);

    const scores = await db.select().from(evalScoreSchema);

    expect(new Set(scores.map(score => score.provider))).toEqual(new Set(['vocion', 'agentcore']));
  });
});
