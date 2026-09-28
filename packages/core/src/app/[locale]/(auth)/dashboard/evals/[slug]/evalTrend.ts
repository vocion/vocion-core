/**
 * The arithmetic behind the eval trend line.
 *
 * Separate from the chart component so each half can be read on its own:
 * these are the rules about what the line means, the component is the drawing.
 * It also leaves the chart file exporting nothing but a component, which is
 * what fast refresh needs.
 */

/** One finished run, as the trend line needs it. */
export type EvalTrendPoint = {
  runId: number;
  provider: string;
  /** ISO timestamp — the x position. */
  startedAt: string;
  /** 0–1. Runs without a pass rate are not plotted. */
  passRate: number;
  datasetVersion: number | null;
  /**
   * Which evaluator this point is, or null for the run's own pass rate.
   *
   * A pass rate and the evaluators underneath it are different questions —
   * "is the dataset passing" against "which part of it moved" — and an agent
   * whose answers improve while its tool use rots holds the first one flat.
   */
  evaluatorSlug?: string | null;
};

export type Series = {
  provider: string;
  /** Unique per line: a provider has one line of its own and one per evaluator. */
  key: string;
  /** Null on the provider's own pass-rate line. */
  evaluatorSlug: string | null;
  label: string;
  /** Which categorical colour the line wears; see `SERIES_SLOT_CLASSES` in the chart. */
  colorSlot: number;
  /** Evaluator lines are drawn lighter, so the pass rate stays the headline. */
  dashed: boolean;
  points: EvalTrendPoint[];
};

/**
 * How many categorical colours the chart has (the validated palette, minus
 * red, which is kept for errored runs).
 */
export const SERIES_SLOT_COUNT = 7;

/**
 * A grader's colour follows the grader, never its position in a list: Vocion
 * is always blue and AgentCore always orange, whichever of them has runs in
 * the period on screen. A grader added later takes the next free slot.
 */
const PROVIDER_SLOTS: Record<string, number> = { vocion: 0, agentcore: 1 };

/**
 * The colour slot for a grader's own line.
 * @param providerId - The grader.
 * @param providerIndex - Its position in the provider list, for a grader with no fixed slot.
 */
function providerSlot(providerId: string, providerIndex: number): number {
  return PROVIDER_SLOTS[providerId] ?? (2 + providerIndex) % SERIES_SLOT_COUNT;
}

/**
 * Group the points into one line per provider, in the order the providers
 * were given so colours stay put between renders.
 * @param points - Every plottable run.
 * @param providers - Who grades this dataset, in display order.
 */
export function buildSeries(points: EvalTrendPoint[], providers: Array<{ id: string; label: string }>): Series[] {
  const series: Series[] = [];
  for (const [providerIndex, provider] of providers.entries()) {
    const mine = points.filter(point => point.provider === provider.id);
    if (mine.length === 0) {
      continue;
    }
    const passRatePoints = sortedByTime(mine.filter(point => !point.evaluatorSlug));
    if (passRatePoints.length > 0) {
      series.push({
        provider: provider.id,
        key: provider.id,
        evaluatorSlug: null,
        label: provider.label,
        colorSlot: providerSlot(provider.id, providerIndex),
        dashed: false,
        points: passRatePoints,
      });
    }
    // One line per evaluator underneath the grader that ran it, named so the
    // legend reads "AgentCore · trajectory" rather than two unlabelled lines.
    for (const [evaluatorIndex, evaluatorSlug] of evaluatorsIn(mine).entries()) {
      series.push({
        provider: provider.id,
        key: `${provider.id}:${evaluatorSlug}`,
        evaluatorSlug,
        label: `${provider.label} · ${evaluatorSlug}`,
        colorSlot: evaluatorIndex % SERIES_SLOT_COUNT,
        dashed: true,
        points: sortedByTime(mine.filter(point => point.evaluatorSlug === evaluatorSlug)),
      });
    }
  }
  return series;
}

/**
 * Points oldest first, so a line is drawn in the order time ran.
 * @param points - The points on one line.
 */
