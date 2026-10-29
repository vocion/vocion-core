/**
 * LIVE TURNS ON THE SAME DIMENSIONS AS THE EVAL (ADR 0010): each finished
 * chat turn's signals, kept, and read back as a scoreboard by agent and
 * level.
 *
 * Every turn is scored, not a sample: the detectors are pattern checks over
 * what the turn already holds, so they cost a row insert. The dimensions an
 * LLM judge is needed for (was the answer grounded, was the argument right)
 * are the sampled half, and live in `judge` once the nightly job writes them.
 */
import type { TurnForSignals, TurnSignalName } from './turnSignals';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { agentTurnSignalSchema } from '@/models/Schema';
import { turnSignals } from './turnSignals';

/** What a finished turn hands over to be scored. */
export type LiveTurn = TurnForSignals & {
  orgId: string;
  agentSlug: string;
  level?: string | null;
  toolLoading?: string | null;
  model?: string | null;
  traceId?: string | null;
  conversationId?: number | null;
  searches?: number;
  unknownTools?: number;
};

/**
 * Score a finished turn and keep the row. Never throws: the scoreboard is
 * worth less than the turn, so a failed write is logged and dropped.
 * @param turn - What the turn did.
 */
export async function recordTurnSignals(turn: LiveTurn): Promise<TurnSignalName[]> {
  const signals = turnSignals(turn);
  try {
    await db.insert(agentTurnSignalSchema).values({
      orgId: turn.orgId,
      agentSlug: turn.agentSlug,
      level: turn.level ?? null,
      toolLoading: turn.toolLoading ?? null,
      model: turn.model ?? null,
      traceId: turn.traceId ?? null,
      conversationId: turn.conversationId ?? null,
      toolCalls: signals.toolCalls,
      toolErrors: signals.toolErrors,
      searches: turn.searches ?? 0,
      unknownTools: turn.unknownTools ?? 0,
      flags: signals.flags,
    });
  } catch (error) {
    console.warn('[evals] could not record a turn\'s signals', { orgId: turn.orgId, agentSlug: turn.agentSlug, message: (error as Error).message });
  }
  return signals.flags;
}

/** One agent at one level over the window. */
export type AgentScore = {
  agentSlug: string;
  /** quick, standard, deep; `unknown` for a turn that did not say. */
  level: string;
  turns: number;
  toolCalls: number;
  toolErrors: number;
  searches: number;
  toolFailures: number;
  refusedWithAction: number;
  claimedSave: number;
  /** Turns with any flag. */
  flagged: number;
  /** The tool-loading modes its turns ran under. */
  loading: string[];
  /** Turns the nightly judge read (`judge.ts`), and of those where each dimension applied, how many passed. */
  judged: number;
  grounded: { passed: number; of: number };
  argsCorrect: { passed: number; of: number };
  unjustifiedRefusals: number;
  lastAt: Date | null;
};

/**
 * The scoreboard: every agent and level with a turn in the window, the
 * agents with the most flagged turns first.
 * @param orgId - The workspace.
 * @param opts - The window.
 * @param opts.days - How many days back.
 * @param opts.now - The clock, for tests.
 */
