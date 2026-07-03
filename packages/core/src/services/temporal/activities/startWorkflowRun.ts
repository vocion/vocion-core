/**
 * startWorkflowRun activity — lets a Temporal Schedule start a Vocion
 * workflow run on its cron.
 *
 * Runs in the worker process with full deps, so the in-process runLoop
 * (including `agent` steps → the deepagents runtime) executes right here.
 * A run that hits an `approve` step pauses itself in Postgres and this
 * activity returns — the human resumes it from the review queue as usual.
 */

import type { WorkflowRunSummary } from '@/services/WorkflowService';
import { startWorkflow } from '@/services/WorkflowService';

export type StartWorkflowRunActivityInput = {
  orgId: string;
  workflowSlug: string;
  input?: Record<string, unknown>;
};

export async function startWorkflowRunActivity(
  input: StartWorkflowRunActivityInput,
): Promise<Pick<WorkflowRunSummary, 'id' | 'status'>> {
  const run = await startWorkflow({
    orgId: input.orgId,
    slug: input.workflowSlug,
    input: input.input ?? {},
    triggerContext: { trigger: 'schedule', firedAt: new Date().toISOString() },
    invokedBy: 'schedule',
  });
  return { id: run.id, status: run.status };
}
