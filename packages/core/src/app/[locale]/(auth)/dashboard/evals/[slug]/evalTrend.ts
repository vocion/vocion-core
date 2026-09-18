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
  color: string;
  /** Evaluator lines are drawn lighter, so the pass rate stays the headline. */
  dashed: boolean;
  points: EvalTrendPoint[];
};

/**
 * Colours are assigned by position in the provider list, not by id, so a
 * third provider is a new entry here and nothing else.
 */
const SERIES_COLORS = ['var(--brand-pass, #10b981)', 'var(--brand-teal, #14b8a6)', 'var(--brand-accent, #f59e0b)', '#8b5cf6'];

/**
 * Group the points into one line per provider, in the order the providers
 * were given so colours stay put between renders.
 * @param points - Every plottable run.
 * @param providers - Who grades this dataset, in display order.
 */
export function buildSeries(points: EvalTrendPoint[], providers: Array<{ id: string; label: string }>): Series[] {
  const series: Series[] = [];
  for (const provider of providers) {
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
        color: SERIES_COLORS[series.length % SERIES_COLORS.length]!,
        dashed: false,
        points: passRatePoints,
      });
    }
    // One line per evaluator underneath the grader that ran it, named so the
    // legend reads "AgentCore · trajectory" rather than two unlabelled lines.
    for (const evaluatorSlug of evaluatorsIn(mine)) {
      series.push({
        provider: provider.id,
        key: `${provider.id}:${evaluatorSlug}`,
        evaluatorSlug,
        label: `${provider.label} · ${evaluatorSlug}`,
        color: SERIES_COLORS[series.length % SERIES_COLORS.length]!,
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
