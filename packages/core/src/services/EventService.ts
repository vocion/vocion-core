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

import type { CausalChain, SkipReason } from '@/services/automations/fireGuards';
import { and, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { eventLogSchema, workflowSchema } from '@/models/Schema';
import { eventFireCeiling, selfTriggerReason } from '@/services/automations/fireGuards';
import { startWorkflow } from '@/services/WorkflowService';
import { readWorkspacePauseWithName, refusalMessage } from '@/services/workspacePause';

export type EmitEventInput = {
  orgId: string;
  /** Event type, e.g. `prospect.reply`. Matches a workflow trigger's `event`. */
  type: string;
  payload?: Record<string, unknown>;
  /** Provider-namespaced idempotency key; a repeat no-ops. */
  dedupeKey?: string;
  invokedBy?: string;
  /**
   * How a subscribed automation's work runs. `inline` (the default) awaits the
   * whole fire, which for a mission check is the entire agent pass: right for
   * a worker with nobody waiting, wrong inside a request. `background` records
   * the fire, answers with its `automationRunId`, and completes the pass after
   * the response (Next's `after`), so a click that emits an event is never
   * held open for minutes. Only a caller in a request scope may pass it.
   */
  dispatchMode?: 'inline' | 'background';
  /**
   * Skip the per-automation fire ceiling for this event. Only for a caller
   * that is itself the pacing: the bulk regenerate workflow walks its leads
   * two at a time on the worker, so a ceiling meant to stop a storm of
   * request-time events would here drop every lead past the sixth and fold
   * them into one coalesced fire that briefs one lead (ticket 071).
   */
  ignoreCeiling?: boolean;
  /**
   * The automation fires whose work raised this event, newest first. A
   * mission run started by a check carries the check's automation; the
   * matcher skips every automation on the chain, so nothing is ever fired by
   * its own run's residue (`services/automations/fireGuards.ts`). Recorded on
   * the event row. Omit when no automation is behind the event.
   */
  causedBy?: CausalChain | null;
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
/**
 * An artifact was created or a new version of it was written — by an agent, a
 * person or a system pass. Emitted fire-and-forget from `ArtifactService` so a
 * save never waits on its subscribers. The wiki plugin subscribes with
 * `filter: { folder: wiki }` to index pages for search (`index-artifact`).
 */
export const ARTIFACT_SAVED = 'artifact.saved';

/** Payload of `artifact.saved`. Scalars only — `when.filter` compares with `===`. */
export type ArtifactSavedPayload = {
  artifactId: number;
  kind: string;
  /** Top-level folder (`wiki`), or null. */
  folder: string | null;
  title: string;
  version: number;
  /** `created` for v1, `revised` after. */
  change: 'created' | 'revised';
  /** `agent` | `human` | `system`. */
  authorKind: string;
  recordType: string | null;
  recordId: string | null;
};

/**
 * A person answered an ask (docs/entities/ask.md) — approved it, rejected it,
 * chose an option, wrote an "other", or marked it done. Emitted fire-and-forget
 * from `AskService.decideAsk`, the one place a human's answer is written, so a
 * plugin can act on the decision without polling: the software factory's
 * product manager subscribes with `filter: { agentSlug: product-manager, kind:
 * recommendation }` to write the decision back on the request and assemble the
 * next batch only once the last one is decided. Distinct from the adoption
 * stream's `ask.decided` row, which is a metric, not a trigger.
 */
export const ASK_DECIDED = 'ask.decided';

/** Payload of `ask.decided`. Scalars, which `when.filter` compares with `===`, plus the records it was about. */
export type AskDecidedPayload = {
  askId: number;
  /** The ask's kind — `approval`, `merge`, `recommendation`, … */
  kind: string;
  /** The resulting status: `approved`, `rejected` or `done`. */
  status: string;
  /** `approve`, `reject`, `done`, `other`, or the option id chosen. */
  decision: string;
  /** Whether the asker owes a read of the note (an "other" on a ruling, approval or recommendation). */
  followUp: boolean;
  /** Who filed it, when an agent did; null for a service or an outside caller. */
  agentSlug: string | null;
  teamSlug: string | null;
  /** The decision sheet it belonged to, so a subscriber can tell when a whole batch is decided. */
  groupKey: string | null;
  /** The filer's idempotency key, when it was filed from outside. */
  sourceRef: string | null;
  /**
   * The records the ask was about — `[{ type, id }]`, an object type slug
   * and the object's id — so a subscriber can write the answer back onto
   * them. The one non-scalar here: `when.filter` cannot match on it, so
   * filter on `agentSlug` and `kind` and read the refs off the payload.
   */
  objectRefs: Array<{ type: string; id: string }>;
  decidedBy: string;
  /** ISO timestamp of the decision. */
  decidedAt: string;
};

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

/**
 * A reviewer pressed Regenerate on a lead brief. Emitted by the regenerate
 * route after the lead is reset to the queued lane with the reviewer's note;
 * an automation subscribed to it (`regenerate-brief-on-request` in the Metacto
 * workspace) briefs and drafts that one lead at once instead of waiting for
 * the hourly pass. Payload: `briefId`, `contactRef`, `contactName`, `note`.
 */
export const PERSONALIZATION_BRIEF_REGENERATE_REQUESTED = 'personalization.brief_regenerate_requested';

/**
 * A reviewer pressed Regenerate on ONE of a lead's three artifacts — the
 * research brief, the outreach recommendation, or the draft sequence
 * (`docs/specs/personalization-v2.md`). The brief's own event above is kept
 * because a workspace automation already subscribes to it and a brief
 * regeneration still resets the whole chain; this one carries `target` so an
 * automation can run only the stage that was asked for.
 *
 * Payload: `leadId`, `target` (`brief` | `recommendation` | `sequence`),
 * `contactRef`, `contactName`, `note` (the instruction, which also becomes the
 * new artifact version's change summary).
 */
export const PERSONALIZATION_ARTIFACT_REGENERATE_REQUESTED = 'personalization.artifact_regenerate_requested';

/**
 * The GitHub source's events — `pr.opened`, `pr.synchronized`,
 * `pr.checks_completed`, `pr.review_submitted`, `pr.merged`, `pr.closed` and
 * `run.failed` — live in `libs/github/events.ts` with their payload types,
 * beside the pure mapping both the poller and the webhook receiver share.
 * Same contract as the constants above: renaming one breaks subscribers.
 */

export type EmitEventResult = {
  eventId: number | null;
  deduped: boolean;
  triggered: Array<{ slug: string; runId: number }>;
  /** Automations that matched and were refused by a guard, with the `skipped` run row that says why. */
  skipped: Array<{ slug: string; automationRunId: number; reason: SkipReason }>;
};

/**
 * A trigger fires only if every key in `filter` matches the payload: equal,
 * or — for a key ending in `Prefix` — the field it names starts with the
 * value (`branchPrefix: factory/` matches `branch: factory/send-t146-…`).
 *
 * The plugin's QA automations have filtered on `branchPrefix` since they were
 * written, and with `===` only they compared against a `branchPrefix` field no
 * event carries, so the QA-on-PR and learn-from-merged automations never fired
 * once (red team, 2026-09-26).
 * @param payload
 * @param filter
 */
export function matchesFilter(payload: Record<string, unknown>, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') {
    return true;
  }
  return Object.entries(filter as Record<string, unknown>).every(([k, v]) => {
    if (payload[k] === v) {
      return true;
    }
    if (k.endsWith('Prefix') && typeof v === 'string') {
      const field = payload[k.slice(0, -'Prefix'.length)];
      return typeof field === 'string' && field.startsWith(v);
    }
    return false;
  });
}

/**
 * Whether an automation's `when.event` — one type or several — names this one.
 * @param subscribed - `whenConfig.event` as stored.
 * @param type - The event being emitted.
 */
export function subscribesTo(subscribed: string | string[] | undefined, type: string): boolean {
  return Array.isArray(subscribed) ? subscribed.includes(type) : subscribed === type;
}

/**
 * The slugs of this org's agents authored `initiative: low` — the ones that
 * sit debriefs out.
 * @param orgId - Tenant.
 */
async function lowInitiativeAgents(orgId: string): Promise<Set<string>> {
  const { agentSchema } = await import('@/models/Schema');
  const rows = await db
    .select({ slug: agentSchema.slug })
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.initiative, 'low')));
  return new Set(rows.map(r => r.slug));
}

