/**
 * recommend_action — A2UI: surface a one-tap recommended action in the answer.
 *
 * Unlike propose_action (which creates a gated action_run immediately), this
 * only RECOMMENDS: it emits a `recommended_action` event the chat renders as a
 * clickable card. The gated review item is JIT-created only if the user taps it
 * (review.propose), reusing the agent's authority so it still lands `pending`
 * for approval. Use it to turn "you should follow up with Nadia" into a button
 * the user can act on, instead of leaving the recommendation as dead text.
 */

import type { RuntimeContext } from '../types';
import type { SuggestedDecision } from '@/libs/actions/suggestedDecision';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { labelWithResolvedRefs } from '@/libs/actions/cardLabel';
import { MERGE_ACTION_ID } from '@/libs/actions/mergeAction';
import { actionInputHints, getAction, listActions } from '@/libs/actions/registry';
import { repairActionInput } from '@/libs/actions/repairInput';
import { restatesLabel } from '@/libs/actions/restatesLabel';
import { SUGGESTED_DECISIONS } from '@/libs/actions/suggestedDecision';
import { appBaseUrl } from '@/libs/links';
import { openLabelFor } from '@/libs/workspace/recordHref';
import { mergeCardRunsItself } from '../decisionHolder';

/**
 * The record a card is ABOUT, read off its action's input: a record named by
 * type and id, or the request a build answers. Null when the card names none.
 * @param input - The card's action payload.
 */
export function cardRecordRef(input: Record<string, unknown>): { objectType: string; id: number } | null {
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : Number.NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
  };
  if (typeof input.objectType === 'string' && input.objectType && num(input.id) !== null) {
    return { objectType: input.objectType, id: num(input.id)! };
  }
  // `factory.dispatch_task` answers a request; its card is about that feature.
  if (num(input.requestId) !== null) {
    return { objectType: 'request', id: num(input.requestId)! };
  }
  return null;
}

/**
 * The link a card carries to the record it is about — the page the workspace
 * opens that record on. Never throws: a card without its link is still a card.
 * @param orgId - Tenant.
 * @param input - The card's action payload.
 */
export async function cardHref(orgId: string | undefined, input: Record<string, unknown>): Promise<{ href: string; hrefLabel: string } | null> {
  const ref = cardRecordRef(input);
  if (!ref || !orgId) {
    return null;
  }
  try {
    const { recordHref } = await import('@/services/objects/recordHref');
    const href = await recordHref(orgId, ref);
    return { href, hrefLabel: openLabelFor(href) };
  } catch {
    return null;
  }
}

/**
 * The candidate gate's refusal for a filing card, judged with this turn's reads.
 * @param ctx - The turn.
 * @param input - The card's parsed objects.propose_candidate payload.
 */
async function filingCardRefusal(ctx: RuntimeContext, input: Record<string, unknown>): Promise<string | undefined> {
  if (!ctx.orgId || typeof input.objectType !== 'string') {
    return undefined;
  }
  try {
    const { candidateGateRefusal, loadObjectType } = await import('@/libs/actions/objects-propose-candidate');
    const type = await loadObjectType(ctx.orgId, input.objectType);
    if (!type) {
      return undefined;
    }
    const fields = (input.fields ?? {}) as Record<string, unknown>;
    // Only what THIS turn can answer is judged here; anything else the door
    // says when the card is filed, as it always has.
    if (await candidateGateRefusal(ctx.orgId, type, fields)) {
      return undefined;
    }
    const { readsThisTurn } = await import('@/services/gates/turnReads');
    return await candidateGateRefusal(ctx.orgId, type, fields, { reads: await readsThisTurn(ctx) });
  } catch {
    return undefined;
  }
}

/**
 * @param ctx - The turn.
 * @param opts - Options.
 * @param opts.actionIds - Describe only these actions (the card pass writes one card
 *   per call and names its action up front); every registered action when omitted.
 *   Validation always runs against the whole registry.
 */
