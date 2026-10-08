/**
 * What a suggested change to a rulebook does, and the evidence it was proposed
 * on — the one definition the store, the compaction pass, the learnings page,
 * the Needs-you screen and the API read.
 *
 * A `learning_candidate` is one of three changes:
 *
 *   - **adopt** — a new rule (everything the feedback loop proposes).
 *   - **merge** — near-duplicates become one stronger rule. The merged rule
 *     keeps what the originals earned: their occurrence counts are summed and
 *     each original rides along as provenance (`meta.mergedFrom`).
 *   - **expire** — a rule is retired: nobody has read or restated it in N
 *     days, or a newer rule says the opposite. Nothing is added.
 *
 * Retiring never deletes. A retired rule is expired in the store (invisible to
 * every read, exactly as a deleted one was) with the decision on its meta, so
 * Undo brings it back as it was. That is the difference between compaction and
 * silently forgetting.
 *
 * Pure: no database, no React.
 */

export const RULE_CHANGE_KINDS = ['adopt', 'merge', 'expire'] as const;

export type RuleChangeKind = typeof RULE_CHANGE_KINDS[number];

/** Why a rule leaves the store. */
export type RetireReason = 'merged' | 'stale' | 'contradicted';

/** One rule as it stood when a compaction was proposed — what a reviewer reads before deciding. */
export type RetiredRuleSnapshot = {
  /** The store key: the rule's identity everywhere. */
  key: string;
  text: string;
  /** How many separate pieces of feedback asked for it. Summed onto a merged rule. */
  occurrenceCount: number;
  /** Where it came from: `feedback:<id>`, `learning-candidate`, `workspace:<id>`, … */
  source: string | null;
  /** When it was adopted, ISO. */
  adoptedAt: string | null;
  /** When an agent last had it mounted, ISO; null when never. */
  lastUsedAt: string | null;
  /** When feedback last restated it, ISO; null when never. */
  lastReinforcedAt: string | null;
};

/** The evidence on a merge or an expiry — `learning_candidate.evidence`. */
export type RuleChangeEvidence = {
  reason: RetireReason;
  /** The rules this change retires, as they stood. */
  rules: RetiredRuleSnapshot[];
  /** For a stale expiry: the window it was judged on, in days. */
  staleDays?: number;
  /** For a contradiction: the newer rule that supersedes the retired one. */
  supersededBy?: { key: string; text: string };
  /** One sentence from the model that judged it, when one did. */
  why?: string;
  /** When the evidence was read, ISO — anything dated is shown with its date. */
  asOf: string;
};

/**
 * The change a candidate makes. A row filed before `change_kind` existed that
 * carries `replaces_keys` was a consolidation, so it reads as a merge.
 * @param candidate - The candidate row, or the fields of it this reads.
 * @param candidate.changeKind - `learning_candidate.change_kind`.
 * @param candidate.replacesKeys - `learning_candidate.replaces_keys`.
 */
export function ruleChangeKind(candidate: { changeKind?: string | null; replacesKeys?: string[] | null }): RuleChangeKind {
  if (candidate.changeKind === 'merge' || candidate.changeKind === 'expire' || candidate.changeKind === 'adopt') {
    return candidate.changeKind;
  }
  return (candidate.replacesKeys?.length ?? 0) > 0 ? 'merge' : 'adopt';
}

/**
 * The verbs a change is decided with — the same words on the learnings page, Needs you and the toast.
 * @param kind - The change.
 */
export function ruleChangeVerbs(kind: RuleChangeKind): { approve: string; reject: string; done: string } {
  switch (kind) {
    case 'merge':
      return { approve: 'Merge', reject: 'Keep separate', done: 'Merged' };
    case 'expire':
      return { approve: 'Retire', reject: 'Keep', done: 'Retired' };
    default:
      return { approve: 'Adopt as rule', reject: 'Reject', done: 'Adopted' };
  }
}

/**
 * One line saying why a rule goes, for a reviewer — dated, never vague.
 * @param evidence - The candidate's evidence.
 */
export function retireLine(evidence: Pick<RuleChangeEvidence, 'reason' | 'staleDays' | 'supersededBy'> & { rules: readonly unknown[] }): string {
  const n = evidence.rules.length;
  const rules = `${n} rule${n === 1 ? '' : 's'}`;
  switch (evidence.reason) {
    case 'stale':
      return `${rules} no agent has read and nobody has restated in ${evidence.staleDays ?? 'many'} days`;
    case 'contradicted':
      return evidence.supersededBy
        ? `Contradicted by a newer rule: “${clip(evidence.supersededBy.text, 120)}”`
        : 'Contradicted by a newer rule';
    default:
      return `${rules} saying the same thing, merged into one`;
  }
}

/**
 * The summed occurrence count a merge carries: every original's count, so
 * "seven people asked for this" survives the merge.
 * @param rules - The rules being merged.
 */
export function mergedOccurrenceCount(rules: ReadonlyArray<Pick<RetiredRuleSnapshot, 'occurrenceCount'>>): number {
  return Math.max(1, rules.reduce((n, r) => n + Math.max(1, r.occurrenceCount || 1), 0));
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
