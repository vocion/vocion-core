import type { StatusModel } from '@/libs/objects/statusModel';
import { groupOf, readStatusModel, reopens, valueFor } from '@/libs/objects/statusModel';

/**
 * Writing and reading a record's ONE status field (`libs/objects/statusModel.ts`).
 *
 * A writer names a TRANSITION — `building`, `merge_waits`, `shipped` — and the
 * record's own type says which value that writes. A type that declares no
 * status, or no such transition, writes nothing: the caller's work is never
 * held up by its status.
 */

/**
 * The status model of a workspace's object type, or null when it declares none.
 * @param orgId - The workspace.
 * @param typeSlug - The type.
 */
export async function loadStatusModel(orgId: string, typeSlug: string): Promise<StatusModel | null> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { businessObjectTypeSchema } = await import('@/models/Schema');
  const [row] = await db.select({ schema: businessObjectTypeSchema.schema }).from(businessObjectTypeSchema).where(and(eq(businessObjectTypeSchema.orgId, orgId), eq(businessObjectTypeSchema.slug, typeSlug))).limit(1);
  return readStatusModel(row?.schema ?? null);
}

export type MarkOptions = {
  /** The sentence that goes with it ("RUN-478 is building attempt 2"). */
  line?: string | null;
  /** A person's word: may move a finished record back into the work. */
  reopen?: boolean;
  /** Leave a record that already reads finished as it is (a re-run never downgrades it). */
  keepFinished?: boolean;
  at?: string;
};

/**
 * Write the status a transition names on a record. Returns the value written,
 * or null when nothing was: the type declares no status or no such
 * transition, it already reads so, or the record is finished and this is not a person reopening it
 * (FE-224: a late verdict wrote `building` over a shipped request). Never
 * throws — a status that could not be written is logged, and the step that
 * called it goes on.
 * @param orgId - The workspace.
 * @param recordId - The record.
 * @param transition - What happened.
 * @param opts - The line, a person's reopen, the time.
 */
export async function markStatus(orgId: string, recordId: number, transition: string, opts: MarkOptions = {}): Promise<string | null> {
  try {
    const { and, eq, sql } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ meta: businessObjectSchema.metadata, schema: businessObjectTypeSchema.schema, typeSlug: businessObjectTypeSchema.slug })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId)))
      .limit(1);
    const model = row ? readStatusModel(row.schema) : null;
    const value = model ? valueFor(model, transition) : null;
    if (!row || !model || value === null) {
      return null;
    }
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const current = meta[model.field];
    if (!opts.reopen && reopens(model, current, value)) {
      return null;
    }
    if (opts.keepFinished && typeof current === 'string' && current !== '' && groupOf(model, current).role === 'done') {
      return null;
    }
    const line = typeof opts.line === 'string' && opts.line.trim() ? opts.line.trim().slice(0, 600) : null;
    // Already so, in the same words: nothing to write.
    if (current === value && (meta[`${model.field}Line`] ?? null) === line) {
      return null;
    }
    const at = opts.at ?? new Date().toISOString();
    const set = { [model.field]: value, [`${model.field}Line`]: line, [`${model.field}At`]: at };
    await db
      .update(businessObjectSchema)
      .set({ metadata: sql`coalesce(${businessObjectSchema.metadata}, '{}'::jsonb) || ${JSON.stringify(set)}::jsonb`, updatedAt: new Date() })
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId)));
    // ONE EVENT PER MOVE (backlog 057): whatever follows the record hears it.
    // Never on the write's path: a bus that fails leaves the status written.
    await announceStatusMarked(orgId, { recordId, typeSlug: row.typeSlug, field: model.field, value, groupRole: groupOf(model, value).role, transition, line: line ?? '', at });
    return value;
  } catch (err) {
    console.warn('status was not written', { orgId, recordId, transition, message: (err as Error).message });
    return null;
  }
}

/**
 * Raise `record.status_marked` for a status just written. Deduped on the record,
 * the value and the moment; a failure is a warning, never the caller's.
 * @param orgId - The workspace.
 * @param payload - What moved.
 */
async function announceStatusMarked(orgId: string, payload: import('@/services/EventService').RecordStatusMarkedPayload): Promise<void> {
  try {
    const { emitEvent, RECORD_STATUS_MARKED } = await import('@/services/EventService');
    await emitEvent({ orgId, type: RECORD_STATUS_MARKED, payload, dedupeKey: `${RECORD_STATUS_MARKED}:${payload.recordId}:${payload.value}:${payload.at}`, invokedBy: 'system:status', dispatchMode: 'auto' });
  } catch (err) {
    console.warn('record.status_marked was not raised', { orgId, recordId: payload.recordId, message: (err as Error).message });
  }
}

/**
 * A record's status as it stands, as the fields an Undo writes back — or null
 * when its type declares none.
 * @param orgId - The workspace.
 * @param recordId - The record.
 */
export async function statusSnapshot(orgId: string, recordId: number): Promise<Record<string, unknown> | null> {
  try {
    const { and, eq } = await import('drizzle-orm');
    const { db } = await import('@/libs/DB');
    const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
    const [row] = await db
      .select({ meta: businessObjectSchema.metadata, schema: businessObjectTypeSchema.schema })
      .from(businessObjectSchema)
      .innerJoin(businessObjectTypeSchema, eq(businessObjectTypeSchema.id, businessObjectSchema.typeId))
      .where(and(eq(businessObjectSchema.orgId, orgId), eq(businessObjectSchema.id, recordId)))
      .limit(1);
    const model = row ? readStatusModel(row.schema) : null;
    if (!row || !model) {
      return null;
    }
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const keys = [model.field, `${model.field}Line`, `${model.field}At`];
    return Object.fromEntries(keys.map(k => [k, meta[k] ?? null]));
  } catch {
    return null;
  }
}
