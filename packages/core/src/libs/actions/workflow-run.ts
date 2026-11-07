/**
 * workflow.run — start one run of a saved workflow from chat
 * (`workflow_start`, `services/agents/tools/workflowStart.ts`).
 *
 * Read by what it does: its review card lists the workflow's steps — the
 * agent work each declares, the automations its `routine.run` steps run and
 * what they change, where it waits for a person — so the consent judge reads
 * a run as that, never as a workflow's name (`consentDecision`). The person's
 * own words, or their reply accepting the agent's offer, start it as theirs;
 * an agent's idea waits for a person on its card (`approvalRequired`), since a
 * run does work Undo cannot take back.
 *
 * The run is started as the person who decided it, from the conversation it
 * was asked in (`triggerContext.conversationId`), so the batches it starts
 * report live there and its browser steps work in that person's browser.
 */

import type { Action } from './types';
import { z } from 'zod';

const workflowRunInput = z.object({
  /** The workflow's slug. */
  workflow: z.string().min(1).max(120),
  /** What the run starts with, by the workflow's input names. */
  input: z.record(z.string(), z.unknown()).default({}),
});

export type WorkflowRunInput = z.infer<typeof workflowRunInput>;

/** How many steps the card names. */
const STEPS_ON_CARD = 8;

export const workflowRunAction: Action<typeof workflowRunInput> = {
  id: 'workflow.run',
  name: 'Start a workflow',
  description: 'Start one run of a saved workflow: its steps run in order, each as the workflow says — agent work, automation batches, and the approvals where it waits for a person.',
  inputSchema: workflowRunInput,
  grant: 'run_workflow',
  external: false,
  approvalRequired: true,
  async precheck(ctx, input) {
    const { getWorkflow } = await import('@/services/WorkflowService');
    const wf = await getWorkflow(ctx.orgId, input.workflow);
    if (!wf) {
      return `No workflow "${input.workflow}" in this workspace.`;
    }
    if (wf.status !== 'active') {
      return `The workflow "${wf.name}" is ${wf.status}; it cannot start.`;
    }
    return undefined;
  },
  async reviewCard(ctx, input) {
    const [{ getWorkflow }, { savedWorkflow, routineLookup }, { listRoutines }] = await Promise.all([
      import('@/services/WorkflowService'),
      import('@/services/workflows/savedWorkflows'),
      import('@/services/routines/routineReads'),
    ]);
    const wf = await getWorkflow(ctx.orgId, input.workflow);
    if (!wf) {
      return { title: `Start the workflow ${input.workflow}`, fields: [] };
    }
    const routines = await listRoutines(ctx.orgId).catch(() => []);
    const saved = savedWorkflow({ slug: wf.slug, name: wf.name, description: wf.description ?? null, ownerAgentSlug: wf.agent ?? null, steps: wf.steps, inputSchema: wf.inputSchema ?? null }, routineLookup(routines));
    const given = Object.entries(input.input ?? {}).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');
    return {
      title: `Start "${wf.name}"`,
      system: 'Workflow',
      ...(saved.description ? { summary: saved.description } : {}),
      fields: [
        ...(given.length > 0 ? [{ label: 'Starts with', value: given.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`.slice(0, 160)).join('; ') }] : []),
        ...saved.steps.slice(0, STEPS_ON_CARD).map((s, i) => ({ label: `Step ${i + 1}`, value: s })),
      ],
      nextAction: 'Approving starts the run now. It reports in this conversation as it goes and stops for a person wherever its steps say.',
      verbs: { approve: 'Start', reject: 'Not now' },
    };
  },
  async execute(ctx, input) {
    const [{ launchWorkflow, personWhoStarted }] = await Promise.all([import('@/services/WorkflowService')]);
    // The person whose decision this is: who approved the card, else whose words started it.
    const person = [ctx.reviewedBy, ctx.origin?.byPerson ? ctx.origin.userId : null, ctx.invokedBy].map(p => personWhoStarted(p)).find(Boolean) ?? null;
    const conversationId = typeof ctx.origin?.conversationId === 'number' ? ctx.origin.conversationId : null;
    const run = await launchWorkflow({
      orgId: ctx.orgId,
      slug: input.workflow,
      input: input.input ?? {},
      triggerContext: { trigger: 'chat', ...(conversationId ? { conversationId } : {}) },
      invokedBy: person ?? ctx.invokedBy ?? 'system',
    });
    return {
      workflowRunId: run.id,
      workflow: input.workflow,
      runLabel: run.runLabel,
      startedBy: person,
      url: `/dashboard/workflows/${encodeURIComponent(input.workflow)}/runs/${run.id}`,
      advice: `Started ${run.runLabel ?? `the workflow ${input.workflow}`}: it reports in this conversation as it goes.`,
    };
  },
};
