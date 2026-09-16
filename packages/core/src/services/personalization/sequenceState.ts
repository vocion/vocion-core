/**
 * Current sequence vs recommended sequence — resolved BEFORE an Enroll button.
 *
 * > "The page recommends **Enroll in Personalized Nurture**. The CRM context
 * > says the contact 'was enrolled in a sequence within minutes of becoming an
 * > MQL'. Those need reconciliation before an **Enroll** button goes in front
 * > of somebody. Is the contact (A) in another sequence, (B) already in this
 * > one, (C) enrolled but finished, or (D) in an automated CRM sequence Vocion
 * > proposes replacing? The UI makes this impossible to tell."
 * > — `docs/specs/personalization-v2.md`
 *
 * The answer the review asks for is not a better label. It is that **the page
 * states transactionally what approving will do** — "Unenroll from X and
 * enroll in Y", or "Add Y; X stays active" — *and that where the data cannot
 * distinguish the cases, it says so and does not offer the button.*
 *
 * That last clause is the whole reason this is a resolver and not a string
 * template. A one-click Enroll that might mean either of two different things
 * to someone's inbox is worse than no button: the reviewer cannot tell which
 * one they authorised, and neither can the audit. `canEnroll: false` is a
 * first-class outcome here, not a failure.
 */

/** What the CRM mirror last observed about the contact's enrollment. */
export type CurrentSequence = {
  id?: string;
  name?: string;
  /** 'active' | 'completed' | 'none' | 'unknown' */
  status: string;
  step?: number;
  totalSteps?: number;
  /** 'automated' (a CRM workflow enrolled them) | 'manual' | 'unknown' */
  kind?: string;
  /** What the agent proposes doing to it: 'replace' | 'add'. Absent = it did not say. */
  disposition?: string;
  observedAt?: string;
  source?: string;
};

export type RecommendedSequence = {
  id: string;
  name: string;
  reason?: string;
  verified?: boolean;
};

/**
 * Which of the review's four cases this lead is in — plus the two the data
 * settles cleanly and the one it cannot.
 */
export type SequenceCase
  /** Not in anything. Enrolling adds the recommended sequence and nothing else. */
  = | 'none'
  /** Already in the recommended sequence. There is nothing to approve. */
    | 'already-enrolled'
  /** Was in a sequence; it finished. Enrolling is unambiguous. */
    | 'finished'
  /** In an automated CRM sequence Vocion proposes replacing. */
    | 'replace-automated'
  /** In another sequence, and the recommendation says which way it goes. */
    | 'replace-other'
  /** In another sequence, and the recommendation says to leave it running. */
    | 'add-alongside'
  /** The data cannot distinguish the cases. No one-click Enroll. */
    | 'ambiguous';

export type SequenceResolution = {
  case: SequenceCase;
  /** "Inbound Follow-up · active · step 1 of 3", or what we actually know. */
  currentLine: string;
  /** "Personalized Nurture · 4 sends", or null when nothing is recommended. */
  recommendedLine: string | null;
  /**
   * What approving will do, stated as a transaction. Null exactly when the
   * data cannot say — and then `canEnroll` is false.
   */
  approvingWill: string | null;
  /** False when the button would mean two different things. */
  canEnroll: boolean;
  /** Why not, in the page's own voice. Null when it can. */
  blockedReason: string | null;
};

const named = (s?: string | null): string | null => {
  const t = (s ?? '').trim();
  return t.length > 0 ? t : null;
};

/**
 * "active · step 1 of 3" from whatever parts the mirror carried.
 * @param current
 */
function describeCurrent(current: CurrentSequence | null | undefined): string {
  if (!current || current.status === 'unknown') {
    return 'Not established — the CRM did not say whether this contact is in a sequence';
  }
  if (current.status === 'none') {
    return 'Not in a sequence';
  }
  const parts: string[] = [];
  parts.push(named(current.name) ?? 'An unnamed sequence');
  parts.push(current.status === 'completed' ? 'finished' : 'active');
  if (current.step != null && current.totalSteps != null) {
    parts.push(`step ${current.step} of ${current.totalSteps}`);
  }
  if (current.kind === 'automated') {
    parts.push('enrolled automatically');
  }
  return parts.join(' · ');
}

