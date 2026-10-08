/**
 * `team-thread` — the built-in automation job that opens a team thread on a
 * schedule or an event, so a team argues a standing question out without a
 * person asking (`services/teams/TeamThreadService.ts`).
 *
 *   automations/forecast-thread.yaml
 *     when: { schedule: '0 14 * * 1' }
 *     do:
 *       job: team-thread
 *       input:
 *         team: revenue-ops          # or lead: revenue-lead
 *         question: Where will the quarter land, and what moves it most?
 *         maxRounds: 2               # optional; the caps default to 3 rounds, $3
 *         capCents: 200
 *
 * The thread is one run, owned by the team's lead and its accountable human;
 * this job waits for its outcome and returns where to find it, which the
 * automation's own run keeps as its result. A lead whose turn is a mission
 * step opens one the same way through its `open_team_thread` tool.
 */

import type { ThreadTurnOrder } from '@/libs/teams/thread';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { teamSchema } from '@/models/Schema';

export const TEAM_THREAD_JOB = 'team-thread';

export type TeamThreadJobInput = {
  /** The team whose lead opens it. */
  team?: string;
  /** Or the lead, by slug. */
  lead?: string;
  question?: string;
  members?: string[];
  maxRounds?: number;
  capCents?: number;
  turnOrder?: ThreadTurnOrder;
};

export type TeamThreadJobResult = {
  runId: number;
  status: string;
  settledBy: string | null;
  rounds: number;
  cents: number;
  outcome: string | null;
  error: string | null;
};

export async function runTeamThreadJob(orgId: string, raw: Record<string, unknown>): Promise<TeamThreadJobResult> {
  const input = raw as TeamThreadJobInput;
  const question = typeof input.question === 'string' ? input.question.trim() : '';
  if (!question) {
    throw new Error('team-thread needs input.question');
  }
  const lead = typeof input.lead === 'string' && input.lead ? input.lead : await leadOf(orgId, input.team);
  const { startTeamThread } = await import('@/services/teams/TeamThreadService');
  const started = await startTeamThread({
    orgId,
    lead,
    question,
    members: Array.isArray(input.members) ? input.members.filter((m): m is string => typeof m === 'string') : undefined,
    maxRounds: typeof input.maxRounds === 'number' ? input.maxRounds : undefined,
    capCents: typeof input.capCents === 'number' ? input.capCents : undefined,
    turnOrder: input.turnOrder,
    // The automation's own run keeps this job's result, which names the thread.
    openedBy: `job:${TEAM_THREAD_JOB}`,
  });
  const result = await started.done;
  return {
    runId: result.runId,
    status: result.status,
    settledBy: result.settledBy,
    rounds: result.rounds,
    cents: Math.round(result.microCents / 1_000_000),
    outcome: result.outcome,
    error: result.error,
  };
}

async function leadOf(orgId: string, team: string | undefined): Promise<string> {
  if (typeof team !== 'string' || !team) {
    throw new Error('team-thread needs input.team or input.lead');
  }
  const [row] = await db.select({ lead: teamSchema.leadAgentSlug, name: teamSchema.name })
    .from(teamSchema)
    .where(and(eq(teamSchema.orgId, orgId), eq(teamSchema.slug, team)))
    .limit(1);
  if (!row) {
    throw new Error(`team-thread: there is no team "${team}" in this workspace`);
  }
  if (!row.lead) {
    throw new Error(`team-thread: the ${row.name} team has no lead yet, so no one can open or settle its thread`);
  }
  return row.lead;
}
