import type { DeliveredEvent, DurableContext, EventSpec, WaitForEventOptions } from './types';

/**
 * The kinds of event that answer a wait: `any`, plus the `types`/`match`
 * shorthand.
 * @param o - The wait.
 */
export function specsOf(o: WaitForEventOptions): EventSpec[] {
  const specs = [...(o.any ?? [])];
  if (o.types && o.types.length > 0) {
    specs.push({ types: o.types, match: o.match ?? {} });
  }
  if (specs.length === 0) {
    throw new Error('a wait names no events: give `types` or `any`');
  }
  return specs;
}

/**
 * The subscription row key of a wait's nth spec.
 * @param name
 * @param i
 */
const rowKey = (name: string, i: number): string => `${name}#${i}`;

/**
 * Open a wait: record one subscription per spec, then answer at once with
 * the earliest matching event already in `event_log` since the wait opened
 * (or `since`). An event raised before the wait is never lost.
 * @param workflowId - The waiting run.
 * @param name - The wait's name, unique within the run.
 * @param o - What answers it.
 */
export async function openWait(workflowId: string, name: string, o: WaitForEventOptions): Promise<DeliveredEvent | null> {
  const { and, asc, eq, gte, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema, eventLogSchema } = await import('@/models/Schema');
  const specs = specsOf(o);
  for (const [i, spec] of specs.entries()) {
    await db.insert(durableWaitSchema)
      .values({ orgId: o.orgId, workflowId, waitKey: rowKey(name, i), types: spec.types, match: spec.match })
      .onConflictDoNothing({ target: [durableWaitSchema.workflowId, durableWaitSchema.waitKey] });
  }
  const [row] = await db.select({ openedAt: durableWaitSchema.openedAt }).from(durableWaitSchema).where(and(eq(durableWaitSchema.workflowId, workflowId), eq(durableWaitSchema.waitKey, rowKey(name, 0)))).limit(1);
  const since = o.since ? new Date(o.since) : row?.openedAt ?? new Date();
  let first: { id: number; event: DeliveredEvent } | null = null;
  for (const spec of specs) {
    const [hit] = await db.select({ id: eventLogSchema.id, type: eventLogSchema.type, payload: eventLogSchema.payload, createdAt: eventLogSchema.createdAt })
      .from(eventLogSchema)
      .where(and(
        eq(eventLogSchema.orgId, o.orgId),
        inArray(eventLogSchema.type, spec.types),
        sql`${eventLogSchema.payload} @> ${JSON.stringify(spec.match)}::jsonb`,
        gte(eventLogSchema.createdAt, since),
      ))
      .orderBy(asc(eventLogSchema.id))
      .limit(1);
    if (hit && (!first || hit.id < first.id)) {
      first = { id: hit.id, event: { type: hit.type, payload: hit.payload ?? {}, at: hit.createdAt.toISOString() } };
    }
  }
  return first?.event ?? null;
}

/**
 * Close a wait once it is answered or timed out: every spec's row.
 * @param workflowId - The run.
 * @param name - The wait's name.
 * @param specs - How many specs it opened.
 */
export async function closeWait(workflowId: string, name: string, specs: number): Promise<void> {
  const { and, eq, inArray } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema } = await import('@/models/Schema');
  const keys = Array.from({ length: specs }, (_, i) => rowKey(name, i));
  await db.delete(durableWaitSchema).where(and(eq(durableWaitSchema.workflowId, workflowId), inArray(durableWaitSchema.waitKey, keys)));
}

/**
 * The message topic a wait reads.
 * @param name
 */
export const waitTopic = (name: string): string => `event:${name}`;

/**
 * One wait, the same in every runtime: open (which may answer at once), else
 * read the run's mailbox until the timeout, then close.
 * @param ctx - The run's context.
 * @param name - The wait's name, unique within the run.
 * @param o - What answers it.
 */
export async function waitForEventVia(ctx: Pick<DurableContext, 'workflowId' | 'step' | 'waitFor'>, name: string, o: WaitForEventOptions): Promise<DeliveredEvent | null> {
  const specs = specsOf(o).length;
  const immediate = await ctx.step(`wait:${name}:open`, () => openWait(ctx.workflowId, name, o));
  const event = immediate ?? await ctx.waitFor<DeliveredEvent>(waitTopic(name), o.timeoutSeconds);
  await ctx.step(`wait:${name}:close`, () => closeWait(ctx.workflowId, name, specs));
  return event;
}

/**
 * Send an event to every run waiting for it. Called by `emitEvent` after the
 * event is recorded; one indexed read when nothing waits. A wait several of
 * whose specs match is sent the event once.
 * @param orgId - The event's workspace.
 * @param type - Its type.
 * @param payload - Its payload.
 * @param at - When it was recorded.
 * @param send - How a message reaches a run.
 */
export async function forwardToWaits(orgId: string, type: string, payload: Record<string, unknown>, at: Date, send: (id: string, topic: string, message: DeliveredEvent) => Promise<void>): Promise<number> {
  const { and, eq, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema } = await import('@/models/Schema');
  const waits = await db.select({ workflowId: durableWaitSchema.workflowId, waitKey: durableWaitSchema.waitKey }).from(durableWaitSchema).where(and(
    eq(durableWaitSchema.orgId, orgId),
    sql`jsonb_exists(${durableWaitSchema.types}, ${type})`,
    sql`${JSON.stringify(payload)}::jsonb @> ${durableWaitSchema.match}`,
  ));
  const sent = new Set<string>();
  for (const w of waits) {
    const name = w.waitKey.replace(/#\d+$/, '');
    const key = `${w.workflowId}\n${name}`;
    if (!sent.has(key)) {
      sent.add(key);
      await send(w.workflowId, waitTopic(name), { type, payload, at: at.toISOString() });
    }
  }
  return sent.size;
}
