import type { McpConfig } from '../config';
import { z } from 'zod';
import {
  cancelWorkflow,
  getWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  resumeWorkflow,
  startWorkflow,
} from '@/services/WorkflowService';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function workflowTools(config: McpConfig): ToolModule[] {
  return [
    {
      name: 'workflow_list',
      title: 'List workflows',
      description: 'Return every workflow defined in workspace/<org>/workflows/ with its trigger and step count.',
      inputSchema: {},
      handler: async () => {
        const rows = await listWorkflows(config.orgId);
        return rows.map(w => ({
          slug: w.slug,
          name: w.name,
          description: w.description,
          status: w.status,
          version: w.version,
          trigger: w.trigger,
          steps: (w.steps as unknown as Array<{ name: string; type: string }>).map(s => ({ name: s.name, type: s.type })),
        }));
      },
    },
    {
      name: 'workflow_get',
      title: 'Get full workflow definition',
      description: 'Return the complete manifest for a workflow including all step bodies.',
      inputSchema: { slug: z.string() },
      handler: async (input) => {
        const manifest = await getWorkflow(config.orgId, (input as { slug: string }).slug);
        return manifest ?? { error: `workflow "${(input as { slug: string }).slug}" not found` };
      },
    },
    {
      name: 'workflow_run_start',
      title: 'Start a workflow run',
      description: 'Kick off a workflow manually. If the workflow hits an approve step, the run pauses and returns with status=paused.',
      inputSchema: {
        slug: z.string(),
        input: z.record(z.string(), z.unknown()).default({}),
        trigger_context: z.record(z.string(), z.unknown()).optional(),
      },
      handler: async (input) => {
        const args = input as { slug: string; input: Record<string, unknown>; trigger_context?: Record<string, unknown> };
        return startWorkflow({
          orgId: config.orgId,
          slug: args.slug,
          input: args.input,
          triggerContext: args.trigger_context,
          invokedBy: 'mcp',
        });
      },
    },
    {
      name: 'workflow_run_list',
      title: 'List workflow runs',
      description: 'Return recent workflow_run rows, newest first. Filter by workflow slug or status.',
      inputSchema: {
        workflow_slug: z.string().optional(),
        status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']).optional(),
        limit: z.number().int().positive().max(100).default(20),
      },
      handler: async (input) => {
        const args = input as { workflow_slug?: string; status?: string; limit: number };
        return listWorkflowRuns(config.orgId, {
          workflowSlug: args.workflow_slug,
          status: args.status,
          limit: args.limit,
        });
      },
    },
    {
      name: 'workflow_run_get',
      title: 'Get a workflow run',
      description: 'Full detail for one run including per-step results.',
      inputSchema: { run_id: z.number().int().positive() },
      handler: async (input) => {
        const run = await getWorkflowRun((input as { run_id: number }).run_id, config.orgId);
        return run ?? { error: `workflow_run ${(input as { run_id: number }).run_id} not found` };
      },
    },
    {
      name: 'workflow_run_resume',
      title: 'Resume a paused workflow run',
      description: 'After a human approves the current approve step, continue execution from where it left off.',
      inputSchema: { run_id: z.number().int().positive() },
      handler: async (input) => {
        return resumeWorkflow((input as { run_id: number }).run_id, config.orgId);
      },
    },
    {
      name: 'workflow_run_cancel',
      title: 'Cancel a workflow run',
      description: 'Permanently cancel a running or paused run. Cannot be un-cancelled.',
      inputSchema: {
        run_id: z.number().int().positive(),
        reason: z.string().optional(),
      },
      handler: async (input) => {
        const args = input as { run_id: number; reason?: string };
        return cancelWorkflow(args.run_id, config.orgId, args.reason);
      },
    },
  ];
}
