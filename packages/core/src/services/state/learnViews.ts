/**
 * LEARNING A PERSON'S VIEWS — noticing the question they keep asking.
 *
 * Every `query_state` call a person makes is logged by its SHAPE (the kinds
 * and the filter, never the words: `queryShape`). When the same shape comes
 * up three times in two weeks, and none of the person's own views already is
 * that query, the tool's output says so to the agent — with a ready-made view
 * — and the agent decides whether to offer it. The offer is the agent's, in
 * the turn, as a Decision card (`view.save`): the system notices, the
 * assistant proposes, the person decides. Nothing is saved, scheduled or put
 * in a brief without that.
 */
import type { StateQuery } from './queryState';
import type { StateView } from './views';
import { and, count, eq, gte, lt } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { stateQueryLogSchema } from '@/models/Schema';
import { queryShape } from './queryState';

/** How many times in the window makes a habit. */
export const REPEAT_THRESHOLD = 3;
/** The window, in days. */
export const REPEAT_WINDOW_DAYS = 14;
/** How long the log is kept. */
const KEEP_DAYS = 30;

export type ViewSuggestion = { shape: string; times: number; query: StateQuery; fromView?: string };

/**
 * Log one query and say whether it has become a habit worth a view. Never
 * throws: learning is a side line of the read, not part of it.
 * @param opts - Who asked what.
 * @param opts.orgId - The workspace.
 * @param opts.userId - The person.
 * @param opts.query - What ran.
 * @param opts.viewSlug - The view it ran, if it ran one.
 * @param opts.ownViews - The person's views, to see whether one already is this query.
 * @param opts.now - The clock.
 */
export async function noteQuery(opts: { orgId: string; userId: string; query: StateQuery; viewSlug?: string; ownViews: StateView[]; now?: Date }): Promise<ViewSuggestion | null> {
  const now = opts.now ?? new Date();
  const shape = queryShape(opts.query);
  try {
    await db.insert(stateQueryLogSchema).values({ orgId: opts.orgId, userId: opts.userId, shape, query: opts.query as unknown as Record<string, unknown>, viewSlug: opts.viewSlug ?? null, createdAt: now });
    await db.delete(stateQueryLogSchema).where(and(eq(stateQueryLogSchema.userId, opts.userId), lt(stateQueryLogSchema.createdAt, new Date(now.getTime() - KEEP_DAYS * 86_400_000))));
    // Already theirs: a person's own view of exactly this query needs no offer.
    if (opts.ownViews.some(v => v.scope === 'person' && queryShape(v.query) === shape)) {
      return null;
    }
    const [row] = await db
      .select({ n: count() })
      .from(stateQueryLogSchema)
      .where(and(
        eq(stateQueryLogSchema.userId, opts.userId),
        eq(stateQueryLogSchema.orgId, opts.orgId),
        eq(stateQueryLogSchema.shape, shape),
        gte(stateQueryLogSchema.createdAt, new Date(now.getTime() - REPEAT_WINDOW_DAYS * 86_400_000)),
      ));
    const times = Number(row?.n ?? 0);
    // Exactly at the threshold, so the offer is made once rather than on every
    // ask after it; a person who declined is not asked again until the next
    // window builds up.
    return times === REPEAT_THRESHOLD ? { shape, times, query: opts.query, ...(opts.viewSlug ? { fromView: opts.viewSlug } : {}) } : null;
  } catch {
    return null;
  }
}

/**
 * The line the agent reads when a question has become a habit.
 * @param s - The suggestion.
 */
export function suggestionNote(s: ViewSuggestion): string {
  return [
    `HABIT: the person has asked this same question ${s.times} times in the last ${REPEAT_WINDOW_DAYS} days.`,
    'After answering, you may offer — once, as a Decision card with recommend_action, action "view.save" — to save it as their own view, named in their words, optionally in their brief.',
    `Its query: ${JSON.stringify(s.query)}.`,
    'Do not save it yourself unless they ask; a schedule or automation from it is a separate ask that follows the trust ladder.',
  ].join(' ');
}
