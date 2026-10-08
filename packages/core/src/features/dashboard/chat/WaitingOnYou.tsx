'use client';

import type { RecommendedAction } from './types';
import { Link } from '@/libs/I18nNavigation';
import { RecommendedActionStack } from './RecommendedActionStack';

/**
 * What is waiting on the person, where they are reading: every proposal the
 * review queue holds for this workspace, as the same cards a turn files
 * (Jamie, 2026-10-07: "I shouldn't be forced to go out to the review queue
 * to do anything"). Each card carries its run, so Approve here is the
 * queue's decision. Past the cap, one line says how many more and where.
 *
 * Nothing is drawn when nothing waits; the eyebrow is not a promise.
 * @param root0 - The block's props.
 * @param root0.cards - The waiting proposals, newest first, already capped.
 * @param root0.more - How many more the queue holds beyond the cards.
 * @param root0.skipRunIds - Runs the thread already shows as cards; those are not drawn twice.
 */
export function WaitingOnYou({ cards, more = 0, skipRunIds }: { cards: RecommendedAction[]; more?: number; skipRunIds?: ReadonlySet<number> }) {
  const shown = skipRunIds ? cards.filter(c => c.runId === undefined || !skipRunIds.has(c.runId)) : cards;
  if (shown.length === 0 && more === 0) {
    return null;
  }
  return (
    <section className="mx-auto w-full max-w-3xl px-4 pt-3 sm:px-6" data-testid="waiting-on-you" aria-label="Waiting on you">
      <p className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        Waiting on you
      </p>
      {shown.length > 0 && <RecommendedActionStack recs={shown} />}
      {more > 0 && (
        <p className="mt-2 text-[13px] text-muted-foreground">
          <Link href="/dashboard/inbox" className="hover:text-foreground hover:underline">
            {more === 1 ? '1 more in the review queue' : `${more} more in the review queue`}
          </Link>
        </p>
      )}
    </section>
  );
}