export function recommendActionTool(ctx: RuntimeContext, opts: { actionIds?: readonly string[] } = {}) {
  const described = opts.actionIds?.length ? opts.actionIds.map(id => getAction(id)).filter((a): a is NonNullable<typeof a> => !!a) : [];
  const shown = described.length > 0 ? described : listActions();
  const available = shown.map(a => `${a.id} — ${a.description}`).join('\n');
  // The field names, with * on the required ones — read off the schemas, so
  // a card is not refused for `object_type` where the action says `objectType`
  // (finding 20, 2026-09-25: every refused card was a guessed field name).
  const inputs = actionInputHints(described.length > 0 ? described.map(a => a.id) : undefined);

  return tool(
    async (input) => {
      const { action_id, action_input: given, label: written, rationale, confidence, suggested_decision, suggested_decision_reason } = input as {
        action_id: string;
        action_input: Record<string, unknown>;
        label: string;
        rationale?: string;
        confidence?: number;
        suggested_decision?: SuggestedDecision;
        suggested_decision_reason?: string;
      };
      // Repaired below when the repair has one right answer.
      let action_input = given;
      // A card is never lost to a missing sentence: the reviewer's suggested
      // decision defaults to approve — the tool is recommending — and its
      // reason to the rationale (2026-09-24: a decline case died in the
      // reference run on exactly this field).
      // A record the label names is the one the payload resolves, never a
      // number the model typed (s1, 2026-09-29: "(request 207)" on a card
      // whose 207 was an environment) — `libs/actions/cardLabel.ts`.
      const label = action_id ? labelWithResolvedRefs(written, action_input ?? {}) : written;
      const suggestedDecision: SuggestedDecision = suggested_decision ?? 'approve';
      // THE WHY IS EVIDENCE, NOT THE TITLE AGAIN. A rationale that only
      // restates the label is sent back while the model can still fix it:
      // what was asked, by whom, when, and what is at stake.
      if (action_id && restatesLabel(rationale, written)) {
        return JSON.stringify({ ok: false, error: `rationale repeats the label ("${written}"). Give the evidence instead, in one or two sentences: what the person asked or what happened, when, and what is at stake — e.g. "Dana asked on Oct 8 for two call slots before the Oct 15 board review; nobody has answered." Then call recommend_action again.` });
      }
      const suggestedDecisionReason = [suggested_decision_reason, rationale].map(x => x?.trim()).find(x => x && !restatesLabel(x, written)) || `Recommended: ${label}`;
      // The card's Approve calls the action with this payload, so a payload the
      // action rejects is a card that can only fail — on 2026-09-18 one reached
      // production as "Couldn't prepare it: Internal server error". Validate
      // here, where the model can still fix it, and say exactly what is wrong.
      if (action_id) {
        const action = getAction(action_id);
        if (!action) {
          // Said out loud: a refused card is a card nobody saw, and for a day
          // (2026-09-24/25) every one of them counted as emitted (finding 20).
          console.warn('recommend_action refused: no such action', { agentSlug: ctx.agentSlug, actionId: action_id, label });
          return JSON.stringify({ ok: false, error: `No registered action "${action_id}". Registered: ${listActions().map(a => a.id).join(', ')}. Pick one of these, or recommend without an action id when the next step is a person's, not a system's.` });
        }
        // One right answer is applied, not asked for (a title from the
        // label, a workspace path made absolute): `libs/actions/repairInput.ts`.
        const fixed = repairActionInput(action.inputSchema, action_input ?? {}, { label: written, baseUrl: appBaseUrl() });
        if (fixed.repaired.length > 0) {
          action_input = fixed.input;
          console.warn('recommend_action: repaired the input', { agentSlug: ctx.agentSlug, actionId: action_id, label, repaired: fixed.repaired });
        }
        const check = action.inputSchema.safeParse(action_input ?? {});
        if (!check.success) {
          const issues = check.error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
          console.warn('recommend_action refused: invalid input', { agentSlug: ctx.agentSlug, actionId: action_id, label, issues });
          return JSON.stringify({ ok: false, error: `action_input for ${action_id} is invalid — ${issues}. Fill those fields from what you know, or recommend without an action id.` });
        }
        // A FILING CARD MEETS THE DOOR NOW, with this turn's reads: the card
        // is filed after the turn, where nobody can say what the turn opened,
        // so a gate asking for a source read in this turn is checked here.
        if (action_id === 'objects.propose_candidate') {
          const refusal = await filingCardRefusal(ctx, check.data as Record<string, unknown>);
          if (refusal) {
            console.warn('recommend_action refused: filing gate', { agentSlug: ctx.agentSlug, actionId: action_id, label });
            return JSON.stringify({ ok: false, error: refusal });
          }
        }
      }
      // NO CARD FOR WHAT THE PERSON JUST TOLD IT TO DO (Chris, 2026-09-29, on
      // #246: "the card came early … and I think unnecessary by the end").
      // In a person's own turn, when a model reading of their words says they
      // told the agent to take exactly this action, it runs as theirs
      // (`runProposal`), with undo, instead of waiting on a tap.
      if (action_id && ctx.userId && !ctx.missionRunId) {
        const { personSaidToDecide } = await import('../owedDecision');
        // Judged as the action, its target and its effect, not the label
        // alone (action 5949: a revert put up where the person asked to defer).
        const { consentDecision } = await import('../consentDecision');
        const decision = await consentDecision(ctx.orgId, action_id, action_input ?? {}, label);
        const consent = await personSaidToDecide(ctx, decision).catch(() => ({ said: false }));
        if (consent.said) {
          const { runProposal } = await import('./proposeAction');
          return runProposal(ctx, { actionId: action_id, input: action_input ?? {}, confidence: typeof confidence === 'number' ? confidence : 0.9, rationale: rationale?.trim() || label, suggestedDecision, suggestedDecisionReason, label }, { tool: 'recommend_action' });
        }
      }
      // A MERGE CARD NOBODY PRESSES (backlog 044): a class whose trust rule
      // merges it on its own once QA approves has no card to show.
      // A running goal asks only for what was asked (`services/objectives/goalGuard.ts`):
      // no outreach nobody asked for, and a denied action is not re-asked revised.
      if (action_id && ctx.conversationId) {
        const { goalProposalRefusal } = await import('@/services/objectives/goalGuard');
        const refusal = await goalProposalRefusal({ orgId: ctx.orgId, conversationId: ctx.conversationId, actionId: action_id, grant: getAction(action_id)?.grant, actionInput: action_input ?? {}, personAsked: false }).catch(() => null);
        if (refusal) {
          return JSON.stringify({ ok: false, error: refusal });
        }
      }
      if (action_id === MERGE_ACTION_ID && typeof action_input?.riskClass === 'string') {
        const moot = await mergeCardRunsItself(ctx, action_input.riskClass);
        if (moot) {
          return JSON.stringify({ ok: false, error: moot });
        }
      }
      // The record the card is about opens from the card (Chris, 2026-09-28:
      // "I want to click through to the feature detail page").
      const link = action_id ? await cardHref(ctx.orgId, action_input ?? {}) : null;
      ctx.emit({
        type: 'recommended_action',
        recommendation: {
          actionId: action_id,
          input: action_input ?? {},
          label,
          ...(link ?? {}),
          rationale,
          confidence,
          agentSlug: ctx.agentSlug,
          suggestedDecision,
          suggestedDecisionReason,
        },
      });
      return `Put "${label}" in front of the person as a decision — docked above their composer, Approve running it as them. Your turn ends there; their answer comes back to you as a typed decision event. Do NOT also paste the full draft as text — the decision carries it.`;
    },
    {
      name: 'recommend_action',
      description: `Put a recommended action in front of the person as ONE DECISION docked above their composer (not dead text): Approve runs it as them, Reject drops it, and their answer comes back to you. Use this for every concrete next action you suggest that maps to a connector action; nothing sends without their approval. Prefer this over spelling the action out in prose. ${described.length > 0 ? `Available actions:\n${available}\n\nEach action's input fields, exactly as named (* = required) — action_input must use these names and nothing else:\n${inputs}` : 'Action ids and their input fields are listed under ACTIONS in your instructions.'}`,
      schema: z.object({
        action_id: z.string().describe('Registered action id, e.g. "gmail.send"'),
        action_input: z.record(z.string(), z.unknown()).describe('Pre-filled payload for the action — for a reply, gmail.send: { to: "Name <address>", cc (everyone still copied on the thread), subject: "Re: <thread subject>", threadId (the thread being answered), body (the reply only), signature (how the sender signs, when known), draft: true }'),
        label: z.string().describe('Short human button label, e.g. "Draft the note to Nadia Brandt"'),
        rationale: z.string().optional().describe('One or two sentences of EVIDENCE for why this action, now: what was asked or happened, by whom, when, and what is at stake. Never the label again.'),
        confidence: z.number().min(0).max(1).optional().describe('Your confidence 0–1 from grounding quality'),
        // Required, and asked as a separate question from `rationale`: the
        // card this becomes goes into the review queue with a recommendation
        // on it, and whatever stands there is scored against what the reviewer
        // then does. Core used to fill this in — an "approve" on every card,
        // which the agreement rate read as the agent's own view.
        suggested_decision: z.enum(SUGGESTED_DECISIONS).optional().describe('What you think the reviewer should do with this once it reaches the queue: "approve", "reject" or "snooze". Almost always "approve" for something you are recommending — say "snooze" when it should wait for something you name, and "reject" when you are surfacing it for a person to turn down. Omitted means approve.'),
        suggested_decision_reason: z.string().optional().describe('ONE short sentence for why that recommendation, in your own words — "the renewal is 11 days out and nobody has replied", "worth doing, but not until the contract is signed". Not the same as `rationale`: that argues the payload is right, this argues what should happen to the card. Omitted means the rationale.'),
      }),
    },
  );
}
