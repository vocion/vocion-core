/**
 * Langfuse retention activity — the host-side wrapper that lets a
 * Temporal Schedule drive the trace pruner.
 *
 * Runs in the worker process, where network access is allowed.
 * `langfuseRetentionWorkflow` calls it through `proxyActivities`; the
 * daily Schedule starts that workflow.
 */

import type { PruneResult } from '@/services/LangfuseRetentionService';
import { pruneExpiredTraces } from '@/services/LangfuseRetentionService';

/**
 * Delete traces past `LANGFUSE_RETENTION_DAYS`. Returns null when
 * tracing is off or no retention period is configured.
 */
export async function pruneLangfuseTracesActivity(): Promise<PruneResult | null> {
  return pruneExpiredTraces();
}
