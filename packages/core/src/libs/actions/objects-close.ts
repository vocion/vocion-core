/**
 * objects.close — a record is closed, or retired, for a reason its type names.
 *
 * Conversations 417–422 (2026-10-01, Squatch Factory). The QA user said
 * "retire REPO-312 … Do it now, don't ask me" and "Close FE-318 as already
 * fixed". The product manager answered "I can mark #312 retired" and did
 * nothing, then said it could not close FE-318 because "the system won't
 * accept state=shipped without QA verifying". Both were true of the paths it
 * had: `objects.update_meta` refuses `status` (the row's lifecycle has "its
 * own path"; for closing there was none), and the only closing state it
 * reached for was `shipped`, whose gate rightly asks QA's evidence for a
 * change the factory never made.
 *
 * Closing is a decision with a reason, not a field write. So a type declares,
 * in its schema, the ways a record of it closes (`x-close`), each a typed
 * reason a person's word picks, and what that reason writes:
 *
 *   x-close:
 *     field: closedAs         # declared field the reason is written to
 *     note: closedNote        # declared field the person's why is written to
 *     reasons:
 *       fixed_elsewhere: {label: Already fixed elsewhere, set: {state: answered}}
 *       duplicate: {label: Duplicate, ref: duplicateOf}   # needs the record it duplicates
 *       deferred: {label: Not now, set: {state: deferred}, note: deferReason}
 *       retired: {label: Retired, status: retired}        # the row's own status
 *
 * Core names no type, state or reason: it reads them from the definition.
 * A record that is still a pending candidate is not closed by a write — its
 * card is the decision, so the card is rejected, as the person.
 *
 * Reversible: the previous field values, row status and card state ride on
 * the run, so Undo puts the record back exactly. Low risk by default, keyed
 * per type (`objects.close.<type>`), so a workspace can hold an agent's own
 * close at a person while a person's word runs at once (`runProposal`).
 */

import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';
import { humanise, loadObjectType } from './objects-propose-candidate';

const CLOSE_ACTION_ID = 'objects.close';

/** One way a record of a type closes, as the type declares it. */
export type CloseReason = {
  /** What a person reads for it. */
  label?: string;
  /** Declared fields this reason writes, e.g. `{state: answered}`. */
  set?: Record<string, unknown>;
  /** A declared field that takes the id of another record (`duplicateOf`). */
  ref?: string;
  /** A declared field the person's note is also written to (`deferReason`). */
  note?: string;
  /** The row's own status this reason sets (`retired`). */
  status?: string;
};

/** A type's closing definition (`schema['x-close']`). */
export type CloseDefinition = {
  field?: string;
  note?: string;
  reasons: Record<string, CloseReason>;
};

/**
 * The type's closing definition, or null when it declares none.
 * @param schema - The object type's JSON Schema.
 */
export function closeDefinitionOf(schema: Record<string, unknown> | null | undefined): CloseDefinition | null {
  const raw = schema?.['x-close'] as { field?: unknown; note?: unknown; reasons?: unknown } | undefined;
  if (!raw || typeof raw !== 'object' || !raw.reasons || typeof raw.reasons !== 'object' || Array.isArray(raw.reasons)) {
    return null;
  }
  const reasons = Object.fromEntries(Object.entries(raw.reasons as Record<string, unknown>).filter(([, v]) => v && typeof v === 'object')) as Record<string, CloseReason>;
  if (Object.keys(reasons).length === 0) {
    return null;
  }
  return {
    reasons,
    ...(typeof raw.field === 'string' ? { field: raw.field } : {}),
    ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
  };
}

/**
 * The reasons a type closes for, one line each, for a tool description or a
 * refusal: `fixed_elsewhere (Already fixed elsewhere), duplicate (needs the record it duplicates)`.
 * @param def - The type's closing definition.
 */
export function describeCloseReasons(def: CloseDefinition): string {
  return Object.entries(def.reasons).map(([key, r]) => {
    const bits = [r.label, r.ref ? `needs the other record, written to ${r.ref}` : null].filter(Boolean);
    return bits.length > 0 ? `${key} (${bits.join('; ')})` : key;
  }).join(', ');
}

const closeInput = z.object({
  /** Slug of an object type in this org's registry. */
  objectType: z.string().min(1).max(200),
  /** The record's id (`business_object.id`). */
  id: z.coerce.number().int().positive(),
  /** One of the reasons the type declares under `x-close.reasons`. */
  closeAs: z.string().min(1).max(80),
  /** The person's why, in their words. Written on the record and the run. */
  note: z.string().min(1).max(1_000),
  /** The other record, for a reason that names one (`ref:`), e.g. the request this duplicates. */
  ref: z.coerce.number().int().positive().optional(),
});

