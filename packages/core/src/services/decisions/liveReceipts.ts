/**
 * A DONE RECEIPT SAYS WHAT ITS RUN IS NOW.
 *
 * A turn's Done line is stored with the turn (`runs_json`), but Undo happens
 * after: from the line itself, from Review's Decided tab, from another tab.
 * So when a transcript is read back, each receipt is stamped with its run's
 * status as it stands — an undone run reads "Undone" with no Undo, never a
 * second Undo on something already taken back. Scoped to the workspace.
 * Never throws: a transcript that cannot be stamped is returned as stored.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

type Row = { runsJson?: unknown };

/**
 * The receipt entries of one row's runs.
 * @param runs - The row's `runs_json`.
 */
function receiptsIn(runs: unknown): Array<{ type: 'receipt'; receipt: { runId?: unknown; status?: unknown } }> {
  return Array.isArray(runs)
    ? runs.filter((r): r is { type: 'receipt'; receipt: { runId?: unknown } } => !!r && typeof r === 'object' && (r as { type?: unknown }).type === 'receipt' && !!(r as { receipt?: unknown }).receipt)
    : [];
}

/**
 * The rows, each receipt marked `undone` where its run has been undone since.
 * @param orgId - The workspace.
 * @param rows - The transcript's rows, oldest first.
 */
export async function withLiveReceipts<T extends Row>(orgId: string, rows: T[]): Promise<T[]> {
  const ids = [...new Set(rows.flatMap(r => receiptsIn(r.runsJson).map(e => e.receipt.runId).filter((id): id is number => typeof id === 'number')))];
  if (ids.length === 0) {
    return rows;
  }
  try {
    const found = await db
      .select({ id: actionRunSchema.id })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, ids), eq(actionRunSchema.status, 'undone')));
    const undone = new Set(found.map(r => r.id));
    if (undone.size === 0) {
      return rows;
    }
    return rows.map((row) => {
      if (!receiptsIn(row.runsJson).some(e => undone.has(e.receipt.runId as number))) {
        return row;
      }
      return {
        ...row,
        runsJson: (row.runsJson as unknown[]).map((r) => {
          const e = r as { type?: unknown; receipt?: { runId?: unknown } };
          return e?.type === 'receipt' && e.receipt && undone.has(e.receipt.runId as number) ? { ...e, receipt: { ...e.receipt, status: 'undone' } } : r;
        }),
      };
    });
  } catch {
    return rows;
  }
}
