/**
 * Reach the daily usage review without compiling it into every route.
 *
 * Turbopack compiles everything a route reaches into that route, `await
 * import()` targets included, and the places that start the review — the
 * agent tool registry, the job catalog, the built-in jobs, the `org.change`
 * action — are reached by nearly every route. Importing the review from them
 * put its modules into about two hundred routes and the production build past
 * its memory budget (`BUILD_PEAK_RSS_BUDGET_MB`, .github/workflows/CI.yml).
 *
 * So they reach it through here, the way the sign-in path reaches the event
 * bus (`libs/eventBridge.ts`): `instrumentation.ts` hands the review over when
 * the Node server starts, before it serves a request or runs a job. Outside
 * Next (vitest, the `tsx` scripts, the worker) nothing hands it over, and this
 * imports it directly; the import is hidden from Turbopack.
 */

import type * as UsageReviewApi from '@/services/usageReview/api';

export type UsageReview = typeof UsageReviewApi;

const KEY = Symbol.for('vocion.usageReview');

type WithReview = { [KEY]?: UsageReview };

/**
 * Hand the review over. Called once, by `instrumentation.ts`.
 * @param api - `services/usageReview/api.ts`.
 */
export function provideUsageReview(api: UsageReview): void {
  (globalThis as WithReview)[KEY] = api;
}

/** The review's entry points, without importing them where this is imported. */
export async function usageReview(): Promise<UsageReview> {
  const provided = (globalThis as WithReview)[KEY];
  if (provided) {
    return provided;
  }
  return import(/* turbopackIgnore: true */ /* webpackIgnore: true */ '@/services/usageReview/api');
}
