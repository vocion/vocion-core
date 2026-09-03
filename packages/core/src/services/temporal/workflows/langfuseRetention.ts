/**
 * langfuseRetentionWorkflow — the Workflow a daily Schedule starts to
 * delete traces past their retention period.
 *
 * Runs in the deterministic Workflow sandbox, so no I/O here: the API
 * calls happen in `pruneLangfuseTracesActivity` on the worker.
 *
 * Retention exists as a Vocion job because Langfuse has no environment
 * variable for it, and its own project-level retention is an Enterprise
 * feature on self-hosted instances. See
 * `services/LangfuseRetentionService.ts`.
 */

import type * as activities from '../activities';
import { proxyActivities } from '@temporalio/workflow';

const acts = proxyActivities<typeof activities>({
  // A first run against a never-pruned instance walks a lot of pages.
  // The service caps itself at 200 pages, so this is a ceiling on the
  // work that cap allows, not a target.
  startToCloseTimeout: '1 hour',
  retry: {
    initialInterval: '30s',
    backoffCoefficient: 2,
    maximumInterval: '10 minutes',
    // Deleting traces is idempotent — an id already gone stays gone —
    // so retrying a partial run is safe. Three attempts, then wait for
    // tomorrow rather than hammering a struggling instance.
    maximumAttempts: 3,
  },
});

export async function langfuseRetentionWorkflow() {
  return acts.pruneLangfuseTracesActivity();
}
