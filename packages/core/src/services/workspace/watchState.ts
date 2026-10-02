import type { CheckOutcome } from '@/libs/automations/checkResult';
import type { PageManifest } from '@/libs/workspace/pageFields';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { readCheckResult } from '@/libs/automations/checkResult';
import { db } from '@/libs/DB';
import { automationRunSchema, automationSchema } from '@/models/Schema';

/**
 * WHAT A WATCH IS WATCHING, AND WHEN IT LAST READ — what an empty page fed by
 * an automation says instead of "Nothing here yet" (a page's `empty.watch`,
 * `libs/workspace/pageFields.ts`). A quiet production, a watch pointed at
 * nothing, a paused watch and one whose last read failed are four different
 * facts, and only the first is good news.
 *
 * Read from the automation's own row (its `do.input`, its status, a person's
 * pause) and its latest run. Nothing here names an automation, a job or a type.
 */

export type WatchState = {
  /** The automation's name, as the Automations page shows it. */
  name: string;
  /** What it watches, each by its label. Empty when it names nothing. */
  items: string[];
  /** `active`, `paused` (a person's hold) or `off` (authored disabled), or `missing` when there is no such automation. */
  state: 'active' | 'paused' | 'off' | 'missing';
  /** When its latest run started, if it has run. */
  lastReadAt: Date | null;
  /** That run's error, when it failed, or why its check could not read. */
  lastError: string | null;
  /** What that run's check came to, when it recorded one (`libs/automations/checkResult.ts`). */
  lastOutcome: CheckOutcome | null;
  /** Where it reads, in the page's words ("Sentry"), when the page says. */
  in: string | null;
};

type Watch = NonNullable<NonNullable<PageManifest['empty']>['watch']>;

/**
 * The labels of what an automation's input names under `items`.
 * @param input - The automation's `do.input`.
 * @param watch - The page's `empty.watch`.
 */
export function watchedItems(input: Record<string, unknown> | null | undefined, watch: Watch): string[] {
  if (!watch.items) {
    return [];
  }
  const list = input?.[watch.items];
  if (!Array.isArray(list)) {
    return [];
  }
  return list.flatMap((it) => {
    if (typeof it === 'string') {
      return it.trim() ? [it.trim()] : [];
    }
    if (it && typeof it === 'object' && watch.itemLabel) {
      const v = (it as Record<string, unknown>)[watch.itemLabel];
      return typeof v === 'string' && v.trim() ? [v.trim()] : [];
    }
    return [];
  });
}

/**
 * The watch's state, from its row and its latest run. Pure.
 * @param row - The automation row, or null when the workspace has none by that slug.
 * @param lastRun - Its latest run that read (not a skipped fire, not a pause).
 * @param watch - The page's `empty.watch`.
 */
export function watchStateOf(
  row: { name: string; status: string | null; pausedAt: Date | null; doConfig: { input?: Record<string, unknown> } } | null,
  lastRun: { startedAt: Date; status: string; error: string | null; result?: unknown } | null,
  watch: Watch,
): WatchState {
  if (!row) {
    return { name: watch.automation, items: [], state: 'missing', lastReadAt: null, lastError: null, lastOutcome: null, in: watch.in ?? null };
  }
  const check = lastRun?.status === 'error' ? null : readCheckResult(lastRun?.result);
  return {
    name: row.name,
    items: watchedItems(row.doConfig.input, watch),
    state: row.pausedAt ? 'paused' : row.status === 'disabled' ? 'off' : 'active',
    lastReadAt: lastRun?.startedAt ?? null,
    lastError: lastRun?.status === 'error' ? (lastRun.error ?? 'it failed without a message') : check?.why ?? null,
    lastOutcome: lastRun?.status === 'error' ? 'unchecked' : check?.outcome ?? null,
    in: watch.in ?? null,
  };
}

/**
 * The watch's state in a workspace.
 * @param orgId - The workspace.
 * @param watch - The page's `empty.watch`.
 */
export async function loadWatchState(orgId: string, watch: Watch): Promise<WatchState> {
  const row = await db.query.automationSchema.findFirst({
    where: and(eq(automationSchema.orgId, orgId), eq(automationSchema.slug, watch.automation)),
  });
  // A skipped fire and a person's pause are on the log, and neither is a read.
  const [lastRun] = await db.select({ startedAt: automationRunSchema.startedAt, status: automationRunSchema.status, error: automationRunSchema.error, result: automationRunSchema.result })
    .from(automationRunSchema)
    .where(and(eq(automationRunSchema.orgId, orgId), eq(automationRunSchema.slug, watch.automation), eq(automationRunSchema.dryRun, false), notInArray(automationRunSchema.kind, ['skipped', 'control'])))
    .orderBy(desc(automationRunSchema.startedAt))
    .limit(1);
  return watchStateOf(row ? { name: row.name, status: row.status, pausedAt: row.pausedAt, doConfig: row.doConfig } : null, lastRun ?? null, watch);
}