export async function loadAgentScoreboard(orgId: string, opts: { days?: number; now?: Date } = {}): Promise<{ since: Date; scores: AgentScore[] }> {
  const since = new Date((opts.now ?? new Date()).getTime() - (opts.days ?? 30) * 86_400_000);
  const t = agentTurnSignalSchema;
  const has = (flag: TurnSignalName) => sql<number>`count(*) filter (where ${flag} = any(${t.flags}))::int`;
  // A judged dimension: the turns where it applied (JSON null is "did not apply"), or those that were `value`.
  const verdict = (key: string, value: 'true' | null) => (value
    ? sql<number>`count(*) filter (where ${t.judge} ->> ${key} = ${value})::int`
    : sql<number>`count(*) filter (where ${t.judge} ->> ${key} is not null)::int`);
  const rows = await db.select({
    agentSlug: t.agentSlug,
    level: sql<string>`coalesce(${t.level}, 'unknown')`,
    turns: sql<number>`count(*)::int`,
    toolCalls: sql<number>`coalesce(sum(${t.toolCalls}), 0)::int`,
    toolErrors: sql<number>`coalesce(sum(${t.toolErrors}), 0)::int`,
    searches: sql<number>`coalesce(sum(${t.searches}), 0)::int`,
    toolFailures: has('toolFailures'),
    refusedWithAction: has('refusedWithAction'),
    claimedSave: has('claimedSave'),
    flagged: sql<number>`count(*) filter (where cardinality(${t.flags}) > 0)::int`,
    loading: sql<string[]>`array_remove(array_agg(distinct ${t.toolLoading}), null)`,
    lastAt: sql<Date | null>`max(${t.createdAt})`,
    judged: sql<number>`count(${t.judge})::int`,
    groundedPassed: verdict('grounded', 'true'),
    groundedOf: verdict('grounded', null),
    argsPassed: verdict('argsCorrect', 'true'),
    argsOf: verdict('argsCorrect', null),
    unjustifiedRefusals: verdict('unjustifiedRefusal', 'true'),
  }).from(t).where(and(eq(t.orgId, orgId), gte(t.createdAt, since))).groupBy(t.agentSlug, sql`coalesce(${t.level}, 'unknown')`);
  const scores = rows.map(({ groundedPassed, groundedOf, argsPassed, argsOf, ...r }) => ({
    ...r,
    loading: r.loading ?? [],
    lastAt: r.lastAt ? new Date(r.lastAt) : null,
    grounded: { passed: groundedPassed, of: groundedOf },
    argsCorrect: { passed: argsPassed, of: argsOf },
  }));
  return { since, scores: sortScores(scores) };
}

const LEVEL_ORDER = ['quick', 'standard', 'deep', 'unknown'];

/**
 * Agents with the most flagged turns first, then by name; levels in effort order within an agent.
 * @param scores - The rows.
 */
export function sortScores(scores: AgentScore[]): AgentScore[] {
  const flaggedBy = new Map<string, number>();
  for (const s of scores) {
    flaggedBy.set(s.agentSlug, (flaggedBy.get(s.agentSlug) ?? 0) + s.flagged);
  }
  return [...scores].sort((a, b) => (flaggedBy.get(b.agentSlug)! - flaggedBy.get(a.agentSlug)!)
    || a.agentSlug.localeCompare(b.agentSlug)
    || LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level));
}

/** A turn worth reading, for the list under the board: one with a signal, or one the judge found wrong. */
export type FlaggedTurn = {
  id: number;
  agentSlug: string;
  level: string | null;
  toolLoading: string | null;
  flags: string[];
  toolCalls: number;
  toolErrors: number;
  conversationId: number | null;
  traceId: string | null;
  /** The nightly judge's verdict, when it read this turn. */
  judge: Record<string, boolean | number | string | null> | null;
  createdAt: Date;
};

/**
 * The turns worth reading in the window, newest first: any signal, or a judged problem.
 * @param orgId - The workspace.
 * @param opts - Filters.
 * @param opts.since - Window start.
 * @param opts.agentSlug - One agent's.
 * @param opts.limit - Page size, at most 200.
 */
export async function listFlaggedTurns(orgId: string, opts: { since: Date; agentSlug?: string | null; limit?: number }): Promise<FlaggedTurn[]> {
  const t = agentTurnSignalSchema;
  return db.select({
    id: t.id,
    agentSlug: t.agentSlug,
    level: t.level,
    toolLoading: t.toolLoading,
    flags: t.flags,
    toolCalls: t.toolCalls,
    toolErrors: t.toolErrors,
    conversationId: t.conversationId,
    traceId: t.traceId,
    judge: t.judge,
    createdAt: t.createdAt,
  }).from(t).where(and(
    eq(t.orgId, orgId),
    gte(t.createdAt, opts.since),
    sql`(cardinality(${t.flags}) > 0 or ${t.judge} ->> 'grounded' = 'false' or ${t.judge} ->> 'argsCorrect' = 'false' or ${t.judge} ->> 'unjustifiedRefusal' = 'true')`,
    ...(opts.agentSlug ? [eq(t.agentSlug, opts.agentSlug)] : []),
  )).orderBy(desc(t.id)).limit(Math.min(opts.limit ?? 50, 200));
}
