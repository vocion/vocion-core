/**
 * EventService — the trigger runner. Turns inbound events (webhooks, internal
 * signals) into work.
 *
 * The spec is "event-driven first": most revenue work should happen when
 * something meaningful occurs — a prospect replies, a meeting ends, a deal
 * changes stage — not on a timer. Workflows already declare an event trigger
 * in their manifest (`trigger: { type: 'event', event, filter? }`); nothing
 * dispatched to them. This does: `emitEvent` records the event (deduped),
 * finds the workflows subscribed to that type whose filter matches, and starts
 * each one with the payload as input. Durability of the started run is the
 * workflow engine's job (Temporal); this is the fan-out.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { eventLogSchema, workflowSchema } from '@/models/Schema';
import { startWorkflow } from '@/services/WorkflowService';

export type EmitEventInput = {
  orgId: string;
  /** Event type, e.g. `prospect.reply`. Matches a workflow trigger's `event`. */
  type: string;
  payload?: Record<string, unknown>;
  /** Provider-namespaced idempotency key; a repeat no-ops. */
  dedupeKey?: string;
  invokedBy?: string;
};

export type EmitEventResult = {
  eventId: number | null;
  deduped: boolean;
  triggered: Array<{ slug: string; runId: number }>;
};

/**
 * A workflow trigger fires only if every key in `filter` equals the payload's.
 * @param payload
 * @param filter
 */
function matchesFilter(payload: Record<string, unknown>, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') {
    return true;
  }
  return Object.entries(filter as Record<string, unknown>).every(([k, v]) => payload[k] === v);
}

/**
 * Dispatch an event: dedupe, find subscribed workflows, start each match.
 * @param input
 */
export async function emitEvent(input: EmitEventInput): Promise<EmitEventResult> {
  const payload = input.payload ?? {};

  // Idempotency — a redelivered webhook with the same key is a no-op.
  if (input.dedupeKey) {
    const [existing] = await db
      .select({ id: eventLogSchema.id })
      .from(eventLogSchema)
      .where(and(eq(eventLogSchema.orgId, input.orgId), eq(eventLogSchema.dedupeKey, input.dedupeKey)))
      .limit(1);
    if (existing) {
      return { eventId: existing.id, deduped: true, triggered: [] };
    }
  }

  // Find active workflows subscribed to this event type whose filter matches.
  const workflows = await db
    .select({ slug: workflowSchema.slug, trigger: workflowSchema.trigger, status: workflowSchema.status })
    .from(workflowSchema)
    .where(eq(workflowSchema.orgId, input.orgId));

  const matches = workflows.filter((w) => {
    if (w.status !== 'active') {
      return false;
    }
    const t = w.trigger as { type?: string; event?: string; filter?: unknown };
    return t?.type === 'event' && t.event === input.type && matchesFilter(payload, t.filter);
  });

  const triggered: Array<{ slug: string; runId: number }> = [];
  for (const w of matches) {
    try {
      const run = await startWorkflow({
        orgId: input.orgId,
        slug: w.slug,
        input: payload,
        triggerContext: { event: input.type, ...payload },
        invokedBy: input.invokedBy ?? `event:${input.type}`,
      });
      triggered.push({ slug: w.slug, runId: run.id });
    } catch {
      // A single workflow failing to start shouldn't drop the whole event;
      // it's recorded in the event_log's `triggered` list only on success.
    }
  }

  const [row] = await db
    .insert(eventLogSchema)
    .values({ orgId: input.orgId, type: input.type, payload, dedupeKey: input.dedupeKey ?? null, triggered, invokedBy: input.invokedBy ?? null })
    .returning({ id: eventLogSchema.id });

  return { eventId: row!.id, deduped: false, triggered };
}
