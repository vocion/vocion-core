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
 *
 * A null pass rate means no score said pass or fail. When scores did come back
 * on AWS's own scales, the run is not gated and passes, saying so loudly: a
 * dataset graded only by ratings has no verdict to hold a bar against, and
 * failing it on every run would teach people to ignore the gate. When nothing
 * came back at all, it fails, because a run that measured nothing — the silent
 * "found no sessions" shape — must never read as green.
 * @param passRate - The run's pass rate, 0 to 1, or null when nothing gave a verdict.
 * @param datasetThreshold - The bar the dataset named, or null for the default.
 * @param scoresWithoutVerdict - Scores that ran but said neither pass nor fail.
 */
export function evaluatePassGate(
  passRate: number | null,
  datasetThreshold: number | null | undefined,
  scoresWithoutVerdict = 0,
): PassGate {
  const threshold = datasetThreshold ?? DEFAULT_PASS_THRESHOLD;
  const source = datasetThreshold === null || datasetThreshold === undefined ? 'runner default' : 'set by the dataset';

  if (passRate === null) {
    const passed = scoresWithoutVerdict > 0;
    return {
      threshold,
      passed,
      summary: passed
        ? `NOT GATED: ${scoresWithoutVerdict} score${scoresWithoutVerdict === 1 ? '' : 's'} came back on the evaluators' own scales and none said pass or fail, so there is nothing to hold the ${(threshold * 100).toFixed(1)}% bar against (${source})`
        : `FAIL: nothing was scored, so the ${(threshold * 100).toFixed(1)}% bar cannot have been met (${source})`,
    };
  }

  const passed = passRate >= threshold;
  return {
    threshold,
    passed,
    summary: `${passed ? 'PASS' : 'FAIL'}: pass rate ${(passRate * 100).toFixed(1)}% against a ${(threshold * 100).toFixed(1)}% bar (${source})`,
  };
}
