/**
 * WHAT A WORKER RUN COST: one figure (run 2, 2026-10-01).
 *
 * Every factory feature read "Two cost records disagree: the tasks say $3.52,
 * the runs charged $7.04". The task's figure was the worker's own final
 * account (Claude's `total_cost_usd`); the run's was the sum of the usage its
 * heartbeats reported, and the same final usage rode on two (or three)
 * heartbeats in flight at once, so it was added twice (run #440: 704 = 2 x 352;
 * #439: 492 = 3 x 164; #441: 378 = 2 x 189). The worker's final account of the
 * whole run, sent with its result, is the run's cost; the heartbeat sum is
 * what is known while it runs, and what stands when no final account came.
 */

const usd = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * The worker's own final account of a run, in cents, from its result
 * (`token_usage.cost_usd`, or `cost_usd` on a failed run's kept result), or null.
 * @param result - The run's result as the worker sent it.
 */
export function reportedRunCents(result: unknown): number | null {
  const r = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : null;
  const usage = r?.token_usage && typeof r.token_usage === 'object' ? r.token_usage as Record<string, unknown> : null;
  const total = usd(usage?.cost_usd) ?? usd(r?.cost_usd);
  return total === null ? null : Math.round(total * 100);
}

/**
 * The run's cost: its final account when the worker sent one, else what its heartbeats added up to.
 * @param run - The run.
 * @param run.cents - What its heartbeats reported, summed.
 * @param run.result - Its result.
 */
export function runCostCents(run: { cents: number | null | undefined; result?: unknown }): number | null {
  return reportedRunCents(run.result) ?? run.cents ?? null;
}
