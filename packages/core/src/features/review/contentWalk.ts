import type { ContentEdit } from './contentKinds';
import type { ActionRevision } from '@/libs/actions/revisions';
import type { ReviewContent } from '@/libs/actions/types';
import { contentHash } from '@/libs/actions/contentHash';
import { copyOf } from '@/libs/actions/revisions';

/**
 * The walk: which sends a reviewer has vouched for, and whether each check
 * still refers to the copy on screen.
 *
 * A check is DERIVED, never stored as a boolean. Approving a send stores a
 * hash of the copy approved; the tab is checked only while that hash still
 * matches what is rendered. One rule then covers three cases with no clearing
 * logic anywhere:
 *
 * - a regeneration replaces the copy, so the hash stops matching
 * - an inline edit after approval changes the copy, so the hash stops matching
 * - the redraft's dedup refresh wipes the stamp and the note, and needs no new
 *   field to remember
 *
 * Kept out of the component so the rule can be tested without mounting one,
 * and so the surface has exactly one place to ask "is this send checked".
 */

/**
 * The copy a check is drawn against: the reviewer's working edit over the item.
 * @param item
 * @param edit
 */
export function currentCopy(item: ReviewContent, edit?: ContentEdit): { subject?: string; body: string } | null {
  const base = copyOf(item);
  if (!base) {
    return null;
  }
  return {
    ...(edit?.subject ?? base.subject) !== undefined ? { subject: edit?.subject ?? base.subject } : {},
    body: edit?.body ?? base.body,
  };
}

/**
 * The hash of what is on screen for this item, or null for a kind with no copy.
 * @param item
 * @param edit
 */
export function currentHash(item: ReviewContent, edit?: ContentEdit): string | null {
  const copy = currentCopy(item, edit);
  return copy ? contentHash(copy.subject, copy.body) : null;
}

/**
 * The items a reviewer can approve one at a time — the ones that carry copy.
 *
 * A document preview or a photo is read, not vouched for line by line, and a
 * check over one would be a claim with nothing behind it. Today that makes
 * this exactly the sends of a sequence, which is the case the walk exists for.
 * @param content - The card's content items.
 */
export function approvableItems(content: readonly ReviewContent[]): ReviewContent[] {
  return content.filter(i => copyOf(i) !== null);
}

/**
 * Whether this card gets the walk at all.
 *
 * Two or more approvable items: the case it exists for. One is approve-then-
 * confirm, two clicks for one thing, so a follow-up email keeps its single
 * click. None has nothing to walk, which leaves discovery proposals and CRM
 * updates exactly as they were.
 * @param content - The card's content items.
 */
export function walkApplies(content: readonly ReviewContent[]): boolean {
  return approvableItems(content).length >= 2;
}

/**
 * Whether this item's check stands: approved, and against the copy still on screen.
 * @param item
 * @param edit
 * @param approvals
 */
export function isChecked(item: ReviewContent, edit: ContentEdit | undefined, approvals: Record<string, string>): boolean {
  const hash = currentHash(item, edit);
  return hash !== null && approvals[item.id] === hash;
}

/**
 * How far through the walk a reviewer is.
 * @param content
 * @param edits
 * @param approvals
 */
export function walkCount(
  content: readonly ReviewContent[],
  edits: Record<string, ContentEdit>,
  approvals: Record<string, string>,
): { approved: number; total: number; complete: boolean } {
  const items = approvableItems(content);
  const approved = items.filter(i => isChecked(i, edits[i.id], approvals)).length;
  return { approved, total: items.length, complete: approved === items.length };
}

/**
 * The checks as the server last recorded them, ready to be carried locally.
 * @param contentReview
 */
export function seedApprovals(contentReview: Record<string, { hash: string }> | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(contentReview ?? {}).map(([id, v]) => [id, v.hash]));
}

/**
 * The working edits to restore on load, so an approved send's copy and its
 * check come back together.
 *
 * Approving a send you just edited records the edited copy as an `approved`
 * revision, so the copy itself survives. The working edit in the decide
 * payload does not — and without this, a reload would render the agent's
 * unedited body, the hash would not match, and the check a reviewer earned
 * would be gone with no explanation.
 *
 * The guard is what stops this resurrecting copy something later replaced. A
 * regeneration and a conversation rewrite both file a dated entry of their
 * own, so an approval with anything newer filed against the same send is
 * stale: the check is meant to be clear, and restoring the old body would
 * hide the new draft behind it.
 * @param content - The card's content items.
 * @param contentReview - The checks as stored.
 * @param revisions - The run's history column.
 */
export function seedEditsFromApprovals(
  content: readonly ReviewContent[],
  contentReview: Record<string, { hash: string; at: string }> | null | undefined,
  revisions: readonly ActionRevision[] | null | undefined,
): Record<string, ContentEdit> {
  const seeded: Record<string, ContentEdit> = {};
  for (const item of approvableItems(content)) {
    const check = contentReview?.[item.id];
    if (!check) {
      continue;
    }
    const mine = (revisions ?? []).filter(r => r.contentId === item.id);
    if (mine.some(r => r.at > check.at)) {
      continue;
    }
    const approved = [...mine].reverse().find(r => r.kind === 'approved');
    if (!approved || contentHash(copyOf(item)?.subject, approved.body) !== check.hash) {
      continue;
    }
    // Already what is rendered — nothing to restore, and seeding it would put
    // an "edited" badge on copy nobody edited.
    if (approved.body !== copyOf(item)!.body) {
      seeded[item.id] = { body: approved.body };
    }
  }
  return seeded;
}
