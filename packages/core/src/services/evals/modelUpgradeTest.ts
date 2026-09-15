/**
 * Model-upgrade test.
 *
 * The claim under test: a frontier model release should make the AI
 * workforce you already have better — the role, its context, its systems and
 * its standards stay put while the intelligence underneath improves. This
 * module makes that claim measurable for ONE agent: run its eval dataset on a
 * baseline model and on a candidate model, judged by the same judge, and
 * compare on the metric a business cares about — **cost per passed case** —
 * rather than price per token.
 *
 * Three questions the comparison answers (see docs/guides/model-upgrade-test.md):
 *   1. What can the role finish now that it could not before? → pass rate,
 *      per-case pass/fail flips.
 *   2. Where does the stronger model remove a handoff or a retry? → mean model
 *      turns and tool calls per case.
 *   3. Does cost per completed job drop even if price per token rises? →
 *      cost per passed case, delta %.
 *
 * Nothing new is stored beyond two ordinary `eval_run` rows: the comparison is
 * a pure read over their `eval_case_result` rows (`compareEvalRuns`), so the
 * dashboard can compare any two runs of a dataset after the fact, and the
 * published briefing is a rendering of the same object.
 */

import type { CaseUsage } from '../EvalService';
import type { LangChainProvider } from '@/libs/llm';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentSchema, briefingSchema } from '@/models/Schema';
import { getDataset, getRun, runDataset } from '../EvalService';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One side of the comparison — everything read off one `eval_run`. */
export type RunSide = {
  runId: number;
  /** The model the agent ran on: `eval_run.model`, else the per-case reported id, else "agent default". */
  model: string;
  cases: number;
  passed: number;
  failed: number;
  errored: number;
  passRate: number;
  /** Mean judge score over cases that were judged (pass or fail; errors excluded). */
  meanScore: number | null;
  totalCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Mean model turns per case with usage; retries and tool loops raise it. */
  meanTurns: number | null;
  meanToolCalls: number | null;
  medianLatencyMs: number | null;
  /** totalCents / passed; null when nothing passed or the model is unpriced (0 cents). */
  costPerPassedCaseCents: number | null;
  /** True when every case with usage priced at 0 — the model is not in libs/pricing.ts. */
  unpriced: boolean;
};

/** One dataset item, side by side. */
export type CaseComparison = {
  itemIndex: number;
  input: string;
  tags: string[];
  baseline: CaseSide | null;
  candidate: CaseSide | null;
  /** `gained` = failed → passed, `lost` = passed → failed, `same` otherwise. */
  flip: 'gained' | 'lost' | 'same';
};

export type CaseSide = {
  verdict: string;
  score: number | null;
  rationale: string | null;
  cents: number | null;
  turns: number | null;
  toolCalls: number | null;
  latencyMs: number | null;
  traceId: string | null;
};

/** Relative change candidate vs baseline, as a fraction (0.25 = +25%); null when the baseline is 0 or unknown. */
export type Delta = number | null;

export type ModelUpgradeComparison = {
  datasetSlug: string;
  datasetName: string;
  agentSlug: string;
  baseline: RunSide;
  candidate: RunSide;
  deltas: {
    passRate: Delta;
    meanScore: Delta;
    totalCents: Delta;
    costPerPassedCase: Delta;
    meanTurns: Delta;
    meanToolCalls: Delta;
    medianLatencyMs: Delta;
  };
  cases: CaseComparison[];
  /** Cases that failed on the baseline and passed on the candidate. */
  gained: number;
  /** Cases that passed on the baseline and failed on the candidate. */
  lost: number;
  /** The one-paragraph reading the briefing opens with. */
  verdict: string;
};

/* ------------------------------------------------------------------ */
/* Pure comparison                                                     */
/* ------------------------------------------------------------------ */

type RunRow = NonNullable<Awaited<ReturnType<typeof getRun>>>;
type DatasetRow = NonNullable<Awaited<ReturnType<typeof getDataset>>>;

/**
 * Compare two completed runs of the same dataset. Pure: reads only the rows
 * it is handed, so it is testable without a database and re-runnable from the
 * dashboard over any two historical runs.
 * @param dataset - The dataset both runs belong to (for item inputs and tags).
 * @param baseline - The run the agent's current model produced.
 * @param candidate - The run the proposed model produced.
 */
