import { ORPCError, os } from '@orpc/server';
import { z } from 'zod';
import { AgentVoiceError, setAgentVoice } from '@/services/agents/agentVoice';
import { setSeededLeadName } from '@/services/workspace/leadNaming';
import { ORG_ROLE } from '@/types/Auth';
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

/**
 * Give the workspace's lead a first name ("Ava"), or clear it so the lead
 * reads as its role ("Revenue lead"). Admins only: it is how the whole
 * workspace addresses its lead. Set from the lead's profile and from Brand
 * ("Make it yours").
 */
export const setLeadName = os.input(z.object({
  name: z.string().max(80),
})).handler(async ({ input }) => {
  const { orgId, has } = await guardAuth();
  if (!has({ role: ORG_ROLE.ADMIN })) {
    throw new ORPCError('FORBIDDEN', { message: 'Only an admin can name the workspace\'s lead.' });
  }
  const named = await setSeededLeadName(orgId, input.name);
  if (!named) {
    throw ApiError.notFound();
  }
  return named;
});
