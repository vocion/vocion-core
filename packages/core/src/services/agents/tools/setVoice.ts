/**
 * `set_voice` — the person says how an agent should talk ("be briefer",
 * "stop telling me what you're about to do", "be more inventive with
 * options") and it becomes the agent's setting, not a promise in one reply.
 * Same service as the agent's page, the API and MCP (`agentVoice.ts`); it
 * takes effect from the next turn and survives a workspace apply.
 *
 * Only a person's turn can change a voice: a mission or an automation turn
 * has no one asking, and an agent does not re-tune itself.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export function setVoiceTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      if (!ctx.userId || ctx.missionRunId) {
        return 'Not changed: only a person can set how an agent talks, from a chat turn they started.';
      }
      const slug = args.agent_slug ?? ctx.agentSlug;
      if (!slug) {
        return 'Not changed: name the agent (agent_slug).';
      }
      const { getAgentVoice, setAgentVoice, AgentVoiceError } = await import('@/services/agents/agentVoice');
      try {
        const before = await getAgentVoice(ctx.orgId, slug);
        const { agent_slug: _a, clear, ...change } = args;
        const after = await setAgentVoice(ctx.orgId, slug, change, { clear: clear === true });
        const v = after.voice;
        return `Voice for ${slug} set — length ${v.length}, narration ${v.narration}, creativity ${v.creativity}${v.style ? `, style ${v.style}` : ''}. It applies from the next turn and stays after a workspace apply. To undo, set it back: ${JSON.stringify(before.override ?? { clear: true })}. Say it in one short sentence.`;
      } catch (e) {
        if (e instanceof AgentVoiceError) {
          return `Not changed: ${e.message}`;
        }
        throw e;
      }
    },
    {
      name: 'set_voice',
      description: 'Change how an agent talks in chat when the person asks for it — "be briefer", "don\'t say what you\'re about to do", "more detail", "be more inventive". Settings: length (brief | standard | detailed), narration (off: never announce the next step; on), creativity (0 sticks to the records, 1 offers ideas beyond them), style (a wiki page slug on how the workspace talks). Send only what the person changed; null resets a setting to the workspace default; clear resets them all. Defaults to you.',
      schema: z.object({
        agent_slug: z.string().optional().describe('The agent to change; omit for yourself.'),
        length: z.enum(['brief', 'standard', 'detailed']).nullable().optional(),
        narration: z.enum(['off', 'on']).nullable().optional(),
        creativity: z.number().min(0).max(1).nullable().optional(),
        style: z.string().nullable().optional(),
        clear: z.boolean().optional(),
      }),
    },
  );
}
