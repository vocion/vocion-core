/**
 * A person's sign-offs in the SEO app, filed and heard by CODE — never by a
 * prompt telling an agent which `file_ask` call to make.
 *
 * Two asks, both core's `signoff` kind (Approve, Revise in their own words,
 * Discard), grouped under the batch on Needs you:
 *
 *   the keyword plan   `seo-plan:<batchId>:<round>` — filed by `seo_plan_batch`
 *                      with the whole keyword map. Nothing is briefed or
 *                      drafted until it is approved; Revise holds the batch
 *                      with the note recorded.
 *   a drafted page     `seo-page:<pageId>:<draftArtifactId>:<round>` — filed
 *                      by `seo_save_review` on a pass, bound to the artifact
 *                      version and content hash it showed. A redraft or a
 *                      later review withdraws the open one; an edit to the
 *                      words after it was filed or signed puts the page back
 *                      to review with a new ask.
 *
 * When one is answered, `AskService.settleWaitersOn` hands it here: the page
 * or batch moves, the project's gate is read again, and `seo.work_queued`
 * is raised so the strategist's standing mission continues the released pages
 * in the background (the plugin's `seo-continue` automation, `work.ts`) — no
 * person has to tell it to. This is the only writer of a page's `signoff`, which is what the
 * gate counts as approved: an agent cannot approve its own page.
 */

import type { SeoBatchMeta, SeoFeedback, SeoPageMeta, SeoPageRecord, SeoSignoff, SeoSignoffAsk } from './records';
import type { SeoFinding } from './work';
import type { Ask } from '@/services/AskService';
import type { AskHere } from '@/services/decisions/askHere';
import { and, eq, like } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { askSchema } from '@/models/Schema';
import { artifactWords, getSeoBatch, getSeoPage, listSeoPages, mergeMeta, pagesDraftedIn, patchSeoPage, refreshSeoBatch } from './records';
import { findingsMd, queueSeoWork, tellBatch } from './work';

/**
 * What each answer to a keyword plan does — said on the card, since an answer
 * here resumes the work in the background (`seo-continue`) rather than only
 * being recorded.
 */
export const PLAN_OUTCOMES = {
  onApprove: 'The briefs start for the pages the gate releases, in the background.',
  onRevise: 'It re-plans with your note and brings the revised plan back to you.',
  onReject: 'The batch is discarded; nothing is written.',
} as const;

/** What each answer to a page's sign-off does. */
export const PAGE_OUTCOMES = {
  onApprove: 'The page is approved, and the next pages the gate releases are written.',
  onRevise: 'Your note is filed where it belongs and the page is redrafted.',
  onReject: 'The page leaves the batch.',
} as const;

export const SEO_SIGNOFF_REF = 'seo-page';
export const SEO_PLAN_REF = 'seo-plan';

const pageHref = (id: number) => `/dashboard/objects/${id}`;
const batchHref = (id: number) => `/dashboard/p/seo-pages?batch=${id}`;

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
 * The source ref a batch's keyword-plan ask carries.
 * @param batchId - The batch.
 * @param round - Which revision of the plan.
 */
export function seoPlanRef(batchId: number, round: number): string {
  return `${SEO_PLAN_REF}:${batchId}:${round}`;
}

/**
 * The batch and plan round an ask's source ref names, or null.
 * @param ref - `ask.source_ref`.
 */
export function parseSeoPlanRef(ref: string | null | undefined): { batchId: number; round: number } | null {
  const m = /^seo-plan:(\d+):(\d+)$/.exec(ref ?? '');
  return m ? { batchId: Number(m[1]), round: Number(m[2]) } : null;
}

/**
 * How a person answered a sign-off, or null when the answer moves nothing.
 * @param ask - The answered ask.
 */
function decisionOf(ask: Pick<Ask, 'status' | 'decision' | 'decisionNote'>): SeoSignoff['decision'] | null {
  if (ask.status === 'open' || ask.status === 'superseded' || ask.status === 'skipped') {
    return null;
  }
  const note = ask.decisionNote?.trim() || null;
  return ask.decision === 'approve'
    ? 'approve'
    : ask.decision === 'reject'
      ? 'discard'
      : ask.decision === 'other' || note
        ? 'revise'
        : null;
}

