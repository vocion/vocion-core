import type { McpConfig } from '../config';
import { z } from 'zod';
import { pauseAutomation, resumeAutomation } from '@/services/AutomationService';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Automations over MCP — the emergency stop from wherever the operator is.
 *
 * The same service path as the dashboard's Pause and the REST twins
 * (`/api/v1/automations/:slug/pause`), so the `control` row is the same: who
 * (`identity.userId` — `token:<id>` over HTTP, `mcp` on stdio), when, why.
 * @param config
 * @param identity - Who the tools act as, for the record.
 * @param identity.userId
 */
export function automationTools(config: McpConfig, identity?: { userId: string }): ToolModule[] {
  const by = { id: identity?.userId ?? 'mcp', name: identity?.userId ? null : 'MCP' };
  return [
    {
      name: 'automation_pause',
      title: 'Pause an automation',
      description: 'Hold an automation now: a schedule stops firing, an event automation is skipped by the matcher, and any fire that reaches it anyway is refused and logged. The note is required — it is what the run log shows beside the gap. Resume with automation_resume.',
      inputSchema: { slug: z.string().min(1), note: z.string().trim().min(1).max(500) },
      handler: async (input) => {
        const { slug, note } = input as { slug: string; note: string };
        const pause = await pauseAutomation(config.orgId, slug, { by, note });
        return { slug, paused: pause };
      },
    },
    {
      name: 'automation_resume',
      title: 'Resume an automation',
      description: 'Lift a pause placed with automation_pause (or from the dashboard). Records who lifted it and whose pause it was.',
      inputSchema: { slug: z.string().min(1), note: z.string().trim().max(500).optional() },
      handler: async (input) => {
        const { slug, note } = input as { slug: string; note?: string };
        await resumeAutomation(config.orgId, slug, { by, note });
        return { slug, paused: null };
      },
    },
  ];
}
