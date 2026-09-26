/**
 * objects.update_meta — an agent writes fields on a record that already
 * exists.
 *
 * `objects.propose_candidate` creates a record for a person to judge, and
 * `POST /api/v1/objects` lets an outside system write one — but nothing let
 * an agent inside the app set a field on a record it was reading. The
 * product manager could score a backlog and not write `priority` on the
 * request; a check that resolved an open thread could not mark it so.
 *
 * Domain-free, like the candidate action: the workspace's object type is the
 * contract. Only fields the type's schema declares may be written, and each
 * value is checked against that field's schema, so a `state` outside its enum
 * or a `priority` given as prose is refused before any row exists. The row's
 * own columns — `title`, `status`, `id` and the rest of the bookkeeping —
 * are never written through here: they are the record's identity and
 * lifecycle, and each has its own path.
 *
 * Every write is reversible (`undo` restores the previous values, which
 * `execute` records on the run) and low-risk by default, so a confident
 * update is done for you with Undo one move away; a workspace that wants a
 * person on every write to a type parks the kind in `trust.yaml`. The
 * action runs ARE the record's write history: each carries who wrote what,
 * why, and what was there before, under a dedup key that names the record
 * and the fields — so two pending proposals about the same fields collapse,
 * and two about different fields stand.
 *
 * One action, one ledger per object type. Writing a `request`'s priority
 * is not the decision writing a `product`'s promises is, so the trust rule,
 * the risk tier and the alignment evidence live under
 * `objects.update_meta.<objectType>` (`policyKeyFor`, the way `git.merge`
 * keys on its risk class) while the proposal still names the action. A
 * type nobody has written a rule for reads the action's own default — low,
 * reversible, done for you — through `actionForPolicyKey`.
 */

import type { Action, ActionContext, ReviewCard } from './types';
import { z } from 'zod';
import { evaluateGates, gateRefusal, gatesOf } from '@/libs/gates/handoffGate';
import { describeSchemaProblems, displayValue, humanise, loadObjectType } from './objects-propose-candidate';

const UPDATE_ACTION_ID = 'objects.update_meta';

/**
 * Keys that are the row, not the record's fields. Each has its own path —
 * `title` and `status` are the identity and the lifecycle, the rest is
 * bookkeeping core writes — and a metadata key of the same name would shadow
 * the column wherever the two are read side by side (`lookup_objects`).
 */
export const RESERVED_OBJECT_KEYS: ReadonlySet<string> = new Set([
  'id',
  'title',
  'status',
  'summary',
  'orgId',
  'projectId',
  'typeId',
  'type',
  'externalSystem',
  'externalId',
  'reviewActionRunId',
  'provenance',
  'createdBy',
  'createdAt',
  'updatedAt',
  'dedupOn',
]);

const updateMetaInput = z.object({
  /** Slug of an object type in this org's registry, e.g. `request`. */
  objectType: z.string().min(1).max(200),
  /** The record's id (`business_object.id`). */
  id: z.coerce.number().int().positive(),
  /**
   * The fields to write, by name. `null` clears a field. Only fields the
   * object type declares; never `title`, `status` or the row's bookkeeping.
   */
  set: z.record(z.string().min(1).max(120), z.unknown()).refine(s => Object.keys(s).length > 0, 'set must name at least one field'),
  /** Why, in a sentence a person can check. Written on the run. */
  reason: z.string().min(1).max(500),
});

export type UpdateMetaInput = z.infer<typeof updateMetaInput>;

type Row = {
  id: number;
  title: string;
  status: string | null;
  metadata: Record<string, unknown>;
};

/**
 * The record, when this org owns one of this type under this id.
 * @param orgId
 * @param typeId
 * @param id
 */
async function readRow(orgId: string, typeId: number, id: number): Promise<Row | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  const [row] = await db
    .select({ id: businessObjectSchema.id, title: businessObjectSchema.title, status: businessObjectSchema.status, metadata: businessObjectSchema.metadata })
    .from(businessObjectSchema)
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.typeId, typeId), eq(businessObjectSchema.id, id)))
    .limit(1);
  return row ? { ...row, metadata: (row.metadata ?? {}) as Record<string, unknown> } : null;
}

async function writeMetadata(orgId: string, id: number, metadata: Record<string, unknown>): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectSchema } = await import('@/models/Schema');
  await db
    .update(businessObjectSchema)
    .set({ metadata })
    .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, id)));
}