/**
 * What an answered sign-off does to a page. Pure: the decision, the note and
 * the page in; the patch out, or null when the answer changes nothing (it was
 * skipped or superseded, or it is about a draft the page has since replaced).
 * The sign-off records the artifact version and hash the ask showed.
 * @param ask - The answered ask.
 * @param page - The page as it stands.
 * @param now - The clock.
 */
export function signoffPatch(ask: Pick<Ask, 'id' | 'status' | 'decision' | 'decisionNote' | 'decidedBy' | 'sourceRef'>, page: Pick<SeoPageMeta, 'draftArtifactId' | 'draftRound' | 'feedback' | 'status' | 'signoffAsk'>, now: Date = new Date()): Partial<SeoPageMeta> | null {
  const ref = parseSeoSignoffRef(ask.sourceRef);
  const decision = ref ? decisionOf(ask) : null;
  if (!ref || !decision) {
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
  const shown = page.signoffAsk && page.signoffAsk.askId === ask.id ? page.signoffAsk : null;
  const signoff: SeoSignoff = {
    decision,
    by,
    at,
    askId: ask.id,
    draftArtifactId: ref.draftArtifactId,
    round: ref.round,
    ...(shown ? { version: shown.version, hash: shown.hash, contentHash: shown.hash } : {}),
  };
  const feedback: SeoFeedback[] = note
    ? [...(page.feedback ?? []), { at, by, note, filedTo: null, askId: ask.id, draftArtifactId: ref.draftArtifactId }]
    : page.feedback ?? [];
  const status: SeoPageMeta['status'] = decision === 'approve' ? 'approved' : decision === 'discard' ? 'rejected' : 'changes_requested';
  // A person decided: the editor's rounds start again for the next draft.
  return { signoff, status, feedback, editorRounds: 0 };
}

/**
 * What an answered plan ask does to a batch. Pure.
 * @param ask - The answered ask.
 * @param batch - The batch as it stands.
 * @param now - The clock.
 */
export function planPatch(ask: Pick<Ask, 'id' | 'status' | 'decision' | 'decisionNote' | 'decidedBy' | 'sourceRef'>, batch: Pick<SeoBatchMeta, 'plan'>, now: Date = new Date()): Partial<SeoBatchMeta> | null {
  const ref = parseSeoPlanRef(ask.sourceRef);
  const decision = ref ? decisionOf(ask) : null;
  if (!ref || !decision || !batch.plan || batch.plan.round !== ref.round) {
    return null;
  }
  const note = ask.decisionNote?.trim() || undefined;
  const state = decision === 'approve' ? 'approved' : decision === 'discard' ? 'discarded' : 'revise';
  return { plan: { state, round: ref.round, askId: ask.id, ...(note ? { note } : {}), by: ask.decidedBy ?? null, at: now.toISOString() } };
}

/**
 * Withdraw the open sign-off asks of a page — every round but `keep`.
 * @param orgId - The workspace.
 * @param pageId - The page.
 * @param why - The note the withdrawal carries.
 * @param keep - A source ref to leave open.
 */
export async function withdrawPageAsks(orgId: string, pageId: number, why: string, keep?: string): Promise<number[]> {
  const open = await db
    .select({ id: askSchema.id, sourceRef: askSchema.sourceRef })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${SEO_SIGNOFF_REF}:${pageId}:%`)));
  const { supersedeAsk } = await import('@/services/AskService');
  const withdrawn: number[] = [];
  for (const a of open) {
    if (a.sourceRef !== keep && parseSeoSignoffRef(a.sourceRef)?.pageId === pageId) {
      await supersedeAsk(orgId, a.id, why);
      withdrawn.push(a.id);
    }
  }
  return withdrawn;
}

/**
 * File the sign-off ask for a page's current draft, in code: the right
 * source ref, the draft and the page as its records, grouped under the batch.
 * Any open ask about an earlier round is withdrawn first. The version and
 * hash it shows are written on the page, so the answer binds to those words.
 * @param opts - What to file.
 * @param opts.orgId - The workspace.
 * @param opts.page - The page, with its draft attached.
 * @param opts.agentSlug - The seat asking.
 * @param opts.notes - What the editor checked, in a few lines.
 * @param opts.openFindings - The editor's findings still open when its rounds ran out: the person decides with them in view.
 * @param opts.here - The person's conversation, when their own turn filed it: the card docks there (`decisions/askHere.ts`).
 */
export async function fileSeoSignoffAsk(opts: { orgId: string; page: SeoPageRecord; agentSlug?: string | null; notes?: string; openFindings?: readonly SeoFinding[]; here?: AskHere | null }): Promise<{ askId: number; sourceRef: string } | null> {
  const { orgId, page } = opts;
  const draft = page.meta.draftArtifactId;
  if (typeof draft !== 'number') {
    return null;
  }
  const round = page.meta.draftRound ?? 1;
  const sourceRef = seoSignoffRef(page.id, draft, round);
  await withdrawPageAsks(orgId, page.id, 'A newer draft of this page is waiting on its own sign-off.', sourceRef);
  const words = (await artifactWords(orgId, [draft])).get(draft);
  if (!words) {
    return null;
  }
  const m = page.meta;
  const { upsertAsk } = await import('@/services/AskService');
  const meta = [m.metaTitle ? `**Meta title:** ${m.metaTitle}` : null, m.metaDescription ? `**Meta description:** ${m.metaDescription}` : null, m.slug ? `**Slug:** /${m.slug}` : null].filter(Boolean).join('\n');
  const { ask } = await upsertAsk({
    orgId,
    createdBy: opts.agentSlug ? `agent:${opts.agentSlug}` : null,
    ask: {
      kind: 'signoff',
      title: `Sign off page #${page.id}: ${page.title}`,
      body: `Draft for "${m.keyword}"${round > 1 ? ` (round ${round})` : ''}, version ${words.version}.${opts.openFindings?.length ? ` The editor still has ${opts.openFindings.length} open ${opts.openFindings.length === 1 ? 'finding' : 'findings'} after ${m.editorRounds ?? 0} rounds; they are below.` : ''} Approve it, revise with a note, or discard it.`,
      sourceRef,
      agentSlug: opts.agentSlug ?? null,
      teamSlug: 'seo',
      objectRefs: [{ type: 'artifact', id: String(draft) }, { type: 'object', id: String(page.id) }],
      groupKey: `seo-batch:${m.batchId}`,
      groupTitle: m.batchTitle ?? `SEO batch #${m.batchId}`,
      contextUrl: pageHref(page.id),
      contextMd: [
        meta,
        opts.openFindings?.length ? `**Open findings (the editor's rounds ran out):**\n${findingsMd(opts.openFindings)}` : null,
        opts.notes?.trim() ? `**What the editor checked:** ${opts.notes.trim().slice(0, 1200)}` : null,
        m.review?.notesArtifactId ? `[The editor's whole review](/dashboard/artifacts/${m.review.notesArtifactId})` : null,
      ].filter(Boolean).join('\n\n') || null,
      allowOther: true,
      outcomes: PAGE_OUTCOMES,
      ...(opts.here ? { conversationId: opts.here.conversationId, ownerUserId: opts.here.ownerUserId } : {}),
    },
  });
  const shown: SeoSignoffAsk = { askId: ask.id, round, draftArtifactId: draft, version: words.version, hash: words.hash, at: new Date().toISOString() };
  await patchSeoPage(orgId, page, { signoffAsk: shown });
  await tellBatch(orgId, m.batchId, `Page "${page.title}" is ready for your sign-off${opts.openFindings?.length ? `, with ${opts.openFindings.length} open ${opts.openFindings.length === 1 ? 'finding' : 'findings'} from the editor` : ''}. [Open it](/dashboard/objects/${page.id})`, `signoff-filed:${ask.id}`);
  return { askId: ask.id, sourceRef };
}

