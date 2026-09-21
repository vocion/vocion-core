/**
 * The brief. What a strong VP walks in with, instead of Build / Answer /
 * Decline / Other.
 *
 * Chris, 2026-09-21: "Answer" is conceptually muddy, and the difference
 * between declining and answering why something will not be built is a
 * distinction in the request workflow, not one an executive cares about. So
 * the verbs go, and what replaces them is the case:
 *
 *   whyNow          why this is in front of you today
 *   evidence        what the factory looked at
 *   scope           what the work actually is
 *   cost            how big, in the units a person thinks in
 *   tradeoff        what it displaces, explicitly, including "nothing"
 *   doNothing       what happens if you never answer
 *   recommendation  strong or weak, with reasons
 *   consequence     of WHAT, and whether it can be undone
 *   choices         options a person recognises
 *
 * Two vocabulary changes are load-bearing.
 *
 * CONFIDENCE BECOMES STRENGTH. A bar at 72 percent does not tell anyone what
 * to do. A strong recommendation with its reasons does, and a weak one has to
 * say why the uncertainty matters, which is the only part of the uncertainty
 * that changes a decision.
 *
 * RISK BECOMES CONSEQUENCE. "Medium risk" invites the question: risk of what.
 * Consequence has to name the thing. And size is not consequence: a large
 * task on an internal surface that can be reverted is low consequence, while
 * a one-line change to authentication is high. `assertBrief` enforces that
 * they are stated separately so nobody can quietly derive one from the other.
 *
 * Pure: no database, no clock. `decisionContract.ts` remains the minimum a
 * row must carry; this is what the BRIEF behind the row must carry.
 */

import type { Grounds } from '@/services/inbox/admissionBar';
import type { DecisionAction, DecisionContract } from '@/services/inbox/decisionContract';

/** How much weight the recommendation carries. There is no percentage. */
export type RecommendationStrength = 'strong' | 'weak';

/** What the system thinks, and how firmly. */
export type BriefRecommendation = {
  /** The id of the choice being recommended, when it is one of them. */
  choiceId: string | null;
  /** What it recommends, one sentence. */
  summary: string;
  strength: RecommendationStrength;
  /**
   * Why. On a strong recommendation these are the reasons to act; on a weak
   * one at least one of them must say what the remaining uncertainty would
   * change, because uncertainty that changes nothing is not worth printing.
   */
  reasons: string[];
};

/** How much is at stake, and in what. Never "medium risk". */
export type Consequence = {
  level: 'low' | 'medium' | 'high';
  /** What the consequence is OF: "an internal surface", "pricing for existing customers". */
  of: string;
  /** Whether the company can put it back. */
  reversible: boolean;
};

/** How big the work is. Size, deliberately, is not consequence. */
export type BriefCost = {
  size: 'small' | 'medium' | 'large';
  /** Plain words: "about two days for one engineer". Optional. */
  estimate?: string;
};

/** What this displaces. "Nothing" is an answer and must be said out loud. */
export type BriefTradeoff = {
  /** The work that stops or slips if this is chosen. Empty means nothing does. */
  displaces: string[];
  /** One sentence of why this instead of those, or why nothing is displaced. */
  note: string;
};

/** Something the factory looked at, and where to look at it. */
export type BriefEvidence = { label: string; href?: string };

/** Everything the brief behind a Review row must carry. */
export type DecisionBrief = {
  /** What must be decided, one sentence. Same sentence as the contract's. */
  decision: string;
  /** What the answer materially changes. */
  grounds: Grounds;
  whyNow: string;
  evidence: BriefEvidence[];
  scope: string;
  cost: BriefCost;
  tradeoff: BriefTradeoff;
  /** What happens if this is never answered. */
  doNothing: string;
  recommendation: BriefRecommendation;
  consequence: Consequence;
  /** Choices a person recognises: "build next", "build after Stamp", "do not build". */
  choices: DecisionAction[];
};

