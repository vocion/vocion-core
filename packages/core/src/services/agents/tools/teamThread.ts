/**
 * `open_team_thread` — a lead puts one question to its specialists together:
 * they post, read each other's posts and answer them, and the thread ends on
 * its settle rule with the lead's outcome (`services/teams/TeamThreadService.ts`).
 *
 * The other shape beside `task`. `task` hands one specialist one piece of work
 * and returns its answer — a tree, nobody sees anyone else's reply. A thread is
 * for a question the team has to argue out: the analyst's number against the
 * coordinator's read of the accounts, corrected in the open.
 *
 * Both loops. In this process the call waits for the outcome. Through the
 * agentcore container a tool call is one HTTP round trip with a timeout
 * (`VOCION_TOOL_TIMEOUT_MS`, 120s by default), so the call waits a bounded
 * while and, if the thread is still going, says so and returns: the thread
 * keeps running in core and its outcome lands on its run. Same tool, same
 * events either way — the run is announced as a `record_created` (the answer
 * links it) and each post as a `step_progress` note on this call.
 *
 * Refused inside a thread: a member, or a lead reviewing a round, does not open
 * another. The workspace's pause, the lead's roster and the caps are the
 * service's to enforce; this tool says what they said.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { dollars, settleLine, THREAD_LIMITS } from '@/libs/teams/thread';
import { missionRunSchema } from '@/models/Schema';

const TOOL = 'open_team_thread';

/** How long the call waits for the outcome in this process — inside the turn's own deadline. */
export const IN_PROCESS_WAIT_MS = 6 * 60 * 1000;

/**
 * How long the call waits when the loop runs on the container: under the
 * artifact's tool timeout, so the call returns an answer, never a timeout.
 */
export function containerWaitMs(): number {
  const timeout = Number(process.env.VOCION_TOOL_TIMEOUT_MS);
  const limit = Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000;
  return Math.max(1_000, limit - 20_000);
}

export function openTeamThreadTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      if (!ctx.agentSlug) {
        return 'Not opened: a thread is opened by a lead, and this turn has no agent.';
      }
      if (ctx.missionRunId && await isThread(ctx.orgId, ctx.missionRunId)) {
        return 'Not opened: you are already in a team thread. Post your answer in it; the lead settles it.';
      }
      const { startTeamThread, TeamThreadError } = await import('@/services/teams/TeamThreadService');
      const { WorkspacePausedError } = await import('@/services/workspacePause');
      const { recordRef } = await import('@/services/chat/recordContext');
      // Posts are reported on this call while it is open; once it has
      // returned, the thread goes on quietly and its run holds the rest.
      let listening = true;
      let started: Awaited<ReturnType<typeof startTeamThread>>;
      try {
        started = await startTeamThread({
          orgId: ctx.orgId,
          lead: ctx.agentSlug,
          question: args.question,
          members: args.members ?? undefined,
          maxRounds: args.max_rounds ?? undefined,
          capCents: args.cap_cents ?? undefined,
          turnOrder: args.turn_order ?? undefined,
          openedBy: `agent:${ctx.agentSlug}`,
          userId: ctx.userId,
          allowedSourceSlugs: ctx.allowedSourceSlugs,
          parentRunId: ctx.missionRunId,
          conversationId: ctx.conversationId,
        }, {
          onPost: p => listening && ctx.emit({ type: 'step_progress', tool: TOOL, note: `${p.kind === 'outcome' ? 'Outcome' : p.kind === 'review' ? `Round ${p.round} review` : `Round ${p.round}`} · ${p.agentName}${p.failed ? ' · failed' : ''}` }),
        });
      } catch (err) {
        if (err instanceof TeamThreadError || err instanceof WorkspacePausedError) {
          return `Not opened: ${err.message}`;
        }
        throw err;
      }
      ctx.emit({ type: 'record_created', record: recordRef('mission_run', started.runId, started.title) });

      const waitMs = ctx.provider === 'runtime' ? containerWaitMs() : IN_PROCESS_WAIT_MS;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        started.done,
        new Promise<null>((resolve) => {
          timer = setTimeout(resolve, waitMs, null);
        }),
      ]).finally(() => {
        clearTimeout(timer);
        listening = false;
      });

      const team = {
        members: started.team.members,
        ...(started.team.left.length > 0 ? { notAssigned: started.team.left, why: 'not on your team, or past the limit of members a thread assigns' } : {}),
      };
      if (!result) {
        return JSON.stringify({
          thread: started.title,
          status: 'still going',
          ...team,
          note: `The thread is still going and settles on its own; its outcome lands on its run, which is linked under your answer. Tell the person the team is discussing it and that the outcome will be on the run — do not wait for it or make up its result.`,
        });
      }
      const [row] = await db.select({ thread: missionRunSchema.thread }).from(missionRunSchema).where(and(eq(missionRunSchema.id, result.runId), eq(missionRunSchema.orgId, ctx.orgId))).limit(1);
      const state = row?.thread;
      return JSON.stringify({
        thread: started.title,
        status: result.status,
        ...team,
        settled: result.settledBy && state ? settleLine(result.settledBy, state) : null,
        cost: dollars(Math.round(result.microCents / 1_000_000)),
        ...(result.error ? { error: result.error } : {}),
        outcome: result.outcome,
        note: result.outcome
          ? 'This is the outcome you wrote for the thread. Give the person the answer in your own words, and say how it settled if it matters to them.'
          : 'The thread ended without an outcome; say so plainly and why.',
      });
    },
    {
      name: TOOL,
      description: [
        'Open a TEAM THREAD: put one question to your specialists together. They post in rounds, read each other\'s posts and answer them by name; after each round you either settle it with the outcome or steer the next round; it ends when you declare it settled, when every member marks their part complete, or at its round or budget cap — and you write the outcome. The whole thread is one run with its cost, linked under your answer.',
        'Use it when the question needs the specialists to disagree, correct or build on each other (a forecast two of them read differently, a plan that crosses their areas). For one specialist\'s answer, use task instead — it is faster and cheaper.',
        `Members default to your whole team (at most ${THREAD_LIMITS.maxMembers}); name some to narrow it. Caps default to ${THREAD_LIMITS.defaultRounds} rounds and ${dollars(THREAD_LIMITS.defaultCapCents)}.`,
      ].join(' '),
      schema: z.object({
        question: z.string().min(1).describe('The one question the thread settles, with what the person asked for and any context the team needs.'),
        members: z.array(z.string()).nullable().optional().describe('Slugs of the specialists to assign, from your team. Omit for your whole team.'),
        max_rounds: z.number().int().min(1).max(THREAD_LIMITS.maxRounds).nullable().optional().describe(`The round cap (default ${THREAD_LIMITS.defaultRounds}).`),
        cap_cents: z.number().int().min(1).max(THREAD_LIMITS.maxCapCents).nullable().optional().describe(`The budget cap in cents (default ${THREAD_LIMITS.defaultCapCents}).`),
        turn_order: z.enum(['parallel', 'sequential']).nullable().optional().describe('parallel (default): everyone posts at once each round. sequential: one after another, each reading the posts before theirs.'),
      }),
    },
  );
}

async function isThread(orgId: string, runId: number): Promise<boolean> {
  const [row] = await db.select({ thread: missionRunSchema.thread }).from(missionRunSchema).where(and(eq(missionRunSchema.id, runId), eq(missionRunSchema.orgId, orgId))).limit(1);
  return Boolean(row?.thread);
}
