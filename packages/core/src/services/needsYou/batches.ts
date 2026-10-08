import type { AskOption } from '@/models/Schema';
import type { InboxItem, InboxKind } from '@/services/InboxService';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { batchKeyFor, PROPOSAL_DEFAULTS } from '@/libs/needsYou/deadlines';
import { actionRunSchema, askSchema } from '@/models/Schema';

/**
 * BATCHES ON NEEDS YOU — the decisions waiting with the same recommendation,
 * gathered so a person can accept them all in one move.
 *
 * Twenty-four approvals that each recommend "Approve" are one judgement made
 * twenty-four times. A batch is every row in view whose recommended option
 * reads the same — an ask's recommended option, a proposal's own suggested
 * decision ("Approve", "Decline") — keyed on how it reads, so the asks and the
 * proposals that recommend "Approve" are one batch whatever filed them.
 *
 * Accepting a batch is each item decided as recommended, one by one, by the
 * person who accepted it, through the same services the row and the detail
 * screen use (`ReviewService.decide`, `AskService.decideAsk`): the alignment
 * ledger, the learning loop and the adoption stream see one decision per
 * item, exactly as if each had been clicked. Nothing is accepted that changed
 * since the person saw it — an item already decided, or whose recommendation
 * moved, is skipped and said so — and a failure on one never stops the rest.
 *
 * A decision sheet (asks under one group key, proposals about one record) is
 * already one move and is left to its own screen.
 */

/** A batch needs at least this many to be worth a move of its own. */
export const MIN_BATCH = 2;

/** One accept decides at most this many. */
export const MAX_BATCH = 100;

export type BatchItem = {
  /** `ask:<id>` | `proposal:<id>` — what the accept names. */
  ref: string;
  kind: InboxKind;
  title: string;
  href: string;
};

export type RecommendationBatch = {
  /** The recommendation as a key (`batchKeyFor`). */
  key: string;
  /** The recommendation as people read it — "Approve". */
  label: string;
  count: number;
  items: BatchItem[];
};

function recommendedOption(options: readonly AskOption[]): AskOption | null {
  const recs = options.filter(o => o.recommended === true);
  return recs.length === 1 ? recs[0]! : null;
}

/**
 * The batches among the rows in view, largest first. Only single rows this
 * workspace can decide in place; only items still waiting with a
 * recommendation; only groups of at least {@link MIN_BATCH}.
 * @param orgId - The workspace.
 * @param items - The rows the person is looking at (the open tab, filters applied).
 */
