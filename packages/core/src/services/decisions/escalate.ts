/**
 * THE ESCALATION RULE, IN ONE PLACE.
 *
 * Every producer that used to put a card in front of a person — a
 * recommendation (`recommend_action`, the card backstop, a tool call written
 * as text), a proposal waiting on approval (`propose_action`), "Draft
 * needed", a connect card (`offer_connection`), the approval gate
 * (`request_human_review`), a ruling's typed choices — reaches the person in
 * the app as ONE thing: a Decision docked above the composer. The producers
 * keep emitting what they emitted; this seam, at the chat route, turns each
 * into the Decision it is:
 *
 *   inside trust + reversible   it ran: a Done receipt, Undo only where real
 *   an unclear instruction      a question            (Draft needed)
 *   several viable paths        a choice              (a ruling's options)
 *   outside trust               an approval           (a recommendation, a proposal, the gate)
 *   a step of setting up        a setup step          (connect a tool)
 *
 * Nobody here (a mission, an automation) never reaches this seam: those file
 * to Needs you with their deadline and default, and dock in chat behind the
 * conversation's own Decisions the next time the person opens it
 * (`DecisionService.waitingElsewhere`).
 *
 * Code routes on the event's typed fields — never on its words.
 */

import type { RaiseDecisionInput } from './DecisionService';
import type { Card } from '@/libs/cards/card';
import type { AskKind, AskOption } from '@/models/Schema';
import type { AgentEvent, RecommendedActionPayload } from '@/services/agents/types';
import type { FiledCard } from '@/services/chat/autoPropose';
import { CONNECT_SYSTEMS_CARD_KIND, SETUP_CARD_KIND } from '@/libs/cards/card';
import { ALLOW_ONCE_ID, DENY_ID } from '@/libs/decisions/decision';

export type EscalationDeps = {
  orgId: string;
  conversationId: number;
  /** The person whose turn it is — the owner of every Decision raised in it. */
  userId: string;
  /** The agent answering — the asker. */
  agentSlug: string;
  /**
   * Files a recommendation as a proposal (the thread is set to act within
   * bounds). Absent: a recommendation becomes an approval whose Approve runs
   * the action as the person.
   */
  file?: (rec: RecommendedActionPayload) => Promise<FiledCard | null>;
};

/**
 * Raise one Decision in this conversation and say so on the wire.
 * @param deps - The turn.
 * @param ask - What to raise.
 * @param approves
 */
async function raise(deps: EscalationDeps, ask: Omit<RaiseDecisionInput, 'orgId' | 'conversationId' | 'ownerUserId' | 'agentSlug'>, approves: string | null = null): Promise<AgentEvent[]> {
  const { raiseDecision } = await import('./DecisionService');
  const { normaliseOptions } = await import('@/services/AskService');
  const { view } = await raiseDecision({
    ...ask,
    options: normaliseOptions(ask.options ?? []),
    orgId: deps.orgId,
    conversationId: deps.conversationId,
    ownerUserId: deps.userId,
    agentSlug: deps.agentSlug,
  });
  // An approval offers "Always allow" where the trust ladder would take it for this person.
  const { withAlwaysAllow } = await import('./alwaysAllow');
  return [{ type: 'decision', decision: await withAlwaysAllow(deps.orgId, deps.userId, view, approves) }];
}

/**
 * A pending proposal, as the approval Decision it is.
 * @param deps - The turn.
 * @param runId - The proposal.
 */
async function proposalEvent(deps: EscalationDeps, runId: number): Promise<AgentEvent[]> {
  const { proposalById, proposalDecisionView } = await import('./proposals');
  const run = await proposalById(deps.orgId, runId);
  if (!run) {
    return [];
  }
  const { withAlwaysAllow } = await import('./alwaysAllow');
  return [{ type: 'decision', decision: await withAlwaysAllow(deps.orgId, deps.userId, await proposalDecisionView(run), run.actionId) }];
}

/**
 * Approve or Reject, Approve running the action as the person who chose it.
 * @param rec - The recommendation.
 */
