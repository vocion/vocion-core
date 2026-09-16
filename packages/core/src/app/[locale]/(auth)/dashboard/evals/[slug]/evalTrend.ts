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
};

export type Series = {
  provider: string;
  label: string;
  color: string;
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
    const mine = points
      .filter(point => point.provider === provider.id)
      .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    if (mine.length === 0) {
      continue;
    }
    series.push({
      provider: provider.id,
      label: provider.label,
      color: SERIES_COLORS[series.length % SERIES_COLORS.length]!,
      points: mine,
    });
  }
  return series;
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
  const ordered = [...points].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
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