/** What a filer sent, before it is a brief. */
export type DecisionBriefInput = Partial<Omit<DecisionBrief, 'evidence' | 'choices'>> & {
  evidence?: readonly BriefEvidence[] | null;
  choices?: readonly DecisionAction[] | null;
};

/** The fields a brief cannot be filed without, in the order they are checked. */
export const REQUIRED_BRIEF_FIELDS = ['decision', 'grounds', 'whyNow', 'scope', 'cost', 'tradeoff', 'doNothing', 'recommendation', 'consequence', 'choices'] as const;

/** The refusal, written at the agent that filed the brief. */
export class DecisionBriefError extends Error {
  constructor(public readonly missing: string, message: string) {
    super(message);
    this.name = 'DecisionBriefError';
  }
}

const GO_AND_FIND_OUT = 'A person’s attention is the scarcest thing the company has: go and find out, then come back with the case.';

function clean(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed === '' ? null : trimmed;
}

function refuse(field: string, about: string, what: string): never {
  throw new DecisionBriefError(field, `${what}${about}. ${GO_AND_FIND_OUT}`);
}

/**
 * Validate a brief, or refuse it by name. Every message says which field is
 * missing and what a good answer to it looks like, because the fix is never
 * "ask the person anyway".
 * @param input - Whatever the filer sent.
 * @param opts - How to word a refusal.
 * @param opts.subject - How the brief reads in the refusal.
 * @throws {DecisionBriefError} When a required field is missing or empty.
 */
export function assertBrief(input: DecisionBriefInput, opts: { subject?: string } = {}): DecisionBrief {
  const about = opts.subject ? ` for "${opts.subject}"` : '';

  const decision = clean(input.decision);
  if (!decision) {
    refuse('decision', about, 'No decision sentence');
  }
  const grounds = input.grounds;
  if (!grounds) {
    refuse('grounds', about, 'No grounds: say which of direction, priority, consequence, authority or policy the answer changes');
  }
  const whyNow = clean(input.whyNow);
  if (!whyNow) {
    refuse('whyNow', about, 'Nothing said about why now');
  }
  const scope = clean(input.scope);
  if (!scope) {
    refuse('scope', about, 'No scope: say what the work actually is');
  }
  if (!input.cost?.size) {
    refuse('cost', about, 'No size: say whether this is small, medium or large');
  }
  const tradeoffNote = clean(input.tradeoff?.note);
  if (!input.tradeoff || !tradeoffNote) {
    refuse('tradeoff', about, 'No tradeoff: say what this displaces, and if it displaces nothing, say that and say there is capacity');
  }
  const doNothing = clean(input.doNothing);
  if (!doNothing) {
    refuse('doNothing', about, 'Nothing said about doing nothing: say what happens if this is never answered');
  }

  const recommendation = normaliseRecommendation(input.recommendation, about);
  const consequence = normaliseConsequence(input.consequence, about);

  const choices = normaliseChoices(input.choices, recommendation.choiceId);
  if (choices.length < 2) {
    refuse('choices', about, 'Fewer than two choices: a decision with one option is a notification');
  }
  if (recommendation.choiceId && !choices.some(c => c.id === recommendation.choiceId)) {
    refuse('recommendation', about, `The recommendation points at "${recommendation.choiceId}", which is not one of the choices`);
  }

  return {
    decision,
    grounds,
    whyNow,
    evidence: (input.evidence ?? []).map(e => ({ label: clean(e?.label) ?? '', ...(e?.href ? { href: e.href } : {}) })).filter(e => e.label !== ''),
    scope,
    cost: { size: input.cost.size, ...(clean(input.cost.estimate) ? { estimate: clean(input.cost.estimate)! } : {}) },
    tradeoff: { displaces: (input.tradeoff.displaces ?? []).map(d => clean(d)).filter((d): d is string => d !== null), note: tradeoffNote },
    doNothing,
    recommendation,
    consequence,
    choices,
  };
}

