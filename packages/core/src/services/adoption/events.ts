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

type EventSpec = {
  /** True when the event is agent-attributable — callers should pass `agentSlug`. */
  agent?: boolean;
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
  /** One event for every HITL approval surface; the run kind travels in metadata. */
  'review.decided': {
    agent: true,
    meta: z.object({
      kind: runKind,
      decision: z.enum(['approved', 'rejected']),
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
  'learning.added': { agent: true },
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
