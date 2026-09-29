import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { AgentVoiceError, setAgentVoice } from '@/services/agents/agentVoice';
import { ApiError } from './ApiError';
import { guardAuth } from './AuthGuards';

/**
 * How an agent talks, set from its page — the same service as the API
 * (`/api/v1/agents/:slug/voice`), MCP (`agent_voice_set`) and chat
 * (`set_voice`).
 */
export const setVoice = os.input(z.object({
  slug: z.string().min(1),
  length: z.enum(['brief', 'standard', 'detailed']).nullable().optional(),
  narration: z.enum(['off', 'on']).nullable().optional(),
  creativity: z.number().min(0).max(1).nullable().optional(),
  style: z.string().nullable().optional(),
  clear: z.boolean().optional(),
})).handler(async ({ input }) => {
  const { orgId } = await guardAuth();
  const { slug, clear, ...change } = input;
  try {
    return await setAgentVoice(orgId, slug, change, { clear: clear === true });
  } catch (e) {
    if (e instanceof AgentVoiceError) {
      if (e.code === 'NOT_FOUND') {
        throw ApiError.notFound();
      }
      throw new ORPCError('BAD_REQUEST', { message: e.message });
    }
    throw e;
  }
});
