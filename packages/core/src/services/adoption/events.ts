import { z } from 'zod';

/**
 * Typed registry of adoption events — the single source of truth for the
 * `user_activity_event.event_type` taxonomy (mirrors the closed-enum pattern
 * of `libs/Langfuse/features.ts`).
 *
 * Event types follow `category.verb`. The read side rolls categories up by
 * prefix, so a NEW event in an existing category is counted in totals and
 * per-user activity automatically — no query or UI change needed.
 *
 * The extension contract for a new activity element:
 *   1. add one entry here (with a zod `meta` schema if it carries metadata)
 *   2. add one `track()` call at the owning service's choke point
 * If the new element is a HITL kind flowing through `ReviewService.decide()`,
 * step 2 is already done — extend `runKind` instead of adding an event type.
 */

export const runKind = z.enum(['skill', 'workflow', 'mission', 'action']);
export const feedbackRating = z.enum(['up', 'down']);
/**
 * How far out a snooze pushed an item, bucketed. Buckets rather than a
 * timestamp because adoption metadata stays enums-and-counts only, and
 * because the question a reader has is "briefly or indefinitely?", not
 * "which minute?". Bounds are inclusive at the top (`up_to_1d` means "one day
 * or less") so the UI's own presets — tomorrow, 3 days, next week — each land
 * in one bucket every time instead of tipping into the next on the
 * milliseconds between the click and the write.
 */
export const snoozeHorizon = z.enum(['under_4h', 'up_to_1d', 'up_to_1w', 'over_1w']);
export type SnoozeHorizon = z.infer<typeof snoozeHorizon>;

type EventSpec = {
  /** True when the event is agent-attributable — callers should pass `agentSlug`. */
  agent?: boolean;
  /**
   * True when the event may be written by a NON-human actor (an agent turn, a
   * scheduled mission check). Adoption still measures humans; a system event
   * exists for auditability, and the read side keeps ignoring it for
   * per-user metrics because its userId never matches a member.
   */
  system?: boolean;
  /** Metadata envelope schema. Counts and enums only — never message content. */
  meta?: z.ZodType;
};

export const ADOPTION_EVENTS = {
  /** JWT issued on credentials sign-in. */
  'auth.login': {},
  /** First authenticated RPC in each 5-minute bucket per user — feeds session derivation. */
  'activity.heartbeat': {},
  'chat.conversation_created': { agent: true },
  'chat.message_sent': { agent: true },
  /**
   * One event for every HITL approval surface; the run kind travels in
   * metadata. `decision` is the TYPED triage signal — approve/edit/reject are
   * terminal; skip/save leave the item pending; rewrite = the human asked AI
   * to redo the draft (a strong tone/quality signal). These feed confidence +
   * alignment scoring and the per-user tone prompt. `hint` carries a rewrite
   * instruction ("shorter", "warmer") when present.
   */
  'review.decided': {
    agent: true,
    meta: z.object({
      kind: runKind,
      decision: z.enum(['approved', 'edited', 'rejected', 'skipped', 'saved', 'rewritten']),
      // Scope dimensions for learnings/tone: the event's userId = individual,
      // orgId = workspace, and actionId = action type. Together they let
      // downstream scoring attribute a signal to a person, an action class, or
      // the whole workspace.
      actionId: z.string().optional(),
      hint: z.string().optional(),
      latencyMs: z.number().optional(),
    }),
  },
  'review.feedback': {
    agent: true,
    meta: z.object({
      kind: runKind,
      rating: feedbackRating.nullable().optional(),
      hasNote: z.boolean().optional(),
    }),
  },
  /**
   * A human deferred a queued item instead of deciding on it. Deliberately
   * NOT a `review.decided` decision: a snooze leaves the item pending, so
   * folding it into the approve/reject ratio would move the approval rate on
   * an item nobody has judged yet. Counted on its own so a run of snoozes on
   * one agent reads as "these suggestions are not worth acting on now".
   */
  'review.snoozed': {
    agent: true,
    meta: z.object({
      kind: runKind,
      deferredFor: snoozeHorizon,
    }),
  },
  'learning.added': { agent: true },
  /**
   * One assessed call = one event, whoever ordered it (scheduled mission
   * check or a chat turn). The drill-down pointer to the ledger:
   * `resource: ['discovery_candidate', id]`. Metadata is enum-and-boolean
   * only — the scores and reasoning live on the ledger row, never here.
   */
  'discovery.classified': {
    agent: true,
    system: true,
    meta: z.object({
      route: z.enum(['generate', 'confirm', 'drop']),
      isDiscovery: z.boolean(),
      proposalReady: z.boolean(),
    }),
  },
} as const satisfies Record<string, EventSpec>;

export type AdoptionEventType = keyof typeof ADOPTION_EVENTS;

export type AdoptionEventMeta<T extends AdoptionEventType>
  = (typeof ADOPTION_EVENTS)[T] extends { meta: infer S extends z.ZodType }
    ? z.infer<S>
    : Record<string, unknown> | undefined;

export const ADOPTION_EVENT_TYPES = Object.keys(ADOPTION_EVENTS) as AdoptionEventType[];

/**
 * System principals write rows with attribution fields too ('web',
 * 'review-service', 'agent:<slug>', 'token:<id>'…). Adoption measures
 * humans — everything else is skipped at capture time. Lives here (not
 * track.ts) so CLI scripts can import it without the Logger chain.
 * @param userId
 */
export const isHumanActor = (userId: string | null | undefined): userId is string =>
  !!userId && !/^(?:web|review-service|review-decision|system|agent:|token:)/.test(userId);
