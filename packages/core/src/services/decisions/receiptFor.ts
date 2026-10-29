/**
 * THE DONE LINE, READ OFF THE RUN (a teammate's walk, 2026-10-28: a HubSpot
 * update showed "Done —" with a run pill, the body, a sentence on why it ran
 * at once, a record pill and a "Completed · Update HubSpot record · Undo" bar).
 * One line now: "Done. <record> updated: <field> old → new", the record's name
 * the link, one quiet Undo. What changed comes from the run itself — the
 * input, the previous values the run kept (`result.previous`), the describer
 * the review queue uses (`describeActionRun`) — and what an action says it
 * did comes from its result's `receipt` ("Pull request opened" and its link).
 * Never throws: the plain receipt stands when nothing more can be read.
 */

import type { DoneReceipt, ReceiptChange } from '@/libs/decisions/receipt';
import { outcomeOf } from '@/libs/decisions/receipt';

type Meta = Record<string, unknown>;

const obj = (v: unknown): Meta | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Meta : null);

/**
 * A receipt with its record, its changes and the action's own outcome.
 * @param orgId - The workspace.
 * @param base - The receipt as the caller built it.
 * @param run - The run that did it.
 * @param run.actionId - Its action.
 * @param run.input - What it was asked to do.
 * @param run.result - What it returned.
 * @param run.proposal - Its proposal envelope.
 * @param run.invokedBy - Who proposed it.
 */
export async function receiptFor(orgId: string, base: DoneReceipt, run: { actionId: string; input: unknown; result: unknown; proposal?: unknown; invokedBy?: string | null }): Promise<DoneReceipt> {
  try {
    const outcome = outcomeOf(run.result);
    const previous = obj(obj(run.result)?.previous);
    const { describeActionRun, humaniseField } = await import('@/services/inbox/describeActionRun');
    const like = { id: base.runId, actionId: run.actionId, input: { ...(obj(run.input) ?? {}), ...(previous ? { previous } : {}) }, proposal: (obj(run.proposal) ?? {}) as never, invokedBy: run.invokedBy ?? null };
    let described = describeActionRun(like);
    if (described.record?.fromId) {
      const { resolveRecordLabels } = await import('@/services/records/recordLabel');
      const names = await resolveRecordLabels(orgId, [described.record.key]).catch(() => new Map<string, string>());
      if (names.size > 0) {
        described = describeActionRun(like, { recordNames: names });
      }
    }
    const changes: ReceiptChange[] = described.record ? described.changes.map(c => ({ field: humaniseField(c.field), to: c.to, ...(c.from !== undefined ? { from: c.from } : {}) })) : [];
    const record = base.record ?? (described.record ? { label: described.record.name, ...(base.href ? { href: base.href } : {}) } : undefined);
    return {
      ...base,
      ...(record ? { record } : {}),
      ...(changes.length > 0 ? { changes } : {}),
      ...(outcome ? { outcome } : {}),
    };
  } catch {
    return base;
  }
}

/**
 * The same, for a run named only by its id (a card's chosen option that ran).
 * @param orgId - The workspace.
 * @param base - The receipt as the caller built it.
 */
export async function receiptForRun(orgId: string, base: DoneReceipt): Promise<DoneReceipt> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { actionRunSchema } = await import('@/models/Schema');
    const [run] = await db.select({ actionId: actionRunSchema.actionId, input: actionRunSchema.input, result: actionRunSchema.result, proposal: actionRunSchema.proposal, invokedBy: actionRunSchema.invokedBy })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, base.runId)))
      .limit(1);
    return run ? receiptFor(orgId, base, run) : base;
  } catch {
    return base;
  }
}
