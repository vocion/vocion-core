/**
 * The admission bar: what is allowed to take an executive's attention.
 *
 * Chris, red-teaming Review a second time on 2026-09-21: "Do not redesign the
 * 31-item inbox. Make it impossible for 31 items like these to exist in the
 * executive Review queue in the first place."
 *
 * So Review stops being a place things arrive and becomes a place things are
 * ADMITTED to. An item is admitted only when the answer materially changes
 * one of five things:
 *
 *   direction    what we build, or whether we build it at all
 *   priority     what goes first, and what that displaces
 *   consequence  something irreversible, external, or costly happens
 *   authority    who is allowed to do or own a thing
 *   policy       a standing rule changes
 *
 * Everything else has one of three destinations, and none of them is a
 * person's morning:
 *
 *   resolve   the factory finishes it itself, or retries, or looks it up
 *   delegate  a standing policy already covers it; it is done under that
 *             policy and recorded in Activity
 *   evidence  it carries no decision of its own. It is pressure on a
 *             decision already open, or proof that a policy is missing.
 *
 * The refusals are an explicit, readable list rather than a mood. Anything the
 * list does not name is admitted, and is admitted with GROUNDS, so "why am I
 * being asked this" always has an answer on the row. That ordering matters:
 * a bar that refused by default would empty a workspace whose vocabulary
 * nobody thought to teach it, and a Review that quietly swallows a real
 * decision is worse than one with an extra row in it.
 *
 * Pure: no database, no clock, no network.
 */

/** The five things an answer must materially change to be worth asking about. */
export type Grounds = 'direction' | 'priority' | 'consequence' | 'authority' | 'policy';

/** Grounds in the order a topic reports them, strongest claim on attention first. */
export const GROUNDS: readonly Grounds[] = ['direction', 'priority', 'consequence', 'authority', 'policy'];

/** Where something that did not clear the bar goes instead. */
export type Destination = 'resolve' | 'delegate' | 'evidence';

/** The least an item must expose to be judged at the bar. */
export type AdmissionCandidate = {
  /** The ask kind, or `proposal` for a proposed action run. */
  kind: string;
  title: string;
  body?: string | null;
  /** The action id on a proposed action run, e.g. `notify.requester`. */
  actionId?: string | null;
  sourceRef?: string | null;
  /**
   * Grounds the filer declared. It is believed over inference, but it cannot
   * rescue bookkeeping: an agent cannot label a metadata update `direction`
   * and buy itself a place in Review.
   */
  grounds?: Grounds | null;
};

/** The bar's verdict on one item. */
export type Admission
  = | { admitted: true; grounds: Grounds; because: string }
    | { admitted: false; destination: Destination; because: string; policy: string | null };

/**
 * Action ids that are bookkeeping, whatever else they claim. Each names the
 * standing policy it runs under, which is also the thing that gets quoted
 * when the factory later proposes doing it without asking.
 */
const BOOKKEEPING_ACTIONS: { prefix: string; destination: Destination; policy: string | null; because: string }[] = [
  { prefix: 'notify.', destination: 'delegate', policy: 'every-asker-hears-back', because: 'Telling a requester their thing shipped is the policy working, not a decision.' },
  { prefix: 'objects.update_meta', destination: 'delegate', policy: 'ranking-is-the-factory’s-job', because: 'Ranking and metadata are the factory’s own arithmetic; a person cannot check it and should not have to.' },
  { prefix: 'objects.propose_candidate', destination: 'delegate', policy: 'ranking-is-the-factory’s-job', because: 'Proposing a record is filing, not deciding.' },
  { prefix: 'ask.file', destination: 'resolve', policy: null, because: 'Filing a question is not itself a question; the question it files is judged at this bar.' },
  { prefix: 'wiki.', destination: 'delegate', policy: 'the-factory-writes-its-own-notes', because: 'Writing up what the factory did is a record, not a choice.' },
  { prefix: 'record.create', destination: 'delegate', policy: 'the-factory-files-its-own-bugs', because: 'Creating a record about work the factory already understands needs no permission.' },
  { prefix: 'bug.', destination: 'delegate', policy: 'the-factory-files-its-own-bugs', because: 'Creating a record about work the factory already understands needs no permission.' },
];

