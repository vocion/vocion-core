'use client';

import type { RecommendedAction } from '../types';
import { Link } from '@/libs/I18nNavigation';
import { describeCardState } from '../cardState';
import { isPollableRunId, useActionRunStatus } from '../useActionRunStatus';

/**
 * A CARD AN EARLIER TURN PUT UP, read back as one quiet line — what it was and
 * what became of it. Cards are not drawn anymore: everything a person decides
 * reaches them as a Decision docked above the composer (a proposal still
 * waiting is there now, its own approval). A transcript from before keeps its
 * record of what was asked and how it ended, never a second button to press.
 * @param props - The cards.
 * @param props.recs - The cards the turn put up, as its row stored them.
 */
export function CardHistory({ recs }: { recs: RecommendedAction[] }) {
  if (recs.length === 0) {
    return null;
  }
  return (
    <ul className="mt-3 space-y-1" data-testid="card-history">
      {recs.map(rec => <CardHistoryLine key={rec.id ?? rec.label} rec={rec} />)}
    </ul>
  );
}

function CardHistoryLine({ rec }: { rec: RecommendedAction }) {
  const live = useActionRunStatus(isPollableRunId(rec.runId) ? rec.runId : undefined);
  const state = describeCardState(
    { status: live?.status ?? null, decidedBy: live?.decidedBy ?? null, decidedAt: live?.decidedAt ?? null, approvedByAgent: live?.approvedByAgent, summary: live?.summary ?? null, choice: live?.choice ?? null, unfiled: rec.state === 'unfiled', draft: false },
    iso => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  );
  const tone = { muted: 'text-muted-foreground', amber: 'text-[var(--brand-amber-deep)]', green: 'text-[var(--brand-pass)]', red: 'text-[var(--brand-fail)]' }[state.tone];
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-muted-foreground" data-testid="card-history-line">
      <span className="min-w-0 truncate text-foreground/80">{rec.label}</span>
      <span aria-hidden>·</span>
      <span className={`shrink-0 ${tone}`}>{state.label}</span>
      {rec.href && (
        <>
          <span aria-hidden>·</span>
          <Link href={rec.href} className="shrink-0 hover:text-foreground hover:underline">Open</Link>
        </>
      )}
    </li>
  );
}
