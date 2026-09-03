import { os } from '@orpc/server';
import { z } from 'zod';
import {
  createComment,
  deleteComment,
  listComments,
  markApplied,
  resolveComments,
} from '@/services/AnchoredCommentService';
import { guardAuth } from './AuthGuards';

const anchorInput = z.object({
  quote: z.string().min(1).max(4000),
  prefix: z.string().max(200),
  suffix: z.string().max(200),
});

/** The reviewer's own comments on a target, each resolved against live text. */
export const list = os
  .input(z.object({
    targetRef: z.string().min(1).max(120),
    /** Current text per field, so an anchor resolves against what is on screen. */
    fieldText: z.record(z.string(), z.string()).default({}),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    if (!userId) {
      return [];
    }
    const rows = await listComments({ orgId, targetRef: input.targetRef, createdBy: userId });
    return resolveComments(rows, input.fieldText);
  });

export const create = os
  .input(z.object({
    targetRef: z.string().min(1).max(120),
    field: z.string().min(1).max(200),
    anchor: anchorInput,
    note: z.string().min(1).max(2000),
  }))
  .handler(async ({ input }) => {
    const { orgId, userId } = await guardAuth();
    return createComment({
      orgId,
      targetRef: input.targetRef,
      field: input.field,
      anchor: input.anchor,
      note: input.note,
      createdBy: userId ?? undefined,
    });
  });

/** Applied only when the change verifiably landed — never on a timer. */
export const apply = os
  .input(z.object({
    ids: z.array(z.number().int().positive()).min(1).max(50),
    runId: z.number().int().positive().optional(),
  }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    return markApplied({ orgId, ids: input.ids, runId: input.runId });
  });

export const remove = os
  .input(z.object({ id: z.number().int().positive() }))
  .handler(async ({ input }) => {
    const { orgId } = await guardAuth();
    await deleteComment({ orgId, id: input.id });
    return { ok: true };
  });