/** Operational events. They belong on the run, inside the work item; none of them is a decision. */
const OPERATIONAL = [
  { re: /\bcontracts?\s+(?:was\s+|were\s+)?refus|\brefused\s+the\s+contract\b|\bworker\s+contract\s+(?:failure|refus)/i, because: 'A refused worker contract is an operational event the factory retries or repairs.' },
  { re: /\b(?:typecheck|type check|lint|build|check|verification)\s+failed\b|\bfailed\s+(?:typecheck|check|verification)\b/i, because: 'A failed check is the factory’s own work to fix.' },
  { re: /\bwhat\s+(?:are|is)\s+the\b[^?]{1,40}\bids?\b|\brecord\s+ids?\b|\bwhich\s+(?:record|object|row)\s+ids?\b/i, because: 'Looking up an identifier is the factory\u2019s own work, and if it truly cannot be found that is an evidence gap, not a decision.' },
  { re: /\btimed\s+out\b|\btimeout\b|\bno[- ]change\s+run\b|\bmade\s+no\s+changes\b/i, because: 'A timeout or a no-change run is an operational event, and the run record already holds it.' },
];

/** Topics that are always somebody else's job, however they are phrased. */
const DELEGATED_TOPICS = [
  { re: /\brelease notes?\b/i, policy: 'release-notes-have-a-standing-owner', because: 'Who writes up a release is a standing assignment, not a decision to be made once per release.' },
  { re: /\bnotify[.\s]requester\b|\b(?:tell|inform)\s+(?:the\s+)?requester\b|\brequester\s+notification\b|\baskers?\b[^.!?]{1,24}?\b(?:hear|heard|uncontacted|waiting)\b/i, policy: 'every-asker-hears-back', because: 'Telling a requester their thing shipped is the policy working, not a decision.' },
  { re: /\b(?:metadata|ranking|priority\s*(?:\/\s*)?priorityreason|update\s+meta)\b/i, policy: 'ranking-is-the-factory’s-job', because: 'Ranking and metadata are the factory’s own arithmetic.' },
  { re: /\b(?:approve|create|file|open)\s+(?:a\s+)?bug\s+record\b|\bbug\s+record\?/i, policy: 'the-factory-files-its-own-bugs', because: 'Recording a defect the factory has already proved needs no permission.' },
  { re: /\bwiki\b|\bwrite\s+(?:the\s+)?page\b/i, policy: 'the-factory-writes-its-own-notes', because: 'Writing up what the factory did is a record, not a choice.' },
];

/**
 * A chase. It repeats a question rather than posing one, so it carries no
 * decision: it is either pressure on a decision already open, or proof that
 * the thing it chases should never have needed a person.
 */
const CHASE = /\bescalat|\bcritical\b|\bsystem failure\b|\bstill (?:pending|waiting|open|uncontacted)\b|\bno decision\b|\bcheck\s*\d+\b|\b\d+\s+checks?\b|\bunblock\b|\bwaiting\s+\d+/i;

/** Signals that something irreversible, external or expensive is about to happen. */
const CONSEQUENCE = /\b(?:charge|refund|payment|invoice|billing|pricing|delete|drop\s+table|production\s+data|authentication|permissions?|send\s+(?:an?\s+)?email\s+to|publish|terminat)/i;

/** What an answer changes, inferred from how the question is asked. */
const GROUNDS_SIGNALS: { grounds: Grounds; re: RegExp; because: string }[] = [
  { grounds: 'priority', re: /\bwhich\s+(?:one\s+)?(?:goes|comes|ships)\s+(?:next|first)\b|\bwhat\s+goes\s+(?:next|first)\b|\bsequencing\b|\bbefore\s+or\s+after\b|\bvs\.?\s|\bversus\b/i, because: 'The answer changes what the factory does next, and therefore what it stops doing.' },
  { grounds: 'authority', re: /\bwho\s+(?:owns|decides|approves|signs|is\s+allowed)\b|\bpermission\s+to\b|\bon\s+whose\s+authority\b/i, because: 'The answer changes who is allowed to act.' },
  { grounds: 'policy', re: /\b(?:policy|standing rule|from now on|by default|stop asking|always|automatically)\b/i, because: 'The answer changes a standing rule, so it is answered once and applies afterwards.' },
  { grounds: 'direction', re: /\bshould\s+(?:we|it|they)\s+build\b|\bwhether\s+to\s+build\b|\bbuild\b[^?]*\?|\bin\s+scope\b|\bwhat\s+(?:infrastructure|approach|stack|architecture)\b|\bdo\s+we\s+(?:need|want)\b/i, because: 'The answer changes what the company builds.' },
];

/**
 * What each kind is asking about, when the words do not say. A
 * `recommendation` is the factory proposing work and the answer is a
 * direction; a `credential` hands over a secret, which is authority; a
 * proposed action changes something outside Vocion, which is consequence; a
 * paused run is waiting for permission to carry on; a suggested rule and an
 * unrecoverable failure class are both policy.
 */
