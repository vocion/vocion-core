/**
 * The decision contract — what every row in Review must carry before it is
 * allowed to take a person's attention.
 *
 * Chris, red-teaming Review on 2026-09-21: the queue was "a factory event
 * stream with some human decisions mixed in, not a queue of decisions". The
 * rows that WERE decisions still read as metadata about which agent asked
 * what, and a person had to open each one to find out what was being decided.
 *
 * So the row itself becomes decision support. Five fields, and an item without
 * them is not filed:
 *
 *   decision       what must be decided, ONE sentence
 *   recommendation what the system thinks — mandatory, unless it genuinely
 *                  cannot form one, and then it must say WHY NOT
 *   why            the one or two strongest reasons, not the whole case
 *   impactOfDelay  what happens if this waits — including "Nothing"
 *   actions        the explicit labelled choices
 *
 * The hand-off card (#501) already renders exactly this shape and reads well
 * on a phone; this is that shape, generalised, so every item gets it.
 *
 * Pure: no database. `AskService.fileAsk` validates against it on write and
 * the surfaces render from it.
 */

/** One labelled choice on an item. The same shape as an ask's `options`. */
export type DecisionAction = {
  id: string;
  label: string;
  /** What picking it does, one line. */
  description?: string;
  recommended?: boolean;
};

/** Everything a Review row must be able to answer without being opened. */
export type DecisionContract = {
  /** What must be decided, one sentence. */
  decision: string;
  /** What the system thinks should happen. Null only with `recommendationWhyNot`. */
  recommendation: string | null;
  /** Why no recommendation could be formed. Required when `recommendation` is null. */
  recommendationWhyNot: string | null;
  /** The one or two strongest reasons. */
  why: string[];
  /** What happens if this waits. "Nothing — this is a preference." is a valid answer. */
  impactOfDelay: string;
  /** The explicit labelled choices. */
  actions: DecisionAction[];
};

/** At most this many reasons ride the row. More than two is a report, not a decision. */
export const MAX_WHY = 2;

/** What a filer sent, before it is a contract. */
export type DecisionContractInput = {
  decision?: string | null;
  recommendation?: string | null;
  recommendationWhyNot?: string | null;
  why?: readonly string[] | null;
  impactOfDelay?: string | null;
  actions?: readonly DecisionAction[] | null;
};

/**
 * The refusal. Its message is written AT THE AGENT that filed the item,
 * because the agent is who has to do something about it — the fix is never
 * "ask the person anyway", it is "go and find out".
 */
export class DecisionContractError extends Error {
  constructor(public readonly missing: string, message: string) {
    super(message);
    this.name = 'DecisionContractError';
  }
}

const INVESTIGATE = 'Human attention is a scarce resource and an agent must earn the right to interrupt: investigate until you can present a decision, a recommendation and the choices, then file it.';

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}

/**
 * Validate a filer's decision contract, or refuse it.
 *
 * Refuses when there is no decision sentence, when there are no labelled
 * choices, when a recommendation is absent without a reason, or when nothing
 * was said about what delay costs. Every message names the missing field and
 * ends with what to do instead.
 * @param input - Whatever the filer sent.
 * @param opts
 * @param opts.subject - How the item reads in the refusal, e.g. the ask's title.
 * @throws DecisionContractError
 */
export function assertDecisionContract(input: DecisionContractInput, opts: { subject?: string } = {}): DecisionContract {
  const about = opts.subject ? ` for "${opts.subject}"` : '';
  const decision = clean(input.decision);
  if (!decision) {
    throw new DecisionContractError('decision', `No decision${about}: say in one sentence what a person must decide. ${INVESTIGATE}`);
  }
  const actions = normaliseActions(input.actions);
  if (actions.length === 0) {
    throw new DecisionContractError('actions', `No choices${about}: an item a person cannot answer from the row is not a decision, it is a notification. ${INVESTIGATE}`);
  }
  const recommendation = clean(input.recommendation);
  const recommendationWhyNot = clean(input.recommendationWhyNot);
  if (!recommendation && !recommendationWhyNot) {
    throw new DecisionContractError(
      'recommendation',
      `No recommendation${about}: say what you think should happen, or say why you cannot form a view. ${INVESTIGATE}`,
    );
  }
  const impactOfDelay = clean(input.impactOfDelay);
  if (!impactOfDelay) {
    throw new DecisionContractError(
      'impactOfDelay',
      `Nothing said about delay${about}: say what happens if this waits. "Nothing — it is a reversible preference" is an answer, and a good one. ${INVESTIGATE}`,
    );
  }
  const why = (input.why ?? []).map(w => clean(w)).filter((w): w is string => w !== null).slice(0, MAX_WHY);
  return {
    decision,
    recommendation,
    recommendationWhyNot: recommendation ? null : recommendationWhyNot,
    why,
    impactOfDelay,
    actions,
  };
}

/**
 * Trim and de-duplicate labelled choices, keeping at most one recommended —
 * the same rule `normaliseOptions` holds asks to, applied to whatever shape
 * the caller passed.
 * @param raw
 */
function normaliseActions(raw: DecisionContractInput['actions']): DecisionAction[] {
  if (!raw) {
    return [];
  }
  const out: DecisionAction[] = [];
  const seen = new Set<string>();
  let recommended = false;
  for (const item of raw) {
    const label = clean(item?.label);
    const id = clean(item?.id) ?? (label ? slug(label) : null);
    if (!label || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const action: DecisionAction = { id, label };
    const description = clean(item.description);
    if (description) {
      action.description = description;
    }
    if (item.recommended === true && !recommended) {
      action.recommended = true;
      recommended = true;
    }
    out.push(action);
  }
  return out;
}

function slug(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'option';
}

/**
 * Whether this contract has everything the row needs, without throwing —
 * for a reader deciding whether to render the decision block or the older,
 * thinner row.
 * @param contract
 */
export function isCompleteContract(contract: Partial<DecisionContract> | null | undefined): contract is DecisionContract {
  return Boolean(contract?.decision && contract.impactOfDelay && (contract.recommendation || contract.recommendationWhyNot) && (contract.actions?.length ?? 0) > 0);
}
