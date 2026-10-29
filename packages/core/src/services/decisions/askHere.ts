/**
 * AN ASK A PERSON'S TURN PRODUCED IS DOCKED IN THAT TURN'S CONVERSATION.
 *
 * `file_ask` already asks the person here when the decision is theirs
 * (`agents/decisionHolder.ts`). An ask a tool files in code — the SEO app's
 * keyword plan sign-off, filed by `seo_plan_batch` — went to Needs you with no
 * conversation, so the thread showed only a chip ("ASK-371 · waiting on a
 * person"), the person's "Approve the plan" was not read against it (answers
 * first reads only the conversation's own Decisions), and the agent filed a
 * second ask (2026-10-29). Now such a tool hands the turn's conversation and
 * person to the ask (`askHere`), and the Decision docks above the composer
 * as the one card, the recommended option first (`showDocked`) — the same
 * card, keys and answer path as any other, and still on Needs you.
 *
 * Only a person's own turn in the app: a mission, an automation, a token
 * caller or a Slack thread files where it always did.
 */

import type { RuntimeContext } from '@/services/agents/types';

/** Where an ask is asked, when a person's turn in the app produced it. */
export type AskHere = { conversationId: number; ownerUserId: string };

/**
 * The conversation and person an ask this turn produces belongs to, or null
 * when nobody is here to answer it (it goes to Needs you as before).
 * @param ctx - The turn.
 */
export async function askHere(ctx: Pick<RuntimeContext, 'orgId' | 'userId' | 'conversationId' | 'missionRunId'>): Promise<AskHere | null> {
  const { inTheApp, personIsHere } = await import('@/services/agents/decisionHolder');
  if (!ctx.conversationId || !ctx.userId || !personIsHere(ctx)) {
    return null;
  }
  return (await inTheApp(ctx)) ? { conversationId: ctx.conversationId, ownerUserId: ctx.userId } : null;
}

/**
 * Dock an ask the turn just filed here: the turn's `decision` event, which
 * draws the card and ends the turn at it (`agents/handOff.ts`). Never throws.
 * @param ctx - The turn.
 * @param askId - The ask.
 * @returns Whether it was docked.
 */
export async function showDocked(ctx: Pick<RuntimeContext, 'orgId' | 'emit'>, askId: number): Promise<boolean> {
  try {
    const { getAsk } = await import('@/services/AskService');
    const { decisionViewOf } = await import('@/libs/decisions/decision');
    const ask = await getAsk(ctx.orgId, askId);
    if (!ask || ask.status !== 'open' || !ask.conversationId) {
      return false;
    }
    ctx.emit({ type: 'decision', decision: decisionViewOf(ask) });
    return true;
  } catch (err) {
    console.warn('an ask could not be docked', { orgId: ctx.orgId, askId, message: (err as Error).message });
    return false;
  }
}
