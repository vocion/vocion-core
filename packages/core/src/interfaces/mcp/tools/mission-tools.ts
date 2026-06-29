import type { McpConfig } from '../config';
import { z } from 'zod';
import {
  cancelMission,
  getMissionRun,
  listMissionRuns,
  listMissions,
  promoteMissionToWorkflow,
  resumeMission,
  startMission,
} from '@/services/MissionService';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Missions over MCP — start open-ended team work and inspect/steer runs.
 * @param config
 */
export function missionTools(config: McpConfig): ToolModule[] {
  return [
    {
      name: 'mission_list',
      title: 'List mission templates',
      description: 'List authored mission templates (starting points) for this org.',
      inputSchema: {},
      handler: async () => listMissions(config.orgId),
    },
    {
      name: 'mission_start',
      title: 'Start a mission',
      description: 'Start an open-ended team mission from a brief — from a template (missionSlug) or ad-hoc (team). Plans the work, then runs to completion or the first approval gate.',
      inputSchema: {
        brief: z.string(),
        title: z.string().optional(),
        missionSlug: z.string().optional(),
        team: z.object({ lead: z.string(), members: z.array(z.string()).default([]) }).optional(),
        autonomyLevel: z.number().int().min(1).max(5).optional(),
      },
      handler: async (input) => {
        const { brief, title, missionSlug, team, autonomyLevel } = input as {
          brief: string;
          title?: string;
          missionSlug?: string;
          team?: { lead: string; members: string[] };
          autonomyLevel?: number;
        };
        return startMission({ orgId: config.orgId, brief, title, missionSlug, team, autonomyLevel, invokedBy: 'mcp' });
      },
    },
    {
      name: 'mission_list_runs',
      title: 'List mission runs',
      description: 'List mission runs (optionally filtered by status).',
      inputSchema: { status: z.string().optional(), limit: z.number().int().positive().max(100).default(50) },
      handler: async (input) => {
        const { status, limit } = input as { status?: string; limit: number };
        return listMissionRuns(config.orgId, { status, limit });
      },
    },
    {
      name: 'mission_get_run',
      title: 'Get a mission run',
      description: 'Get one mission run with its plan (task graph), team, artifacts, and status.',
      inputSchema: { id: z.number().int().positive() },
      handler: async (input) => {
        const { id } = input as { id: number };
        return (await getMissionRun(id, config.orgId)) ?? { error: `mission run ${id} not found` };
      },
    },
    {
      name: 'mission_approve',
      title: 'Approve + resume a mission',
      description: 'Approve a paused mission run (awaiting_review) and continue execution.',
      inputSchema: { id: z.number().int().positive() },
      handler: async (input) => {
        const { id } = input as { id: number };
        return resumeMission(id, config.orgId);
      },
    },
    {
      name: 'mission_cancel',
      title: 'Cancel a mission',
      description: 'Cancel a mission run.',
      inputSchema: { id: z.number().int().positive(), reason: z.string().optional() },
      handler: async (input) => {
        const { id, reason } = input as { id: number; reason?: string };
        return cancelMission(id, config.orgId, reason);
      },
    },
    {
      name: 'mission_promote',
      title: 'Promote a mission to a workflow',
      description: 'Draft a reusable Workflow from a completed mission run (for review before activating).',
      inputSchema: { id: z.number().int().positive() },
      handler: async (input) => {
        const { id } = input as { id: number };
        return promoteMissionToWorkflow(id, config.orgId);
      },
    },
  ];
}
