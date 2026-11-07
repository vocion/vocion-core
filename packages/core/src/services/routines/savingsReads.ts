/**
 * WHAT AUTOMATIONS SAVED, READ — the runs, their baselines, the spend ledger
 * and the workspace's hourly rate, summed by `libs/routines/savings.ts`. One
 * read for the batch header, the automation page, `routine_report` and the
 * savings dashboard, so every surface says the same number.
 *
 * Tokens and cost come from the ledger (`model_call`, `run_kind =
 * 'routine_run'`), where a routine's browser run files every model call; a run
 * the ledger has nothing for (before the ledger, or a run that never reached
 * the model) falls back to its browser run's own meter.
 */

import type { HourlyRate, RoutineSavingsView, Savings, SavingsRun, SavingsWeek } from '@/libs/routines/savings';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { monthStart, runsSince, savingsOf, weeklySavings, weekOf } from '@/libs/routines/savings';
import { browserRunSchema, modelCallSchema, projectSchema, routineBatchSchema, routineRunSchema, routineSchema, routineVersionSchema } from '@/models/Schema';

/**
 * Tokens and micro-cents per automation run, from the spend ledger.
 * @param runIds - The runs.
 */
export async function ledgerByRun(runIds: readonly number[]): Promise<Map<number, { tokens: number; microCents: number }>> {
  if (runIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({
      runId: modelCallSchema.runId,
      tokens: sql<string>`coalesce(sum(${modelCallSchema.inputTokens} + ${modelCallSchema.outputTokens} + ${modelCallSchema.cacheReadTokens} + ${modelCallSchema.cacheWriteTokens}), 0)`,
      microCents: sql<string>`coalesce(sum(${modelCallSchema.microCents}), 0)`,
    })
    .from(modelCallSchema)
    .where(and(eq(modelCallSchema.runKind, 'routine_run'), inArray(modelCallSchema.runId, runIds.map(String))))
    .groupBy(modelCallSchema.runId)
    .catch(() => []);
  return new Map(rows.map(r => [Number(r.runId), { tokens: Number(r.tokens), microCents: Number(r.microCents) }]));
}

/**
 * The workspace's hourly rate for people's time (`defaults.hourlyRate`), or null.
 * @param orgId - The workspace.
 */
export async function workspaceHourlyRate(orgId: string): Promise<HourlyRate | null> {
  const [row] = await db.select({ rate: projectSchema.hourlyRate }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1).catch(() => []);
  const rate = row?.rate;
  return rate && Number.isFinite(rate.cents) && rate.cents > 0 ? { cents: rate.cents, of: rate.of ?? null } : null;
}

/**
 * Cents from the ledger, else the browser run's meter.
 * @param ledger - The ledger's row for the run, when one.
 * @param browserMicroCents - The browser run's meter.
 */
export function runCents(ledger: { microCents: number } | undefined, browserMicroCents: number): number {
  const micro = ledger && ledger.microCents > 0 ? ledger.microCents : browserMicroCents;
  return Math.round(micro / 1_000_000);
}

export type RoutineSavingsReport = {
  rate: HourlyRate | null;
  timeZone: string;
  /** Every run, all time. */
  total: Savings;
  /** This month, in the workspace's zone. */
  month: Savings;
  /** The last `weeks` weeks together. */
  recent: Savings;
  weeks: SavingsWeek[];
  /** Per automation, all time, most saved first. */
  byRoutine: Array<{ id: number; slug: string; name: string; savings: Savings; recent: Savings }>;
  /** When seeded sample history is counted: the first day after it ("Nov 4"), as `YYYY-MM-DD`. */
  sampleBefore: string | null;
};

/**
 * What one automation, or all of them, saved: all time, this month, and week by week.
 * @param orgId - The workspace.
 * @param opts - Which automation, how many weeks, and the clock.
 * @param opts.routineId - One automation; absent, every automation in the workspace.
 * @param opts.weeks - How many weeks the trend covers, this one included (default 8).
 * @param opts.now - The clock.
 */
export async function routineSavings(orgId: string, opts: { routineId?: number; weeks?: number; now?: number } = {}): Promise<RoutineSavingsReport> {
  const now = opts.now ?? Date.now();
  const weeks = opts.weeks ?? 8;
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const [timeZone, rate, routines] = await Promise.all([
    workspaceTimeZone(orgId),
    workspaceHourlyRate(orgId),
    db.select({ id: routineSchema.id, slug: routineSchema.slug, name: routineSchema.name }).from(routineSchema).where(and(eq(routineSchema.orgId, orgId), ...(opts.routineId ? [eq(routineSchema.id, opts.routineId)] : []))),
  ]);
  const ids = routines.map(r => r.id);
  const [runs, versions, batches] = ids.length === 0
    ? [[], [], []]
    : await Promise.all([
        db.select({
          id: routineRunSchema.id,
          routineId: routineRunSchema.routineId,
          n: routineRunSchema.n,
          batchId: routineRunSchema.batchId,
          version: routineRunSchema.version,
          status: routineRunSchema.status,
          humanMs: routineRunSchema.humanMs,
          decisions: routineRunSchema.decisions,
          browserRunId: routineRunSchema.browserRunId,
          startedAt: routineRunSchema.startedAt,
          endedAt: routineRunSchema.endedAt,
          createdAt: routineRunSchema.createdAt,
        }).from(routineRunSchema).where(and(eq(routineRunSchema.orgId, orgId), inArray(routineRunSchema.routineId, ids))).orderBy(desc(routineRunSchema.id)).limit(20_000),
        db.select({ routineId: routineVersionSchema.routineId, n: routineVersionSchema.n, spec: routineVersionSchema.spec }).from(routineVersionSchema).where(inArray(routineVersionSchema.routineId, ids)),
        db.select({ id: routineBatchSchema.id, sample: routineBatchSchema.sample }).from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), inArray(routineBatchSchema.routineId, ids))),
      ]);
  const browserIds = runs.map(r => r.browserRunId).filter((x): x is number => typeof x === 'number');
  const [ledger, browsers] = await Promise.all([
    ledgerByRun(runs.map(r => r.id)),
    browserIds.length > 0 ? db.select({ id: browserRunSchema.id, microCents: browserRunSchema.microCents }).from(browserRunSchema).where(inArray(browserRunSchema.id, browserIds)) : Promise.resolve([]),
  ]);
  const meter = new Map(browsers.map(b => [b.id, Number(b.microCents ?? 0)]));
  const baseline = new Map(versions.map(v => [`${v.routineId}:${v.n}`, v.spec.manualMinutes ?? null]));
  const sampleBatch = new Set(batches.filter(b => b.sample).map(b => b.id));
  const counted = runs.map((r) => {
    const l = ledger.get(r.id);
    const run: SavingsRun = {
      // A reconciliation (row 0) is work for the batch: its cost counts, it is not a run of the work.
      overhead: r.n === 0,
      status: r.status,
      manualMinutes: r.n > 0 ? baseline.get(`${r.routineId}:${r.version}`) ?? null : null,
      humanMs: Number(r.humanMs ?? 0),
      cents: runCents(l, r.browserRunId ? meter.get(r.browserRunId) ?? 0 : 0),
      tokens: l?.tokens ?? 0,
      decisions: Number(r.decisions ?? 0),
      at: (r.endedAt ?? r.startedAt ?? r.createdAt)?.toISOString() ?? null,
    };
    return { routineId: r.routineId, sample: sampleBatch.has(r.batchId), run };
  });
  const all = counted.map(c => c.run);
  const fromWeeks = Date.parse(`${weekOf(now, timeZone)}T00:00:00Z`) - (weeks - 1) * 7 * 86_400_000;
  const recentRuns = runsSince(all, fromWeeks);
  // Where the workspace's sample history ends, across every automation, so each surface names the same day.
  const sampleEnd = counted.some(c => c.sample)
    ? await db.select({ last: sql<Date | string | null>`max(${routineBatchSchema.endedAt})` }).from(routineBatchSchema).where(and(eq(routineBatchSchema.orgId, orgId), eq(routineBatchSchema.sample, true))).then(r => r[0]?.last ?? null)
    : null;
  const lastSample = sampleEnd === null ? null : new Date(sampleEnd).getTime();
  const byRoutine = routines.map((r) => {
    const mine = counted.filter(c => c.routineId === r.id).map(c => c.run);
    return { id: r.id, slug: r.slug, name: r.name, savings: savingsOf(mine, rate), recent: savingsOf(runsSince(mine, fromWeeks), rate) };
  }).sort((a, b) => (b.savings.savedMinutes ?? -1) - (a.savings.savedMinutes ?? -1));
  return {
    rate,
    timeZone,
    total: savingsOf(all, rate),
    month: savingsOf(runsSince(all, monthStart(now, timeZone)), rate),
    recent: savingsOf(recentRuns, rate),
    weeks: weeklySavings(all, rate, { weeks, now, timeZone }),
    byRoutine,
    sampleBefore: lastSample === null ? null : new Date(Date.parse(`${new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date(lastSample))}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
  };
}

/**
 * One automation over time, for its page.
 * @param orgId - The workspace.
 * @param routineId - The automation.
 */
export async function routineSavingsView(orgId: string, routineId: number): Promise<RoutineSavingsView> {
  const r = await routineSavings(orgId, { routineId });
  return { month: r.month, recent: r.recent, total: r.total, weeks: r.weeks, sampleBefore: r.sampleBefore };
}
