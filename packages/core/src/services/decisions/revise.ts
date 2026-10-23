/**
 * A REVISED RECOMMENDATION REPLACES THE ONE IT REVISES (Chris, 2026-10-23).
 * The Founder GTM Lead docked "Allow Founder GTM Lead to draft the intro
 * ask?"; Chris replied "can we soften the ask?"; the lead recommended a
 * revised draft, and the docked card kept the old one. Both asked the same
 * thing, so both waited, the old one in front.
 *
 * Which pending ask a recommendation revises is read off typed fields, never
 * its words:
 *   - the agent's own link, `supersedes` on `recommend_action`: the open
 *     ask's id, from the turn's list of what waits in this conversation
 *     (`openAsksTurnNote`);
 *   - else the same action on the same record in the same conversation: an
 *     open approval whose Allow once runs `rec.actionId` on the record
 *     `rec.input` names (`cardRecordRef`).
 * The revised ask is withdrawn as superseded, with the new one named as the
 * reason, so Review and Needs you never show both.
 */

import type { AskOption } from '@/models/Schema';
import type { RecommendedActionPayload } from '@/services/agents/types';

/** An open ask, as far as revising reads it. */
export type OpenAsk = { id: number; kind: string; conversationId: number | null; title: string; options: readonly AskOption[] | null };

type RecordRef = { objectType: string; id: number } | null;

/**
 * The open ask a recommendation revises, or null. Pure.
 * @param rec - The recommendation.
 * @param open - The conversation's open asks.
 * @param conversationId - The turn's conversation.
 * @param recordRef - Reads the record an action's input names (`cardRecordRef`).
 */
export function revisionTarget(rec: Pick<RecommendedActionPayload, 'actionId' | 'input' | 'supersedes'>, open: readonly OpenAsk[], conversationId: number, recordRef: (input: Record<string, unknown>) => RecordRef): number | null {
  const here = open.filter(a => a.conversationId === conversationId && a.kind === 'approval');
  if (typeof rec.supersedes === 'number') {
    return here.find(a => a.id === rec.supersedes)?.id ?? null;
  }
  const target = recordRef(rec.input ?? {});
  if (!target) {
    return null;
  }
  const same = here.filter(a => (a.options ?? []).some((o) => {
    if (o.action?.id !== rec.actionId) {
      return false;
    }
    const theirs = recordRef((o.action.input ?? {}) as Record<string, unknown>);
    return theirs !== null && theirs.objectType === target.objectType && theirs.id === target.id;
  }));
  // The newest of them is the draft in front of the person.
  return same.length > 0 ? Math.max(...same.map(a => a.id)) : null;
}

/**
 * The open asks of one conversation. Never throws: a read that fails revises nothing.
 * @param orgId - The workspace.
 * @param conversationId - The conversation.
 */
export async function openAsksIn(orgId: string, conversationId: number): Promise<OpenAsk[]> {
  try {
    const [{ db }, { askSchema }, { and, eq }] = await Promise.all([import('@/libs/DB'), import('@/models/Schema'), import('drizzle-orm')]);
    return await db
      .select({ id: askSchema.id, kind: askSchema.kind, conversationId: askSchema.conversationId, title: askSchema.title, options: askSchema.options })
      .from(askSchema)
      .where(and(eq(askSchema.orgId, orgId), eq(askSchema.conversationId, conversationId), eq(askSchema.status, 'open')))
      .limit(20) as OpenAsk[];
  } catch (error) {
    console.warn('revise: could not read the open asks', { orgId, conversationId, message: (error as Error).message });
    return [];
  }
}

/**
 * What waits on the person in this conversation, said to the agent on the
 * turn so a revision can name what it revises (`supersedes`). Empty when
 * nothing waits.
 * @param open - The conversation's open asks.
 */
export function openAsksTurnNote(open: readonly OpenAsk[]): string {
  const approvals = open.filter(a => a.kind === 'approval');
  if (approvals.length === 0) {
    return '';
  }
  const lines = approvals.map((a) => {
    const action = (a.options ?? []).find(o => o.action)?.action?.id;
    return `- #${a.id}${action ? ` (${action})` : ''}: ${a.title}`;
  });
  return [
    'WAITING ON THE PERSON IN THIS CONVERSATION (docked above their composer, not yet approved, so nothing in them has happened yet):',
    ...lines,
    'If what you recommend now revises one of these, pass its number as `supersedes` to recommend_action; the new card replaces it.',
  ].join('\n');
}