/** One row of the keyword map a person signs off. */
export type PlanRow = { keyword: string; pageType?: string; location?: string; intent?: string; cluster?: string; target: string };

/**
 * The keyword map as a person reads it: keyword, page type, location, intent,
 * cluster, and the target — the live URL a refresh rewrites, or a new page.
 * @param rows - The plan.
 */
export function planTable(rows: readonly PlanRow[]): string {
  const cell = (s: string | undefined) => (s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim() || '—';
  return [
    '| # | Keyword | Page type | Location | Intent | Cluster | Target |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r, i) => `| ${i + 1} | ${cell(r.keyword)} | ${cell(r.pageType)} | ${cell(r.location)} | ${cell(r.intent)} | ${cell(r.cluster)} | ${cell(r.target)} |`),
  ].join('\n');
}

/**
 * File the ONE sign-off ask for a batch's keyword plan, in code, showing the
 * whole keyword map. An earlier round's open ask is withdrawn.
 * @param opts - What to file.
 * @param opts.orgId - The workspace.
 * @param opts.batchId - The batch.
 * @param opts.agentSlug - The seat asking.
 * @param opts.why - The strategist's reasoning, in a few lines.
 * @param opts.here - The person's conversation, when their own turn planned it: the card docks there (`decisions/askHere.ts`).
 */
export async function fileSeoPlanAsk(opts: { orgId: string; batchId: number; agentSlug?: string | null; why?: string; here?: AskHere | null }): Promise<{ askId: number; sourceRef: string } | null> {
  const batch = await getSeoBatch(opts.orgId, opts.batchId);
  if (!batch?.meta.plan) {
    return null;
  }
  const round = batch.meta.plan.round;
  const sourceRef = seoPlanRef(batch.id, round);
  const { supersedeAsk, upsertAsk } = await import('@/services/AskService');
  const earlier = await db
    .select({ id: askSchema.id, sourceRef: askSchema.sourceRef })
    .from(askSchema)
    .where(and(eq(askSchema.orgId, opts.orgId), eq(askSchema.status, 'open'), like(askSchema.sourceRef, `${SEO_PLAN_REF}:${batch.id}:%`)));
  for (const a of earlier) {
    if (a.sourceRef !== sourceRef && parseSeoPlanRef(a.sourceRef)?.batchId === batch.id) {
      await supersedeAsk(opts.orgId, a.id, 'A revised keyword plan is waiting on its own sign-off.');
    }
  }
  const pages = (await listSeoPages(opts.orgId, batch.id)).filter(p => p.meta.status !== 'rejected');
  const rows: PlanRow[] = pages.map(p => ({
    keyword: p.meta.keyword,
    pageType: p.meta.pageType,
    location: p.meta.location,
    intent: p.meta.intent,
    cluster: p.meta.cluster,
    target: p.meta.existingUrl ? `refresh ${p.meta.existingUrl}` : 'new page',
  }));
  const { ask } = await upsertAsk({
    orgId: opts.orgId,
    createdBy: opts.agentSlug ? `agent:${opts.agentSlug}` : null,
    ask: {
      kind: 'signoff',
      title: `Sign off the keyword plan: ${batch.title}${round > 1 ? ` (revision ${round})` : ''}`,
      body: `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} for ${batch.meta.projectName ?? `project #${batch.meta.projectId}`}. Nothing is briefed or written until you approve the plan. Revise with a note to change it.`,
      sourceRef,
      agentSlug: opts.agentSlug ?? null,
      teamSlug: 'seo',
      objectRefs: [{ type: 'object', id: String(batch.id) }],
      groupKey: `seo-batch:${batch.id}`,
      groupTitle: batch.title,
      contextUrl: batchHref(batch.id),
      // The map first: the sheet shows a leading table on the card, the reasoning in Details.
      contextMd: [planTable(rows), opts.why?.trim() ? `**Why these pages:** ${opts.why.trim().slice(0, 1500)}` : null].filter(Boolean).join('\n\n'),
      allowOther: true,
      outcomes: PLAN_OUTCOMES,
      ...(opts.here ? { conversationId: opts.here.conversationId, ownerUserId: opts.here.ownerUserId } : {}),
    },
  });
  await mergeMeta<SeoBatchMeta>(opts.orgId, batch.id, cur => ({ plan: { ...(cur.plan ?? { state: 'plan_review', round }), askId: ask.id } }));
  return { askId: ask.id, sourceRef };
}

/**
 * The draft's words changed (a person or an agent edited the artifact). A
 * page whose sign-off — asked or given — was about other words goes back to
 * review with a new ask; the gate already counts it as not approved. Never
 * throws: it hangs off a save that has landed.
 * @param orgId - The workspace.
 * @param artifactId - The artifact that was saved.
 */
export async function onSeoDraftRevised(orgId: string, artifactId: number): Promise<number[]> {
  const moved: number[] = [];
  try {
    const pages = await pagesDraftedIn(orgId, artifactId);
    if (pages.length === 0) {
      return moved;
    }
    const words = (await artifactWords(orgId, [artifactId])).get(artifactId);
    if (!words) {
      return moved;
    }
    for (const page of pages) {
      const m = page.meta;
      const signed = m.status === 'approved' && m.signoff?.decision === 'approve' && m.signoff.hash && m.signoff.hash !== words.hash;
      const asked = m.status === 'in_review' && m.signoffAsk && m.signoffAsk.round === (m.draftRound ?? 1) && m.signoffAsk.hash !== words.hash;
      if (!signed && !asked) {
        continue;
      }
      const round = (m.draftRound ?? 1) + 1;
      const updated = await patchSeoPage(orgId, page, { status: 'in_review', draftRound: round, signoff: undefined });
      await fileSeoSignoffAsk({ orgId, page: updated, notes: `The draft changed after it was ${signed ? 'signed off' : 'sent for sign-off'} (now version ${words.version}); this is the new wording.` });
      await refreshSeoBatch(orgId, m.batchId);
      moved.push(page.id);
    }
  } catch (err) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('an SEO page could not hear its draft change', { artifactId, error: err instanceof Error ? err.message : String(err) });
  }
  return moved;
}

