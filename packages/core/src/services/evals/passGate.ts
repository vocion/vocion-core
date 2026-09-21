/**
 * Whether a run passed, for the exit code `eval:run` hands a pipeline.
 *
 * Small enough to inline in the script, and deliberately not: an exit code
 * that decides whether a deploy goes ahead is worth a test, and a script is
 * the one place nothing tests. The rule it holds is that the dataset's own
 * bar wins over the runner's, because the right bar differs — a handful of
 * deterministic cases can be held to nearly all of them passing, while a set
 * spread across a dozen live websites loses one whenever a site redesigns a
 * page, and a gate that reddens a build for that is a gate people learn to
 * ignore.
 */

/**
 * The bar a dataset that names none of its own is held to.
 *
 * Unchanged from the number the runner has always compiled in, so every
 * dataset written before `pass_threshold` existed passes and fails exactly
 * as it did.
 */
export const DEFAULT_PASS_THRESHOLD = 0.8;

export type PassGate = {
  /** The bar actually applied. */
  threshold: number;
  /** True when the run reached it. */
  passed: boolean;
  /** One sentence for the console, naming the bar and where it came from. */
  summary: string;
};

/**
 * Decide a run's verdict against its dataset's bar.
 *
 * A pass rate exactly on the bar passes: a threshold reads as "this much is
 * good enough", and failing the run that hit it precisely would make the
 * number mean something nobody wrote down.
 * @param passRate - The run's pass rate, 0 to 1.
 * @param datasetThreshold - The bar the dataset named, or null for the default.
 */
export function evaluatePassGate(passRate: number, datasetThreshold: number | null | undefined): PassGate {
  const threshold = datasetThreshold ?? DEFAULT_PASS_THRESHOLD;
  const passed = passRate >= threshold;
  const source = datasetThreshold === null || datasetThreshold === undefined ? 'runner default' : 'set by the dataset';
  return {
    threshold,
    passed,
    summary: `${passed ? 'PASS' : 'FAIL'}: pass rate ${(passRate * 100).toFixed(1)}% against a ${(threshold * 100).toFixed(1)}% bar (${source})`,
  };
}
