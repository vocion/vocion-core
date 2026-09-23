import type { ActionRevision } from '@/libs/actions/revisions';
import type { ReviewContent } from '@/libs/actions/types';
import { and, eq } from 'drizzle-orm';
import { contentHash } from '@/libs/actions/contentHash';
import { getAction } from '@/libs/actions/registry';
import { copyOf, nextRevisionVersion, revisionsFor, stepOf } from '@/libs/actions/revisions';
import { db } from '@/libs/DB';
import { actionRunSchema } from '@/models/Schema';

/**
 * What a review run keeps about each piece of content it carries: the copy the
 * agent proposed, every ask made of it, and the copy that was approved.
 *
 * Three writes, and they exist because none of it used to survive. Clicking
 * Regenerate stamps the note on the run and redrafts; when the redraft lands,
 * `proposeAction`'s dedup refresh replaces `input` and clears both the stamp
 * and the note. Approving then calls `updateActionInput` and replaces `input`
 * again. The proposal, the instruction and the before-copy were all gone by
 * the time anyone could read them.
 *
 * `revisions` is already the right column — typed per content item, already
 * carrying the ask, the returned body and a version — so this fills it rather
 * than adding a second history beside it (principle 7).
 *
 * Every write here is BEST EFFORT at the call site: a decision or a
 * regeneration must never fail on its audit trail.
 */

/**
 * The content items a run's card carries, resolved through the action's own presenter.
 * @param orgId
 * @param actionId
 * @param input
 */
async function contentOf(orgId: string, actionId: string, input: unknown): Promise<ReviewContent[]> {
  const presenter = getAction(actionId)?.reviewCard;
  if (!presenter) {
    return [];
  }
  const card = await presenter({ orgId }, input as never);
  return card?.content ?? [];
}

/**
 * The item an id addresses. An untargeted call on a card with exactly one item
 * means that item; on a card with several it means nothing nameable, and
 * recording against a guess would file one send's copy under another's id.
 * @param items - The card's content.
 * @param contentId - The id the caller named, when it named one.
 */
function itemFor(items: readonly ReviewContent[], contentId: string | undefined): ReviewContent | null {
  if (contentId !== undefined) {
    return items.find(i => i.id === contentId) ?? null;
  }
  return items.length === 1 ? items[0]! : null;
}

/**
 * File the copy a regeneration is about to replace, with the ask it answers.
 *
 * Called BEFORE the dispatch, which is the last moment `input` still holds the
 * body the reviewer read. The first such entry for an item is its `proposed`
 * copy; later ones are versions a redraft landed and nothing recorded, so they
 * file as `regenerated` — the kind states what the body IS, never when we
 * happened to catch it.
 * @param opts - The run, the item, and the instruction.
 * @param opts.orgId - The project that owns the run.
 * @param opts.runId - The action run.
 * @param opts.actionId - Its action, for the presenter that resolves content.
 * @param opts.runInput - The run's input, as stored right now.
 * @param opts.contentId - Which item the instruction is about.
 * @param opts.ask - The reviewer's instruction.
 * @param opts.by - Who asked.
 */
export async function recordPreRegenerationCopy(opts: {
  orgId: string;
  runId: number;
  actionId: string;
  runInput: unknown;
  contentId?: string;
  ask: string;
  by?: string;
}): Promise<void> {
  const item = itemFor(await contentOf(opts.orgId, opts.actionId, opts.runInput), opts.contentId);
  const copy = item ? copyOf(item) : null;
  if (!item || !copy) {
    return;
  }
  const contentId = opts.contentId ?? item.id;
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ revisions: actionRunSchema.revisions })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1)
      .for('update');
    if (!row) {
      return;
    }
    const existing = (row.revisions ?? []) as ActionRevision[];
    const prior = revisionsFor(existing, contentId);
    // The same body already filed with the same ask is the same click twice,
    // not a second version.
    const last = prior[prior.length - 1];
    if (last && last.body === copy.body && last.ask === opts.ask) {
      return;
    }
    const step = stepOf(contentId);
    const kind = prior.some(r => r.kind === 'proposed') ? 'regenerated' as const : 'proposed' as const;
    await tx
      .update(actionRunSchema)
      .set({
        revisions: [...existing, {
          contentId,
          ...(step !== undefined ? { step } : {}),
          version: nextRevisionVersion(existing, contentId, kind),
          body: copy.body,
          ask: opts.ask,
          at: new Date().toISOString(),
          ...(opts.by ? { by: opts.by } : {}),
          kind,
        }],
      })
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)));
  });
}

/**
 * Record one send as approved: an `approved` revision holding the copy that
 * was vouched for, and the hash the check is derived from.
 *
 * `input` is deliberately untouched. Approving a send is a checkpoint, not an
 * execution — Enroll stays the one act that reaches the outside world, so the
 * autonomy gate keeps one door — and nothing about the payload the action runs
 * on may change behind the reviewer's back.
 * @param opts - The run, the item and the copy.
 * @param opts.orgId - The project that owns the run.
 * @param opts.runId - The action run.
 * @param opts.contentId - Which item was approved.
 * @param opts.subject - The subject as approved, for kinds that have one.
 * @param opts.body - The body as approved.
 * @param opts.by - Who approved it.
 * @returns The hash the check is drawn against.
 */
