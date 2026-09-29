import type { AskObjectRef } from '@/models/Schema';
import type { AskDecidedPayload } from '@/services/EventService';
import { matchesFilter, subscribesTo } from '@/services/eventFilter';

/**
 * WHAT AN ANSWER SETS OFF, known before it is given (Chris, 2026-09-29, ask
 * #145: "there's nothing 'Proposed' in this Ruling. what is it going to do if
 * I hit approve? make that clear").
 *
 * Deciding an ask runs nothing by itself (`AskService.decideAsk` writes the
 * row and announces `ask.decided`). Whatever happens next is an automation or
 * a workflow subscribed to that event, whose filter matches the payload. The
 * payload is built HERE, once, for both the announcement and the preview the
 * decision page shows — so the page can say "Starts X" or "Nothing runs on its
 * own" from the same match the event bus will make, never from a guess.
 */

/** The ask fields the `ask.decided` payload carries. */
export type DecidedAskRow = {
  id: number;
  kind: string;
  status: string;
  decision: string | null;
  followUp: boolean;
  agentSlug: string | null;
  teamSlug: string | null;
  groupKey: string | null;
  sourceRef: string | null;
  objectRefs: AskObjectRef[] | null;
  decidedBy: string | null;
  decidedAt: Date | null;
};

/**
 * The `ask.decided` event payload for a decided row.
 * @param row - The decided ask, as written.
 */
export function askDecidedPayload(row: DecidedAskRow): AskDecidedPayload {
  return {
    askId: row.id,
    kind: row.kind,
    status: row.status,
    decision: row.decision ?? '',
    followUp: row.followUp,
    agentSlug: row.agentSlug ?? null,
    teamSlug: row.teamSlug ?? null,
    groupKey: row.groupKey ?? null,
    sourceRef: row.sourceRef ?? null,
    objectRefs: row.objectRefs ?? [],
    decidedBy: row.decidedBy ?? '',
    decidedAt: (row.decidedAt ?? new Date()).toISOString(),
  };
}

/**
 * The status a decision writes — `approve` and `reject` their own, every other
 * answer (`done`, a named option, `other`) is `done` (`AskService.resolveDecision`).
 * @param decision - The decision id.
 */
export function statusForDecision(decision: string): string {
  return decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'done';
}

/** One subscriber to events: an automation or an event-triggered workflow. */
export type AnswerSubscriber = { name: string; event: string | string[] | undefined; filter: unknown };

/**
 * For each possible answer, the names of the subscribers that answer would
 * start. Empty lists are kept: "nothing runs" is an answer too.
 * @param ask - The open ask.
 * @param decisions - The answers on offer.
 * @param subscribers - Active, unpaused automations and workflows.
 */
export function listenersFor(
  ask: Omit<DecidedAskRow, 'status' | 'decision' | 'followUp' | 'decidedBy' | 'decidedAt'>,
  decisions: string[],
  subscribers: AnswerSubscriber[],
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const decision of decisions) {
    const payload = askDecidedPayload({
      ...ask,
      status: statusForDecision(decision),
      decision,
      followUp: false,
      decidedBy: null,
      decidedAt: null,
    });
    out[decision] = [...new Set(subscribers
      .filter(s => subscribesTo(s.event, 'ask.decided') && matchesFilter(payload, s.filter))
      .map(s => s.name))];
  }
  return out;
}
