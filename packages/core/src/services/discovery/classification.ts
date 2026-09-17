/**
 * The discovery classifier's OUTPUT CONTRACT — what the model is asked for,
 * what a stored row means, and what a number next to a verdict is.
 *
 * ## Why this file exists
 *
 * v1 asked the model for `{is_discovery, is_discovery_confidence, …}` and
 * never said what the confidence meant. Two readings are defensible from that
 * prompt — *probability of the positive class* (`is_discovery: false` ⇒ a low
 * number) and *confidence in the answer given* (`is_discovery: false` ⇒ a high
 * number) — and production produced both: the story fixtures assume the first
 * (`isDiscovery: false, isDiscoveryConfidence: 0.12`), a real row showed
 * `discovery 0.95` on a call whose own reasoning says "Not a discovery call".
 * Routing survived by luck, because the boolean was checked before the
 * threshold; the UI did not, because it drew the number under the label
 * "discovery".
 *
 * ## The definition, once
 *
 * **`classificationConfidence` is the model's confidence in the class it
 * stated, never the probability of a fixed class.** `classification:
 * 'not-discovery'` with `classificationConfidence: 0.95` means "95% sure this
 * is NOT a discovery call". The field name carries the meaning, the class
 * travels with the number everywhere it is rendered, and the threshold now
 * reads as what its name says: below it, we are not sure enough of the stated
 * class to act on it, so a person decides.
 *
 * Rows written before this definition existed are marked
 * `confidenceSemantics: 'legacy'`. Their verdict is readable; their number is
 * not, because nothing recorded which reading produced it. They are never
 * reinterpreted — a migration that guessed would corrupt the audit record this
 * ledger exists to be.
 */

// ── Classes ─────────────────────────────────────────────────────────────────

/** What the call is. `uncertain` is a real answer, routed to a person. */
export const DISCOVERY_CLASSES = ['discovery', 'not-discovery', 'uncertain'] as const;
export type DiscoveryClass = typeof DISCOVERY_CLASSES[number];

/** Whether the call gives enough to draft a proposal now. */
export const READINESS_CLASSES = ['proposal-ready', 'not-proposal-ready', 'uncertain'] as const;
export type ReadinessClass = typeof READINESS_CLASSES[number];

/** How each class is written wherever a person reads it. */
export const DISCOVERY_CLASS_LABEL: Record<DiscoveryClass, string> = {
  'discovery': 'Discovery',
  'not-discovery': 'Not discovery',
  'uncertain': 'Uncertain',
};

export const READINESS_CLASS_LABEL: Record<ReadinessClass, string> = {
  'proposal-ready': 'Proposal-ready',
  'not-proposal-ready': 'Not proposal-ready',
  'uncertain': 'Readiness uncertain',
};

// ── Reason codes ────────────────────────────────────────────────────────────

/**
 * The CLOSED set of reasons a call is classified the way it is. A row carries
 * one code plus one sentence; the model's long reasoning lives behind
 * Evidence. Closed because these become operational dimensions — "how many
 * calls did we drop as diligence last month" is only answerable if the answer
 * comes from a fixed vocabulary.
 */
export const REASON_CODES = [
  'first-sales-conversation',
  'existing-opportunity',
  'internal-meeting',
  'customer-delivery-call',
  'follow-up-discovery',
  'diligence',
  'no-buyer-present',
  'insufficient-evidence',
] as const;
export type ReasonCode = typeof REASON_CODES[number];

export const REASON_CODE_LABEL: Record<ReasonCode, string> = {
  'first-sales-conversation': 'First sales conversation',
  'existing-opportunity': 'Existing opportunity',
  'internal-meeting': 'Internal meeting',
  'customer-delivery-call': 'Customer delivery call',
  'follow-up-discovery': 'Follow-up discovery',
  'diligence': 'Diligence',
  'no-buyer-present': 'No buyer present',
  'insufficient-evidence': 'Insufficient evidence',
};

/** The code an unmatched reason falls back to. Never invented, always flagged. */
export const REASON_CODE_FALLBACK: ReasonCode = 'insufficient-evidence';

/**
 * Map whatever the model wrote onto the closed set. An unrecognised reason
 * becomes `insufficient-evidence` AND is flagged, so the row says "the model
 * gave a reason we do not have a code for" rather than quietly claiming a code
 * it did not pick.
 * @param raw - The model's `reason_code`.
 */
export function normaliseReasonCode(raw: unknown): { code: ReasonCode; fallback: boolean } {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase().replace(/[\s_]+/g, '-') : '';
  const hit = (REASON_CODES as readonly string[]).includes(s) ? s as ReasonCode : null;
  return hit ? { code: hit, fallback: false } : { code: REASON_CODE_FALLBACK, fallback: true };
}

// ── The stored shape ────────────────────────────────────────────────────────

export type ConfidenceSemantics = 'stated-class' | 'legacy';

/**
 * What `discovery_candidate.classification` holds for a row written under the
 * defined contract. `classificationConfidence` and
 * `proposalReadinessConfidence` are both confidence IN THE STATED CLASS.
 */
export type StatedClassClassification = {
  confidenceSemantics: 'stated-class';
  classification: DiscoveryClass;
  classificationConfidence: number;
  proposalReadiness: ReadinessClass;
  proposalReadinessConfidence: number;
  reasonCode: ReasonCode;
  /** True when the model's reason did not match the closed set. */
  reasonCodeFallback: boolean;
  /** The one sentence that sits on the row. */
  reasonSummary: string;
  /** The model's long explanation — behind Evidence, never on the row. */
  reasoning: string;
  model?: string;
};

