import { DEFAULT_PASS_THRESHOLD } from './passGate';

/**
 * The two ways an eval run can go wrong, as a filter on a dataset's run list.
 *
 * They are different problems with different owners, which is why they are
 * separate filters rather than one "failed" bucket:
 *
 * - `errored` — the run itself broke (status `failed`): the agent, the grader
 *   or the infrastructure fell over, and there is no score at all. Someone has
 *   to fix the pipeline.
 * - `below_threshold` — the run finished and was scored, but its pass rate is
 *   under the dataset's bar. The agent got worse, or the cases got harder.
 *   Someone has to look at the answers.
 *
 * A running run is neither: it has not failed yet.
 */
export type RunOutcomeFilter = 'errored' | 'below_threshold';

export const RUN_OUTCOME_FILTERS: ReadonlyArray<{ id: RunOutcomeFilter; label: string }> = [
  { id: 'errored', label: 'Errored' },
  { id: 'below_threshold', label: 'Below threshold' },
];

/**
 * Read the `outcome` query value. Missing means every run; anything else that
 * is not a known filter is null, for the caller to refuse (the API) or ignore
 * (the page).
 * @param value - The raw query value.
 */
export function parseRunOutcome(value: string | null | undefined): { ok: true; outcome: RunOutcomeFilter | undefined } | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, outcome: undefined };
  }
  if (RUN_OUTCOME_FILTERS.some(filter => filter.id === value)) {
    return { ok: true, outcome: value as RunOutcomeFilter };
  }
  return { ok: false, message: `\`outcome\` must be one of: ${RUN_OUTCOME_FILTERS.map(filter => filter.id).join(', ')}.` };
}

/**
 * The pass rate a dataset's runs are held to: its own, or the runner's
 * default — the same bar the runner gates on (`evaluatePassGate`), so the page
 * never calls a run below threshold that the runner passed.
 * @param datasetThreshold - The dataset's `passThreshold`, or null.
 */
export function passThresholdFor(datasetThreshold: number | null | undefined): number {
  return datasetThreshold ?? DEFAULT_PASS_THRESHOLD;
}
