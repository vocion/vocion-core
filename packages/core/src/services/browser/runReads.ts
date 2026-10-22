/**
 * A BROWSER RUN, READ — what every surface that shows a run needs, and only that: the row and the
 * live picture's counter. Kept apart from `BrowserRunService`, which drives runs and so reaches
 * the model, the budget and the conversation: a page or a route that only shows a run compiles
 * this, not the server (the build budget, CI.yml "Build memory"; #1300).
 *
 * A run is shown from its row alone: the process driving it writes each step there as it lands,
 * and the picture is read from the person's browser (`browserEngine.latestFrame`) when this
 * process holds it.
 */

import type { BrowserRunView } from '@/libs/browser/run';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { isLive } from '@/libs/browser/run';
import { db } from '@/libs/DB';
import { browserRunSchema } from '@/models/Schema';
import { frameSeq, latestFrame, sessionKeyOf, whereNow } from './browserEngine';

type Row = typeof browserRunSchema.$inferSelect;

/** How old a run's beat is before its process counts as gone (`BrowserRunService`). */
export const STALE_MS = 30_000;

/**
 * Whether the process driving a run has stopped beating.
 * @param row - The run's beat.
 * @param row.heartbeatAt - When it last beat.
 */
export function isStale(row: Pick<Row, 'heartbeatAt'>): boolean {
  return !row.heartbeatAt || Date.now() - row.heartbeatAt.getTime() > STALE_MS;
}

/**
 * A run as the pane draws it.
 * @param row - The run.
 */
export function toView(row: Row): BrowserRunView {
  const key = sessionKeyOf(row);
  const holding = isLive(row.status) && Boolean(latestFrame(key));
  const where = holding ? whereNow(key) : null;
  const steps = row.steps ?? [];
  const lastUrl = [...steps].reverse().find(s => s.url)?.url ?? row.startUrl ?? null;
  return {
    id: row.id,
    status: row.status,
    task: row.task,
    startUrl: row.startUrl,
    inputs: row.inputs ?? {},
    outputs: row.outputs ?? [],
    result: row.result ?? null,
    summary: row.summary,
    steps,
    waiting: row.waiting ?? null,
    error: row.error,
    url: where?.url && where.url !== 'about:blank' ? where.url : lastUrl,
    title: where?.title ?? null,
    frameSeq: holding ? frameSeq(key) : 0,
    live: holding,
    finalShotUrl: row.finalShotUrl,
    proposedBy: row.proposedBy,
    agentSlug: row.agentSlug,
    conversationId: row.conversationId,
    cents: Math.round(Number(row.microCents ?? 0) / 1_000_000),
    isolation: row.isolation ?? null,
    resumes: row.resumes ?? 0,
    // Live in the database, driven by no process this one can see, and its beat stopped: it is
    // about to be picked up again.
    resuming: isLive(row.status) && !holding && isStale(row),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * A run as the pane draws it, or null when this workspace has no such run.
 * @param orgId - The workspace.
 * @param id - The run.
 */
export async function readBrowserRun(orgId: string, id: number): Promise<BrowserRunView | null> {
  const [row] = await db.select().from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.id, id))).limit(1);
  return row ? toView(row) : null;
}

/**
 * The person's recent runs, newest first.
 * @param orgId - The workspace.
 * @param userId - The person.
 * @param limit - How many.
 */
export async function recentBrowserRuns(orgId: string, userId: string, limit = 20): Promise<BrowserRunView[]> {
  // A routine's runs are listed on its batch, not among the person's own.
  const rows = await db.select().from(browserRunSchema).where(and(eq(browserRunSchema.orgId, orgId), eq(browserRunSchema.userId, userId), isNull(browserRunSchema.routineRunId))).orderBy(desc(browserRunSchema.id)).limit(limit);
  return rows.map(toView);
}