function sortedByTime(points: EvalTrendPoint[]): EvalTrendPoint[] {
  return [...points].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

/**
 * Every evaluator that scored these runs, alphabetically so the legend holds
 * still between renders.
 * @param points - One provider's points.
 */
function evaluatorsIn(points: EvalTrendPoint[]): string[] {
  const slugs = new Set<string>();
  for (const point of points) {
    if (point.evaluatorSlug) {
      slugs.add(point.evaluatorSlug);
    }
  }
  return [...slugs].sort();
}

/**
 * Where the dataset changed underneath the numbers.
 *
 * A pass rate before an edit to the cases and one after it are measurements of
 * two different tests. Drawing the boundary is what stops the line being read
 * as the agent improving when the questions simply got easier.
 * @param points - Every plottable run, any provider.
 */
export function versionBoundaries(points: EvalTrendPoint[]): Array<{ at: number; version: number }> {
  // One boundary per run, not one per line through it: the evaluator points
  // repeat the same run at the same moment, and counting them again would draw
  // the same edit several times over.
  const runs = new Map<number, EvalTrendPoint>();
  for (const point of points) {
    if (!runs.has(point.runId)) {
      runs.set(point.runId, point);
    }
  }
  const ordered = [...runs.values()].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const boundaries: Array<{ at: number; version: number }> = [];
  let previous: number | null = null;
  for (const point of ordered) {
    const version = point.datasetVersion;
    if (version === null) {
      continue;
    }
    if (previous !== null && version !== previous) {
      boundaries.push({ at: Date.parse(point.startedAt), version });
    }
    previous = version;
  }
  return boundaries;
}

/**
 * The lines the main chart draws: each grader's own pass rate, and nothing
 * per evaluator — seven overlapping lines on one axis is a picture nobody can
 * read, and the per-evaluator numbers live in the breakdown table instead.
 *
 * The one exception is a grader with no pass rate at all (AgentCore grading
 * only on its own rating scales): its evaluator lines stay, because without
 * them that grader would vanish from the chart entirely.
 * @param series - Everything `buildSeries` built.
 */
export function chartSeries(series: Series[]): Series[] {
  const withOwnLine = new Set(series.filter(line => line.evaluatorSlug === null).map(line => line.provider));
  return series.filter(line => line.evaluatorSlug === null || !withOwnLine.has(line.provider));
}

export type EvaluatorSummary = {
  provider: string;
  providerLabel: string;
  evaluatorSlug: string;
  /** The newest run's score, 0–1. */
  latest: number;
  /** Mean over the period, 0–1. */
  average: number;
  /** How the newest score sits against the period's mean. */
  direction: 'up' | 'down' | 'flat';
  runs: number;
};

/** How far from the mean, 0–1, the latest score must sit to count as moving. */
const MOVEMENT_THRESHOLD = 0.02;

/**
 * One row per evaluator for the breakdown table: where its score is now, what
 * it averaged over the period, and which way the newest run moved it.
 *
 * Latest against the mean rather than against the run before, because one
 * noisy run would otherwise flip the arrow on every page load.
 * @param points - Every plottable point; only evaluator points are read.
 * @param providers - Who grades this dataset, in display order.
 */
export function summariseEvaluators(points: EvalTrendPoint[], providers: Array<{ id: string; label: string }>): EvaluatorSummary[] {
  const rows: EvaluatorSummary[] = [];
  for (const line of buildSeries(points, providers)) {
    if (line.evaluatorSlug === null || line.points.length === 0) {
      continue;
    }
    const latest = line.points.at(-1)!.passRate;
    const average = line.points.reduce((sum, point) => sum + point.passRate, 0) / line.points.length;
    const gap = latest - average;
    rows.push({
      provider: line.provider,
      providerLabel: providers.find(provider => provider.id === line.provider)?.label ?? line.provider,
      evaluatorSlug: line.evaluatorSlug,
      latest,
      average,
      direction: gap > MOVEMENT_THRESHOLD ? 'up' : gap < -MOVEMENT_THRESHOLD ? 'down' : 'flat',
      runs: line.points.length,
    });
  }
  return rows;
}
