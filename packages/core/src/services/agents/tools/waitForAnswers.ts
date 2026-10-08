/**
 * wait_for_answers — an agent whose remaining work is all blocked on asks
 * stops spending until they are answered.
 *
 * The zero-person company kept a mission checking every two hours for a week
 * with nothing it could do but wait on 24 open approvals: every check was a
 * paid turn that ended "still waiting". This is the stop. The agent names the
 * asks it is blocked on (ids from `file_ask` or Needs you — never inferred
 * from its words) and what it is waiting for in one line; core files ONE
 * resume-gate ask and parks what would otherwise keep spending
 * (`services/needsYou/ResumeGateService.ts`):
 *
 *   - a mission run with tasks still to do stops before its next task;
 *   - else the scheduled automation whose check this is skips its ticks;
 *   - else nothing more is scheduled, so nothing needs stopping.
 *
 * Answering the asks resumes it on its own; the gate's Resume resumes it as
 * things stand. Only present in a mission run — a person's own chat has a
 * person in it, and nothing to park.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { automationSchema, missionRunSchema } from '@/models/Schema';

/**
 * What a turn in this mission run would park: the run itself when it has
 * tasks left after this one, else the scheduled automation that fired it,
 * else nothing.
 * @param orgId - The workspace.
 * @param missionRunId - The run this turn belongs to.
 */
export async function parkTargetFor(orgId: string, missionRunId: number): Promise<{ kind: 'mission_run'; id: number; automationSlug: string | null } | { kind: 'automation'; slug: string } | null> {
  const [run] = await db.select({ plan: missionRunSchema.plan, causedBy: missionRunSchema.causedBy, status: missionRunSchema.status }).from(missionRunSchema).where(and(eq(missionRunSchema.orgId, orgId), eq(missionRunSchema.id, missionRunId))).limit(1);
  if (!run) {
    return null;
  }
  // Only an automation on a schedule spends on its own; an event fire answers
  // something that happened, and is never held.
  let scheduled: string | null = null;
  const firedBy = run.causedBy?.[0]?.automationSlug;
  if (firedBy) {
    const [auto] = await db.select({ when: automationSchema.whenConfig }).from(automationSchema).where(and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, firedBy))).limit(1);
    scheduled = auto?.when.schedule ? firedBy : null;
  }
  const left = (run.plan?.tasks ?? []).filter(t => t.status === 'pending' || t.status === 'awaiting_approval');
  if (left.length > 0) {
    return { kind: 'mission_run', id: missionRunId, automationSlug: scheduled };
  }
  return scheduled ? { kind: 'automation', slug: scheduled } : null;
}

export function waitForAnswersTools(ctx: RuntimeContext) {
  if (!ctx.missionRunId) {
    return [];
  }
  const missionRunId = ctx.missionRunId;
  return [tool(
    async (raw) => {
      const args = raw as { ask_ids: number[]; waiting_for: string };
      const target = await parkTargetFor(ctx.orgId, missionRunId);
      if (!target) {
        return 'Nothing more is scheduled after this turn, so nothing needs to stop: the questions wait on Needs you, and whoever answers them reads the answers back. End your turn and say in one line what you are waiting for.';
      }
      const { ResumeGateError, parkOnAsks } = await import('@/services/needsYou/ResumeGateService');
      try {
        const parked = await parkOnAsks({
          orgId: ctx.orgId,
          subject: target,
          waitingOn: args.ask_ids,
          agentSlug: ctx.agentSlug ?? null,
          reason: args.waiting_for,
        });
        ctx.emit({ type: 'tool_progress', tool: 'wait_for_answers', meta: { gateAskId: parked.gateAskId, parked: target.kind, waitingOn: parked.waitingOn } } as never);
        const what = target.kind === 'mission_run'
          ? `This run stops after this turn: its next task waits until ${parked.waitingOn.length === 1 ? 'that question is' : 'those questions are'} answered.`
          : `The ${target.slug} automation skips its scheduled checks until ${parked.waitingOn.length === 1 ? 'that question is' : 'those questions are'} answered, then runs once straight away.`;
        return `Parked (ask #${parked.gateAskId} on Needs you says so). ${what} Answering them resumes it on its own. End your turn now — no more tool calls — and say in one line what you are waiting for.`;
      } catch (err) {
        if (err instanceof ResumeGateError) {
          return `Not parked (${err.code}): ${err.message}`;
        }
        return `Could not park: ${(err as Error).message}. Your questions are still on Needs you.`;
      }
    },
    {
      name: 'wait_for_answers',
      description: 'Call this when EVERYTHING you have left to do is blocked on questions a person has not answered yet — nothing useful remains until they answer. It stops this work spending (no further turns, no scheduled checks) and files one "nothing I can do until…" note on Needs you; answering the questions resumes you on your own. Name the open asks by id (from file_ask, or the ids on Needs you). Do NOT call it when any part of the work can still move: do that part first.',
      schema: z.object({
        ask_ids: z.array(z.number().int().positive()).min(1).max(50).describe('The open asks you are blocked on — the ids file_ask returned.'),
        waiting_for: z.string().min(1).max(300).describe('What you are waiting for, in one line a person reads on Needs you: "the pricing tier for Northwind and the Q4 budget".'),
      }),
    },
  )];
}
