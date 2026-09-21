/**
 * Re-asking an open question is not a second decision.
 *
 * Read off production on 2026-09-21: of 22 open asks, twelve were the same
 * question. "Who owns agent-drafted release notes?" was filed once as #61-64,
 * then chased by #67, #68, #69, #70, #71, #77 and #79, one new row on every
 * scheduled check, each louder than the last, none of them a new decision.
 * Chris saw eleven rows and could make one ruling.
 *
 * A chase carries no decision of its own. It carries URGENCY about a decision
 * already on the page. So it folds into the ask it chases: the row keeps the
 * original question, and the chases become the evidence that it has gone
 * unanswered, counted and dated. Nothing is deleted, and answering the root
 * is still the one action that clears all of it.
 *
 * Pure: no database, no clock.
 */

/** The least an ask must expose to be placed in a chain. */
export type ChainableAsk = {
  id: number;
  title: string;
  body: string | null;
  sourceRef: string | null;
  createdAt: Date;
};

/**
 * Every ask id a piece of text points at. Reads `#61`, `ask #61`, `ask-61`,
 * `asks-61-64` and the ranges `#61-64` / `#61–64` / `#61, 64`, because the
 * factory writes all of those. A range is expanded, capped so a typo like
 * `#1-9999` cannot enumerate the world.
 *
 * Every number here is a CANDIDATE. It means nothing until it is matched
 * against the asks actually open, which is what keeps `req 39`, `check 10`
 * and gap request `#2584` from being read as ask citations.
 * @param text - Title, body or source ref.
 */
export function citedAskIds(text: string | null | undefined): number[] {
  if (!text) {
    return [];
  }
  const found = new Set<number>();
  // `#61`, `#61-64`, `#61–64`; and `ask-61`, `asks-61-64`, `ask 61`.
  const pattern = /(?:#|\basks?[ -])(\d{1,6})(?: ?[-\u2013\u2014] ?(\d{1,6}))?/gi;
  for (const m of text.matchAll(pattern)) {
    const from = Number(m[1]);
    if (!Number.isFinite(from)) {
      continue;
    }
    found.add(from);
    const to = m[2] === undefined ? from : Number(m[2]);
    // A range is only a range when it runs forwards and stays small. `#61–64`
    // is four asks; anything wider is a number that happened to have a dash
    // after it, and expanding it would drag in unrelated decisions.
    if (Number.isFinite(to) && to > from && to - from <= 32) {
      for (let id = from + 1; id <= to; id++) {
        found.add(id);
      }
    }
  }
  return [...found];
}

/** One decision, with every later ask that only chased it. */
export type AskChain<T extends ChainableAsk> = {
  /** The ask that actually poses the decision: the oldest in the chain. */
  root: T;
  /** Later asks that exist only to chase `root`, oldest first. */
  chases: T[];
  /** When it was last chased, or null if it never was. */
  lastChasedAt: Date | null;
};

/**
 * Fold every chase into the ask it chases.
 *
 * An ask is a CHASE when it cites at least one older open ask and every older
 * open ask it cites already belongs to one chain. A chase never merges two
 * roots: an ask that chases two different open decisions attaches to the
 * oldest of them and leaves the others standing as their own rows, because
 * two decisions are two decisions however they are bundled in a reminder.
 *
 * Order is by `createdAt` then `id`, so the result does not depend on the
 * order rows came back from the database.
 * @param asks - The open asks, in any order.
 */
export function chainReAsks<T extends ChainableAsk>(asks: T[]): AskChain<T>[] {
  const ordered = [...asks].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);
  const open = new Map(ordered.map(a => [a.id, a]));
  /** ask id → the id of the root whose chain it sits in. */
  const rootOf = new Map<number, number>();
  const chains = new Map<number, AskChain<T>>();

  for (const ask of ordered) {
    const cited = citedAskIds(`${ask.title}\n${ask.body ?? ''}\n${ask.sourceRef ?? ''}`)
      .filter(id => id !== ask.id && open.has(id))
      // Only an OLDER ask can be chased. A citation forwards in time is a
      // cross-reference, not a reminder, and folding on it would let one
      // decision swallow the next one filed.
      .filter((id) => {
        const target = open.get(id)!;
        return target.createdAt.getTime() < ask.createdAt.getTime() || (target.createdAt.getTime() === ask.createdAt.getTime() && target.id < ask.id);
      })
      .map(id => rootOf.get(id))
      .filter((id): id is number => id !== undefined);

    if (cited.length === 0) {
      rootOf.set(ask.id, ask.id);
      chains.set(ask.id, { root: ask, chases: [], lastChasedAt: null });
      continue;
    }
    const rootId = Math.min(...cited);
    const chain = chains.get(rootId)!;
    chain.chases.push(ask);
    chain.lastChasedAt = ask.createdAt;
    rootOf.set(ask.id, rootId);
  }
  return [...chains.values()];
}

/**
 * How the chases read on the row: the pressure, without a row each. Null when
 * the decision has never been chased, so an ordinary ask says nothing extra.
 * @param chain
 */
export function chaseLine<T extends ChainableAsk>(chain: AskChain<T>): string | null {
  const n = chain.chases.length;
  return n === 0 ? null : `asked again ${n} ${n === 1 ? 'time' : 'times'}, still open`;
}