/**
 * Completion events — the moments a piece of work is over and its residue is
 * worth reading back into the record. A debrief is an automation that
 * subscribes to one of these: the wiki researcher asking whether a standing
 * fact changed, the product manager writing what shipped on the request.
 *
 * All five payloads are scalar (filterable) and carry the ids a mission needs
 * to read the work itself, plus a `summary` short enough to sit in a brief.
 * Each is raised from the one place the terminal status is written, under a
 * dedupe key on the row id, so a retried write raises nothing twice.
 */
export const WORKER_RUN_COMPLETED = 'worker_run.completed';
export const WORKER_RUN_FAILED = 'worker_run.failed';
export const MISSION_RUN_COMPLETED = 'mission_run.completed';
export const CONVERSATION_ENDED = 'conversation.ended';
export const AUTOMATION_RUN_COMPLETED = 'automation_run.completed';

/**
 * The event types that mean "work finished" — `pr.merged` from the GitHub
 * source included. An automation on any of these is a debrief, and an agent
 * whose `initiative` is `low` sits debriefs out: its automations on these
 * types are skipped, and the event log's `triggered` list says nothing fired.
 * A schedule or any other event is unaffected — a low-initiative curator
 * still runs its Friday pass.
 */
export const DEBRIEF_EVENTS: ReadonlySet<string> = new Set([
  WORKER_RUN_COMPLETED,
  WORKER_RUN_FAILED,
  MISSION_RUN_COMPLETED,
  CONVERSATION_ENDED,
  AUTOMATION_RUN_COMPLETED,
  'pr.merged',
]);

