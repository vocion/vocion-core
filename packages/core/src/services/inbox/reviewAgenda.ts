/**
 * The agenda: what is actually on the table, and where everything else went.
 *
 * This is the whole of Chris's strongest requirement in one function. Nothing
 * is filtered out of sight: every candidate lands somewhere and says why, so
 * "Review has four items" is a claim anyone can audit in one read.
 *
 *   1. The admission bar decides what changes direction, priority,
 *      consequence, authority or policy (`admissionBar.ts`).
 *   2. What clears it is folded into topics, so related uncertainty enriches
 *      an existing decision rather than creating another (`decisionTopic.ts`).
 *   3. What did not clear it either enriches one of those decisions or goes
 *      to the factory, to a standing policy, or into the evidence that a
 *      policy is missing.
 *
 * A policy that has been chased repeatedly is reported as ONE gap, not as the
 * eleven rows the chasing produced. That is the difference between a queue
 * that tells a person the factory is stuck and one that tells them what to
 * change.
 *
 * Pure: no database, no clock, no network.
 */

import type { Admission, AdmissionCandidate, Destination, Grounds } from '@/services/inbox/admissionBar';
import type { DecisionTopic, TopicItem } from '@/services/inbox/decisionTopic';
import { admit, GROUNDS } from '@/services/inbox/admissionBar';
import { topicsOf } from '@/services/inbox/decisionTopic';

/** Everything the agenda needs from a candidate row. */
export type AgendaCandidate = AdmissionCandidate & TopicItem;

/** One decision on the agenda. */
export type AgendaEntry<T extends AgendaCandidate> = {
  topic: DecisionTopic<T>;
  /** Everything the answer changes, across the topic, strongest first. */
  grounds: Grounds[];
  /** Why the root was admitted. */
  because: string;
};

/** One thing that did not reach a person, and what happened to it instead. */
export type Reclassified<T extends AgendaCandidate> = {
  item: T;
  destination: Destination;
  because: string;
  /** The standing policy it runs under, when there is one. */
  policy: string | null;
  /** The decision it enriches, when it belongs to one. */
  topicKey: string | null;
};

/**
 * A standing policy that keeps producing rows: the factory asking the same
 * permission over and over is not a decision queue, it is a missing rule.
 */
export type PolicyGap = {
  policy: string;
  /** How many items this policy should have absorbed. */
  count: number;
  /** How many of those were chases rather than fresh work. */
  chases: number;
  /** The sentence a person reads. */
  summary: string;
};

/** What Review shows, and the full account of what it did not. */
export type ReviewAgenda<T extends AgendaCandidate> = {
  entries: AgendaEntry<T>[];
  reclassified: Reclassified<T>[];
  policyGaps: PolicyGap[];
};

/**
 * Build the agenda from every candidate the factory produced.
 * @param candidates - Asks, proposed actions, escalations: everything that used to be a row.
 */
export function reviewAgenda<T extends AgendaCandidate>(candidates: T[]): ReviewAgenda<T> {
  const verdicts = new Map<string, Admission>();
  const admitted: T[] = [];
  const denied: T[] = [];
  for (const c of candidates) {
    const verdict = admit(c);
    verdicts.set(c.key, verdict);
    (verdict.admitted ? admitted : denied).push(c);
  }

  const { topics, unattached } = topicsOf(admitted, denied);

  const entries = topics.map((topic): AgendaEntry<T> => {
    const found = new Set<Grounds>();
    for (const m of topic.members) {
      const v = verdicts.get(m.key);
      if (v?.admitted) {
        found.add(v.grounds);
      }
    }
    const rootVerdict = verdicts.get(topic.root.key);
    return {
      topic,
      grounds: GROUNDS.filter(g => found.has(g)),
      because: rootVerdict?.admitted ? rootVerdict.because : '',
    };
  });

  const reclassified: Reclassified<T>[] = [];
  const record = (item: T, topicKey: string | null) => {
    const v = verdicts.get(item.key);
    if (!v || v.admitted) {
      return;
    }
    reclassified.push({ item, destination: topicKey ? 'evidence' : v.destination, because: topicKey ? `${v.because} It enriches a decision already on the agenda.` : v.because, policy: v.policy, topicKey });
  };
  for (const entry of entries) {
    for (const e of entry.topic.enrichments) {
      record(e, entry.topic.key);
    }
  }
  for (const item of unattached) {
    record(item, null);
  }

  return { entries, reclassified, policyGaps: policyGapsOf(reclassified) };
}

function plural(n: number): string {
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

/**
 * Roll the reclassified items up by the policy they belong to. Eleven chases
 * about who owns release notes are one sentence: the rule is missing.
 * @param reclassified - Everything the bar turned away, with its destination.
 */
function policyGapsOf<T extends AgendaCandidate>(reclassified: Reclassified<T>[]): PolicyGap[] {
  const byPolicy = new Map<string, { count: number; chases: number }>();
  for (const r of reclassified) {
    if (!r.policy) {
      continue;
    }
    const acc = byPolicy.get(r.policy) ?? { count: 0, chases: 0 };
    acc.count += 1;
    if (r.destination === 'evidence') {
      acc.chases += 1;
    }
    byPolicy.set(r.policy, acc);
  }
  return [...byPolicy.entries()]
    .map(([policy, acc]) => ({
      policy,
      count: acc.count,
      chases: acc.chases,
      summary: acc.chases > 0
        ? `${plural(acc.count)} ran under "${policy}", ${acc.chases} of them the factory chasing a person about it. The rule needs changing, not the items answering.`
        : `${plural(acc.count)} ran under "${policy}" without needing you.`,
    }))
    .sort((a, b) => b.count - a.count || a.policy.localeCompare(b.policy));
}