export function compareEvalRuns(dataset: DatasetRow, baseline: RunRow, candidate: RunRow): ModelUpgradeComparison {
  const b = summarizeRun(baseline);
  const c = summarizeRun(candidate);

  const byIndex = (run: RunRow) => new Map(run.results.map(r => [r.itemIndex, r]));
  const bCases = byIndex(baseline);
  const cCases = byIndex(candidate);
  const indexes = new Set<number>([...bCases.keys(), ...cCases.keys()]);

  const cases: CaseComparison[] = [...indexes].sort((x, y) => x - y).map((itemIndex) => {
    const bc = bCases.get(itemIndex);
    const cc = cCases.get(itemIndex);
    const item = dataset.items[itemIndex];
    const bPass = bc?.verdict === 'pass';
    const cPass = cc?.verdict === 'pass';
    return {
      itemIndex,
      input: item?.input ?? bc?.input ?? cc?.input ?? '',
      tags: item?.tags ?? [],
      baseline: bc ? caseSide(bc) : null,
      candidate: cc ? caseSide(cc) : null,
      flip: !bPass && cPass ? 'gained' : bPass && !cPass ? 'lost' : 'same',
    };
  });

  const gained = cases.filter(x => x.flip === 'gained').length;
  const lost = cases.filter(x => x.flip === 'lost').length;

  const deltas = {
    passRate: delta(b.passRate, c.passRate),
    meanScore: delta(b.meanScore, c.meanScore),
    totalCents: delta(b.totalCents, c.totalCents),
    costPerPassedCase: delta(b.costPerPassedCaseCents, c.costPerPassedCaseCents),
    meanTurns: delta(b.meanTurns, c.meanTurns),
    meanToolCalls: delta(b.meanToolCalls, c.meanToolCalls),
    medianLatencyMs: delta(b.medianLatencyMs, c.medianLatencyMs),
  };

  return {
    datasetSlug: dataset.slug,
    datasetName: dataset.name,
    agentSlug: dataset.agentSlug,
    baseline: b,
    candidate: c,
    deltas,
    cases,
    gained,
    lost,
    verdict: readVerdict({ baseline: b, candidate: c, deltas, gained, lost }),
  };
}

function summarizeRun(run: RunRow): RunSide {
  const results = run.results;
  const passed = results.filter(r => r.verdict === 'pass').length;
  const errored = results.filter(r => r.verdict === 'error').length;
  const failed = results.length - passed - errored;
  const judged = results.filter(r => r.verdict === 'pass' || r.verdict === 'fail');
  const scores = judged.map(r => Number(r.score)).filter(n => Number.isFinite(n));
  const withUsage = results.map(r => r.usage).filter((u): u is CaseUsage => !!u);
  const totalCents = sum(withUsage.map(u => u.cents));
  const latencies = results.map(r => r.latencyMs).filter((n): n is number => typeof n === 'number');
  const reportedModel = withUsage.find(u => u.model && u.model !== 'unknown')?.model;

  return {
    runId: run.id,
    model: run.model ?? reportedModel ?? 'agent default',
    cases: results.length,
    passed,
    failed,
    errored,
    passRate: results.length > 0 ? passed / results.length : 0,
    meanScore: scores.length > 0 ? round(sum(scores) / scores.length, 3) : null,
    totalCents: round(totalCents, 4),
    totalInputTokens: sum(withUsage.map(u => u.inputTokens)),
    totalOutputTokens: sum(withUsage.map(u => u.outputTokens)),
    meanTurns: withUsage.length > 0 ? round(sum(withUsage.map(u => u.turns)) / withUsage.length, 2) : null,
    meanToolCalls: withUsage.length > 0 ? round(sum(withUsage.map(u => u.toolCalls)) / withUsage.length, 2) : null,
    medianLatencyMs: latencies.length > 0 ? median(latencies) : null,
    costPerPassedCaseCents: passed > 0 && totalCents > 0 ? round(totalCents / passed, 4) : null,
    unpriced: withUsage.length > 0 && totalCents === 0,
  };
}

function caseSide(r: RunRow['results'][number]): CaseSide {
  const score = r.score == null ? null : Number(r.score);
  return {
    verdict: r.verdict ?? 'pending',
    score: score != null && Number.isFinite(score) ? score : null,
    rationale: r.rationale ?? null,
    cents: r.usage?.cents ?? null,
    turns: r.usage?.turns ?? null,
    toolCalls: r.usage?.toolCalls ?? null,
    latencyMs: r.latencyMs ?? null,
    traceId: r.traceId ?? null,
  };
}

function delta(baseline: number | null, candidate: number | null): Delta {
  if (baseline == null || candidate == null || baseline === 0) {
    return null;
  }
  return round((candidate - baseline) / baseline, 4);
}