/**
 * The recommendation, with the rule that gives "weak" its meaning: a weak
 * recommendation must say why the uncertainty matters. A percentage is never
 * accepted here; `strengthFor` is how a confidence score becomes one of two
 * words.
 * @param raw - The field as the filer wrote it.
 * @param about - The subject phrase appended to a refusal.
 */
function normaliseRecommendation(raw: DecisionBriefInput['recommendation'], about: string): BriefRecommendation {
  const summary = clean(raw?.summary);
  if (!raw || !summary) {
    refuse('recommendation', about, 'No recommendation: say what you think should happen');
  }
  if (raw.strength !== 'strong' && raw.strength !== 'weak') {
    refuse('recommendation', about, 'No strength: a recommendation is strong or weak, never a percentage');
  }
  const reasons = (raw.reasons ?? []).map(r => clean(r)).filter((r): r is string => r !== null);
  if (reasons.length === 0) {
    refuse('recommendation', about, `A ${raw.strength} recommendation with no reasons is an opinion`);
  }
  return { choiceId: clean(raw.choiceId), summary, strength: raw.strength, reasons };
}

/**
 * The consequence, with the rule that kills "medium risk": it must name what
 * the consequence is OF.
 * @param raw - The field as the filer wrote it.
 * @param about - The subject phrase appended to a refusal.
 */
function normaliseConsequence(raw: DecisionBriefInput['consequence'], about: string): Consequence {
  const of = clean(raw?.of);
  if (!raw || !raw.level) {
    refuse('consequence', about, 'No consequence: say low, medium or high, and of what');
  }
  if (!of) {
    refuse('consequence', about, `"${raw.level} consequence" of what? Name the thing that changes, so nobody has to ask`);
  }
  return { level: raw.level, of, reversible: raw.reversible === true };
}

function normaliseChoices(raw: DecisionBriefInput['choices'], recommendedId: string | null): DecisionAction[] {
  const out: DecisionAction[] = [];
  const seen = new Set<string>();
  for (const item of raw ?? []) {
    const label = clean(item?.label);
    const id = clean(item?.id) ?? (label ? slug(label) : null);
    if (!label || !id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push({ id, label, ...(clean(item.description) ? { description: clean(item.description)! } : {}), ...(id === recommendedId ? { recommended: true } : {}) });
  }
  return out;
}

function slug(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'option';
}

/**
 * How a confidence score becomes a word. The threshold is high on purpose:
 * anything the system is not clearly sure about is weak, and a weak
 * recommendation is obliged to explain the uncertainty rather than print it.
 * @param confidence - 0 to 1, or null when the system never scored it.
 */
export function strengthFor(confidence: number | null | undefined): RecommendationStrength {
  return typeof confidence === 'number' && confidence >= 0.8 ? 'strong' : 'weak';
}

/**
 * Whether a brief is complete, without throwing, for a reader deciding
 * whether to render the brief or fall back to the thinner contract row.
 * @param brief - The brief to read.
 */
export function isCompleteBrief(brief: Partial<DecisionBrief> | null | undefined): brief is DecisionBrief {
  if (!brief) {
    return false;
  }
  try {
    assertBrief(brief);
    return true;
  } catch {
    return false;
  }
}

/**
 * The row a brief collapses to, so the queue keeps showing the five things
 * `decisionContract.ts` requires and the brief is what opens underneath it.
 * The contract's `impactOfDelay` is the brief's `doNothing`, which is the
 * same question asked from the other end.
 * @param brief - The brief to read.
 */
export function contractFromBrief(brief: DecisionBrief): DecisionContract {
  const strength = brief.recommendation.strength === 'strong' ? 'Strongly recommend' : 'Weakly recommend';
  return {
    decision: brief.decision,
    recommendation: `${strength}: ${brief.recommendation.summary}`,
    recommendationWhyNot: null,
    why: brief.recommendation.reasons.slice(0, 2),
    impactOfDelay: brief.doNothing,
    actions: brief.choices,
  };
}
