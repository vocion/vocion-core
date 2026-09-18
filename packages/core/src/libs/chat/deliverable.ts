/**
 * The turn's DELIVERABLE contract — "does this turn end in an artifact?"
 * answered by a type on the request, never by the model.
 *
 * Whether a turn produced something the person keeps (a report, a brief, a
 * table) used to be a judgement call the main model made while it was also
 * doing the work, steered by prompt text. It failed the way prompt-steered
 * requirements always fail here: "draft a pipeline report" came back as a
 * sentence of narration and nothing in the pane, with no way to tell whether
 * the model had decided against an artifact or had simply forgotten.
 *
 * So the question is decided BEFORE the turn runs, on the wire:
 *
 *   `deliverable: 'artifact'`  this turn must end with an artifact. If it
 *                              does not, the harness makes one (see
 *                              `services/agents/deliverableBackstop.ts`).
 *   `deliverable: 'answer'`    a reply is the whole deliverable. Nothing is
 *                              wrapped, nothing is stubbed.
 *   absent                     same as `answer` — no backstop.
 *
 * **How it is armed: the person types `@artifact`.** The first cut inferred it
 * from the draft and pre-armed a chip beside the send button; Chris killed
 * that — an inferred opt-in is a thing you have to notice and undo. The tag is
 * the composer's existing `@`-mention, so arming the contract is the same
 * gesture as tagging a team or the page, and the `(+)` menu beside the box is
 * the pointer path to the same list (`features/dashboard/chat/composerTags.ts`).
 *
 * Kept free of React, the database and any server import so the composer, the
 * stream route and the harness can all read the same definition.
 */

/** What a turn is expected to produce. */
export type Deliverable = 'artifact' | 'answer';

/**
 * The `@`-mention that arms the contract. One string, shared by the tag the
 * composer offers and the check below, so the token in the popover and the
 * token that arms the backstop can never drift.
 */
export const ARTIFACT_TAG = 'artifact';

/**
 * The mention's `type`. It is deliberately NOT one of `pageContext.ts`'s
 * `RECORD_TYPES`: this tag points at no record, it states what the turn owes.
 * It is read off the composer's tags and stripped before `context_refs` goes
 * on the wire, so the model is never handed "a record called Artifact".
 */
export const DELIVERABLE_REF_TYPE = 'deliverable';

/**
 * Whether one composer tag is the artifact tag.
 * @param ref - A composer tag (`{ type, id }` is all that is read).
 * @param ref.type
 * @param ref.id
 */
export function isArtifactTag(ref: { type: string; id: string }): boolean {
  return ref.type === DELIVERABLE_REF_TYPE && ref.id === ARTIFACT_TAG;
}

/**
 * What the turn owes, read off the composer's tags — `artifact` when the
 * person tagged `@artifact`, `answer` otherwise. Pure and total: an unknown
 * tag can never arm the backstop.
 * @param refs - The composer's tags for this message.
 */
export function deliverableFromRefs(refs: ReadonlyArray<{ type: string; id: string }>): Deliverable {
  return refs.some(isArtifactTag) ? 'artifact' : 'answer';
}

/**
 * Read the `deliverable` field off an untrusted request body. Anything that
 * is not one of the two values is `undefined` — absent and malformed mean the
 * same thing (no backstop), so a typo can never silently arm one.
 * @param raw - `body.deliverable` as it arrived.
 */
export function readDeliverable(raw: unknown): Deliverable | undefined {
  return raw === 'artifact' || raw === 'answer' ? raw : undefined;
}
