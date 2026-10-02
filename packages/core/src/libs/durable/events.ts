import type { DeliveredEvent, DurableContext, WaitForEventOptions } from './types';

/**
 * Open a wait: record the subscription, then answer at once with a matching
 * event already in `event_log` since the wait opened (or `since`). An event
 * raised between the start of the step and the wait is never lost.
 * @param workflowId - The waiting run.
 * @param name - The wait's name, unique within the run.
 * @param o - What answers it.
 */
export async function openWait(workflowId: string, name: string, o: WaitForEventOptions): Promise<DeliveredEvent | null> {
  const { and, asc, eq, gte, inArray, sql } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema, eventLogSchema } = await import('@/models/Schema');
  await db.insert(durableWaitSchema)
    .values({ orgId: o.orgId, workflowId, waitKey: name, types: o.types, match: o.match })
    .onConflictDoNothing({ target: [durableWaitSchema.workflowId, durableWaitSchema.waitKey] });
  const [row] = await db.select({ openedAt: durableWaitSchema.openedAt }).from(durableWaitSchema).where(and(eq(durableWaitSchema.workflowId, workflowId), eq(durableWaitSchema.waitKey, name))).limit(1);
  const since = o.since ? new Date(o.since) : row?.openedAt ?? new Date();
  const [hit] = await db.select({ type: eventLogSchema.type, payload: eventLogSchema.payload, createdAt: eventLogSchema.createdAt })
    .from(eventLogSchema)
    .where(and(
      eq(eventLogSchema.orgId, o.orgId),
      inArray(eventLogSchema.type, o.types),
      sql`${eventLogSchema.payload} @> ${JSON.stringify(o.match)}::jsonb`,
      gte(eventLogSchema.createdAt, since),
    ))
    .orderBy(asc(eventLogSchema.id))
    .limit(1);
  return hit ? { type: hit.type, payload: hit.payload ?? {}, at: hit.createdAt.toISOString() } : null;
}

/**
 * Close a wait once it is answered or timed out.
 * @param workflowId - The run.
 * @param name - The wait's name.
 */
export async function closeWait(workflowId: string, name: string): Promise<void> {
  const { and, eq } = await import('drizzle-orm');
  const { db } = await import('@/libs/DB');
  const { durableWaitSchema } = await import('@/models/Schema');
  await db.delete(durableWaitSchema).where(and(eq(durableWaitSchema.workflowId, workflowId), eq(durableWaitSchema.waitKey, name)));
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
  const immediate = await ctx.step(`wait:${name}:open`, () => openWait(ctx.workflowId, name, o));
  const event = immediate ?? await ctx.waitFor<DeliveredEvent>(waitTopic(name), o.timeoutSeconds);
  await ctx.step(`wait:${name}:close`, () => closeWait(ctx.workflowId, name));
  return event;
}

/**
 * Send an event to every run waiting for it. Called by `emitEvent` after the
 * event is recorded; one indexed read when nothing waits.
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
  for (const w of waits) {
    await send(w.workflowId, waitTopic(w.waitKey), { type, payload, at: at.toISOString() });
  }
  return waits.length;
}