function approvalOptions(rec: RecommendedActionPayload): AskOption[] {
  return [
    { id: ALLOW_ONCE_ID, label: 'Allow once', description: 'Runs it as you, now — this once.', ...(rec.suggestedDecision !== 'reject' && rec.suggestedDecision !== 'snooze' ? { recommended: true } : {}), action: { id: rec.actionId, input: rec.input ?? {} } },
    { id: DENY_ID, label: 'Deny', description: 'Nothing runs; the agent hears no.', ...(rec.suggestedDecision === 'reject' ? { recommended: true } : {}) },
  ];
}

/**
 * A recommendation, as the Decision it is.
 * @param rec - What the producer recommended.
 * @param deps - The turn.
 */
async function fromRecommendation(rec: RecommendedActionPayload, deps: EscalationDeps): Promise<AgentEvent[]> {
  // Nothing to press: the agent's words already carry it.
  if (!rec.actionId) {
    return [];
  }
  // AN UNCLEAR INSTRUCTION: a filing that misses its type's bar is asked as
  // one question — draft it here first — never filed as it stands.
  if (rec.draft) {
    return raise(deps, {
      kind: 'input',
      question: rec.label,
      body: `Not filed yet: ${rec.draft.missing}`.slice(0, 600),
      options: [{ id: 'draft', label: 'Draft it here', description: 'Writes every field it needs from this conversation, then files it.', recommended: true }],
      allowOther: true,
    });
  }
  // SEVERAL VIABLE PATHS: a ruling's typed options are a choice, each option
  // carrying what it runs.
  if (rec.actionId === 'ask.file') {
    const input = rec.input as { title?: unknown; body?: unknown; kind?: unknown; options?: unknown; objectRefs?: unknown; contextMd?: unknown; contextUrl?: unknown };
    const { ASK_KINDS } = await import('@/models/Schema');
    const { normaliseObjectRefs } = await import('@/services/AskService');
    const kind = (ASK_KINDS as readonly string[]).includes(String(input.kind)) ? input.kind as AskKind : 'ruling';
    return raise(deps, {
      kind,
      question: typeof input.title === 'string' && input.title.trim() ? input.title : rec.label,
      body: typeof input.body === 'string' ? input.body : rec.rationale ?? null,
      options: Array.isArray(input.options) ? input.options as AskOption[] : [],
      objectRefs: (() => {
        try {
          return normaliseObjectRefs(input.objectRefs);
        } catch {
          return [];
        }
      })(),
      contextMd: typeof input.contextMd === 'string' ? input.contextMd : null,
      contextUrl: typeof input.contextUrl === 'string' ? input.contextUrl : rec.href ?? null,
    });
  }
  // INSIDE TRUST: the thread acts within bounds, so it is filed — run on the
  // spot (a Done receipt) or left pending (the proposal is the approval).
  if (deps.file) {
    const filed = await deps.file(rec).catch(() => null);
    if (filed?.status === 'done') {
      const { actionIsUndoable } = await import('@/libs/actions/undoable');
      return [{ type: 'receipt', receipt: { runId: filed.runId, actionId: rec.actionId, label: rec.label, undoable: actionIsUndoable(rec.actionId), ...(rec.href ? { href: rec.href } : {}) } }];
    }
    if (filed?.status === 'pending') {
      return proposalEvent(deps, filed.runId);
    }
  }
  // OUTSIDE TRUST: an approval, asked the way a permission prompt asks —
  // the exact payload above Allow once; Allow once runs it as the person.
  const { payloadPreview } = await import('./preview');
  return raise(deps, {
    kind: 'approval',
    question: rec.label,
    body: rec.rationale ?? rec.suggestedDecisionReason ?? null,
    options: approvalOptions(rec),
    allowOther: true,
    contextUrl: rec.href ?? null,
    contextMd: payloadPreview(rec.input),
  }, rec.actionId);
}

/**
 * The connector a connect card is for, read off its link's query
 * (`connector=` on the login, `add=` on the token form).
 * @param href - The card's link.
 */