export type CloseInput = z.infer<typeof closeInput>;

type Row = { id: number; title: string; status: string | null; reviewActionRunId: number | null; metadata: Record<string, unknown> };

async function readRow(orgId: string, typeId: number, id: number): Promise<Row | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, reviewActionRunId: businessObjectSchema.reviewActionRunId, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, typeId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ? { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> } : null;
}

async function writeStatus(orgId: string, id: number, status: string | null): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db.update(businessObjectSchema).set({ status }).where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

/**
 * The pending card a candidate record is waiting on, when it is one.
 * @param orgId - The workspace.
 * @param row - The record.
 */
async function pendingCandidateCard(orgId: string, row: Row): Promise<number | null> {
  if (!row.reviewActionRunId) {
    return null;
  }
  const { CANDIDATE_STATUS } = await import('./objects-propose-candidate');
  if (row.status !== CANDIDATE_STATUS.proposed) {
    return null;
  }
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { actionRunSchema } = await import('@/models/Schema');
  const [run] = await db.select({ status: actionRunSchema.status }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, row.reviewActionRunId))).limit(1);
  return run?.status === 'pending' ? row.reviewActionRunId : null;
}

/**
 * The declared fields this close writes: the reason's own `set`, the reason
 * itself, the note, and the record it names.
 * @param def - The type's closing definition.
 * @param input - The close.
 */
export function closeFields(def: CloseDefinition, input: Pick<CloseInput, 'closeAs' | 'note' | 'ref'>): Record<string, unknown> {
  const reason = def.reasons[input.closeAs]!;
  return {
    ...(reason.set ?? {}),
    ...(def.field ? { [def.field]: input.closeAs } : {}),
    ...(def.note ? { [def.note]: input.note } : {}),
    ...(reason.note ? { [reason.note]: input.note } : {}),
    ...(reason.ref && input.ref ? { [reason.ref]: input.ref } : {}),
  };
}

/**
 * Why this close cannot run, or nothing.
 * @param orgId - The workspace.
 * @param input - The close.
 */
async function refuseClose(orgId: string, input: CloseInput): Promise<string | undefined> {
  const objectType = await loadObjectType(orgId, input.objectType);
  if (!objectType) {
    return `No object type "${input.objectType}" in this workspace.`;
  }
  const def = closeDefinitionOf(objectType.schema);
  if (!def) {
    return `A ${objectType.label.toLowerCase()} declares no way to close (its type has no \`x-close\`). Add the reasons it closes for to the type first.`;
  }
  const reason = def.reasons[input.closeAs];
  if (!reason) {
    return `A ${objectType.label.toLowerCase()} does not close as "${input.closeAs}". It closes as: ${describeCloseReasons(def)}.`;
  }
  if (reason.ref && !input.ref) {
    return `Closing a ${objectType.label.toLowerCase()} as ${input.closeAs} names the other record (its id or code, written to ${reason.ref}).`;
  }
  if (reason.ref && input.ref === input.id) {
    return `A record cannot be closed as ${input.closeAs} of itself.`;
  }
  const row = await readRow(orgId, objectType.id, input.id);
  if (!row) {
    return `No ${objectType.label.toLowerCase()} #${input.id} in this workspace. Look the record up first; the id is the record's own, not a name.`;
  }
  return undefined;
}