/** Payload of `worker_run.completed` and `worker_run.failed`. */
export type WorkerRunEndedPayload = {
  workerRunId: number;
  agentSlug: string;
  /** `worker` | `lead` | `board` | `red-team` | `compact` | `snapshot`. */
  kind: string;
  /** `completed` | `cancelled` on the completed event; `failed` on the failed one. */
  status: string;
  /** The worker's own account of the run, or the error on a failure. Trimmed to 500 characters. */
  summary: string;
  /** The record the run was queued against, when the creator named one. */
  recordType: string | null;
  recordId: number | null;
  attempt: number;
  cents: number;
  completedAt: string;
};

/** Payload of `mission_run.completed`. */
export type MissionRunCompletedPayload = {
  missionRunId: number;
  missionId: number | null;
  missionSlug: string | null;
  title: string;
  /** The lead agent of the run's team. */
  agentSlug: string;
  /** `planned` for a brief a person or the planner decomposed; `check` for an automation's mission check. */
  mode: 'planned' | 'check';
  /** The last task's output, trimmed to 500 characters — the run's answer. */
  summary: string;
  tasksTotal: number;
  tasksFailed: number;
  completedAt: string;
};

/** Payload of `conversation.ended`. */
export type ConversationEndedPayload = {
  conversationId: number;
  agentSlug: string;
  title: string;
  /** `app` | `slack` | `email` | `mcp`. */
  surface: string;
  messageCount: number;
  /** When the last message landed; the idle window is measured from here. */
  lastMessageAt: string;
  /** `idle` — no turn for the sweep's window. The only way a conversation ends today. */
  endedBy: 'idle';
  /** The title, which the first message named. */
  summary: string;
  endedAt: string;
};

