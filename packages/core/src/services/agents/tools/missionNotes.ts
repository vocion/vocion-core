/**
 * update_mission_notes — the team's working memory across mission checks.
 *
 * A scheduled check ends by REWRITING the mission's notes: open threads
 * (with how many consecutive checks they've been open), commitments with
 * due dates, escalation state. The next check reads them in its brief —
 * which is how "Catalyst reply overdue — 3rd consecutive check" emerges
 * instead of every check rediscovering the world.
 *
 * The write goes through the `mission.update_notes` action
 * (`libs/actions/mission-update-notes.ts`) rather than straight at the
 * column, because these notes are the system improving itself and the same
 * rules apply to all of those: propose with an honest confidence, run on its
 * own above the bar, show a chip in the turn that did it, and keep the exact
 * previous text so one click puts it back. Before this it was a bare
 * `db.update` — a check that hallucinated a closed thread poisoned every
 * check after it, silently and permanently.
 *
 * Mission-scoped: only available in runs bound to a mission (ctx.missionSlug).
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ActionError, proposeAction } from '@/services/ActionService';
import { emitSelfUpdate } from '../selfUpdateEvent';

const MAX_NOTES_CHARS = 8000;

export function updateMissionNotesTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { notes, reason, confidence } = args as { notes: string; reason: string; confidence: number };
      if (!ctx.missionSlug) {
        return 'Not running inside a mission check — update_mission_notes is unavailable here.';
      }
      const slug = ctx.missionSlug;
      const input = { slug, notes: notes.slice(0, MAX_NOTES_CHARS), reason };
      try {
        const res = await proposeAction({
          orgId: ctx.orgId,
          actionId: 'mission.update_notes',
          input,
          principal: {
            kind: 'agent',
            id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : 'agent:unknown',
            scope: { orgId: ctx.orgId },
            grants: ['*'],
            autonomy: 2,
          },
          invokedBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId,
          proposal: {
            confidence,
            rationale: reason,
            suggestedDecision: 'approve',
            suggestedDecisionReason: reason.slice(0, 160),
          },
        });
        emitSelfUpdate(ctx, { actionId: 'mission.update_notes', input, res });
        if (res.status === 'pending') {
          return `Working notes for "${slug}" are PENDING a person's decision (run #${res.runId}, confidence ${confidence} was under the bar). Do NOT assume the next check will see them.`;
        }
        return `Working notes saved for "${slug}" (${input.notes.length} chars, run #${res.runId}). They will be in your next check's brief, and a person can undo them in one click.`;
      } catch (err) {
        if (err instanceof ActionError) {
          return `Notes not saved (${err.code}): ${err.message}`;
        }
        return `Notes not saved: ${(err as Error).message}`;
      }
    },
    {
      name: 'update_mission_notes',
      description: 'REWRITE this mission\'s working notes (full replacement, not append) — your memory for the next scheduled check. Carry forward open threads with how many consecutive checks they\'ve been open, commitments with due dates, and drop resolved items. Keep under ~40 lines. Done for you above the confidence bar and undoable in one click; below it a person decides.',
      schema: z.object({
        notes: z.string().min(1).describe('The complete new working notes (replaces the previous notes).'),
        reason: z.string().min(1).max(500).describe('One or two sentences: what changed since the last check and why these notes now say what they say.'),
        confidence: z.number().min(0).max(1).describe('Your confidence these notes are right, 0–1. An honest number decides whether they are saved now or reviewed first.'),
      }),
    },
  );
}
