/**
 * objects.rename — an agent changes what a record is called.
 *
 * `objects.update_meta` writes the fields a type declares and refuses the
 * row's own columns: "`title` and `status` are the identity and the
 * lifecycle, and each has its own path". For `title` there was no path. An
 * agent that had just narrowed a request's scope could rewrite its story, its
 * summary and its notes, and could not change the name at the top of its
 * page — so the record went on announcing work it was no longer for.
 *
 * Chris, 2026-09-24, on request 121: the share half of "add send/share to
 * file detail page" had already shipped, the remaining gap was the send
 * endpoint and the first mailer, and the factory lead narrowed every field it
 * could reach and then reported: *"the title is a row-level field the
 * platform won't let me write through update_object"*. It was right.
 *
 * A separate action rather than a hole in `RESERVED_OBJECT_KEYS`, for three
 * reasons. A rename is a different decision from a field write — everything
 * that links to a record by name goes stale, which is not true of a priority.
 * It needs its own rung on the trust ladder, because a workspace that lets an
 * agent score a backlog unattended may still want a person on anything that
 * changes what the work is called. And keeping `set` unable to reach the row
 * means a generic bag of fields can still never touch identity by accident,
 * which is the guard that set exists to be.
 *
 * Reversible, like its sibling: the previous title rides on the run, so a
 * rename that read the room wrong is one Undo away.
 */

import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';
import { humanise, loadObjectType } from './objects-propose-candidate';

const RENAME_ACTION_ID = 'objects.rename';

const renameInput = z.object({
  /** Slug of an object type in this org's registry, e.g. `request`. */
  objectType: z.string().min(1).max(200),
  /** The record's id (`business_object.id`). */
  id: z.coerce.number().int().positive(),
  /**
   * What it should be called. Trimmed; a title that is only whitespace, or
   * the one the record already has, is refused rather than written as a
   * no-op run nobody can read.
   */
  title: z.string().min(1).max(500),
  /** Why, in a sentence a person can check. Written on the run. */
  reason: z.string().min(1).max(500),
});

export type RenameInput = z.infer<typeof renameInput>;

type Row = { id: number; title: string };

/**
 * The record, by type and id, scoped to the caller's workspace.
 * @param orgId - The caller's workspace.
 * @param typeId - The object type's row id.
 * @param id - The record's own id.
 * @returns The row, or null when this workspace has no such record.
 */
async function readRow(orgId: string, typeId: number, id: number): Promise<Row | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, typeId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ?? null;
}

/**
 * Write the title on the row.
 * @param orgId - The caller's workspace.
 * @param id - The record's own id.
 * @param title - The new title, already trimmed.
 */
async function writeTitle(orgId: string, id: number, title: string): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db
    .update(businessObjectSchema)
    .set({ title })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

export const objectsRenameAction: Action<typeof renameInput> = {
  id: RENAME_ACTION_ID,
  name: 'Rename a record',
  description: 'Change what an existing record is called — the title at the top of its page and in every list. For work whose scope has genuinely changed, so the name still says what it is for. Reversible: the previous title is one Undo away, and the run carries who renamed it, why, and what it was called before.',
  inputSchema: renameInput,
  grant: 'update_object',
  external: false,
  // The record, not the title: a second thought about what to call the same
  // record refreshes the pending card rather than queuing a rival name.
  dedupKeyFor: input => `${RENAME_ACTION_ID}:${input.objectType.trim().toLowerCase()}:${input.id}`,
  // One ledger per object type, as with `objects.update_meta`: renaming a
  // `request` is not the decision renaming a `product` is.
  policyKeyFor: input => `${RENAME_ACTION_ID}.${input.objectType.trim().toLowerCase()}`,
  async precheck(ctx, input) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    if (!objectType) {
      return `No object type "${input.objectType}" in this workspace. Rename a record of a type the workspace defines.`;
    }
    const row = await readRow(ctx.orgId, objectType.id, input.id);
    if (!row) {
      return `No ${objectType.label.toLowerCase()} #${input.id} in this workspace. Look the record up first; the id is the record's own, not a name.`;
    }
    const next = input.title.trim();
    if (next === '') {
      return 'A title cannot be blank. Say what the record should be called.';
    }
    if (next === row.title) {
      return `That ${objectType.label.toLowerCase()} is already called "${row.title}". Nothing to change.`;
    }
    return undefined;
  },
  async reviewCard(ctx: ActionContext, input): Promise<ReviewCard> {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    const typeLabel = objectType?.label ?? humanise(input.objectType);
    return {
      title: `Rename ${typeLabel.toLowerCase()} #${input.id}`,
      system: typeLabel,
      summary: input.reason,
      fields: [
        { label: 'Now', value: row?.title ?? `#${input.id}`, href: '/dashboard/objects' },
        { label: 'Becomes', value: input.title.trim() },
      ],
      nextAction: 'Approving renames the record everywhere it is listed; the old title stays on this run for Undo.',
      verbs: { approve: 'Rename', reject: 'Keep the name' },
    };
  },
  async execute(ctx, input) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    if (!objectType) {
      throw new Error(`No object type "${input.objectType}" in this workspace.`);
    }
    const row = await readRow(ctx.orgId, objectType.id, input.id);
    if (!row) {
      throw new Error(`No ${objectType.label.toLowerCase()} #${input.id} in this workspace.`);
    }
    const next = input.title.trim();
    // Checked again at execution, not only at proposal: the record may have
    // been renamed by someone else between the card and the approval, and a
    // stale card must not quietly undo their change.
    if (next === row.title) {
      throw new Error(`That ${objectType.label.toLowerCase()} is already called "${row.title}".`);
    }
    await writeTitle(ctx.orgId, row.id, next);
    return {
      objectId: row.id,
      objectType: input.objectType,
      title: next,
      previousTitle: row.title,
      reason: input.reason,
      renamedBy: ctx.invokedBy ?? null,
      reviewedBy: ctx.reviewedBy ?? null,
      runId: ctx.runId ?? null,
      renamedAt: new Date().toISOString(),
    };
  },
  async undo(ctx, input, result) {
    const previousTitle = result.previousTitle as string | undefined;
    if (!previousTitle) {
      throw new Error('This rename recorded no previous title, so there is nothing to restore.');
    }
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    if (!row) {
      throw new Error(`No ${objectType?.label.toLowerCase() ?? input.objectType} #${input.id} in this workspace to restore.`);
    }
    await writeTitle(ctx.orgId, row.id, previousTitle);
    return { restoredTitle: previousTitle, restoredAt: new Date().toISOString() };
  },
};
