/**
 * AnchoredCommentService — the comment layer, beside the document.
 *
 * The layer never mutates document text. That is a property of this file's
 * shape rather than a rule people remember: every write here touches
 * `anchored_comment` and nothing else, and the only time a document is read
 * is to check whether an anchor still resolves. There is no code path from a
 * comment to `lead_brief.sections` or `draft_sequence`.
 */

import type { TextAnchor } from '@/libs/anchors/resolve';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { resolveAnchor } from '@/libs/anchors/resolve';
import { db } from '@/libs/DB';
import { anchoredCommentSchema } from '@/models/Schema';

export type AnchoredCommentRow = typeof anchoredCommentSchema.$inferSelect;

/** A comment plus where it currently points, resolved against live text. */
export type ResolvedComment = AnchoredCommentRow & {
  /** Null when the quoted span is gone — the surface renders it as orphaned. */
  range: { start: number; end: number; exact: boolean } | null;
};

export async function createComment(opts: {
  orgId: string;
  targetRef: string;
  field: string;
  anchor: TextAnchor;
  note: string;
  createdBy?: string;
}): Promise<AnchoredCommentRow> {
  const [row] = await db
    .insert(anchoredCommentSchema)
    .values({
      orgId: opts.orgId,
      targetRef: opts.targetRef,
      field: opts.field,
      anchor: opts.anchor,
      note: opts.note.trim(),
      createdBy: opts.createdBy ?? null,
    })
    .returning();
  return row!;
}

/**
 * Every comment on a target, oldest first. Comments are per user: a
 * reviewer sees their own notes, matching the conversation rule (a note is
 * one half of a conversation turn).
 * @param opts - Lookup key.
 * @param opts.orgId - Tenant.
 * @param opts.targetRef - The document, e.g. `lead_brief:412`.
 * @param opts.createdBy - The requesting user.
 * @returns The user's comments on that target.
 */
export async function listComments(opts: {
  orgId: string;
  targetRef: string;
  createdBy: string;
}): Promise<AnchoredCommentRow[]> {
  return db
    .select()
    .from(anchoredCommentSchema)
    .where(and(
      eq(anchoredCommentSchema.orgId, opts.orgId),
      eq(anchoredCommentSchema.targetRef, opts.targetRef),
      eq(anchoredCommentSchema.createdBy, opts.createdBy),
    ))
    .orderBy(asc(anchoredCommentSchema.id));
}

/**
 * Resolve each comment against the field text it points into, and persist a
 * status change when a span has gone. An orphan is recorded, not hidden: the
 * reviewer asked for something and deserves to know the words moved.
 * @param comments - The stored rows.
 * @param fieldText - Current text per field key.
 * @returns Each comment with its live range, or null when orphaned.
 */
export async function resolveComments(
  comments: AnchoredCommentRow[],
  fieldText: Record<string, string>,
): Promise<ResolvedComment[]> {
  const newlyOrphaned: number[] = [];
  const resolved = comments.map((c) => {
    const text = fieldText[c.field];
    const range = text === undefined ? null : resolveAnchor(text, c.anchor);
    // An ABSENT field is not a missing quote. A caller that has not rendered
    // the document yet, or that asks about one field, knows nothing about the
    // others — recording those as orphaned would destroy good anchors on a
    // race. Only text we were actually given, and searched, can orphan one.
    if (range === null && text !== undefined && c.status === 'open') {
      newlyOrphaned.push(c.id);
    }
    return { ...c, range };
  });
  if (newlyOrphaned.length > 0) {
    await db
      .update(anchoredCommentSchema)
      .set({ status: 'orphaned' })
      .where(inArray(anchoredCommentSchema.id, newlyOrphaned));
    for (const c of resolved) {
      if (newlyOrphaned.includes(c.id)) {
        c.status = 'orphaned';
      }
    }
  }
  return resolved;
}

/**
 * Mark comments applied — called only when an apply verifiably completed,
 * never on a timer, and carrying the run that did it so the action's payload
 * can show what changed.
 * @param opts - What was applied.
 * @param opts.orgId - Tenant.
 * @param opts.ids - The comments the apply covered.
 * @param opts.runId - The action run that applied them.
 * @returns The updated rows.
 */
export async function markApplied(opts: {
  orgId: string;
  ids: number[];
  runId?: number;
}): Promise<AnchoredCommentRow[]> {
  if (opts.ids.length === 0) {
    return [];
  }
  return db
    .update(anchoredCommentSchema)
    .set({ status: 'applied', appliedAt: new Date(), appliedByRunId: opts.runId ?? null })
    .where(and(
      eq(anchoredCommentSchema.orgId, opts.orgId),
      inArray(anchoredCommentSchema.id, opts.ids),
    ))
    .returning();
}

export async function deleteComment(opts: { orgId: string; id: number }): Promise<void> {
  await db
    .delete(anchoredCommentSchema)
    .where(and(eq(anchoredCommentSchema.orgId, opts.orgId), eq(anchoredCommentSchema.id, opts.id)));
}
