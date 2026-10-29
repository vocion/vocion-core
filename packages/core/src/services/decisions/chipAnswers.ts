/**
 * A CHIP THAT ANSWERS AN OPEN CARD DECIDES IT.
 *
 * 2026-10-29, the SEO app on prod: the strategist filed the keyword plan's
 * sign-off and ended its reply with the chip "Approve the plan". The person
 * tapped it, the chip sent its words as a message, and the strategist, which
 * could not decide a sign-off itself, filed a second, generic approval. Two
 * near-identical cards, and approving the second would have done nothing.
 * "Asked me to approve with a chip. I did. That should be enough."
 *
 * Now, when a turn ends with follow-up chips while one of the agent's own
 * Decisions is open in the conversation, each chip that answers it carries
 * the Decision's id and the option it picks (`Suggestion.answers`). Tapping
 * it sends that typed answer (`decision_answer`, `via: 'chat_chip'`), which
 * is recorded as the person's answer with no model in between, and the ask's
 * own follow-up runs (`AskService.settleWaitersOn`).
 *
 * The binding is made in code, when the chips are handed over, so the model
 * never has to get an id right: a chip that is the option's own label (or id)
 * binds at once, and any other chip is read against the card by the same
 * model read that judges a typed answer (`turnJudge.readDecisionAnswer`) —
 * meaning is read, never matched. One open Decision only: with two, which one
 * a chip answers is not this code's guess to make.
 */

import type { Suggestion } from '@/libs/chat/suggestions';
import type { DecisionView } from '@/libs/decisions/decision';
import type { DecisionAnswerReading } from '@/services/agents/turnJudge';

/** What the chips are bound against: the turn's conversation, the person in it and the agent that wrote them. */
export type ChipTurn = {
  orgId: string;
  conversationId?: number | null;
  userId?: string | null;
  agentSlug?: string | null;
};

/** The model read of one chip against the card; injected in tests. */
export type ChipRead = (input: { orgId: string; message: string; decision: Pick<DecisionView, 'question' | 'options' | 'allowOther' | 'multiple'> }) => Promise<DecisionAnswerReading>;

/**
 * A label as a card's button says it, case and edge spaces aside.
 * @param s - The label.
 */
function same(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The option a chip is, by its own label or id — the identity of a button,
 * not a reading of what the words mean. Pure.
 * @param chip - The chip.
 * @param decision - The open Decision.
 * @param decision.options - Its options.
 */
export function optionNamedBy(chip: Pick<Suggestion, 'label'>, decision: Pick<DecisionView, 'options'>): string | null {
  const said = same(chip.label);
  if (!said) {
    return null;
  }
  return decision.options.find(o => same(o.label) === said || same(o.id) === said)?.id ?? null;
}

/**
 * The one open Decision the agent's chips may answer: its own, open, in this
 * conversation, with options to pick. Null when there is none or several.
 * @param open - What the conversation is waiting on.
 * @param agentSlug - The agent that wrote the chips.
 */
export function chipDecisionOf(open: readonly DecisionView[], agentSlug: string | null | undefined): DecisionView | null {
  const mine = open.filter(d => (d.subject ?? 'ask') === 'ask' && d.state === 'open' && d.options.length > 0 && (!agentSlug || !d.agentSlug || d.agentSlug === agentSlug));
  return mine.length === 1 ? mine[0]! : null;
}

/**
 * Bind each chip that answers the agent's open Decision to it. Chips that do
 * not answer it (or every chip, when nothing is open) come back unchanged.
 * Never throws: a chip left unbound still sends its words, and a typed
 * answer is read against the card before the turn is routed (`answersFirst`).
 * @param turn - The turn the chips end.
 * @param items - The chips, as the agent wrote them.
 * @param deps - Injected in tests.
 * @param deps.open - What the conversation is waiting on.
 * @param deps.read - The model read for a chip that is not an option's label.
 */
export async function bindChipsToOpenDecision(turn: ChipTurn, items: readonly Suggestion[], deps: { open?: (turn: ChipTurn) => Promise<DecisionView[]>; read?: ChipRead } = {}): Promise<Suggestion[]> {
  if (items.length === 0 || !turn.conversationId || !turn.userId || items.every(s => s.deeper)) {
    return [...items];
  }
  try {
    const open = await (deps.open ?? (async (t: ChipTurn) => {
      const { openDecisions } = await import('./DecisionService');
      return openDecisions(t.orgId, t.conversationId!, t.userId ?? null);
    }))(turn);
    const decision = chipDecisionOf(open, turn.agentSlug);
    if (!decision) {
      return [...items];
    }
    const read: ChipRead = deps.read ?? (async (input) => {
      const { readDecisionAnswer } = await import('@/services/agents/turnJudge');
      return readDecisionAnswer(input as Parameters<typeof readDecisionAnswer>[0]);
    });
    const { decisionAnswerFromReading } = await import('@/services/agents/turnJudge');
    // Only an option counts: a chip is never a free-text answer or a skip.
    const asCard = { question: decision.question, options: decision.options, allowOther: false, multiple: false };
    return await Promise.all(items.map(async (chip) => {
      if (chip.deeper) {
        return chip;
      }
      const named = optionNamedBy(chip, decision);
      if (named) {
        return { ...chip, answers: { id: decision.id, optionId: named } };
      }
      const reading = await read({ orgId: turn.orgId, message: chip.prompt, decision: asCard }).catch(() => null);
      const answer = reading ? decisionAnswerFromReading(asCard, reading, chip.prompt) : null;
      return answer?.kind === 'option' && answer.optionIds.length === 1
        ? { ...chip, answers: { id: decision.id, optionId: answer.optionIds[0]! } }
        : chip;
    }));
  } catch (err) {
    console.warn('chip binding failed', { orgId: turn.orgId, message: (err as Error).message });
    return [...items];
  }
}
