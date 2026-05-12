/**
 * vocionWorkflow — the Temporal Workflow function (Phase H.3).
 *
 * Runs INSIDE the deterministic Workflow sandbox. Per Temporal rules
 * this file MUST NOT import anything that does I/O at module load:
 *   - no `db`, no `fetch`, no Node `fs`
 *   - no Date.now() or Math.random() at top level
 *   - no native modules
 *
 * Everything side-effecty goes through Activities, which the worker
 * runs in the host process (where Node imports + I/O are fine).
 *
 * Loop semantics mirror the old in-process `runLoop()`:
 *   skill → executeSkillActivity → recordStepCompleted
 *   approve → recordApprovalRequested → await Signal → branch
 *   action → executeActionActivity → recordStepCompleted
 * Any Activity failure (after retries) → recordStepFailed → end-with-fail.
 *
 * The Signal/Wait pattern for `approve` is the headline difference vs.
 * the old engine: pause-resume is no longer Postgres state, it's an
 * in-Workflow await. Pause survives crashes because Temporal Event
 * History is the source of truth.
 */

import type * as activities from '../activities';
import type { ApprovalPayload } from '../signals/approval';
import { condition, proxyActivities, setHandler } from '@temporalio/workflow';
import { approvalSignal } from '../signals/approval';

const acts = proxyActivities<typeof activities>({
  startToCloseTimeout: '15 minutes',
  retry: {
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    maximumAttempts: 3,
  },
});

/** Persisted shape mirrors `workflow.steps[]` JSONB in Postgres. */
export type WorkflowStepSpec
  = | { name: string; type: 'skill'; skill: string; input?: Record<string, unknown> }
    | { name: string; type: 'approve'; prompt?: string }
    | { name: string; type: 'action'; actionType: string; input?: Record<string, unknown> };

export type VocionWorkflowInput = {
  runId: number;
  orgId: string;
  workflowSlug: string;
  steps: WorkflowStepSpec[];
  triggerContext: Record<string, unknown>;
};

export async function vocionWorkflow(input: VocionWorkflowInput): Promise<{ status: 'completed' | 'cancelled' | 'failed' }> {
  // Single-slot Signal buffer. Reset between approve steps so a
  // stale signal from an earlier step can't auto-approve the next.
  let approval: ApprovalPayload | null = null;
  setHandler(approvalSignal, (payload) => {
    approval = payload;
  });

  for (const step of input.steps) {
    await acts.recordStepStartedActivity({
      runId: input.runId,
      stepName: step.name,
      type: step.type,
    });

    try {
      if (step.type === 'skill') {
        const r = await acts.executeSkillActivity({
          orgId: input.orgId,
          skillSlug: step.skill,
          input: step.input ?? {},
          runId: input.runId,
          stepName: step.name,
        });
        await acts.recordStepCompletedActivity({
          runId: input.runId,
          stepName: step.name,
          output: r.output,
          skillRunId: r.skillRunId,
        });
      } else if (step.type === 'approve') {
        await acts.recordApprovalRequestedActivity({
          runId: input.runId,
          stepName: step.name,
        });
        approval = null;
        // Block until a Signal arrives. Temporal persists this wait
        // in event history; crashes don't lose the pause.
        await condition(() => approval !== null);
        const decision = approval!;
        if (!decision.approved) {
          await acts.recordStepFailedActivity({
            runId: input.runId,
            stepName: step.name,
            error: `rejected${decision.note ? `: ${decision.note}` : ''}${decision.reviewer ? ` by ${decision.reviewer}` : ''}`,
          });
          await acts.recordWorkflowCompletedActivity({
            runId: input.runId,
            status: 'cancelled',
            error: 'Approval rejected',
          });
          return { status: 'cancelled' };
        }
        await acts.recordStepCompletedActivity({
          runId: input.runId,
          stepName: step.name,
          output: decision,
        });
      } else {
        // action step
        const r = await acts.executeActionActivity({
          orgId: input.orgId,
          actionType: step.actionType,
          input: step.input ?? {},
          runId: input.runId,
          stepName: step.name,
        });
        await acts.recordStepCompletedActivity({
          runId: input.runId,
          stepName: step.name,
          output: r,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await acts.recordStepFailedActivity({
        runId: input.runId,
        stepName: step.name,
        error: message,
      });
      await acts.recordWorkflowCompletedActivity({
        runId: input.runId,
        status: 'failed',
        error: message,
      });
      return { status: 'failed' };
    }
  }

  await acts.recordWorkflowCompletedActivity({
    runId: input.runId,
    status: 'completed',
  });
  return { status: 'completed' };
}
