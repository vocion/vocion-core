import { os } from '@orpc/server';
import { z } from 'zod';
import { track } from '@/services/adoption/track';
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

/**
 * The opening hint was shown, clicked or dismissed (`libs/chat/openingHints.ts`).
 * Recorded on the adoption stream; a dismissal is what hides that item for
 * 7 days and lowers its type's weight for this person.
 */
export const hintEvent = os
  .input(z.object({
    event: z.enum(['shown', 'clicked', 'dismissed']),
    hints: z.array(z.object({ key: z.string().min(1).max(120), type: z.string().min(1).max(20), score: z.number().optional(), rank: z.number().int().min(1).max(2).optional() })).min(1).max(2),
  }))
  .handler(async ({ input }) => {
    const actor = await guardAuth();
    const eventType = input.event === 'shown' ? 'chat.hint_shown' : input.event === 'clicked' ? 'chat.hint_clicked' : 'chat.hint_dismissed';
    await Promise.all(input.hints.map(h => track(actor, eventType, { meta: h })));
    return { ok: true };
  });
