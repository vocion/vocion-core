/**
 * The ledger's THIRD dimension: what a person did with the assessment.
 *
 * Classification (what it is), recommended action (what to do about it) and
 * human disposition (what a person decided) are three different questions, and
 * the v1 filter — `generate · confirm · drop` — mixed all three into one word.
 * `routed confirm` next to `review: declined` could not tell you what was
 * declined: the classification, the recommendation, or the whole row.
 *
 * Disposition is DERIVED, not stored in a second place. The inbox already
 * writes one `decision_alignment` row per human decision on an agent
 * recommendation, and a discovery candidate points at the `action_run` that
 * decision was made on (`review_action_run_id`). Reading it back is what makes
 * this ledger's agreement rate the same number the rest of the platform uses.
 */

export const DISPOSITIONS = ['pending', 'accepted', 'corrected', 'dismissed'] as const;
export type Disposition = typeof DISPOSITIONS[number];

export const DISPOSITION_LABEL: Record<Disposition, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  corrected: 'Corrected',
  dismissed: 'Dismissed',
};

/** What the ledger knows about the human side of one row. */
export type HumanDecision = {
  /** `action_run.status`, or null when the row was never put in front of anyone. */
  reviewStatus: string | null;
  /** `decision_alignment.decision`, when the inbox recorded one. */
  decision: string | null;
  /** `decision_alignment.agreed` — whether the person chose what the agent advised. */
  agreed: boolean | null;
};

/**
 * Map one human decision onto the four dispositions.
 *
 *  - **Pending** — nobody has decided. Includes a row that was never routed to
 *    a person, which is the honest reading: the assessment stands unreviewed.
 *  - **Accepted** — the person went with the recommendation.
 *  - **Corrected** — the person overrode it (declined it, or edited it before
 *    approving). This is the disagreement the calibration loop is about.
 *  - **Dismissed** — the row left the queue without a judgement: cancelled,
 *    superseded, or lost. Not a correction, and counting it as one would
 *    understate the agreement rate.
 * @param d - The row's human side.
 */
export function dispositionOf(d: HumanDecision): Disposition {
  if (d.agreed === false || d.decision === 'rejected' || d.decision === 'edited') {
    return 'corrected';
  }
  if (d.agreed === true || d.decision === 'approved' || d.decision === 'done') {
    return 'accepted';
  }
  switch (d.reviewStatus) {
    case 'approved':
    case 'executing':
    case 'done':
    case 'completed':
      return 'accepted';
    case 'rejected':
      return 'corrected';
    case 'cancelled':
    case 'superseded':
    case 'lost':
      return 'dismissed';
    default:
      return 'pending';
  }
}

/**
 * A disposition that settles the calibration question — agreed, or did not.
 * @param disposition
 */
export function isDecided(disposition: Disposition): boolean {
  return disposition === 'accepted' || disposition === 'corrected';
}

/**
 * The rows the header's "N corrected" counts, and the Disagreements filter shows.
 * @param disposition
 */
export function isDisagreement(disposition: Disposition): boolean {
  return disposition === 'corrected';
}

export type Calibration = {
  /** Rows with a classification. */
  assessed: number;
  /**
   * ASSESSED rows waiting on a person. A matched call with no transcript is
   * also `pending`, but it is not waiting on a human — it is waiting on a
   * transcript, and counting it here would make the header's number disagree
   * with the filter it applies.
   */
  needReview: number;
  /** Rows a person overrode. */
  corrected: number;
  /** Rows a person accepted. */
  accepted: number;
  /** accepted + corrected — the denominator of the rate. */
  decided: number;
  /** accepted / decided, or null when nobody has decided anything yet. */
  agreementRate: number | null;
};

/**
 * Roll a set of dispositions into the header's line:
 * "47 assessed · 4 need review · 6 corrected · 88% agreement".
 * @param rows - One entry per assessed candidate.
 */
export function calibrationOf(rows: ReadonlyArray<{ assessed: boolean; disposition: Disposition }>): Calibration {
  let assessed = 0;
  let needReview = 0;
  let corrected = 0;
  let accepted = 0;
  for (const r of rows) {
    if (r.assessed) {
      assessed += 1;
    }
    if (r.disposition === 'pending') {
      if (r.assessed) {
        needReview += 1;
      }
    } else if (r.disposition === 'corrected') {
      corrected += 1;
    } else if (r.disposition === 'accepted') {
      accepted += 1;
    }
  }
  const decided = accepted + corrected;
  return {
    assessed,
    needReview,
    corrected,
    accepted,
    decided,
    agreementRate: decided === 0 ? null : accepted / decided,
  };
}

/**
 * The delta the header shows when a previous classifier version has decided
 * rows: "+7 pts vs <previous version>". Null when there is no earlier version
 * with anything decided — an invented baseline is worse than no baseline.
 * @param rows - Assessed rows with their classifier version and disposition.
 * @param currentVersion - The version the newest assessed row was produced by.
 */
export function versionDelta(
  rows: ReadonlyArray<{ classifierVersion: string | null; disposition: Disposition; assessedAt: string }>,
  currentVersion: string | null,
): { previousVersion: string; points: number } | null {
  if (!currentVersion) {
    return null;
  }
  const decided = rows.filter(r => isDecided(r.disposition) && r.classifierVersion);
  const current = decided.filter(r => r.classifierVersion === currentVersion);
  if (current.length === 0) {
    return null;
  }
  // The most recently used version that is not the current one.
  const previous = [...decided]
    .filter(r => r.classifierVersion !== currentVersion)
    .sort((a, b) => (a.assessedAt < b.assessedAt ? 1 : -1))[0]
    ?.classifierVersion;
  if (!previous) {
    return null;
  }
  const prevRows = decided.filter(r => r.classifierVersion === previous);
  const rate = (set: typeof decided) => set.filter(r => r.disposition === 'accepted').length / set.length;
  return {
    previousVersion: previous,
    points: Math.round((rate(current) - rate(prevRows)) * 100),
  };
}
