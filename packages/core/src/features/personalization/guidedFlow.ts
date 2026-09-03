/**
 * The guided review's state machine.
 *
 * The cards a reviewer decides on are derived from the run, not asked of the
 * model: every one of them is computable from the card's own content, so the
 * flow is a typed contract with a deterministic source rather than a hope
 * about model behaviour (vocion-core's structural-over-prompting rule). The
 * model is invoked only to revise a send and to answer questions.
 *
 * Two rules carry the weight, and both exist because approval is a promise:
 *
 *   - **Approval binds to copy the reviewer has seen.** A revision
 *     re-presents its send, and the decision is withheld while any revised
 *     send is unread. Asking for a change after reaching the decision
 *     withdraws it until the revised send is read again.
 *   - **Only applied revisions count.** A question is answered and counts
 *     nothing; the recap lists the revisions with the asks that produced
 *     them, so the record of what changed is the reviewer's own words.
 */

import type { ReviewCard } from '@/libs/actions/types';

export type GuidedSend = {
  /** Card content id, e.g. `send-2` — what a rewrite and an edit address. */
  id: string;
  label: string;
  subject: string;
  body: string;
  /** 1-based position, for "send 2 of 3". */
  position: number;
};

export type Revision = {
  contentId: string;
  /** 2 for the first revision — v1 is the draft. */
  version: number;
  body: string;
  /** What the reviewer asked for, verbatim. */
  ask: string;
};

export type GuidedState = {
  /** How far the walk has gone; -1 before it starts. */
  step: number;
  /** contentId → its revisions, newest last. */
  revisions: Record<string, Revision[]>;
  /** Revised sends the reviewer has not re-read. The decision waits on these. */
  unread: string[];
  decided: boolean;
};

export const initialGuidedState: GuidedState = { step: -1, revisions: {}, unread: [], decided: false };

/**
 * The sends to walk, taken from the card's own content.
 * @param card
 */
export function sendsFromCard(card: ReviewCard): GuidedSend[] {
  return (card.content ?? [])
    .filter(c => c.kind === 'email')
    .map((c, i) => ({
      id: c.id,
      label: c.label ?? `Send ${i + 1}`,
      subject: 'subject' in c ? String(c.subject ?? '') : '',
      body: 'body' in c ? String(c.body ?? '') : '',
      position: i + 1,
    }));
}

/**
 * The copy that will actually send: the latest revision, else the draft.
 * @param send
 * @param state
 */
export function currentBody(send: GuidedSend, state: GuidedState): string {
  const revs = state.revisions[send.id];
  return revs && revs.length > 0 ? revs[revs.length - 1]!.body : send.body;
}

/**
 * 1 for an unrevised send, 2 for its first revision, and so on.
 * @param send
 * @param state
 */
export function versionOf(send: GuidedSend, state: GuidedState): number {
  return (state.revisions[send.id]?.length ?? 0) + 1;
}

/**
 * Record a revision. It re-presents its send, and if that send is not the
 * one under review it joins the unread set, so the decision waits for it.
 * @param state - Current state.
 * @param sends - The sends being walked.
 * @param contentId - Which send was revised.
 * @param body - The revised copy.
 * @param ask - What the reviewer asked for.
 * @returns The next state.
 */
export function applyRevision(
  state: GuidedState,
  sends: GuidedSend[],
  contentId: string,
  body: string,
  ask: string,
): GuidedState {
  const existing = state.revisions[contentId] ?? [];
  const revision: Revision = { contentId, version: existing.length + 2, body, ask };
  const index = sends.findIndex(s => s.id === contentId);
  const isUnderReview = index === state.step;
  return {
    ...state,
    revisions: { ...state.revisions, [contentId]: [...existing, revision] },
    unread: isUnderReview || state.unread.includes(contentId) ? state.unread : [...state.unread, contentId],
  };
}

/**
 * The reviewer read a re-presented send.
 * @param state
 * @param contentId
 */
export function markRead(state: GuidedState, contentId: string): GuidedState {
  return { ...state, unread: state.unread.filter(id => id !== contentId) };
}

/**
 * Whether the decision may be offered: every send walked, and nothing
 * revised-but-unread. A change asked after the recap withdraws it, because
 * the reviewer would otherwise approve copy they have not seen.
 * @param state - Current state.
 * @param sends - The sends being walked.
 * @returns True when the decision card belongs on screen.
 */
export function canDecide(state: GuidedState, sends: GuidedSend[]): boolean {
  return !state.decided && state.step >= sends.length && state.unread.length === 0;
}

/**
 * Every revision that will ride along with the approval, in send order.
 * @param state - Current state.
 * @param sends - The sends being walked.
 * @returns The latest revision per revised send.
 */
export function revisionList(state: GuidedState, sends: GuidedSend[]): Revision[] {
  return sends.flatMap((s) => {
    const revs = state.revisions[s.id];
    return revs && revs.length > 0 ? [revs[revs.length - 1]!] : [];
  });
}

/**
 * The content edits an approval carries — the same edit-then-approve path
 * the review card uses, so the copy that persists is the copy on screen.
 * @param state - Current state.
 * @param sends - The sends being walked.
 * @returns Edits keyed by content id, empty when nothing was revised.
 */
export function contentEditsFor(state: GuidedState, sends: GuidedSend[]): Array<{ id: string; body: string }> {
  return revisionList(state, sends).map(r => ({ id: r.contentId, body: r.body }));
}

/**
 * Which send a free-text ask is about: the one it names ("make send 2
 * shorter"), else the one under review. An ask before the walk starts, or
 * after it ends, addresses the last send seen.
 * @param text - What the reviewer typed.
 * @param sends - The sends being walked.
 * @param state - Current state.
 * @returns The addressed send, or null when there is none.
 */
export function targetOf(text: string, sends: GuidedSend[], state: GuidedState): GuidedSend | null {
  if (sends.length === 0) {
    return null;
  }
  const named = /\bsend\s*(\d{1,2})\b/i.exec(text);
  if (named) {
    const position = Number(named[1]);
    const found = sends.find(s => s.position === position);
    if (found) {
      return found;
    }
  }
  const index = Math.min(Math.max(state.step, 0), sends.length - 1);
  return sends[index] ?? null;
}

/** Words that read as an instruction to change the copy rather than a question. */
const CHANGE_RE = /\b(?:make|shorten|shorter|longer|change|rewrite|reword|replace|add|remove|drop|swap|soften|firmer|tighten|cut|tone|punchier|warmer|colder|fix)\b/i;

/**
 * Is this ask a revision, or a question?
 *
 * A question is answered and counts nothing — a recap claiming changes that
 * never happened is a lie about what the reviewer approved.
 * @param text - What the reviewer typed.
 * @returns True when the ask should produce a revision.
 */
export function isRevisionAsk(text: string): boolean {
  const t = text.trim();
  if (!t || t.endsWith('?')) {
    return false;
  }
  return CHANGE_RE.test(t);
}
