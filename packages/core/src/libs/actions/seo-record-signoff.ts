import type { Action } from './types';
import { z } from 'zod';

/**
 * seo.record_signoff — a person's sign-off on an SEO page, written onto the
 * page in code, bound to the words they were shown.
 *
 * The page's workflow run (`seo-page`) asks the person once, at its approve
 * step. The step after it is this action: it records who signed off, their
 * note and the draft's version and hash, moves the page to approved and
 * re-reads the project's gate, which may release the next pages (they get
 * their own runs). It refuses a page whose draft changed after it went to
 * sign-off: the person approved other words. Publishing reads this record
 * (`signedOff`). Internal and undoable, so the SEO plugin's trust rule runs
 * it as part of the run; Undo puts the page back to waiting on its sign-off.
 */

export const SEO_RECORD_SIGNOFF_ACTION_ID = 'seo.record_signoff';

const input = z.object({
  pageRecordId: z.coerce.number().int().positive(),
  /** The person who approved it on the run's Decision. */
  approvedBy: z.string().min(1).max(200),
  note: z.string().max(4000).nullable().optional(),
  /** The workflow run whose approve step it was. */
  runId: z.coerce.number().int().positive().optional(),
});

type Input = z.infer<typeof input>;

/**
 * Why this sign-off may not be recorded, or nothing.
 * @param orgId - The workspace.
 * @param i - The input.
 */
async function problem(orgId: string, i: Input): Promise<string | undefined> {
  const [{ getSeoPage, artifactWords }] = await Promise.all([import('@/services/seo/records')]);
  const page = await getSeoPage(orgId, i.pageRecordId);
  if (!page) {
    return `#${i.pageRecordId} is not an SEO page in this workspace.`;
  }
  if (!i.approvedBy.startsWith('usr-')) {
    return 'A page is signed off by a person, and this approval names none.';
  }
  const draft = page.meta.draftArtifactId;
  if (typeof draft !== 'number') {
    return `"${page.title}" has no draft to sign off.`;
  }
  const shown = page.meta.signoffAsk;
  const words = (await artifactWords(orgId, [draft])).get(draft);
  if (shown?.hash && words && shown.hash !== words.hash) {
    return `The draft of "${page.title}" changed after it went to sign-off (now version ${words.version}); the approval was for other words. It goes back to review.`;
  }
  return undefined;
}

export const seoRecordSignoffAction: Action<typeof input> = {
  id: SEO_RECORD_SIGNOFF_ACTION_ID,
  name: 'Record an SEO page\'s sign-off',
  description: 'Record a person\'s sign-off on an SEO page from its workflow run\'s approve step, bound to the draft they were shown, and release the next pages the gate allows. Run by the page\'s workflow, never proposed on its own.',
  inputSchema: input,
  grant: 'update_object',
  external: false,
  dedupKeyFor: i => `seo.record_signoff:${i.pageRecordId}:${i.runId ?? ''}`,
  async precheck(ctx, i) {
    return problem(ctx.orgId, i);
  },
  async reviewCard(_ctx, i) {
    return {
      title: `Record the sign-off on page #${i.pageRecordId}`,
      system: 'SEO',
      headline: 'Writes the person\'s approval onto the page, bound to the draft they were shown.',
      fields: [{ label: 'Approved by', value: i.approvedBy }, ...(i.note ? [{ label: 'Note', value: i.note }] : [])],
    };
  },
  async execute(ctx, i) {
    const why = await problem(ctx.orgId, i);
    if (why) {
      throw new Error(why);
    }
    const { getSeoPage, artifactWords, patchSeoPage, refreshSeoBatch } = await import('@/services/seo/records');
    const page = (await getSeoPage(ctx.orgId, i.pageRecordId))!;
    const draft = page.meta.draftArtifactId!;
    const words = (await artifactWords(ctx.orgId, [draft])).get(draft);
    const at = new Date().toISOString();
    const before = { status: page.meta.status, signoff: page.meta.signoff ?? null, feedback: page.meta.feedback ?? [] };
    const note = i.note?.trim() || null;
    await patchSeoPage(ctx.orgId, page, {
      status: 'approved',
      editorRounds: 0,
      signoff: { decision: 'approve', by: i.approvedBy, at, askId: page.meta.signoffAsk?.askId ?? 0, draftArtifactId: draft, round: page.meta.draftRound ?? 1, ...(words ? { version: words.version, hash: words.hash, contentHash: words.hash } : {}) },
      ...(note ? { feedback: [...(page.meta.feedback ?? []), { at, by: i.approvedBy, note, filedTo: null, askId: 0, draftArtifactId: draft }] } : {}),
    });
    await refreshSeoBatch(ctx.orgId, page.meta.batchId);
    // The gate may release the next pages: each gets its own run.
    const { queueSeoWork } = await import('@/services/seo/work');
    await queueSeoWork(ctx.orgId, 'write', { batchId: page.meta.batchId, projectId: page.meta.projectId }, `write:${page.meta.batchId}:after:${page.id}`);
    return { pageRecordId: page.id, before, line: `Signed off "${page.title}" for ${i.approvedBy}, version ${words?.version ?? '?'}.` };
  },
  async undo(ctx, i, result) {
    const { getSeoPage, patchSeoPage, refreshSeoBatch } = await import('@/services/seo/records');
    const page = await getSeoPage(ctx.orgId, i.pageRecordId);
    const before = (result?.before ?? null) as { status?: string; signoff?: unknown; feedback?: unknown } | null;
    if (!page || !before) {
      throw new Error('This run recorded nothing to put back.');
    }
    await patchSeoPage(ctx.orgId, page, { status: (before.status ?? 'in_review') as never, signoff: (before.signoff ?? undefined) as never, feedback: (before.feedback ?? []) as never });
    await refreshSeoBatch(ctx.orgId, page.meta.batchId);
    return { line: `Page #${page.id} is waiting on its sign-off again.` };
  },
};