/**
 * Queue the strategist's background run after a sign-off moved the work, so
 * it continues the released pages on its own.
 * @param row - The settled ask.
 * @param payload - What moved.
 */
async function announceSettled(row: Ask, payload: Record<string, unknown>): Promise<void> {
  await queueSeoWork(row.orgId, 'signoff', { askId: row.id, decision: row.decision ?? null, ...payload }, `signoff:${row.id}`);
}

/**
 * Carry an answered sign-off onto its page or batch, re-read the project's
 * gate, and queue the strategist to continue. Never throws: the person's
 * answer is already written.
 * @param row - The settled ask.
 */
export async function onSeoAskSettled(row: Ask): Promise<void> {
  try {
    const plan = parseSeoPlanRef(row.sourceRef);
    if (plan) {
      const batch = await getSeoBatch(row.orgId, plan.batchId);
      const patch = batch ? planPatch(row, batch.meta) : null;
      if (!batch || !patch) {
        return;
      }
      await mergeMeta<SeoBatchMeta>(row.orgId, batch.id, () => patch);
      if (patch.plan?.state === 'discarded') {
        for (const p of await listSeoPages(row.orgId, batch.id)) {
          await patchSeoPage(row.orgId, p, { status: 'rejected' });
        }
      }
      const gate = await refreshSeoBatch(row.orgId, batch.id);
      await announceSettled(row, { kind: 'plan', batchId: batch.id, projectId: batch.meta.projectId, plan: patch.plan?.state, note: patch.plan?.note ?? null, writable: gate?.writable.length ?? 0, line: gate?.line ?? null });
      return;
    }
    const ref = parseSeoSignoffRef(row.sourceRef);
    if (!ref) {
      return;
    }
    const page = await getSeoPage(row.orgId, ref.pageId);
    if (!page) {
      return;
    }
    const heard: { decision: SeoSignoff['decision'] | null } = { decision: null };
    await patchSeoPage(row.orgId, page, (current) => {
      const patch = signoffPatch(row, current);
      heard.decision = patch?.signoff?.decision ?? null;
      return patch;
    });
    const moved = heard.decision;
    if (!moved) {
      return;
    }
    const gate = await refreshSeoBatch(row.orgId, page.meta.batchId);
    await announceSettled(row, { kind: 'page', pageId: page.id, batchId: page.meta.batchId, projectId: page.meta.projectId, signoff: moved, writable: gate?.writable.length ?? 0, line: gate?.line ?? null });
  } catch (err) {
    const { logger } = await import('@/libs/Logger');
    logger.warn('an SEO page could not hear its sign-off', { askId: row.id, error: err instanceof Error ? err.message : String(err) });
  }
}
