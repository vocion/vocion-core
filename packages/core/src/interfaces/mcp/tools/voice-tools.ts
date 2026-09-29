/**
 * HOW AN AGENT TALKS, OVER MCP — the same service as the agent's page, the
 * API (`/api/v1/agents/:slug/voice`) and chat (`set_voice`).
 */
import type { McpConfig } from '../config';
import type { Principal } from '@/services/authz';
import { z } from 'zod';
import { mcpCaller } from './review-tools';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * @param config - MCP runtime config.
 * @param identity - Who the change is recorded as.
 * @param identity.userId - The actor id.
 * @param identity.principal - The token's principal.
 */
export function voiceTools(config: McpConfig, identity?: { userId: string; principal?: Principal }): ToolModule[] {
  const caller = mcpCaller(config, identity);
  return [
    {
      name: 'agent_voice_get',
      title: 'Read how an agent talks',
      description: 'The chat voice an agent runs with — length (brief | standard | detailed), narration (off | on: whether it says what it is about to do), creativity (0–1) and style (a wiki page on how the workspace talks) — with what its workspace YAML says and what a person set over it. Same as GET /api/v1/agents/:slug/voice.',
      inputSchema: { agent_slug: z.string().min(1) },
      handler: async (input) => {
        const { getAgentVoice } = await import('@/services/agents/agentVoice');
        return getAgentVoice(caller.orgId, String(input.agent_slug));
      },
    },
    {
      name: 'agent_voice_set',
      title: 'Set how an agent talks',
      description: 'Change an agent\'s chat voice. Send only what changes; a key sent as null goes back to the workspace YAML, and clear: true drops every setting a person made. Takes effect on the agent\'s next turn and survives a workspace apply. Needs the approve capability. Same as PUT /api/v1/agents/:slug/voice.',
      inputSchema: {
        agent_slug: z.string().min(1),
        length: z.enum(['brief', 'standard', 'detailed']).nullable().optional(),
        narration: z.enum(['off', 'on']).nullable().optional(),
        creativity: z.number().min(0).max(1).nullable().optional(),
        style: z.string().nullable().optional(),
        clear: z.boolean().optional(),
      },
      handler: async (input) => {
        const { enforce } = await import('@/services/authz');
        enforce(caller.principal, { kind: 'action', action: 'approve', scope: { orgId: caller.orgId } }, 'mutate');
        const { setAgentVoice } = await import('@/services/agents/agentVoice');
        const { agent_slug, clear, ...change } = input as Record<string, unknown>;
        return setAgentVoice(caller.orgId, String(agent_slug), change as never, { clear: clear === true });
      },
    },
  ];
}
