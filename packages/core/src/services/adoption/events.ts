import { z } from 'zod';
import { LABEL_VERDICTS } from '@/libs/actions/labelVerdict';
import { SELF_UPDATE_NOUNS } from '@/libs/actions/selfUpdate';
import { SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { DISCOVERY_CLASSES, READINESS_CLASSES } from '@/services/discovery/classification';

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
/** Whether a proposed rule asks the agent to change or to keep doing something. */
export const learningPolarity = z.enum(['correct', 'reinforce']);
/** Which of the six things the system changed about itself (`libs/actions/selfUpdate.ts`). */
export const selfUpdateNoun = z.enum(SELF_UPDATE_NOUNS);

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
   * A conversation turn opened FROM a record via an "Ask about this"
   * affordance (briefing section, inbox ask, team-report row, record page) —
   * distinct from the hotkey. `recordType` says which surface hands work to
   * the agent; the count against `chat.message_sent` is how much of the chat
   * starts in context rather than cold.
   */
  'chat.opened_from_context': { agent: true, meta: z.object({ recordType: z.string().max(40) }) },
  /**
   * A thumb on one assistant turn in the chat (0094). `rating` null = the
   * person cleared their thumb. The note itself never travels here — it goes
   * to the feedback classifier — only whether there was one.
   */
  'chat.feedback': {
    agent: true,
    meta: z.object({
      rating: feedbackRating.nullable().optional(),
      hasNote: z.boolean().optional(),
    }),
  },
  /**
   * One event for every HITL approval surface; the run kind travels in
   * metadata. `decision` is the TYPED triage signal — approve/edit/reject are
   * terminal; skip/save leave the item pending; rewrite = the human asked AI
   * to redo one draft's wording (a strong tone/quality signal); regenerated =
   * the human sent the whole work back to be done again, with instructions —
   * kept distinct from rewritten so the metrics can tell a tone touch-up from
   * a full re-do. These feed confidence + alignment scoring and the per-user
   * tone prompt. `hint` carries the rewrite or regenerate instruction
   * ("shorter", "warmer") when present.
   */
  'review.decided': {
    agent: true,
    meta: z.object({
      kind: runKind,
      decision: z.enum(['approved', 'edited', 'rejected', 'skipped', 'saved', 'rewritten', 'regenerated']),
      // Scope dimensions for learnings/tone: the event's userId = individual,
      // orgId = workspace, and actionId = action type. Together they let
      // downstream scoring attribute a signal to a person, an action class, or
      // the whole workspace.
      actionId: z.string().optional(),
      hint: z.string().optional(),
      latencyMs: z.number().optional(),
      /**
       * What the agent recommended for this item, copied onto the event as the
       * decision is recorded. Stamped here rather than read back off the run
       * later because a re-proposal can change the recommendation, and the
       * honest comparison is against the advice the reviewer was looking at.
       * Absent when the agent gave no view — not the same as recommending
       * approval, and never to be counted as one.
       */
      suggestedDecision: z.enum(SUGGESTED_DECISIONS).optional(),
      /**
       * What the reviewer did with each field the proposal declared as a
       * label of its own making: kept it, changed it, cleared it, or filled
       * one in the proposer left empty.
       *
       * Field NAMES as keys and verdict ENUMS as values, which is as far as
       * this envelope goes: the before and after values are message content
       * and stay out, exactly as the rule at the top of this file says. The
       * tenant's own correction note is where a person reads what changed.
       *
       * Absent when the proposal declared no labels, which is every proposal
       * that judges nothing, and must never be read as "nothing was edited".
       */
      labels: z.record(z.string(), z.enum(LABEL_VERDICTS)).optional(),
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
      /**
       * Carried here too, so a snooze the agent itself recommended can be
       * recognised as agreement. A deferral stays outside the approval rate
       * for the reason above, but "the agent said come back to this later and
       * the reviewer did" is a real meeting of minds and belongs in the
       * agreement matrix.
       */
      suggestedDecision: z.enum(SUGGESTED_DECISIONS).optional(),
    }),
  },
  /**
   * A person edited an artifact in the pane — a save, or a restore of an
   * older version. Agent edits are NOT tracked here: adoption measures what
   * humans do, and an agent's own version is already in artifact_version.
   * `action` separates a normal edit from a restore, which is the signal
   * that the agent's last change was not wanted.
   */
  'artifact.edited': {
    meta: z.object({
      kind: z.string().max(20),
      action: z.enum(['edited', 'restored']),
      version: z.number().int().positive(),
    }),
  },
  /**
   * An artifact came into being — by an agent, a person or a system pass.
   * System-writable because most artifacts are agent output; the read side
   * still counts humans only for per-user metrics. `folder` is the top-level
   * folder (`wiki`), so a plugin's output can be counted without a new event.
   */
  'artifact.created': {
    agent: true,
    system: true,
    meta: z.object({
      kind: z.string().max(20),
      folder: z.string().max(40).optional(),
    }),
  },
  /**
   * A wiki page was written through `wiki.write_page` — created, revised, or
   * found unchanged. `append` says a dated section was added rather than the
   * page rewritten. The count against `artifact.created` with folder `wiki`
   * is how much of the wiki the agents grow versus people.
   */
  'wiki.page_written': {
    agent: true,
    system: true,
    meta: z.object({
      mode: z.enum(['created', 'revised', 'unchanged']),
      append: z.boolean().optional(),
    }),
  },
  /**
   * A data room was opened, and a source was filed into one. `by` says who:
   * the collector after a sync, an agent in a turn, or a person. The two
   * counts are the data-rooms plugin's outcome measures, read from here.
   */
  'room.created': {
    agent: true,
    system: true,
    meta: z.object({ by: z.enum(['collector', 'agent', 'human']) }),
  },
  'room.source_filed': {
    agent: true,
    system: true,
    meta: z.object({
      by: z.enum(['collector', 'agent', 'human']),
      /** Match score bucket for collector filings; absent for a named filing. */
      score: z.enum(['high', 'medium']).optional(),
    }),
  },
  'learning.added': { agent: true },
  /**
   * Feedback proposed a rule nobody had proposed before, so a candidate is
   * now waiting in the queue. `polarity` says whether the reviewer wanted a
   * behaviour changed or kept.
   */
  'learning.candidate_created': {
    agent: true,
    meta: z.object({ polarity: learningPolarity }),
  },
  /**
   * Feedback restated a rule that was already pending or already adopted. No
   * candidate was created; the existing row's occurrence count went up. These
   * events are how "five people keep asking for this" becomes visible.
   */
  'learning.candidate_duplicate': {
    agent: true,
    meta: z.object({
      polarity: learningPolarity,
      matchedKind: z.enum(['candidate', 'learning']),
    }),
  },
  /** A person adopted or rejected a candidate. Both outcomes are signal. */
  'learning.candidate_decided': {
    agent: true,
    meta: z.object({ decision: z.enum(['approved', 'rejected']) }),
  },
  /**
   * The system changed something about ITSELF and it stuck — a wiki page, a
   * mission's working notes, a playbook, an agent's own instructions, a
   * remembered rule, a capability turned on. One event for every member of
   * the self-improvement class (`libs/actions/selfUpdate.ts`), written from
   * the single choke point every one of them executes through, so a new noun
   * in the class needs no new event and no new `track()` call.
   *
   * It sits in the `learning.` family deliberately: the adoption rollup
   * already counts that prefix as interaction, so "how much is this workspace
   * teaching itself" is one query rather than a new one. `mode` says whether
   * the ladder released it or a person did; `runId` rides as the resource so
   * every row links to the run that can undo it.
   */
  'learning.self_updated': {
    agent: true,
    system: true,
    meta: z.object({
      noun: selfUpdateNoun,
      mode: z.enum(['auto', 'approved']),
      /** The thing it touched — a page slug, a mission slug, an agent slug. */
      target: z.string().max(120).optional(),
      /** How much moved, for the nouns that have a size. Counts only. */
      linesAdded: z.number().int().nonnegative().optional(),
      linesRemoved: z.number().int().nonnegative().optional(),
    }),
  },
  /**
   * A person put a self-update back. The strongest signal in the class: it
   * demotes the kind on the ladder (`AutonomyService.holdAfterUndo`), and the
   * count against `learning.self_updated` is the honest answer to "is it
   * teaching itself the right things".
   */
  'learning.self_update_undone': {
    agent: true,
    system: true,
    meta: z.object({
      noun: selfUpdateNoun,
      target: z.string().max(120).optional(),
    }),
  },
  /**
   * A person approved a consolidation proposal: one stronger rule replaced
   * several. `replaced` is how many were retired; `stepName` names the
   * namespace, so the growing-memory chart can mark "N → 1" on the day.
   */
  'learning.consolidated': {
    agent: true,
    meta: z.object({ replaced: z.number().int().positive(), stepName: z.string() }),
  },
  /**
   * A person answered an ask — a ruling, an approval, a credential, a merge, a
   * recommendation, a gate. Nothing executes on a decision, so the outcome is
   * the status the ask landed in. `kind` says what sort of thing was waiting.
   */
  'ask.decided': {
    agent: true,
    meta: z.object({
      kind: z.enum(['approval', 'input', 'ruling', 'credential', 'merge', 'recommendation', 'gate']),
      status: z.enum(['approved', 'rejected', 'done', 'superseded']),
      /** The records the ask was about, so a reader can join the answer to them. */
      objectRefs: z.array(z.object({ type: z.string(), id: z.string() })).optional(),
    }),
  },
  /**
   * An action kind moved on the autonomy ladder. `automatic` is a demotion
   * the system made itself (a rejected auto-execution, or a rejection on a
   * high-risk kind) as opposed to a person's promote/demote. System events
   * exist for the audit trail; adoption keeps measuring humans.
   */
  'autonomy.promoted': {
    system: true,
    meta: z.object({ actionId: z.string(), from: z.string(), to: z.string(), automatic: z.boolean() }),
  },
  'autonomy.demoted': {
    system: true,
    meta: z.object({ actionId: z.string(), from: z.string(), to: z.string(), automatic: z.boolean() }),
  },
  /**
   * One assessed call = one event, whoever ordered it (scheduled mission
   * check or a chat turn). The drill-down pointer to the ledger:
   * `resource: ['discovery_candidate', id]`. Metadata is enums only — the
   * confidences and the reasoning live on the ledger row, never here. The
   * booleans became classes when the classifier's contract did
   * (`services/discovery/classification.ts`).
   */
  'discovery.classified': {
    agent: true,
    system: true,
    meta: z.object({
      route: z.enum(['generate', 'confirm', 'drop']),
      classification: z.enum(DISCOVERY_CLASSES),
      proposalReadiness: z.enum(READINESS_CLASSES),
      reasonCode: z.string(),
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
