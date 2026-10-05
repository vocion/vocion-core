/**
 * THE ASK, AND WHEN THE WORK STARTED — one reading for every surface (the
 * feature page, its public share, the walks). Chris, 2026-10-05, on FE-226's
 * share card reading "Built in 5d 18h" over the planning prompt that led the
 * product manager to propose it: "Is it a systemic fix? Or are you monkey
 * patching it?"
 *
 * Two kinds of request:
 *   - ASKED: a person asked, in their words (`body`), at `askedAt`. The work
 *     started when they said go (`decidedAt`), which for a chat ask is the
 *     same minute.
 *   - PROPOSED: an agent put it forward (`recommendedAt`, nobody in
 *     `askedBy`). Its `body` is whatever led the agent there — a planning
 *     prompt, a tracker row — never a person's ask, so the ask shown is the
 *     feature as it was put to the person (`story`, else `outcome`). The work
 *     started when a person approved it (`decidedAt`); "built in" runs from
 *     there, and the days it waited as a proposal are the timeline's, not the
 *     build's.
 *
 * Nothing here names a type or a writer: it reads the record's own fields.
 */

export type RequestAsk = {
  kind: 'asked' | 'proposed';
  /** The ask as it is shown: the person's words, or the feature as put to them. Null when the record has neither. */
  text: string | null;
  /** When it was asked, or put forward. */
  at: Date | null;
  /** When the work started: the person's go-ahead, else the ask itself. "Built in" runs from here. */
  startedAt: Date | null;
};

function date(v: unknown): Date | null {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v;
  }
  if (typeof v !== 'string' || !v) {
    return null;
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Read the ask off a request's record.
 * @param meta - The request's metadata.
 * @param createdAt - When the record was made, the ask's time when nothing else says.
 */
export function requestAsk(meta: Record<string, unknown> | null | undefined, createdAt: Date | null): RequestAsk {
  const m = meta ?? {};
  const askedBy = m.askedBy && typeof m.askedBy === 'object' ? (m.askedBy as Record<string, unknown>) : null;
  const somebodyAsked = askedBy !== null && Object.values(askedBy).some(v => typeof v === 'string' && v.trim());
  const recommendedAt = date(m.recommendedAt);
  const proposed = recommendedAt !== null && !somebodyAsked;
  const at = proposed ? recommendedAt : (date(m.askedAt) ?? createdAt);
  const decidedAt = date(m.decidedAt);
  const startedAt = decidedAt !== null && (at === null || decidedAt.getTime() >= at.getTime()) ? decidedAt : at;
  return {
    kind: proposed ? 'proposed' : 'asked',
    text: proposed ? (text(m.story) ?? text(m.outcome)) : text(m.body),
    at,
    startedAt,
  };
}