/**
 * Resolve the two states into one transaction, or refuse.
 * @param current - What the CRM last observed. Null means never observed.
 * @param recommended - What the agent proposes. Null means nothing is proposed.
 * @param sendCount - How many sends the draft carries, for the recommended line.
 */
export function resolveSequenceState(
  current: CurrentSequence | null | undefined,
  recommended: RecommendedSequence | null | undefined,
  sendCount = 0,
): SequenceResolution {
  const currentLine = describeCurrent(current);
  const recommendedLine = recommended
    ? [recommended.name, sendCount > 0 ? `${sendCount} ${sendCount === 1 ? 'send' : 'sends'}` : null].filter(Boolean).join(' · ')
    : null;

  const base = { currentLine, recommendedLine };

  if (!recommended) {
    return {
      ...base,
      case: 'ambiguous',
      approvingWill: null,
      canEnroll: false,
      blockedReason: 'No sequence is recommended yet, so there is nothing to enroll into.',
    };
  }

  // (D-prime) Never observed, or observed as unknown. This is the case the old
  // page silently rendered as "Enroll".
  if (!current || current.status === 'unknown') {
    return {
      ...base,
      case: 'ambiguous',
      approvingWill: null,
      canEnroll: false,
      blockedReason: 'We cannot tell whether this contact is already in a sequence, so Enroll could mean adding a second one or replacing one. Re-read the contact in the CRM, or enroll from the CRM where the current state is visible.',
    };
  }

  // (B) Already in the one we are recommending.
  if (current.status === 'active' && current.id && current.id === recommended.id) {
    return {
      ...base,
      case: 'already-enrolled',
      approvingWill: null,
      canEnroll: false,
      blockedReason: `This contact is already in ${recommended.name}. There is nothing to enroll — review the sends if you want to change what is still to go out.`,
    };
  }

  // Nothing running.
  if (current.status === 'none') {
    return {
      ...base,
      case: 'none',
      approvingWill: `Enroll in ${recommended.name}.`,
      canEnroll: true,
      blockedReason: null,
    };
  }

  // (C) Enrolled but finished.
  if (current.status === 'completed') {
    return {
      ...base,
      case: 'finished',
      approvingWill: `Enroll in ${recommended.name}. ${named(current.name) ?? 'The previous sequence'} already finished and is not affected.`,
      canEnroll: true,
      blockedReason: null,
    };
  }

  // From here the contact IS in another active sequence. The question is what
  // happens to it, and that has to be SAID, not assumed.
  const other = named(current.name) ?? 'the sequence they are in';

  // (D) An automated CRM sequence Vocion proposes replacing. "Automated"
  // carries the disposition on its own: nobody chose it, so replacing it is
  // what "enroll in the researched one instead" means.
  if (current.kind === 'automated' && current.disposition !== 'add') {
    return {
      ...base,
      case: 'replace-automated',
      approvingWill: `Unenroll from ${other} and enroll in ${recommended.name}.`,
      canEnroll: true,
      blockedReason: null,
    };
  }

  if (current.disposition === 'replace') {
    return {
      ...base,
      case: 'replace-other',
      approvingWill: `Unenroll from ${other} and enroll in ${recommended.name}.`,
      canEnroll: true,
      blockedReason: null,
    };
  }

  if (current.disposition === 'add') {
    return {
      ...base,
      case: 'add-alongside',
      approvingWill: `Add ${recommended.name}. ${other} stays active.`,
      canEnroll: true,
      blockedReason: null,
    };
  }

  // (A) In another sequence somebody chose, and the recommendation did not say
  // whether to replace it. Both readings are plausible and they do different
  // things to a person's inbox.
  return {
    ...base,
    case: 'ambiguous',
    approvingWill: null,
    canEnroll: false,
    blockedReason: `This contact is already in ${other}, and the recommendation does not say whether ${recommended.name} replaces it or runs alongside it. Those send different mail, so Enroll is held until it does.`,
  };
}
