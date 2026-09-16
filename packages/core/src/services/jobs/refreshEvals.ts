/**
 * `refresh-evals` — the scheduled counterpart to the refresh button.
 *
 * An automation carries the cadence, the way every other recurring thing in
 * this workspace does:
 *
 * ```yaml
 * automations:
 *   - slug: nightly-evals
 *     when: { schedule: '0 6 * * *' }
 *     do:   { job: refresh-evals }
 * ```
 *
 * With no `input.dataset`, every dataset in the workspace is refreshed, which
 * is what a nightly cadence usually wants. Naming one or a few narrows it,
 * for a dataset that is expensive or slow enough to deserve its own schedule.
 *
 * Each dataset is started as its own workflow rather than run here. The job
 * returns as soon as they are accepted, so an automation firing at six in the
 * morning does not sit holding an activity open for however long the slowest
 * dataset takes, and one dataset failing to start does not cancel the rest.
 */

import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { evalDatasetSchema } from '@/models/Schema';
import { startEvalRefresh } from '@/services/evals/refresh';

export const REFRESH_EVALS_JOB = 'refresh-evals';

/** What the automation asked for. */
type RefreshEvalsInput = {
  /** One slug, or several. Omitted means every dataset in the workspace. */
  dataset?: string | string[];
  /** Grade with only these providers. Omitted means every available one. */
  providers?: string[];
  concurrency?: number;
};

/** What one dataset's refresh did. */
type RefreshEvalsOutcome = {
  datasetSlug: string;
  runId: number | null;
  runGroupId: string | null;
  error: string | null;
};

/**
 * Which datasets this firing covers.
 * @param orgId - Whose workspace.
 * @param requested - What the automation named, if anything.
 */
async function datasetSlugsFor(orgId: string, requested: RefreshEvalsInput['dataset']): Promise<string[]> {
  if (typeof requested === 'string') {
    return [requested];
  }
  if (Array.isArray(requested) && requested.length > 0) {
    return requested;
  }
  const rows = await db
    .select({ slug: evalDatasetSchema.slug })
    .from(evalDatasetSchema)
    .where(eq(evalDatasetSchema.orgId, orgId));
  return rows.map(row => row.slug);
}

/**
 * Start a refresh for each dataset this automation covers.
 *
 * A dataset that cannot be started is recorded and the rest go ahead. The
 * whole point of a nightly refresh is the history it builds; losing every
 * dataset because one of them is misconfigured would put a hole in all of
 * them.
 * @param orgId - Whose workspace.
 * @param input - What the automation asked for.
 */
export async function runRefreshEvalsJob(orgId: string, input: Record<string, unknown>): Promise<{
  started: number;
  failed: number;
  datasets: RefreshEvalsOutcome[];
}> {
  const options = input as RefreshEvalsInput;
  const slugs = await datasetSlugsFor(orgId, options.dataset);

  const outcomes: RefreshEvalsOutcome[] = [];
  for (const datasetSlug of slugs) {
    try {
      const started = await startEvalRefresh({
        orgId,
        datasetSlug,
        providerIds: options.providers,
        concurrency: options.concurrency,
      });
      outcomes.push({
        datasetSlug,
        runId: started.runId,
        runGroupId: started.runGroupId,
        error: null,
      });
    } catch (error) {
      const message = (error as Error).message ?? 'could not start the refresh';
      console.error(`[evals] scheduled refresh could not start ${datasetSlug} for ${orgId}`, error);
      outcomes.push({ datasetSlug, runId: null, runGroupId: null, error: message });
    }
  }

  return {
    started: outcomes.filter(outcome => outcome.error === null).length,
    failed: outcomes.filter(outcome => outcome.error !== null).length,
    datasets: outcomes,
  };
}
