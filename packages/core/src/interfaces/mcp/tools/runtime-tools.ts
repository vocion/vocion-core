import type { McpConfig } from '../config';
import { z } from 'zod';
import { approveSkillRun, executeSkill, getSkillRun, listSkillRuns, rejectSkillRun } from '@/services/SkillService';

/**
 * Runtime tools: execute skills and manage their review queue from MCP.
 *
 * `run_skill` actually hits OpenAI — keep an eye on cost when an LLM-authored
 * caller starts chaining runs in a loop.
 */

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

export function runtimeTools(config: McpConfig): ToolModule[] {
  return [
    runOperationTool(config, 'runtime_run_operation', 'Execute an operation'),
    // Back-compat alias. External MCP consumers (e.g. Claude Code) may
    // have `runtime_run_skill` hardcoded. Drop in a future major.
    runOperationTool(
      config,
      'runtime_run_skill',
      '[deprecated] alias of runtime_run_operation — use the new name in new integrations',
    ),
    listRunsTool(config),
    approveTool(config),
    rejectTool(config),
  ];
}

function runOperationTool(config: McpConfig, name: string, title: string): ToolModule {
  return {
    name,
    title,
    description: 'Run an operation with the given input. Returns run_id, output, and Langfuse trace id. Runs with requiresApproval=true will return status=pending; others auto-complete.',
    inputSchema: {
      // Accept the new `operation_slug` and keep `skill_slug` as an
      // alias for v0.1 callers.
      operation_slug: z.string().optional().describe('operation slug to run (e.g. discovery_summary)'),
      skill_slug: z.string().optional().describe('[deprecated] alias of operation_slug'),
      input: z.record(z.string(), z.unknown()).describe('variables matching the operation inputSchema'),
      user_id: z.string().optional().describe('who triggered the run; stored on the run row'),
    },
    handler: async (input) => {
      const { operation_slug, skill_slug, input: opInput, user_id } = input as {
        operation_slug?: string;
        skill_slug?: string;
        input: Record<string, unknown>;
        user_id?: string;
      };
      const slug = operation_slug ?? skill_slug;
      if (!slug) {
        throw new Error('one of `operation_slug` or `skill_slug` is required');
      }
      return executeSkill({
        orgId: config.orgId,
        skillSlug: slug,
        input: opInput,
        userId: user_id ?? 'mcp',
      });
    },
  };
}

function listRunsTool(config: McpConfig): ToolModule {
  return {
    name: 'runtime_list_runs',
    title: 'List recent skill runs',
    description: 'Return recent skill_run rows for this org. Filter by skill slug or status (pending/approved/rejected/auto).',
    inputSchema: {
      skill_slug: z.string().optional(),
      status: z.enum(['pending', 'approved', 'rejected', 'auto']).optional(),
      limit: z.number().int().positive().max(200).default(20),
    },
    handler: async (input) => {
      const { skill_slug, status, limit } = input as {
        skill_slug?: string;
        status?: 'pending' | 'approved' | 'rejected' | 'auto';
        limit: number;
      };
      const runs = await listSkillRuns({
        orgId: config.orgId,
        skillSlug: skill_slug,
        status,
        limit,
      });
      return runs.map(r => ({
        id: r.id,
        skillId: r.skillId,
        status: r.status,
        input: r.input,
        output: r.output ? r.output.slice(0, 500) : null,
        truncated: !!(r.output && r.output.length > 500),
        contextSha: r.contextSha,
        langfuseTraceId: r.langfuseTraceId,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt,
      }));
    },
  };
}

function approveTool(config: McpConfig): ToolModule {
  return {
    name: 'runtime_approve_draft',
    title: 'Approve a pending skill run',
    description: 'Mark a skill_run as approved. Only works on rows with status=pending.',
    inputSchema: {
      run_id: z.number().int().positive(),
      reviewed_by: z.string().default('mcp'),
    },
    handler: async (input) => {
      const { run_id, reviewed_by } = input as { run_id: number; reviewed_by: string };
      const run = await approveSkillRun({ orgId: config.orgId, runId: run_id, reviewedBy: reviewed_by });
      if (!run) {
        return { error: `run ${run_id} not found` };
      }
      return run;
    },
  };
}

function rejectTool(config: McpConfig): ToolModule {
  return {
    name: 'runtime_reject_draft',
    title: 'Reject a pending skill run',
    description: 'Mark a skill_run as rejected. Only works on rows with status=pending.',
    inputSchema: {
      run_id: z.number().int().positive(),
      reviewed_by: z.string().default('mcp'),
      reason: z.string().optional(),
    },
    handler: async (input) => {
      const { run_id, reviewed_by, reason } = input as { run_id: number; reviewed_by: string; reason?: string };
      const run = await rejectSkillRun({ orgId: config.orgId, runId: run_id, reviewedBy: reviewed_by, feedback: reason ? { note: reason, rating: 'down' } : undefined });
      if (!run) {
        return { error: `run ${run_id} not found` };
      }
      return run;
    },
  };
}

// expose getSkillRun on MCP for convenience
export function skillRunDetailTool(config: McpConfig): ToolModule {
  return {
    name: 'runtime_get_run',
    title: 'Get full skill run detail',
    description: 'Return a single skill_run including full output text (not truncated).',
    inputSchema: { run_id: z.number().int().positive() },
    handler: async (input) => {
      const { run_id } = input as { run_id: number };
      const run = await getSkillRun(config.orgId, run_id);
      if (!run) {
        return { error: `run ${run_id} not found` };
      }
      return run;
    },
  };
}
