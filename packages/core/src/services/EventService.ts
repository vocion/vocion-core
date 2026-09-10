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

/**
 * Event types Vocion emits from its own code, as opposed to the ones an
 * outside caller invents and posts to `/api/v1/events`.
 *
 * They live here, beside `EmitEventInput.type`, because this is the only place
 * that defines what an event *is*; a workspace author writes one of these
 * strings into an automation's `when.event` (see `AutomationManifestSchema`)
 * and gets the payload documented below as the run's input. Renaming one
 * breaks every workspace that subscribes to it, so treat these as public API.
 */
export const SOURCE_SYNC_COMPLETED = 'source.sync_completed';

/**
 * Payload of a `source.sync_completed` event.
 *
 * These are the fields an automation's `when.filter` can match on and the keys
 * its workflow or mission receives as input, so they are a contract, not a
 * debug dump: every one is a scalar (filters compare with `===`) and none of
 * them carries document content.
 */
export type SourceSyncCompletedPayload = {
  /** `knowledge_source.id` of the source that finished syncing. */
  sourceId: number;
  /** Source slug — the stable, human-readable handle a filter should use. */
  sourceSlug: string;
  /** Connector slug behind the source, e.g. `web`, `notion`. */
  connector: string;
  /** True when only documents changed since the last run were requested. */
  incremental: boolean;
  created: number;
  updated: number;
  unchanged: number;
  tombstoned: number;
  /** Documents the run could not ingest. A completed sync can still be > 0. */
  errors: number;
  /** ISO timestamp of the run's cutoff, i.e. when the sync started reading. */
  completedAt: string;
};

/**
 * A lead that was enrolled in a sequence has done something a person should
 * pick up: replied to a send, or booked a meeting. Emitted by
 * `HandoffTriggerService` after a HubSpot contacts sync moves the lead's
 * reply or meeting timestamp past what the watcher had seen, and past the
 * enrollment decision. One event per new timestamp, deduped on it.
 */
export const LEAD_REPLIED = 'lead.replied';
export const LEAD_MEETING_BOOKED = 'lead.meeting_booked';

/**
 * Payload of `lead.replied` and `lead.meeting_booked`. Scalars only, for the
 * same reason as `SourceSyncCompletedPayload`: a `when.filter` compares with
 * `===`, and an automation's mission check receives these keys verbatim as
 * its trigger payload.
 */
export type LeadHandoffTriggerPayload = {
  /** `lead_brief.id` of the enrolled lead. */
  leadBriefId: number;
  /** CRM mirror ref, e.g. `contacts:9412`. What `save_handoff_brief` takes. */
  contactRef: string;
  /** The HubSpot contact id, for the live read tools. */
  hubspotId: string | null;
  contactName: string;
  /** Which signal moved: the handoff trigger the skill records. */
  trigger: 'reply' | 'meeting';
  /** ISO timestamp HubSpot stamped on the reply or the meeting activity. */
  observedAt: string;
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

  // Automations are the first-class event subscribers ({when: {event}} ->
  // {do: workflow | checkMission}). The workflow-embedded triggers above
  // remain as a deprecated legacy path.
  const { automationSchema } = await import('@/models/Schema');
  const { fireAutomation } = await import('@/services/AutomationService');
  const automations = await db
    .select()
    .from(automationSchema)
    .where(eq(automationSchema.orgId, input.orgId));
  for (const a of automations) {
    if (a.status !== 'active' || a.whenConfig.event !== input.type || !matchesFilter(payload, a.whenConfig.filter)) {
      continue;
    }
    try {
      const res = await fireAutomation(input.orgId, a.slug, {
        input: payload,
        invokedBy: input.invokedBy ?? `event:${input.type}`,
      });
      triggered.push({ slug: `automation:${a.slug}`, runId: res.runId });
    } catch {
      // Same tolerance as workflows above - one bad automation never drops the event.
    }
  }

  const [row] = await db
    .insert(eventLogSchema)
    .values({ orgId: input.orgId, type: input.type, payload, dedupeKey: input.dedupeKey ?? null, triggered, invokedBy: input.invokedBy ?? null })
    .returning({ id: eventLogSchema.id });

  return { eventId: row!.id, deduped: false, triggered };
}
