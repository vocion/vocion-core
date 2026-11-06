/**
 * `workflow_start` — start one run of a saved workflow from chat.
 *
 * Before 2026-11-06 only MCP could start a workflow (`workflow_run_start`); a
 * chat agent asked to "enroll this week's ready clinicians" had to do the
 * procedure's steps itself. Now it starts the workflow through the
 * `workflow.run` action (`libs/actions/workflow-run.ts`), down the one
 * proposal path every action takes (`runProposal`): the consent judge reads
 * the run by what it does — its steps, the automations they run, where it
 * waits for a person — against the person's words and the agent's offer they
 * answered. Their word starts it as theirs, with no card; an agent's idea is
 * a card with Start on it.
 *
 * Who has it: an agent in a workspace with active workflows (read per request
 * into `ctx.savedWorkflows`), or one granted `workflows`.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { WORKFLOWS_GRANT } from '@/services/workflows/savedWorkflows';

/**
 * Whether this turn's agent can start workflows.
 * @param ctx - The turn.
 */
export function workflowsEnabled(ctx: Pick<RuntimeContext, 'harnessConfig' | 'userId' | 'savedWorkflows' | 'workflowStep'>): boolean {
  // A workflow's own step does not start workflows: its procedure is fixed.
  if (!ctx.userId || ctx.workflowStep) {
    return false;
  }
  return (ctx.harnessConfig.grantTools ?? []).includes(WORKFLOWS_GRANT) || (ctx.savedWorkflows ?? []).length > 0;
}

export function workflowStartTools(ctx: RuntimeContext): StructuredToolInterface[] {
  if (!workflowsEnabled(ctx)) {
    return [];
  }
  return [
    tool(
      async (raw: unknown) => {
        const args = raw as { workflow: string; input?: Record<string, unknown>; why?: string };
        const { findSavedWorkflow, savedWorkflows } = await import('@/services/workflows/savedWorkflows');
        const all = ctx.savedWorkflows ?? await savedWorkflows(ctx.orgId);
        const wf = findSavedWorkflow(all, args.workflow);
        if (!wf) {
          return `No workflow “${args.workflow}” in this workspace.${all.length > 0 ? ` Its workflows: ${all.map(w => w.slug).join(', ')}.` : ''}`;
        }
        const { runProposal } = await import('./proposeAction');
        const why = args.why?.trim() || `Start the workflow "${wf.name}".`;
        return runProposal(ctx, {
          actionId: 'workflow.run',
          input: { workflow: wf.slug, input: args.input ?? {} },
          confidence: 1,
          rationale: why,
          suggestedDecision: 'approve',
          suggestedDecisionReason: why,
          label: `Start "${wf.name}"`,
        }, { tool: 'workflow_start' });
      },
      {
        name: 'workflow_start',
        description: 'Start one run of a saved workflow (SAVED WORKFLOWS in your instructions): its steps run in order — agent work, automation batches, and approvals where it waits for a person — and it reports in this conversation as it goes. When the person asked for what the workflow does, it starts now as theirs; otherwise it is put to them with a Start button. One call per run.',
        schema: {
          type: 'object',
          properties: {
            workflow: { type: 'string', description: 'The workflow\'s slug or name.' },
            input: { type: 'object', description: 'What the run starts with, by the workflow\'s input names.' },
            why: { type: 'string', maxLength: 300, description: 'In a sentence, what the person asked for that this run does.' },
          },
          required: ['workflow'],
        },
      },
    ),
  ];
}
