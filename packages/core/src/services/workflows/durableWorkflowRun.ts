import { defineDurable } from '@/libs/durable';
import { MAX_WAIT_SECONDS } from '@/libs/durable/types';

/**
 * A YAML workflow run, durable (backlog 054). The run advances its steps as
 * one recorded step until it pauses (an approve or an ask) or ends, then
 * waits on its own mailbox for the resume that `resumeWorkflow` sends. The
 * wait survives restarts and deploys; nothing polls, nothing re-enters.
 */
export const WORKFLOW_RUN = 'vocion.workflow-run';

/** Paused runs wait this long for a person before the run reads as timed out. */
const PAUSE_LIMIT_SECONDS = 60 * 60 * 24 * 90;

export type WorkflowRunInput = { runId: number };

export const workflowRunDefinition = defineDurable<WorkflowRunInput, { status: string }>({
  name: WORKFLOW_RUN,
  async run(ctx, { runId }) {
    for (let segment = 0; ; segment++) {
      const after = await ctx.step(`advance-${segment}`, async () => {
        const { advanceWorkflowRun } = await import('@/services/WorkflowService');
        const s = await advanceWorkflowRun(runId);
        return { status: s.status, pauseReason: s.pauseReason };
      });
      await ctx.setStatus({ stage: after.status, line: after.pauseReason ?? after.status });
      if (after.status !== 'paused') {
        return { status: after.status };
      }
      let resumed: { resumedAt: string } | null = null;
      for (let waited = 0; !resumed && waited < PAUSE_LIMIT_SECONDS; waited += MAX_WAIT_SECONDS) {
        resumed = await ctx.waitFor<{ resumedAt: string }>('resume', MAX_WAIT_SECONDS);
      }
      if (!resumed) {
        return { status: 'paused' };
      }
    }
  },
});