/**
 * One paragraph a person can act on, written from the numbers and nothing
 * else. Names the three questions in order and says plainly when a side is
 * unpriced, because an unpriced candidate would otherwise read as free.
 * @param c - The pieces of the comparison the verdict is read from.
 */
function readVerdict(c: Pick<ModelUpgradeComparison, 'baseline' | 'candidate' | 'deltas' | 'gained' | 'lost'>): string {
  const { baseline: b, candidate: cand, deltas } = c;
  const parts: string[] = [];

  const passDelta = Math.round((cand.passRate - b.passRate) * 100);
  parts.push(
    passDelta > 0
      ? `Finishes more of the job: pass rate ${pct(b.passRate)} → ${pct(cand.passRate)} (+${passDelta} pts), ${c.gained} case${c.gained === 1 ? '' : 's'} gained${c.lost ? `, ${c.lost} lost` : ''}.`
      : passDelta < 0
        ? `Finishes less of the job: pass rate ${pct(b.passRate)} → ${pct(cand.passRate)} (${passDelta} pts), ${c.lost} case${c.lost === 1 ? '' : 's'} lost${c.gained ? `, ${c.gained} gained` : ''}.`
        : `Finishes the same share of the job: pass rate ${pct(cand.passRate)} on both${c.gained || c.lost ? ` (${c.gained} gained, ${c.lost} lost)` : ''}.`,
  );

  if (b.meanTurns != null && cand.meanTurns != null) {
    parts.push(
      cand.meanTurns < b.meanTurns
        ? `Fewer turns per case (${b.meanTurns} → ${cand.meanTurns}) — less retrying and looping before it hands back.`
        : cand.meanTurns > b.meanTurns
          ? `More turns per case (${b.meanTurns} → ${cand.meanTurns}).`
          : `Same turns per case (${cand.meanTurns}).`,
    );
  }

  if (cand.unpriced || b.unpriced) {
    parts.push(`Cost is not comparable: ${cand.unpriced ? cand.model : b.model} has no entry in the price table, so its cents read as 0. Add it to libs/pricing.ts and re-run.`);
  } else if (b.costPerPassedCaseCents != null && cand.costPerPassedCaseCents != null && deltas.costPerPassedCase != null) {
    const d = Math.round(deltas.costPerPassedCase * 100);
    parts.push(
      d < 0
        ? `Cheaper per completed job: ${usd(b.costPerPassedCaseCents)} → ${usd(cand.costPerPassedCaseCents)} per passed case (${d}%), even though the per-token price is what it is.`
        : d > 0
          ? `More expensive per completed job: ${usd(b.costPerPassedCaseCents)} → ${usd(cand.costPerPassedCaseCents)} per passed case (+${d}%).`
          : `Same cost per completed job (${usd(cand.costPerPassedCaseCents)} per passed case).`,
    );
  } else if (cand.passed === 0) {
    parts.push('Cost per passed case is undefined for the candidate — nothing passed.');
  }

  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Run both sides                                                      */
/* ------------------------------------------------------------------ */

export type ModelUpgradeTestOptions = {
  orgId: string;
  datasetSlug: string;
  /** The model the role runs on today. */
  baselineModel: string;
  /** The model release being evaluated. */
  candidateModel: string;
  baselineProvider?: LangChainProvider;
  candidateProvider?: LangChainProvider;
  /** Skip the briefing (the CLI's `--no-briefing`). Default publishes one. */
  publish?: boolean;
  /** Progress hook for the CLI. */
  onProgress?: (line: string) => void;
};

export type ModelUpgradeTestResult = {
  baselineRunId: number;
  candidateRunId: number;
  comparison: ModelUpgradeComparison;
  briefingId: number | null;
};

/**
 * Run a dataset on the baseline, then on the candidate, and compare.
 *
 * Sequential on purpose: the two runs share the agent's tools, connectors and
 * budget row, and running them side by side would make per-case latency —
 * one of the compared numbers — a function of contention rather than of the
 * model.
 * @param opts - The dataset and the two models.
 */
export async function runModelUpgradeTest(opts: ModelUpgradeTestOptions): Promise<ModelUpgradeTestResult> {
  const dataset = await getDataset(opts.orgId, opts.datasetSlug);
  if (!dataset) {
    throw new Error(`dataset ${opts.datasetSlug} not found for org ${opts.orgId}`);
  }
  if (opts.baselineModel.trim() === opts.candidateModel.trim()) {
    throw new Error('baselineModel and candidateModel are the same model; nothing to compare');
  }
  const progress = opts.onProgress ?? (() => {});

  progress(`baseline: running ${dataset.items.length} case(s) on ${opts.baselineModel}`);
  const baseline = await runDataset({
    orgId: opts.orgId,
    datasetSlug: dataset.slug,
    modelOverride: opts.baselineModel,
    providerOverride: opts.baselineProvider,
  });
  progress(`baseline: run #${baseline.runId} — pass ${pct(baseline.metrics?.passRate ?? 0)}`);

  progress(`candidate: running ${dataset.items.length} case(s) on ${opts.candidateModel}`);
  const candidate = await runDataset({
    orgId: opts.orgId,
    datasetSlug: dataset.slug,
    modelOverride: opts.candidateModel,
    providerOverride: opts.candidateProvider,
  });
  progress(`candidate: run #${candidate.runId} — pass ${pct(candidate.metrics?.passRate ?? 0)}`);

  const comparison = await getComparison(opts.orgId, dataset.slug, baseline.runId, candidate.runId);
  if (!comparison) {
    throw new Error('runs completed but could not be read back for comparison');
  }

  let briefingId: number | null = null;
  if (opts.publish !== false) {
    briefingId = await publishComparisonBriefing(opts.orgId, comparison);
    progress(`briefing #${briefingId} published`);
  }

  return { baselineRunId: baseline.runId, candidateRunId: candidate.runId, comparison, briefingId };
}

/**
 * Read two runs of one dataset back and compare them. Null when either run is
 * missing, belongs to another org, or belongs to a different dataset.
 * @param orgId - The tenant.
 * @param datasetSlug - The dataset both runs must belong to.
 * @param baselineRunId - The baseline `eval_run.id`.
 * @param candidateRunId - The candidate `eval_run.id`.
 */
export async function getComparison(
  orgId: string,
  datasetSlug: string,
  baselineRunId: number,
  candidateRunId: number,
): Promise<ModelUpgradeComparison | null> {
  const dataset = await getDataset(orgId, datasetSlug);
  if (!dataset) {
    return null;
  }
  const [baseline, candidate] = await Promise.all([getRun(orgId, baselineRunId), getRun(orgId, candidateRunId)]);
  if (!baseline || !candidate || baseline.datasetId !== dataset.id || candidate.datasetId !== dataset.id) {
    return null;
  }
  return compareEvalRuns(dataset, baseline, candidate);
}

/* ------------------------------------------------------------------ */
/* Briefing                                                            */
/* ------------------------------------------------------------------ */

/**
 * Publish the comparison to the agent's team briefings (workspace rollup when
 * the agent has no team), so the people who own the role read it where they
 * read everything else about the team.
 * @param orgId - The tenant.
 * @param c - The comparison to render.
 */
export async function publishComparisonBriefing(orgId: string, c: ModelUpgradeComparison): Promise<number> {
  const [agent] = await db
    .select({ teamSlug: agentSchema.teamSlug, name: agentSchema.name })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, c.agentSlug)))
    .limit(1);
  const [row] = await db
    .insert(briefingSchema)
    .values({
      orgId,
      title: `Model upgrade test — ${agent?.name ?? c.agentSlug} — ${c.baseline.model} → ${c.candidate.model}`.slice(0, 200),
      content: renderComparisonMarkdown(c),
      publishedBy: 'system:model-upgrade-test',
      agentSlug: c.agentSlug,
      teamSlug: agent?.teamSlug ?? null,
    })
    .returning({ id: briefingSchema.id });
  return row!.id;
}