function connectorOf(href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href, 'http://in-app.invalid');
    return url.searchParams.get('connector') ?? url.searchParams.get('add');
  } catch {
    return null;
  }
}

/**
 * A card, as the Decision it is.
 * @param card - The card.
 * @param deps - The turn.
 */
async function fromCard(card: Card, deps: EscalationDeps): Promise<AgentEvent[]> {
  // A proposal waiting on approval is its own approval Decision.
  if (card.runId !== undefined && card.state === 'filed') {
    return proposalEvent(deps, card.runId);
  }
  // A STEP OF SETTING UP that one action does (add an app, turn a plugin on,
  // hire a role, invite people): choosing it runs that action as the person,
  // with its Undo — what the setup card's one button did, as a Decision.
  if (card.kind === SETUP_CARD_KIND && card.actions[0]) {
    const act = card.actions[0];
    return raise(deps, {
      kind: 'setup',
      question: card.title,
      body: card.body ?? null,
      options: [{ id: 'do', label: act.label || 'Do it', description: 'Runs it as you, now.', recommended: true, action: { id: act.actionId, input: act.input ?? {} } }],
      allowOther: true,
      contextUrl: card.href ?? null,
    });
  }
  // CONNECT YOUR SYSTEMS: one setup Decision whose option opens the docked
  // walk-through (each system in turn, verified); the walk answers it when it
  // finishes, with what happened (`services/connect/settleWalk.ts`).
  if (card.kind === CONNECT_SYSTEMS_CARD_KIND && card.href) {
    const { START_WALK_OPTION } = await import('@/services/connect/settleWalk');
    return raise(deps, {
      kind: 'setup',
      question: card.title,
      body: card.body ?? 'One system at a time, each verified, then what each one unlocks.',
      options: [{ id: START_WALK_OPTION, label: card.hrefLabel ?? 'Start', description: 'Walks you through each system here, one at a time.', recommended: true, href: card.href }],
      allowOther: true,
    });
  }
  // A STEP OF SETTING UP: connect a tool. Its options open the login or the
  // token form; the person lands back here and the step is answered then.
  if (card.kind === 'link' && card.href) {
    const connector = connectorOf(card.href) ?? 'tool';
    const options: AskOption[] = [
      { id: `connect:${connector}`, label: card.hrefLabel ?? card.title, description: 'Opens the sign-in, then brings you back here.', recommended: true, href: card.href },
      ...(card.secondaryHref ? [{ id: `paste:${connector}`, label: card.secondaryHrefLabel ?? 'Paste a token', description: 'Opens the token form, then brings you back here.', href: card.secondaryHref }] : []),
    ];
    return raise(deps, {
      kind: 'setup',
      question: card.title,
      body: card.lastAttempt ? `Last try: ${card.lastAttempt.summary}.` : card.body ?? null,
      options,
      allowOther: true,
    });
  }
  return [];
}

/**
 * What one producer event becomes in an app conversation: the Decision (or
 * Done receipt) to put on the wire, or null when the event is not one this
 * rule turns into a Decision and goes out as it is.
 * @param event - The producer's event.
 * @param deps - The turn.
 */
export async function escalate(event: AgentEvent, deps: EscalationDeps): Promise<AgentEvent[] | null> {
  if (event.type === 'recommended_action') {
    return fromRecommendation(event.recommendation, deps);
  }
  if (event.type === 'card') {
    return fromCard(event.card, deps);
  }
  if (event.type === 'hitl_gate') {
    const g = event.gate;
    const { payloadPreview } = await import('./preview');
    return raise(deps, {
      kind: 'gate',
      question: g.question,
      body: null,
      options: [
        { id: ALLOW_ONCE_ID, label: 'Allow once', description: 'It goes ahead, this once.', recommended: true },
        { id: DENY_ID, label: 'Deny', description: 'It does not happen; the agent hears no.' },
      ],
      allowOther: true,
      contextUrl: g.resumeUrl ?? null,
      contextMd: payloadPreview(g.payload),
    });
  }
  return null;
}