/**
 * The outcome of a regeneration that did not land, filed under the ask it was
 * answering so the history reads "asked X, then: it failed because Y" instead
 * of an ask with nothing after it. The body is the copy that stayed on the
 * card. Best effort, like the pre-regeneration record: a failure must never
 * fail on its audit trail.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.contentId - The send the instruction was about, if one was named.
 * @param opts.ask - The reviewer's instruction.
 * @param opts.failure - What went wrong, in the words the reviewer will read.
 * @param opts.by
 */
export async function recordRegenerationFailure(opts: {
  orgId: string;
  runId: number;
  contentId?: string;
  ask: string;
  failure: string;
  by?: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ revisions: actionRunSchema.revisions })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1)
      .for('update');
    if (!row) {
      return;
    }
    const existing = (row.revisions ?? []) as ActionRevision[];
    const prior = revisionsFor(existing, opts.contentId);
    const last = prior[prior.length - 1];
    const step = stepOf(opts.contentId);
    await tx
      .update(actionRunSchema)
      .set({
        revisions: [...existing, {
          ...(opts.contentId ? { contentId: opts.contentId } : {}),
          ...(step !== undefined ? { step } : {}),
          version: last?.version ?? 1,
          body: last?.body ?? '',
          ask: opts.ask,
          failure: opts.failure,
          at: new Date().toISOString(),
          ...(opts.by ? { by: opts.by } : {}),
          kind: 'failed' as const,
        }],
      })
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)));
  });
}

export async function recordApprovedContent(opts: {
  orgId: string;
  runId: number;
  contentId: string;
  subject?: string;
  body: string;
  by?: string;
}): Promise<string> {
  const hash = contentHash(opts.subject, opts.body);
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ revisions: actionRunSchema.revisions, contentReview: actionRunSchema.contentReview })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1)
      .for('update');
    if (!row) {
      return;
    }
    const existing = (row.revisions ?? []) as ActionRevision[];
    const prior = revisionsFor(existing, opts.contentId);
    // Approving the same copy twice — an unapprove and a re-approve, a second
    // window — is one approval. The hash moves either way; the history does
    // not grow a duplicate.
    const alreadyFiled = prior.some(r => r.kind === 'approved' && r.body === opts.body);
    const step = stepOf(opts.contentId);
    await tx
      .update(actionRunSchema)
      .set({
        contentReview: { ...(row.contentReview ?? {}), [opts.contentId]: { hash, at, ...(opts.by ? { by: opts.by } : {}) } },
        ...(alreadyFiled
          ? {}
          : {
              revisions: [...existing, {
                contentId: opts.contentId,
                ...(step !== undefined ? { step } : {}),
                version: nextRevisionVersion(existing, opts.contentId, 'approved'),
                body: opts.body,
                at,
                ...(opts.by ? { by: opts.by } : {}),
                kind: 'approved' as const,
              }],
            }),
      })
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)));
  });
  return hash;
}

/**
 * Drop one send's check. The history it already wrote stands: a record is a record.
 * @param opts
 * @param opts.orgId
 * @param opts.runId
 * @param opts.contentId
 */
export async function clearApprovedContent(opts: { orgId: string; runId: number; contentId: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ contentReview: actionRunSchema.contentReview })
      .from(actionRunSchema)
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)))
      .limit(1)
      .for('update');
    if (!row?.contentReview) {
      return;
    }
    const next = { ...row.contentReview };
    delete next[opts.contentId];
    await tx
      .update(actionRunSchema)
      .set({ contentReview: next })
      .where(and(eq(actionRunSchema.id, opts.runId), eq(actionRunSchema.orgId, opts.orgId)));
  });
}

/**
 * The backstop, run at decide time: every content item that carries copy ends
 * with an `approved` revision holding the copy that actually ran.
 *
 * Called BEFORE `updateActionInput`, which replaces `input` wholesale — the
 * same window `labelVerdicts` and the voice diff depend on. What it files is
 * the payload being approved, so a reviewer who walked every send finds their
 * own approvals already there and one who clicked straight through gets the
 * record made for them. Either way "what did this run send" is answerable from
 * one column after the fact.
 * @param opts - The run and the payload being approved.
 * @param opts.orgId - The project that owns the run.
 * @param opts.runId - The action run.
 * @param opts.actionId - Its action, for the presenter that resolves content.
 * @param opts.approvedInput - The input as approved (the reviewer's edits already applied).
 * @param opts.by - Who approved it.
 */
export async function recordApprovedRevisions(opts: {
  orgId: string;
  runId: number;
  actionId: string;
  approvedInput: unknown;
  by?: string;
}): Promise<void> {
  const items = await contentOf(opts.orgId, opts.actionId, opts.approvedInput);
  for (const item of items) {
    const copy = copyOf(item);
    if (!copy) {
      continue;
    }
    await recordApprovedContent({
      orgId: opts.orgId,
      runId: opts.runId,
      contentId: item.id,
      ...(copy.subject !== undefined ? { subject: copy.subject } : {}),
      body: copy.body,
      ...(opts.by ? { by: opts.by } : {}),
    });
  }
}
