import { os } from '@orpc/server';
import { z } from 'zod';
import { synthesizeAgentChips } from '@/services/chat/synthesis';
import { guardAuth } from './AuthGuards';

/**
 * Per-agent empty-state suggestion chips — synthesized at runtime from the
 * agent's declared context (missions × skills × tracker state), cached
 * server-side with a 15-minute TTL (see services/chat/synthesis.ts).
 *
 * Called lazily by ChatShell when a specific agent is picked in the
 * switcher — the workspace view's chips are server-rendered on page load,
 * so only the picked-agent path needs a client fetch.
 */
export const suggestions = os
  .input(z.object({ agentSlug: z.string().min(1) }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return synthesizeAgentChips(orgId, input.agentSlug);
  });