/**
 * Whether this object type asked for a picture of itself.
 *
 * Same gate as the gap check: `visuals` is a field a type DECLARES, and a
 * type that never modelled it is a type whose author wants nothing drawn.
 * @param schema - The object type's JSON schema.
 */
function declaresVisuals(schema: { properties?: Record<string, unknown> } | null | undefined): boolean {
  return 'visuals' in ((schema?.properties ?? {}) as Record<string, unknown>);
}

/**
 * Redraw this record's picture, when the write could have changed what it
 * says (`services/factory/proposalVisual.ts`).
 *
 * Imported here rather than at the top of the file, for the reason `readRow`
 * is: this module reaches the database handle, which validates the whole
 * environment at import, and the action registry is loaded by tests that
 * configure none.
 *
 * Never throws. This hangs off a write that has already landed, and a picture
 * that could not be drawn must not fail the turn that was the point of.
 * @param orgId - The workspace.
 * @param id - The record.
 * @param meta - Its metadata after the write.
 * @param written - The field keys the write touched.
 */
async function redraw(orgId: string, id: number, meta: Record<string, unknown>, written: string[]) {
  const { ensureProposalVisual, redrawNeeded } = await import('@/services/factory/proposalVisual');
  if (!redrawNeeded(written)) {
    return null;
  }
  return ensureProposalVisual({ orgId, requestId: id, meta, author: { kind: 'system' } })
    .catch((err: unknown) => ({ status: 'skipped' as const, reason: (err as Error).message ?? 'unknown error' }));
}

/**
 * The next metadata: the current bag with `set` applied, `null` deleting.
 * @param current
 * @param set
 */
