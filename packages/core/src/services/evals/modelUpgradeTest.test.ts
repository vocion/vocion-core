/**
 * The model-upgrade comparison, read off two runs of one dataset.
 *
 * `compareEvalRuns` is pure over the rows it is handed, so these tests build
 * the rows by hand and pin the number the whole feature exists for — cost per
 * passed case — plus the two edges that would otherwise mislead: a candidate
 * whose model is unpriced (reads as free), and a candidate on which nothing
 * passed (cost per passed case is undefined, not zero).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { compareEvalRuns, renderComparisonMarkdown } = await import('./modelUpgradeTest');

type Result = {
  id: number;
  runId: number;
  itemIndex: number;
  input: string;
  output: string | null;
  score: string | null;
  verdict: string | null;
  rationale: string | null;
  traceId: string | null;
  latencyMs: number | null;
  usage: { model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cents: number; turns: number; toolCalls: number } | null;
  createdAt: Date;
};

const dataset = {
  id: 1,
  orgId: 'org_t',
  projectId: null,
  slug: 'proposal-writer-upgrade',
  name: 'Proposal Writer — upgrade',
  agentSlug: 'proposal-writer',
  description: null,
  items: [
    { input: 'Draft a brief for Acme', tags: ['brief'] },
    { input: 'Draft a brief for Globex', tags: ['brief'] },
    { input: 'Price the Initech scope' },
  ],
  version: 1,
  updatedAt: new Date(),
  createdAt: new Date(),
};

function run(id: number, model: string | null, cases: Array<Partial<Result> & { verdict: string }>) {
  return {
    id,
    orgId: 'org_t',
    projectId: null,
    datasetId: 1,
    agentSlug: 'proposal-writer',
    workspaceSha: null,
    model,
    provider: 'vocion',
    datasetVersion: dataset.version,
    runGroupId: null,
    status: 'succeeded',
    metrics: {},
    startedAt: new Date(),
    completedAt: new Date(),
    results: cases.map((c, i) => ({
      id: id * 100 + i,
      runId: id,
      itemIndex: i,
      input: dataset.items[i]!.input,
      output: 'out',
      score: c.score ?? (c.verdict === 'pass' ? '0.800' : '0.300'),
      verdict: c.verdict,
      rationale: c.rationale ?? null,
      traceId: null,
      latencyMs: c.latencyMs ?? 1000,
      usage: c.usage === undefined ? { model: model ?? 'x', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cents: 2, turns: 3, toolCalls: 2 } : c.usage,
      trajectory: null,
      createdAt: new Date(),
    })),
  };
}

describe('compareEvalRuns', () => {
  it('compares on cost per passed case, not on total spend', () => {
    // Baseline: 1 of 3 passes, 6 cents total → 6 cents per passed case.
    const baseline = run(10, 'gpt-5.6-sol', [
      { verdict: 'pass' },
      { verdict: 'fail' },
      { verdict: 'fail' },
    ]);
    // Candidate: 3 of 3 pass at 4 cents each — more expensive in total
    // (12 vs 6) and cheaper per completed job (4 vs 6).
    const usage = { model: 'gpt-6-astra', inputTokens: 1000, outputTokens: 400, cacheReadTokens: 0, cents: 4, turns: 2, toolCalls: 1 };
    const candidate = run(11, 'gpt-6-astra', [
      { verdict: 'pass', usage },
      { verdict: 'pass', usage },
      { verdict: 'pass', usage },
    ]);

    const c = compareEvalRuns(dataset, baseline, candidate);

    expect(c.baseline.costPerPassedCaseCents).toBe(6);
    expect(c.candidate.costPerPassedCaseCents).toBe(4);
    expect(c.deltas.totalCents).toBeCloseTo(1, 5); // +100% total spend
    expect(c.deltas.costPerPassedCase).toBeCloseTo(-1 / 3, 4); // −33% per passed case
    expect(c.gained).toBe(2);
    expect(c.lost).toBe(0);
    expect(c.candidate.meanTurns).toBe(2);
    expect(c.baseline.meanTurns).toBe(3);
    expect(c.verdict).toMatch(/Cheaper per completed job/);
    expect(c.verdict).toMatch(/Fewer turns per case/);
  });

  it('tracks which cases flipped, in dataset order', () => {
    const baseline = run(1, 'a', [{ verdict: 'pass' }, { verdict: 'fail' }, { verdict: 'pass' }]);
    const candidate = run(2, 'b', [{ verdict: 'pass' }, { verdict: 'pass' }, { verdict: 'fail' }]);

    const c = compareEvalRuns(dataset, baseline, candidate);

    expect(c.cases.map(x => x.flip)).toEqual(['same', 'gained', 'lost']);
    expect(c.cases[1]!.input).toBe('Draft a brief for Globex');
    expect(c.cases[1]!.tags).toEqual(['brief']);
    expect(c.gained).toBe(1);
    expect(c.lost).toBe(1);
  });

  it('says so when a side is unpriced instead of calling it free', () => {
    const free = { model: 'gpt-5.4-mini', inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cents: 0, turns: 2, toolCalls: 1 };
    const baseline = run(1, 'gpt-5.6-sol', [{ verdict: 'pass' }, { verdict: 'pass' }, { verdict: 'pass' }]);
    const candidate = run(2, 'gpt-5.4-mini', [{ verdict: 'pass', usage: free }, { verdict: 'pass', usage: free }, { verdict: 'pass', usage: free }]);

    const c = compareEvalRuns(dataset, baseline, candidate);

    expect(c.candidate.unpriced).toBe(true);
    expect(c.candidate.costPerPassedCaseCents).toBeNull();
    expect(c.deltas.costPerPassedCase).toBeNull();
    expect(c.verdict).toMatch(/Cost is not comparable/);
    expect(renderComparisonMarkdown(c)).toMatch(/not in `libs\/pricing.ts`/);
  });

  it('leaves cost per passed case undefined when nothing passed', () => {
    const baseline = run(1, 'a', [{ verdict: 'pass' }, { verdict: 'pass' }, { verdict: 'pass' }]);
    const candidate = run(2, 'b', [{ verdict: 'fail' }, { verdict: 'error', usage: null }, { verdict: 'fail' }]);

    const c = compareEvalRuns(dataset, baseline, candidate);

    expect(c.candidate.passed).toBe(0);
    expect(c.candidate.errored).toBe(1);
    expect(c.candidate.costPerPassedCaseCents).toBeNull();
    expect(c.verdict).toMatch(/Finishes less of the job/);
    expect(c.verdict).toMatch(/nothing passed/);
  });

  it('falls back to the reported model id when eval_run.model is null', () => {
    const baseline = run(1, null, [{ verdict: 'pass' }]);
    const candidate = run(2, 'gpt-6-astra', [{ verdict: 'pass' }]);

    const c = compareEvalRuns(dataset, baseline, candidate);

    // `run()` stamps usage.model with 'x' when the run has no model.
    expect(c.baseline.model).toBe('x');
    expect(c.candidate.model).toBe('gpt-6-astra');
  });

  it('renders a briefing that leads with the verdict and lists the changed cases', () => {
    const baseline = run(1, 'gpt-5.6-sol', [{ verdict: 'fail' }, { verdict: 'pass' }, { verdict: 'pass' }]);
    const candidate = run(2, 'gpt-6-astra', [{ verdict: 'pass', rationale: 'Client-ready; template followed.' }, { verdict: 'pass' }, { verdict: 'pass' }]);

    const md = renderComparisonMarkdown(compareEvalRuns(dataset, baseline, candidate));

    expect(md).toMatch(/^# Model upgrade test — `proposal-writer`/);
    expect(md).toMatch(/\*\*Reading\.\*\* Finishes more of the job/);
    expect(md).toMatch(/## Cases that changed \(1 of 3\)/);
    expect(md).toMatch(/\| 1 \| ✅ gained \|/);
    expect(md).toMatch(/Cost per passed case/);
  });
});