/** Payload of `automation_run.completed` — only for a `checkMission` fire that produced a result. */
export type AutomationRunCompletedPayload = {
  automationRunId: number;
  /** The automation's slug. */
  slug: string;
  kind: 'mission_check';
  missionRunId: number;
  missionRunStatus: string;
  tasksOk: number;
  tasksFailed: number;
  summary: string;
  completedAt: string;
};

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
      return { eventId: existing.id, deduped: true, triggered: [], skipped: [] };
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
  const skipped: EmitEventResult['skipped'] = [];
  // The workspace's off switch, read once per event rather than once per
  // subscriber. While it is held, the event is still RECORDED — a worker that
  // was already running finishes and reports, and its completion belongs in
  // the log — but it raises nothing: the fire is what a pause refuses.
  const workspacePause = await readWorkspacePauseWithName(input.orgId);
  for (const w of workspacePause ? [] : matches) {
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
  const {
    beginAutomationFire,
    completeAutomationFire,
    countRecentEventFires,
    fireAutomation,
    recordSkippedFire,
    scheduleCoalescedFire,
  } = await import('@/services/AutomationService');
  const causedBy = input.causedBy && input.causedBy.length > 0 ? input.causedBy : null;
  const automations = await db
    .select()
    .from(automationSchema)
    .where(eq(automationSchema.orgId, input.orgId));
  // Debriefs are gated on the owning agent's initiative; the roster is read
  // once per event and only when an automation is actually a debrief.
  let lowInitiative: Set<string> | null = null;
  for (const a of automations) {
    // A paused automation is skipped the way a disabled one is — silently,
    // not as a refused-fire row per event, which would bury the log while a
    // busy event type is held. The pause itself is already on the record.
    if (a.status !== 'active' || a.pausedAt || !subscribesTo(a.whenConfig.event, input.type) || !matchesFilter(payload, a.whenConfig.filter)) {
      continue;
    }
    if (workspacePause) {
      // A refused match, written down. Unlike the per-automation pause above
      // — which is skipped silently, because the pause is already on that
      // automation's record — a workspace pause leaves no row on any
      // automation at all, so without this the log for the whole afternoon
      // would simply be empty and nobody could tell a stop from an outage.
      const detail = refusalMessage(workspacePause, 'automation_fire');
      const skipId = await recordSkippedFire(input.orgId, a.slug, {
        event: input.type,
        payload,
        result: { kind: 'skipped', reason: 'workspace_paused', detail, event: input.type, causedBy },
      });
      skipped.push({ slug: a.slug, automationRunId: skipId, reason: 'workspace_paused' });
      continue;
    }
    // A low-initiative agent does not debrief (`agent.initiative`): its
    // automations on completion events are skipped, not refused — nothing in
    // the run log, since the agent was authored not to volunteer.
    if (DEBRIEF_EVENTS.has(input.type) && a.ownerAgentSlug) {
      lowInitiative ??= await lowInitiativeAgents(input.orgId);
      if (lowInitiative.has(a.ownerAgentSlug)) {
        continue;
      }
    }
    try {
      // An automation never fires on its own run's event. The chain on the
      // event names the fires behind it; a candidate on that chain, or one
      // whose own mission just completed, is refused and the refusal logged.
      // Sixty `wiki-debrief` runs in minutes on 20 September is why.
      const selfTrigger = selfTriggerReason(a, { type: input.type, payload, causedBy });
      if (selfTrigger) {
        const skipId = await recordSkippedFire(input.orgId, a.slug, {
          event: input.type,
          payload,
          result: { kind: 'skipped', reason: 'self_trigger', detail: selfTrigger, event: input.type, causedBy },
        });
        skipped.push({ slug: a.slug, automationRunId: skipId, reason: 'self_trigger' });
        continue;
      }
      // The ceiling: past `when.maxFiresPer10m` event fires in the window,
      // the fire is held and one coalesced fire is arranged for after it.
      const ceiling = input.ignoreCeiling ? null : eventFireCeiling(a.whenConfig);
      if (ceiling !== null && await countRecentEventFires(input.orgId, a.slug) >= ceiling) {
        const coalesce = await scheduleCoalescedFire(input.orgId, a.slug);
        const skipId = await recordSkippedFire(input.orgId, a.slug, {
          event: input.type,
          payload,
          result: {
            kind: 'skipped',
            reason: 'rate_limited',
            detail: `over ${ceiling} event fire${ceiling === 1 ? '' : 's'} in ten minutes (when.maxFiresPer10m); ${coalesce === 'unreachable' ? 'Temporal was unreachable, so this fire will not be replayed' : 'held for one coalesced fire after the window'}`,
            event: input.type,
            causedBy,
            ceiling,
            coalesce,
            coalescedInto: null,
          },
        });
        skipped.push({ slug: a.slug, automationRunId: skipId, reason: 'rate_limited' });
        continue;
      }
      if (input.dispatchMode === 'background') {
        // The fire's row exists before we answer; the pass itself runs after
        // the response. A mission check holds an agent loop for minutes, and
        // the caller here is a request a person is waiting on.
        const pending = await beginAutomationFire(input.orgId, a.slug, {
          input: payload,
          invokedBy: input.invokedBy ?? `event:${input.type}`,
          causedBy,
        });
        const { after } = await import('next/server');
        after(async () => {
          await completeAutomationFire(pending).catch(() => {
            /* recorded on the run row by completeAutomationFire */
          });
        });
        triggered.push({ slug: `automation:${a.slug}`, runId: pending.automationRunId });
      } else {
        const res = await fireAutomation(input.orgId, a.slug, {
          input: payload,
          invokedBy: input.invokedBy ?? `event:${input.type}`,
          causedBy,
        });
        triggered.push({ slug: `automation:${a.slug}`, runId: res.runId });
      }
    } catch {
      // Same tolerance as workflows above - one bad automation never drops the event.
    }
  }

  const [row] = await db
    .insert(eventLogSchema)
    .values({ orgId: input.orgId, type: input.type, payload, dedupeKey: input.dedupeKey ?? null, triggered, invokedBy: input.invokedBy ?? null, causedBy })
    .returning({ id: eventLogSchema.id });

  return { eventId: row!.id, deduped: false, triggered, skipped };
}