function applySet(current: Record<string, unknown>, set: Record<string, unknown>): Record<string, unknown> {
  const next = { ...current };
  for (const [key, value] of Object.entries(set)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

/**
 * What the record said for these keys before the write — `undefined` for a
 * key it did not have, so undo can delete rather than write `undefined`.
 * @param current
 * @param keys
 */
function previousValues(current: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map(k => [k, k in current ? current[k] : null]));
}

/**
 * The type's declared fields in a stable order for a message: the schema's
 * `propertyOrder` first, then the rest alphabetically. The schema is jsonb,
 * which keeps no author order, so without this the same refusal would list
 * the fields differently from one read to the next.
 * @param schema
 * @param properties
 */
function declaredFieldOrder(schema: Record<string, unknown> | null, properties: Record<string, unknown>): string[] {
  const stated = Array.isArray(schema?.propertyOrder) ? (schema.propertyOrder as unknown[]).map(String).filter(k => k in properties) : [];
  const rest = Object.keys(properties).filter(k => !stated.includes(k)).sort();
  return [...stated, ...rest];
}

/**
 * Why this write is not allowed, in words the caller can act on, or nothing.
 * Checks the type exists and declares fields, every key is declared and not
 * reserved, and every value fits its field's schema.
 * @param schema - The type's JSON Schema.
 * @param typeSlug
 * @param set
 */
async function refuseWrite(schema: Record<string, unknown> | null, typeSlug: string, set: Record<string, unknown>): Promise<string | undefined> {
  const properties = (schema?.properties ?? null) as Record<string, Record<string, unknown>> | null;
  if (!properties || Object.keys(properties).length === 0) {
    return `Object type "${typeSlug}" declares no fields in its schema, so nothing can be written on it. Add the fields to the type first.`;
  }
  const declared = declaredFieldOrder(schema, properties);
  const keys = Object.keys(set).sort();
  const reserved = keys.filter(k => RESERVED_OBJECT_KEYS.has(k));
  if (reserved.length > 0) {
    return `${reserved.join(', ')} ${reserved.length === 1 ? 'is' : 'are'} not a field of the record but the row itself and cannot be written here. Fields on "${typeSlug}": ${declared.join(', ')}.`;
  }
  const unknown = keys.filter(k => !(k in properties));
  if (unknown.length > 0) {
    return `Object type "${typeSlug}" declares no field ${unknown.map(k => `"${k}"`).join(', ')}. Fields it declares: ${declared.join(', ')}. Add the field to the type before writing it.`;
  }
  // Each value against its own field's schema, and only the fields being
  // set: the type's `required` list is about the whole record, and a record
  // already missing one must still accept a write to another.
  const touched = Object.fromEntries(keys.filter(k => set[k] !== null).map(k => [k, set[k]]));
  if (Object.keys(touched).length === 0) {
    return undefined;
  }
  const partial = { type: 'object', properties: Object.fromEntries(Object.keys(touched).map(k => [k, properties[k]])) };
  const problems = await describeSchemaProblems(partial, touched);
  if (problems.length > 0) {
    return `The values do not fit "${typeSlug}": ${problems.join('; ')}.`;
  }
  return undefined;
}

export const objectsUpdateMetaAction: Action<typeof updateMetaInput> = {
  id: UPDATE_ACTION_ID,
  name: 'Update a record\'s fields',
  description: 'Write one or more declared fields on an existing record of a workspace object type — a priority, a state, a link to what answered it. Only fields the type declares, checked against its schema; never the title or the lifecycle status. Reversible: the previous values are one Undo away, and every write is on the record\'s run history with who, why and what was there before.',
  inputSchema: updateMetaInput,
  grant: 'update_object',
  external: false,
  // The record and the fields: a re-scored priority refreshes the pending
  // card for that score; a write to other fields on the same record stands
  // beside it.
  dedupKeyFor: input => `${UPDATE_ACTION_ID}:${input.objectType.trim().toLowerCase()}:${input.id}:${Object.keys(input.set).sort().join(',')}`,
  // The ladder's key: one ledger per object type, so `product` can be held
  // at approval while `request` earns its way. A rule for the bare id binds
  // to nothing, as with `git.merge`.
  //
  // A PRODUCT DECISION IS ITS OWN KIND (red team, 2026-09-26: asked "what
  // should I decide right now", the PM deferred a proposal itself, done for
  // you). Writing a request's verdict — deferred, out of scope, answered, a
  // recommendation approved or rejected — keys to `…request.decision`, so a
  // workspace can hold decisions at a person while every other field earns.
  policyKeyFor: (input) => {
    const type = input.objectType.trim().toLowerCase();
    const set = (input.set ?? {}) as Record<string, unknown>;
    const decides = type === 'request' && (
      ['deferred', 'out_of_scope', 'answered'].includes(String(set.state ?? ''))
      || ['approved', 'rejected', 'deferred'].includes(String(set.recommendationState ?? ''))
    );
    return decides ? `${UPDATE_ACTION_ID}.request.decision` : `${UPDATE_ACTION_ID}.${type}`;
  },
  async precheck(ctx, input) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    if (!objectType) {
      return `No object type "${input.objectType}" in this workspace. Write to a type the workspace defines, or have the type added first.`;
    }
    const refusal = await refuseWrite(objectType.schema, input.objectType, input.set);
    if (refusal) {
      return refusal;
    }
    const row = await readRow(ctx.orgId, objectType.id, input.id);
    if (!row) {
      return `No ${objectType.label.toLowerCase()} #${input.id} in this workspace. Look the record up first; the id is the record's own, not a name.`;
    }
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    // DECLARED gates (`gates:` on the type): the deterministic half of the
    // handoff check. A failing transition is refused, and the record is
    // marked returned to the seat that produced it so Work says so — the
    // seat fixes the work; nobody is interrupted (libs/gates/handoffGate.ts).
    const failure = evaluateGates(gatesOf(objectType.schema), meta, input.set);
    if (failure) {
      await writeMetadata(ctx.orgId, row.id, {
        ...meta,
        returnedTo: failure.gate.producedBy,
        gate: { name: failure.gate.name, to: failure.to, failed: failure.failed, at: new Date().toISOString() },
      }).catch(() => undefined);
      return gateRefusal(failure, objectType.label);
    }
    return undefined;
  },
  async reviewCard(ctx: ActionContext, input): Promise<ReviewCard> {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const properties = (objectType?.schema?.properties ?? {}) as Record<string, { title?: string }>;
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    const typeLabel = objectType?.label ?? humanise(input.objectType);
    const fields: ReviewCard['fields'] = [
      { label: 'Record', value: row ? `${row.title} (#${input.id})` : `${typeLabel} #${input.id}`, href: '/dashboard/objects' },
    ];
    for (const [key, value] of Object.entries(input.set)) {
      const before = row && key in row.metadata ? displayValue(row.metadata[key]) : '';
      const after = value === null ? '' : displayValue(value);
      fields.push({
        label: properties[key]?.title ?? humanise(key),
        value: before ? `${before} → ${after || '(cleared)'}` : after || '(cleared)',
      });
    }
    return {
      title: `Update ${typeLabel.toLowerCase()}: ${row?.title ?? `#${input.id}`}`,
      system: typeLabel,
      summary: input.reason,
      fields,
      nextAction: 'Approving writes these fields on the record; the previous values stay on this run for Undo.',
      verbs: { approve: 'Update', reject: 'Leave as is' },
    };
  },
  async execute(ctx, input) {
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    if (!objectType) {
      throw new Error(`No object type "${input.objectType}" in this workspace.`);
    }
    // The contract is checked again at execution: the type may have changed
    // between the proposal and the approval, and a value the schema no
    // longer accepts must not land because a card was approved.
    const refusal = await refuseWrite(objectType.schema, input.objectType, input.set);
    if (refusal) {
      throw new Error(refusal);
    }
    const row = await readRow(ctx.orgId, objectType.id, input.id);
    if (!row) {
      throw new Error(`No ${objectType.label.toLowerCase()} #${input.id} in this workspace.`);
    }
    // Sorted: the input comes back from jsonb in no particular order, and the
    // history should read the same however it was stored.
    const keys = Object.keys(input.set).sort();
    const previous = previousValues(row.metadata, keys);
    // A write that crosses a gated transition and passes clears the return:
    // the seat did the work the gate asked for.
    const crossedGates = gatesOf(objectType.schema).filter(g => typeof input.set[g.when.field] === 'string' && g.when.becomes.includes(input.set[g.when.field] as string) && row.metadata[g.when.field] !== input.set[g.when.field]);
    const crossed = crossedGates.length > 0;
    const next = applySet(row.metadata, crossed && 'returnedTo' in row.metadata ? { ...input.set, returnedTo: null, gate: null } : input.set);
    await writeMetadata(ctx.orgId, row.id, next);
    // THE JUDGE runs after the write, best-effort and off the request's
    // critical path: the deterministic gate passed, and now the seat's
    // rubric reads the record. Pass stamps it; return undoes the transition
    // and marks the seat; escalate files an ask (services/gates/handoffJudge.ts).
    for (const gate of crossedGates) {
      if (!gate.judge) {
        continue;
      }
      const judge = gate.judge;
      void (async () => {
        const { judgeHandoff, realJudgeDeps } = await import('@/services/gates/handoffJudge');
        const deps = await realJudgeDeps(ctx.orgId, row.id, gate.producedBy);
        const out = await judgeHandoff({ typeLabel: objectType.label, gate, judge, recordId: row.id, title: row.title, previous: row.metadata[gate.when.field], after: next }, deps);
        console.warn('handoff judge', { gate: gate.name, recordId: row.id, ran: out.ran, outcome: out.outcome, confidence: out.verdict?.confidence, reasonCode: out.verdict?.reasonCode });
      })().catch(err => console.warn('handoff judge crashed', { gate: gate.name, recordId: row.id, message: (err as Error).message }));
    }
    // The picture the board draws this outcome as, redrawn from what the
    // record now says. It hangs off the write rather than being asked of an
    // agent, because a visual an agent has to remember is a visual sixteen of
    // twenty-five rows did not have. Gated on the type DECLARING `visuals`,
    // the same way the gap gate is gated on `gapCheck`: this action is
    // domain-free and must stay so.
    const visual = declaresVisuals(objectType.schema) ? await redraw(ctx.orgId, row.id, next, keys) : null;
    // The run is the record's history: who wrote what, why, and what was
    // there before — in one place, queryable by the dedup key's prefix.
    return {
      objectId: row.id,
      objectType: input.objectType,
      title: row.title,
      updated: keys,
      set: input.set,
      previous,
      ...(visual === null ? {} : { visual }),
      reason: input.reason,
      writtenBy: ctx.invokedBy ?? null,
      reviewedBy: ctx.reviewedBy ?? null,
      runId: ctx.runId ?? null,
      writtenAt: new Date().toISOString(),
    };
  },
  // Reversible: the previous values go back, a field that was absent is
  // removed again. This is what lets a confident update run on its own.
  async undo(ctx, input, result) {
    const previous = result.previous as Record<string, unknown> | undefined;
    if (!previous) {
      throw new Error('This update recorded no previous values, so there is nothing to restore.');
    }
    const objectType = await loadObjectType(ctx.orgId, input.objectType);
    const row = objectType ? await readRow(ctx.orgId, objectType.id, input.id) : null;
    if (!row) {
      throw new Error(`No ${objectType?.label.toLowerCase() ?? input.objectType} #${input.id} in this workspace to restore.`);
    }
    await writeMetadata(ctx.orgId, row.id, applySet(row.metadata, previous));
    return { restored: Object.keys(previous), restoredAt: new Date().toISOString() };
  },
};