const KIND_GROUNDS: Record<string, { grounds: Grounds; because: string }> = {
  recommendation: { grounds: 'direction', because: 'The factory recommends doing something it cannot start without a direction.' },
  credential: { grounds: 'authority', because: 'Handing over a secret is a grant of authority only a person can make.' },
  proposal: { grounds: 'consequence', because: 'An agent wants to change something outside Vocion, and no standing policy covers it.' },
  run: { grounds: 'authority', because: 'Work has stopped and is waiting for permission to carry on.' },
  learning: { grounds: 'policy', because: 'A suggested rule is a policy change: answered once, applied afterwards.' },
  exception: { grounds: 'policy', because: 'The factory cannot recover this class of failure on its own, so the answer sets the policy for it.' },
};

/** The grounds for a question nothing else explains: someone must choose. */
const DEFAULT_GROUNDS: { grounds: Grounds; because: string } = {
  grounds: 'direction',
  because: 'A person was asked a question the factory could not answer, and no standing policy covers it.',
};

/**
 * What the DENY rules read: the title and the source ref, what the item
 * declares itself to be. Bodies are excluded on purpose. A body that quotes a
 * failed check while posing a real product question must not be refused for
 * the quote, and in this data a chase always announces itself in its title.
 * @param c - The candidate being judged.
 */
function declared(c: AdmissionCandidate): string {
  return `${c.title}\n${c.sourceRef ?? ''}`;
}

/**
 * What the ADMIT rules read: everything the item says, because the sentence
 * that reveals what the answer changes is often in the body.
 * @param c - The candidate being judged.
 */
function stated(c: AdmissionCandidate): string {
  return `${c.title}\n${c.body ?? ''}`;
}

/**
 * Judge one item at the bar.
 *
 * Order matters, and it is the order of how cheap the refusal is: bookkeeping
 * actions, operational events, delegated topics, chases, then the kinds that
 * are never decisions, then grounds. Declared grounds are believed only once
 * every deny rule has passed, so labelling a metadata update `direction` buys
 * nothing.
 * @param c - The item, as much of it as the caller has.
 */
export function admit(c: AdmissionCandidate): Admission {
  const deny = declared(c);

  const action = c.actionId ? BOOKKEEPING_ACTIONS.find(b => c.actionId!.startsWith(b.prefix)) : undefined;
  if (action) {
    return { admitted: false, destination: action.destination, because: action.because, policy: action.policy ?? null };
  }

  // A declaration is believed HERE, above the text rules, because a filer that
  // has already decided what its answer changes knows more than a regular
  // expression over its title. It sits below the bookkeeping rules so that an
  // agent cannot label a metadata update `direction` and buy itself a row.
  if (c.grounds && GROUNDS.includes(c.grounds)) {
    return { admitted: true, grounds: c.grounds, because: 'The filer declared what the answer changes, and it is not something a standing policy covers.' };
  }

  for (const rule of OPERATIONAL) {
    if (rule.re.test(deny)) {
      return { admitted: false, destination: 'resolve', because: rule.because, policy: null };
    }
  }

  for (const rule of DELEGATED_TOPICS) {
    if (rule.re.test(deny)) {
      // A chase about a delegated topic is not pressure on a decision, it is
      // proof the delegation never happened. That is evidence a policy is
      // missing, which is a far more useful thing than another row.
      const destination: Destination = CHASE.test(deny) ? 'evidence' : 'delegate';
      return { admitted: false, destination, because: rule.because, policy: rule.policy };
    }
  }

  if (CHASE.test(deny)) {
    return { admitted: false, destination: 'evidence', because: 'A chase repeats a question rather than posing one: it is urgency about a decision already open.', policy: null };
  }

  const admitText = stated(c);
  for (const signal of GROUNDS_SIGNALS) {
    if (signal.re.test(admitText)) {
      return { admitted: true, grounds: signal.grounds, because: signal.because };
    }
  }

  // The consequence valve runs after the grounds signals on purpose. "Build
  // PATCH/DELETE for the objects API?" is a direction question that happens to
  // contain the word delete, and asking about consequence first would mislabel
  // it.
  if (CONSEQUENCE.test(admitText)) {
    return { admitted: true, grounds: 'consequence', because: 'Something irreversible, external or costly happens either way.' };
  }

  const byKind = KIND_GROUNDS[c.kind] ?? DEFAULT_GROUNDS;
  return { admitted: true, grounds: byKind.grounds, because: byKind.because };
}

/**
 * Whether an item clears the bar. The shorthand for callers that only need
 * the yes or no.
 * @param c - The candidate being judged.
 */
export function clearsBar(c: AdmissionCandidate): boolean {
  return admit(c).admitted;
}