export const objectsCloseAction: Action<typeof closeInput> = {
  id: CLOSE_ACTION_ID,
  name: 'Close or retire a record',
  description: 'Close a record for one of the reasons its type declares — already fixed elsewhere, a duplicate, deferred, out of scope, answered, retired — writing the reason, the person\'s note and the state the reason names. A record still waiting as a candidate has its card rejected instead. Reversible: Undo puts the fields, the status and the card back.',
  inputSchema: closeInput,
  grant: 'update_object',
  external: false,
  dedupKeyFor: input => `${CLOSE_ACTION_ID}:${input.objectType.trim().toLowerCase()}:${input.id}`,
  policyKeyFor: input => `${CLOSE_ACTION_ID}.${input.objectType.trim().toLowerCase()}`,
  async precheck(ctx, input) {
    return refuseClose(ctx.orgId, input);
  },
  async reviewCard(ctx: ActionContext, input): Promise<ReviewCard> {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    const typeLabel = objectType?.label ?? humanise(input.objectType);
    const def = objectType ? closeDefinitionOf(objectType.schema) : null;
    const { recordHref } = await import('@/services/objects/recordHref');
    return {
      title: `Close ${typeLabel.toLowerCase()}: ${row?.title ?? `#${input.id}`}`,
      system: typeLabel,
      summary: input.note,
      fields: [
        { label: 'Record', value: row ? `${row.title} (#${input.id})` : `${typeLabel} #${input.id}`, href: await recordHref(ctx.orgId, { objectType: input.objectType, id: input.id }) },
        { label: 'Closes as', value: def?.reasons[input.closeAs]?.label ?? humanise(input.closeAs) },
        ...(input.ref ? [{ label: 'Names', value: `#${input.ref}` }] : []),
      ],
      nextAction: 'Approving closes the record for this reason; Undo puts it back as it was.',
      verbs: { approve: 'Close', reject: 'Keep it open' },
    };
  },
  async execute(ctx, input) {
    const refusal = await refuseClose(ctx.orgId, input);
    if (refusal) {
      throw new Error(refusal);
    }
    const objectType = (await loadObjectType(ctx.orgId, input.objectType))!;
    const def = closeDefinitionOf(objectType.schema)!;
    const reason = def.reasons[input.closeAs]!;
    const row = (await readRow(ctx.orgId, objectType.id, input.id))!;
    const by = ctx.reviewedBy ?? ctx.invokedBy;
    const record = { objectType: input.objectType, id: row.id };
    // A CANDIDATE IS CLOSED BY ITS CARD. It never became a record anyone
    // approved, so rejecting the card it waits on — as the person, whoever
    // filed it — is the close, and the candidate reads rejected.
    const card = await pendingCandidateCard(ctx.orgId, row);
    if (card) {
      const { rejectAction } = await import('@/services/ActionService');
      await rejectAction(card, ctx.orgId, `${reason.label ?? humanise(input.closeAs)}: ${input.note}`.slice(0, 1_000), { reviewedBy: by });
      return { record, objectId: row.id, objectType: input.objectType, title: row.title, closedAs: input.closeAs, candidateCard: card, previousStatus: row.status, note: input.note, closedBy: by ?? null, closedAt: new Date().toISOString() };
    }
    // The fields, through the one write path every record field takes: the
    // type's schema checks each value, the body versions, `object.updated`
    // is raised, and the previous values are kept for Undo.
    const set = closeFields(def, input);
    const { objectsUpdateMetaAction } = await import('./objects-update-meta');
    const written = Object.keys(set).length > 0
      ? await objectsUpdateMetaAction.execute(ctx, { objectType: input.objectType, id: row.id, set, reason: `${reason.label ?? humanise(input.closeAs)}: ${input.note}`.slice(0, 500) }) as Record<string, unknown>
      : null;
    if (reason.status && reason.status !== row.status) {
      await writeStatus(ctx.orgId, row.id, reason.status);
    }
    return {
      record,
      objectId: row.id,
      objectType: input.objectType,
      title: row.title,
      closedAs: input.closeAs,
      updated: Object.keys(set).sort(),
      previous: (written?.previous ?? {}) as Record<string, unknown>,
      ...(reason.status ? { status: reason.status, previousStatus: row.status } : {}),
      note: input.note,
      closedBy: by ?? null,
      closedAt: new Date().toISOString(),
    };
  },
  async undo(ctx, input, result) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    if (!row) {
      throw new Error(`No ${objectType?.label.toLowerCase() ?? input.objectType} #${input.id} in this workspace to reopen.`);
    }
    const card = Number(result.candidateCard);
    if (Number.isInteger(card) && card > 0) {
      // The card back in front of a person, and the candidate waiting on it.
      const { and, eq } = await import('drizzle-orm');
      const { db } = await import('@/libs/DB');
      const { actionRunSchema } = await import('@/models/Schema');
      await db.update(actionRunSchema).set({ status: 'pending', error: null, executedAt: null, decidedBy: null, decidedAt: null }).where(and(eq(actionRunSchema.orgId, ctx.orgId), eq(actionRunSchema.id, card)));
      await writeStatus(ctx.orgId, row.id, (result.previousStatus as string | null) ?? null);
      return { reopened: row.id, card, restoredAt: new Date().toISOString() };
    }
    const previous = result.previous as Record<string, unknown> | undefined;
    if (previous && Object.keys(previous).length > 0) {
      const { objectsUpdateMetaAction } = await import('./objects-update-meta');
      await objectsUpdateMetaAction.undo!(ctx, { objectType: input.objectType, id: row.id, set: previous, reason: `Reopened: ${input.note}`.slice(0, 500) }, { previous });
    }
    if ('previousStatus' in result) {
      await writeStatus(ctx.orgId, row.id, (result.previousStatus as string | null) ?? null);
    }
    return { reopened: row.id, restored: Object.keys(previous ?? {}), restoredAt: new Date().toISOString() };
  },
};
