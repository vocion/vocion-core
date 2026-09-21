/**
 * One topic is one decision.
 *
 * > Related uncertainty enriches an existing decision. It does not create
 * > another decision. (Chris, 2026-09-21)
 *
 * The factory already understood that starting the Send admin panel would
 * pause the Stamp rename. It filed that understanding as a SECOND row
 * ("Admin panel vs. Stamp rename: which goes next?") instead of folding it
 * into the first ("Build a two-pane admin panel for Send?"). That is how one
 * topic becomes six rows: a ranking recommendation, a metadata correction, an
 * ask proposal, a build choice, a priority ruling, and an escalation caused by
 * the earlier proposals going unanswered.
 *
 * `reAskChain.ts` already folds a CHASE into the ask it cites. This is the
 * same move one level up: fold everything about the same SUBJECT into one
 * durable decision, whether or not it cites anything. Agents keep updating
 * that one object; Activity holds the history.
 *
 * The root is the OLDEST admitted member, because that is the decision the
 * person has owed an answer to for longest, and because it is what "fold it
 * into the first" means. Later related uncertainty becomes enrichment on it.
 *
 * Pure: no database, no clock, no network.
 */

/**
 * Words that carry no subject. Two items are not about the same thing because
 * they both say "approve" or "decision". The list is deliberately heavy on
 * factory vocabulary, which is exactly the vocabulary that would otherwise
 * make everything look related to everything.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'that',
  'this',
  'these',
  'those',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  'its',
  'their',
  'our',
  'out',
  'not',
  'but',
  'all',
  'any',
  'can',
  'cannot',
  'will',
  'would',
  'should',
  'could',
  'must',
  'may',
  'now',
  'how',
  'why',
  'what',
  'which',
  'who',
  'whom',
  'when',
  'where',
  'whether',
  'does',
  'did',
  'yet',
  'via',
  'per',
  'off',
  'ask',
  'asks',
  'asker',
  'askers',
  'asking',
  'answer',
  'question',
  'questions',
  'decide',
  'decision',
  'decisions',
  'decided',
  'approve',
  'approval',
  'approved',
  'reject',
  'rejected',
  'build',
  'built',
  'ship',
  'shipped',
  'next',
  'first',
  'last',
  'open',
  'close',
  'closed',
  'still',
  'pending',
  'waiting',
  'wait',
  'blocked',
  'unblock',
  'escalation',
  'escalate',
  'critical',
  'urgent',
  'system',
  'failure',
  'failed',
  'check',
  'checks',
  'review',
  'proposal',
  'proposals',
  'propose',
  'action',
  'actions',
  'run',
  'runs',
  'task',
  'tasks',
  'work',
  'item',
  'items',
  'need',
  'needs',
  'needed',
  'owner',
  'own',
  'owns',
  'direct',
  'scope',
  'update',
  'updates',
  'new',
  'old',
  'use',
  'used',
  'two',
  'three',
  'four',
  'five',
]);

/**
 * How many subject words two items must share before they are the same topic.
 * One is far too loose: "Send is RED" and "a panel for Send" share only the
 * product name and are two different decisions.
 */
export const TOPIC_OVERLAP = 2;

/** The least an item must expose to be placed on a topic. */
export type TopicItem = {
  /** Stable identity, used to order deterministically and to key the topic. */
  key: string;
  title: string;
  body?: string | null;
  /** When it started waiting. The oldest admitted member becomes the root. */
  at: Date;
};

/**
 * The subject words in a piece of text: lower-cased, de-punctuated, three
 * characters or more, and free of the vocabulary every factory row shares.
 * `e2e` survives because it is three characters and means something.
 * @param text - Title, and optionally the body.
 */
export function subjectWords(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) {
    return out;
  }
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw) && !/^\d+$/.test(raw)) {
      out.add(raw);
    }
  }
  return out;
}

/**
 * How many subject words two texts share.
 * @param a - One item.
 * @param b - The other item.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const word of a) {
    if (b.has(word)) {
      n += 1;
    }
  }
  return n;
}

/**
 * Whether two items are about the same thing, and therefore the same decision.
 * @param a - One item.
 * @param b - The other item.
 */
export function sameTopic(a: TopicItem, b: TopicItem): boolean {
  return overlap(subjectWords(a.title), subjectWords(b.title)) >= TOPIC_OVERLAP;
}

/** One durable decision and everything that enriches it. */
export type DecisionTopic<T extends TopicItem> = {
  /** `topic:<root key>`, stable while the root is open. */
  key: string;
  /** The decision itself: the oldest admitted member. */
  root: T;
  /** Admitted members, oldest first, root included. */
  members: T[];
  /** Items that carry no decision of their own but belong to this one. */
  enrichments: T[];
};

/**
 * Fold admitted items into topics, then attach everything that did not clear
 * the bar to the topic it belongs to.
 *
 * Clustering is transitive: A relates to B and B to C puts all three on one
 * topic, because they are one conversation even where A and C share no words.
 * Order is by `at` then `key`, so the result does not depend on the order rows
 * came out of the database.
 * @param admitted - Items that cleared the admission bar.
 * @param denied - Items that did not. Each is attached to at most one topic.
 */
export function topicsOf<T extends TopicItem>(admitted: T[], denied: T[] = []): { topics: DecisionTopic<T>[]; unattached: T[] } {
  const order = (a: T, b: T) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key);
  const ordered = [...admitted].sort(order);

  const clusters: { members: T[]; words: Set<string> }[] = [];
  for (const item of ordered) {
    const words = subjectWords(item.title);
    const hits = clusters.filter(c => overlap(c.words, words) >= TOPIC_OVERLAP);
    if (hits.length === 0) {
      clusters.push({ members: [item], words: new Set(words) });
      continue;
    }
    // Transitive: this item joins every cluster it relates to, which merges
    // them. One conversation is one decision even when it drifted vocabulary.
    const [keep, ...merge] = hits as [{ members: T[]; words: Set<string> }, ...{ members: T[]; words: Set<string> }[]];
    keep.members.push(item);
    for (const word of words) {
      keep.words.add(word);
    }
    for (const other of merge) {
      keep.members.push(...other.members);
      for (const word of other.words) {
        keep.words.add(word);
      }
      clusters.splice(clusters.indexOf(other), 1);
    }
  }

  const topics: DecisionTopic<T>[] = clusters.map((c) => {
    const members = [...c.members].sort(order);
    const root = members[0]!;
    return { key: `topic:${root.key}`, root, members, enrichments: [] };
  });

  const unattached: T[] = [];
  for (const item of [...denied].sort(order)) {
    const words = subjectWords(item.title);
    const home = topics.find(t => t.members.some(m => overlap(subjectWords(m.title), words) >= TOPIC_OVERLAP));
    if (home) {
      home.enrichments.push(item);
    } else {
      unattached.push(item);
    }
  }
  return { topics, unattached };
}

/**
 * How the enrichments read on the topic: what the row gained without gaining
 * a row. Null when nothing has enriched it, so an ordinary decision says
 * nothing extra.
 * @param topic - The decision the enrichments landed on.
 */
export function enrichmentLine<T extends TopicItem>(topic: DecisionTopic<T>): string | null {
  const related = topic.members.length - 1;
  const evidence = topic.enrichments.length;
  const parts: string[] = [];
  if (related > 0) {
    parts.push(`${related} related ${related === 1 ? 'question' : 'questions'} folded in`);
  }
  if (evidence > 0) {
    parts.push(`${evidence} ${evidence === 1 ? 'item' : 'items'} of evidence`);
  }
  return parts.length === 0 ? null : parts.join(' · ');
}
