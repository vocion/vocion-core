/**
 * A person's sign-off on a drafted SEO page, carried onto the page.
 *
 * The sign-off is core's `signoff` ask (`file_ask`, kind `signoff`): Approve,
 * Revise (the answer in their own words) or Discard. The SEO tools tell the
 * agent to file it with `source_ref: seo-page:<pageId>:<draftArtifactId>:<round>`
 * (the round counts the page's drafts, so a redraft saved as a new version of
 * the same artifact still gets its own ask);
 * when it is answered, `AskService.settleWaitersOn` hands it here and the page
 * moves — approved, changes requested with the note recorded, or discarded —
 * and the batch's gate is read again. This is the only writer of a page's
 * `signoff`, which is what the gate counts as approved: an agent cannot
 * approve its own page by writing a status.
 */

import type { SeoFeedback, SeoPageMeta, SeoSignoff } from './records';
import type { Ask } from '@/services/AskService';
import { getSeoPage, patchSeoPage, refreshSeoBatch } from './records';

export const SEO_SIGNOFF_REF = 'seo-page';

/**
 * The source ref a page's sign-off ask carries.
 * @param pageId - The page.
 * @param draftArtifactId - The draft being signed off.
 * @param round - Which draft of the page this is (1 for the first).
 */
export function seoSignoffRef(pageId: number, draftArtifactId: number, round: number): string {
  return `${SEO_SIGNOFF_REF}:${pageId}:${draftArtifactId}:${round}`;
}

/**
 * The page and draft an ask's source ref names, or null when it names none.
 * @param ref - `ask.source_ref`.
 */
export function parseSeoSignoffRef(ref: string | null | undefined): { pageId: number; draftArtifactId: number; round: number } | null {
  const m = /^seo-page:(\d+):(\d+):(\d+)$/.exec(ref ?? '');
  return m ? { pageId: Number(m[1]), draftArtifactId: Number(m[2]), round: Number(m[3]) } : null;
}

/**
 * What an answered sign-off does to a page. Pure: the decision, the note and
 * the page in; the patch out, or null when the answer changes nothing (it was
 * skipped or superseded, or it is about a draft the page has since replaced).
 * @param ask - The answered ask.
 * @param page - The page as it stands.
 * @param now - The clock.
 */
export function signoffPatch(ask: Pick<Ask, 'id' | 'status' | 'decision' | 'decisionNote' | 'decidedBy' | 'sourceRef'>, page: Pick<SeoPageMeta, 'draftArtifactId' | 'draftRound' | 'feedback' | 'status'>, now: Date = new Date()): Partial<SeoPageMeta> | null {
  const ref = parseSeoSignoffRef(ask.sourceRef);
  if (!ref || ask.status === 'open' || ask.status === 'superseded' || ask.status === 'skipped') {
    return null;
  }
  if ((page.draftArtifactId ?? null) !== ref.draftArtifactId || (page.draftRound ?? 1) !== ref.round) {
    // An answer about an older draft: the page has moved on, and a sign-off
    // on words nobody is publishing would approve the wrong thing.
    return null;
  }
  const at = now.toISOString();
  const note = ask.decisionNote?.trim() || null;
  const by = ask.decidedBy ?? null;
  const decision: SeoSignoff['decision'] | null = ask.decision === 'approve'
    ? 'approve'
    : ask.decision === 'reject'
      ? 'discard'
      : ask.decision === 'other' || note
        ? 'revise'
        : null;
  if (!decision) {
    return null;
  }
  const signoff: SeoSignoff = { decision, by, at, askId: ask.id, draftArtifactId: ref.draftArtifactId, round: ref.round };
  const feedback: SeoFeedback[] = note
    ? [...(page.feedback ?? []), { at, by, note, filedTo: null, askId: ask.id, draftArtifactId: ref.draftArtifactId }]
    : page.feedback ?? [];
  const status: SeoPageMeta['status'] = decision === 'approve' ? 'approved' : decision === 'discard' ? 'rejected' : 'changes_requested';
  return { signoff, status, feedback };
}

/**
 * Carry an answered sign-off onto its page and re-read the batch's gate.
 * Never throws: the person's answer is already written.
 * @param row - The settled ask.
 */
export async function onSeoAskSettled(row: Ask): Promise<void> {
  const ref = parseSeoSignoffRef(row.sourceRef);
  if (!ref) {
    return;
  }
  try {
    const page = await getSeoPage(row.orgId, ref.pageId);
    if (!page) {
      return;
    }
    const patch = signoffPatch(row, page.meta);
    if (!patch) {
      return;
    }
    await patchSeoPage(row.orgId, page, patch);
    await refreshSeoBatch(row.orgId, page.meta.batchId);
  } catch (err) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('an SEO page could not hear its sign-off', { askId: row.id, error: err instanceof Error ? err.message : String(err) });
  }
}