/**
 * What rows written before the contract hold. The booleans are readable; the
 * numbers are NOT, because the prompt that produced them admitted two
 * readings. They are carried, never converted.
 */
export type LegacyClassification = {
  confidenceSemantics?: undefined;
  isDiscovery: boolean;
  isDiscoveryConfidence: number;
  proposalReady: boolean;
  proposalReadyConfidence: number;
  reasoning: string;
  model?: string;
};

export type StoredClassification = StatedClassClassification | LegacyClassification;

/**
 * The reading every consumer works from: one class per axis, and a confidence
 * only where a confidence means something. A legacy row yields
 * `semantics: 'legacy'` and NO confidence — the verdict renders, the
 * percentage does not.
 */
export type ReadClassification = {
  semantics: ConfidenceSemantics;
  classification: DiscoveryClass;
  /** Null on a legacy row: the number exists but its meaning was never defined. */
  classificationConfidence: number | null;
  proposalReadiness: ReadinessClass;
  proposalReadinessConfidence: number | null;
  reasonCode: ReasonCode | null;
  reasonCodeFallback: boolean;
  reasonSummary: string;
  reasoning: string;
  model?: string;
  /** The raw numbers a legacy row stored, for the evidence panel only. */
  legacyScores?: { isDiscoveryConfidence: number; proposalReadyConfidence: number };
};

function clamp01(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * Read a stored classification of either vintage. Never guesses at a legacy
 * row's scale: the booleans become classes (that much the old prompt did
 * define) and the confidences are handed on labelled, not converted.
 * @param raw - `discovery_candidate.classification`, or null.
 */
export function readClassification(raw: StoredClassification | null | undefined): ReadClassification | null {
  if (!raw) {
    return null;
  }
  if (raw.confidenceSemantics === 'stated-class') {
    return {
      semantics: 'stated-class',
      classification: raw.classification,
      classificationConfidence: clamp01(raw.classificationConfidence),
      proposalReadiness: raw.proposalReadiness,
      proposalReadinessConfidence: clamp01(raw.proposalReadinessConfidence),
      reasonCode: raw.reasonCode,
      reasonCodeFallback: raw.reasonCodeFallback === true,
      reasonSummary: raw.reasonSummary,
      reasoning: raw.reasoning,
      model: raw.model,
    };
  }
  const legacy = raw as LegacyClassification;
  return {
    semantics: 'legacy',
    classification: legacy.isDiscovery ? 'discovery' : 'not-discovery',
    classificationConfidence: null,
    proposalReadiness: legacy.proposalReady ? 'proposal-ready' : 'not-proposal-ready',
    proposalReadinessConfidence: null,
    reasonCode: null,
    reasonCodeFallback: false,
    reasonSummary: '',
    reasoning: legacy.reasoning ?? '',
    model: legacy.model,
    legacyScores: {
      isDiscoveryConfidence: clamp01(legacy.isDiscoveryConfidence),
      proposalReadyConfidence: clamp01(legacy.proposalReadyConfidence),
    },
  };
}

// ── Routing ─────────────────────────────────────────────────────────────────

export type Route = 'generate' | 'confirm' | 'drop';

export type RouteThresholds = { discoveryThreshold: number; readyThreshold: number };

/**
 * Pick a path from a classification. Under the defined contract the threshold
 * finally means what its name says: **a confidence below it is not a low
 * probability of discovery, it is a weak verdict**, so it goes to a person
 * whichever way the verdict points.
 *
 *  - `uncertain`, or any class held below `discoveryThreshold` → `confirm`
 *    (human review). Dropping a call we are unsure about would throw away the
 *    only case the ledger's calibration loop can learn from.
 *  - Confident `not-discovery` → `drop`.
 *  - Confident `discovery`, confidently proposal-ready → `generate`.
 *  - Confident `discovery`, anything else → `confirm`.
 *
 * A legacy row routes on its boolean alone — the reading its number was
 * written under is unknown, so comparing it to a threshold would be theatre.
 * @param c - A read classification (either vintage).
 * @param opts - The thresholds in force.
 */
export function routeClassification(c: ReadClassification, opts: RouteThresholds): Route {
  if (c.semantics === 'legacy') {
    return c.classification === 'discovery'
      ? (c.proposalReadiness === 'proposal-ready' ? 'generate' : 'confirm')
      : 'drop';
  }
  if (c.classification === 'uncertain' || (c.classificationConfidence ?? 0) < opts.discoveryThreshold) {
    return 'confirm';
  }
  if (c.classification === 'not-discovery') {
    return 'drop';
  }
  if (c.proposalReadiness === 'proposal-ready' && (c.proposalReadinessConfidence ?? 0) >= opts.readyThreshold) {
    return 'generate';
  }
  return 'confirm';
}

/**
 * What the agent recommends doing, named as an action rather than as a routing
 * outcome. The ledger's second dimension: a route is how the system moved the
 * row, this is what it is proposing to a person.
 * @param route - The route chosen, or null before routing.
 */
export function recommendedAction(route: Route | null): 'generate-proposal' | 'continue-discovery' | 'no-action' | null {
  if (route === 'generate') {
    return 'generate-proposal';
  }
  if (route === 'confirm') {
    return 'continue-discovery';
  }
  if (route === 'drop') {
    return 'no-action';
  }
  return null;
}

export const RECOMMENDED_ACTION_LABEL: Record<NonNullable<ReturnType<typeof recommendedAction>>, string> = {
  'generate-proposal': 'Generate proposal',
  'continue-discovery': 'Continue discovery',
  'no-action': 'No discovery workflow',
};