export async function recommendationBatches(orgId: string, items: readonly InboxItem[]): Promise<RecommendationBatch[]> {
  const singles = items.filter(i => i.shape === 'single' && !i.workspace && i.status !== 'awaiting_execution');
  const askIds = singles.map(i => i.askId).filter((id): id is number => id !== undefined);
  const runIds = singles.filter(i => i.kind === 'proposal').map(i => i.reviewId).filter((id): id is number => id !== undefined);
  const [asks, runs] = await Promise.all([
    askIds.length > 0
      ? db.select({ id: askSchema.id, options: askSchema.options }).from(askSchema).where(and(eq(askSchema.orgId, orgId), inArray(askSchema.id, askIds), eq(askSchema.status, 'open')))
      : Promise.resolve([]),
    runIds.length > 0
      ? db.select({ id: actionRunSchema.id, proposal: actionRunSchema.proposal, regeneratingSince: actionRunSchema.regeneratingSince }).from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), inArray(actionRunSchema.id, runIds), eq(actionRunSchema.status, 'pending')))
      : Promise.resolve([]),
  ]);
  const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
  const askLabel = new Map(asks.map(a => [a.id, recommendedOption(a.options ?? [])?.label ?? null]));
  const runLabel = new Map(runs.map((r) => {
    const s = r.proposal?.suggestedDecision;
    return [r.id, (s === 'approve' || s === 'reject') && !isRegeneratingFresh(r.regeneratingSince) ? PROPOSAL_DEFAULTS[s] : null];
  }));

  const groups = new Map<string, { labels: Map<string, number>; items: BatchItem[] }>();
  for (const item of singles) {
    const isAsk = item.askId !== undefined;
    const label = isAsk ? askLabel.get(item.askId!) : item.reviewId !== undefined ? runLabel.get(item.reviewId) : null;
    if (!label) {
      continue;
    }
    const key = batchKeyFor(label);
    const group = groups.get(key) ?? { labels: new Map<string, number>(), items: [] as BatchItem[] };
    group.labels.set(label, (group.labels.get(label) ?? 0) + 1);
    group.items.push({ ref: isAsk ? `ask:${item.askId}` : `proposal:${item.reviewId}`, kind: item.kind, title: item.title, href: item.href });
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.items.length >= MIN_BATCH)
    .map(([key, g]) => ({
      key,
      // The way most of them spell it.
      label: [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0]![0],
      count: g.items.length,
      items: g.items.slice(0, MAX_BATCH),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export type BatchOutcome = { ref: string; title: string; outcome: 'accepted' | 'skipped' | 'failed'; reason?: string };

export type BatchResult = { accepted: number; skipped: number; failed: number; results: BatchOutcome[] };

export class BatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchError';
  }
}

function parseRef(ref: string): { subject: 'ask' | 'proposal'; id: number } | null {
  const m = /^(ask|proposal):(\d+)$/.exec(ref);
  return m ? { subject: m[1] as 'ask' | 'proposal', id: Number(m[2]) } : null;
}

/**
 * Accept a batch: decide each item as recommended, as this person.
 * @param opts - The batch.
 * @param opts.orgId - The workspace the request runs in; every item is read in it.
 * @param opts.userId - The person accepting.
 * @param opts.key - The recommendation the person accepted (`batchKeyFor`).
 * @param opts.refs - The items they saw under it.
 */
export async function acceptBatch(opts: { orgId: string; userId: string; key: string; refs: readonly string[] }): Promise<BatchResult> {
  const refs = [...new Set(opts.refs)];
  if (refs.length === 0) {
    throw new BatchError('Nothing to accept: the batch named no items.');
  }
  if (refs.length > MAX_BATCH) {
    throw new BatchError(`A batch accepts at most ${MAX_BATCH} items at once.`);
  }
  const results: BatchOutcome[] = [];
  for (const ref of refs) {
    const parsed = parseRef(ref);
    if (!parsed) {
      results.push({ ref, title: ref, outcome: 'skipped', reason: 'not an item this batch can decide' });
      continue;
    }
    results.push(parsed.subject === 'ask'
      ? await acceptAsk(opts.orgId, opts.userId, opts.key, parsed.id, ref)
      : await acceptProposal(opts.orgId, opts.userId, opts.key, parsed.id, ref));
  }
  return {
    accepted: results.filter(r => r.outcome === 'accepted').length,
    skipped: results.filter(r => r.outcome === 'skipped').length,
    failed: results.filter(r => r.outcome === 'failed').length,
    results,
  };
}

async function acceptAsk(orgId: string, userId: string, key: string, id: number, ref: string): Promise<BatchOutcome> {
  const { decideAsk, getAsk } = await import('@/services/AskService');
  const ask = await getAsk(orgId, id);
  if (!ask) {
    // Another workspace's id reads the same as a missing one.
    return { ref, title: ref, outcome: 'skipped', reason: 'not in this workspace' };
  }
  if (ask.status !== 'open') {
    return { ref, title: ask.title, outcome: 'skipped', reason: `already ${ask.status}` };
  }
  const rec = recommendedOption(ask.options ?? []);
  if (!rec || batchKeyFor(rec.label) !== key) {
    return { ref, title: ask.title, outcome: 'skipped', reason: 'its recommendation changed since you saw it' };
  }
  try {
    await decideAsk({ orgId, id, decision: rec.id, decidedBy: userId });
    return { ref, title: ask.title, outcome: 'accepted' };
  } catch (err) {
    return { ref, title: ask.title, outcome: 'failed', reason: (err as Error).message };
  }
}

async function acceptProposal(orgId: string, userId: string, key: string, id: number, ref: string): Promise<BatchOutcome> {
  const [run] = await db.select().from(actionRunSchema).where(and(eq(actionRunSchema.orgId, orgId), eq(actionRunSchema.id, id))).limit(1);
  if (!run) {
    return { ref, title: ref, outcome: 'skipped', reason: 'not in this workspace' };
  }
  const { reviewRowById } = await import('@/services/inbox/reviewRows');
  const title = (await reviewRowById(orgId, id).catch(() => null))?.described.title ?? run.actionId;
  if (run.status !== 'pending') {
    return { ref, title, outcome: 'skipped', reason: `already ${run.status}` };
  }
  const { isRegeneratingFresh } = await import('@/libs/actions/regenerating');
  if (isRegeneratingFresh(run.regeneratingSince)) {
    return { ref, title, outcome: 'skipped', reason: 'a new version is being drafted' };
  }
  const suggested = run.proposal?.suggestedDecision;
  if ((suggested !== 'approve' && suggested !== 'reject') || batchKeyFor(PROPOSAL_DEFAULTS[suggested]) !== key) {
    return { ref, title, outcome: 'skipped', reason: 'its recommendation changed since you saw it' };
  }
  try {
    const { decide } = await import('@/services/ReviewService');
    const out = await decide({ kind: 'action', id }, suggested, orgId, { reviewedBy: userId });
    if (out?.execution?.status === 'failed') {
      return { ref, title, outcome: 'failed', reason: out.execution.error ?? 'it was approved and its execution failed' };
    }
    return { ref, title, outcome: 'accepted' };
  } catch (err) {
    return { ref, title, outcome: 'failed', reason: (err as Error).message };
  }
}