/**
 * The comparison as a scannable document: the verdict first, then the three
 * questions as a table, then every case that changed. Markdown, because that
 * is what `briefing.content` holds and the Briefings page renders.
 * @param c - The comparison.
 */
export function renderComparisonMarkdown(c: ModelUpgradeComparison): string {
  const { baseline: b, candidate: cand, deltas } = c;
  const row = (label: string, bv: string, cv: string, d: Delta, betterWhenLower = false) =>
    `| ${label} | ${bv} | ${cv} | ${fmtDelta(d, betterWhenLower)} |`;

  const lines: string[] = [
    `# Model upgrade test — \`${c.agentSlug}\``,
    '',
    `Dataset **${c.datasetName}** (\`${c.datasetSlug}\`, ${cand.cases} cases). Baseline run #${b.runId} on \`${b.model}\`; candidate run #${cand.runId} on \`${cand.model}\`. Same judge on both sides.`,
    '',
    `**Reading.** ${c.verdict}`,
    '',
    '## The three questions',
    '',
    `| | \`${b.model}\` | \`${cand.model}\` | Δ |`,
    '|---|---|---|---|',
    row('Pass rate — what it finishes', pct(b.passRate), pct(cand.passRate), deltas.passRate),
    row('Mean judge score', num(b.meanScore, 2), num(cand.meanScore, 2), deltas.meanScore),
    row('Model turns per case — retries and loops', num(b.meanTurns, 2), num(cand.meanTurns, 2), deltas.meanTurns, true),
    row('Tool calls per case — handoffs it carries itself', num(b.meanToolCalls, 2), num(cand.meanToolCalls, 2), deltas.meanToolCalls, true),
    row('Median latency', b.medianLatencyMs != null ? `${b.medianLatencyMs} ms` : '—', cand.medianLatencyMs != null ? `${cand.medianLatencyMs} ms` : '—', deltas.medianLatencyMs, true),
    row('Total cost, all cases', usd(b.totalCents), usd(cand.totalCents), deltas.totalCents, true),
    row('**Cost per passed case**', b.costPerPassedCaseCents != null ? `**${usd(b.costPerPassedCaseCents)}**` : '—', cand.costPerPassedCaseCents != null ? `**${usd(cand.costPerPassedCaseCents)}**` : '—', deltas.costPerPassedCase, true),
    '',
    `Tokens — baseline ${fmtInt(b.totalInputTokens)} in / ${fmtInt(b.totalOutputTokens)} out; candidate ${fmtInt(cand.totalInputTokens)} in / ${fmtInt(cand.totalOutputTokens)} out.`,
  ];

  if (b.unpriced || cand.unpriced) {
    lines.push('', `> ⚠ ${[b.unpriced ? `\`${b.model}\`` : null, cand.unpriced ? `\`${cand.model}\`` : null].filter(Boolean).join(' and ')} is not in \`libs/pricing.ts\`; its cost reads as $0.00. Price it before trusting the cost rows.`);
  }

  const changed = c.cases.filter(x => x.flip !== 'same');
  lines.push('', `## Cases that changed (${changed.length} of ${c.cases.length})`, '');
  if (changed.length === 0) {
    lines.push('Every case landed the same verdict on both models.');
  } else {
    lines.push(`| # | Outcome | \`${b.model}\` | \`${cand.model}\` | Input |`, '|---|---|---|---|---|');
    for (const x of changed) {
      lines.push(`| ${x.itemIndex + 1} | ${x.flip === 'gained' ? '✅ gained' : '❌ lost'} | ${sideCell(x.baseline)} | ${sideCell(x.candidate)} | ${oneLine(x.input, 90)} |`);
    }
  }

  lines.push('', '## Every case', '', `| # | \`${b.model}\` | \`${cand.model}\` | Judge on candidate |`, '|---|---|---|---|');
  for (const x of c.cases) {
    lines.push(`| ${x.itemIndex + 1} | ${sideCell(x.baseline)} | ${sideCell(x.candidate)} | ${oneLine(x.candidate?.rationale ?? '', 120)} |`);
  }

  lines.push('', '---', '', `Read the numbers in order: what it finishes, where it stops needing a person or a retry, and what a finished piece of work costs. A higher price per token with a lower cost per passed case is the upgrade working. See \`docs/guides/model-upgrade-test.md\`.`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* Formatting helpers (shared with the dashboard view)                 */
/* ------------------------------------------------------------------ */

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * USD from cents: two decimals, four when the amount is under a cent so a
 * cheap case does not round to $0.00.
 * @param cents - USD cents.
 */
export function usd(cents: number): string {
  const dollars = cents / 100;
  if (dollars === 0) {
    return '$0.00';
  }
  return dollars < 0.01 ? `$${dollars.toFixed(4)}` : `$${dollars.toFixed(2)}`;
}

export function fmtDelta(d: Delta, betterWhenLower = false): string {
  if (d == null) {
    return '—';
  }
  const p = Math.round(d * 100);
  if (p === 0) {
    return '±0%';
  }
  const better = betterWhenLower ? p < 0 : p > 0;
  return `${p > 0 ? '+' : ''}${p}% ${better ? '▲ better' : '▼ worse'}`;
}

function num(n: number | null, digits: number): string {
  return n == null ? '—' : n.toFixed(digits);
}

function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

function sideCell(s: CaseSide | null): string {
  if (!s) {
    return '—';
  }
  const bits = [s.verdict, s.score != null ? s.score.toFixed(2) : null, s.cents != null ? usd(s.cents) : null, s.turns != null ? `${s.turns}t` : null].filter(Boolean);
  return bits.join(' · ');
}

function oneLine(s: string, max: number): string {
  const flat = s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}
