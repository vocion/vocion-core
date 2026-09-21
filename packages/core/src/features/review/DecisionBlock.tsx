import type { AskHistoryEntry } from '@/models/Schema';
import type { DecisionContract } from '@/services/inbox/decisionContract';
import { AlertTriangle, Clock, Lightbulb } from 'lucide-react';

/**
 * The decision contract, rendered — what must be decided, what the system
 * thinks, the strongest reasons, and what waiting costs.
 *
 * The hand-off card (#501) already read this way on a phone, and it is the
 * one shape in the queue that a person could answer without opening it. So
 * it stops being the hand-off's card and becomes every item's: the sentence
 * first, the recommendation as one inline line under it, the reasons short,
 * and the cost of delay said out loud — including when it is nothing.
 *
 * No box inside a box (`docs/design/patterns.md`): hairlines and spacing
 * carry the structure.
 * @param props
 * @param props.contract - The item's decision contract.
 * @param props.history - The escalation so far, when the item has been re-checked.
 * @param props.compact - The list-row register: one line each, no headings.
 */
export function DecisionBlock({ contract, history, compact }: { contract: DecisionContract; history?: AskHistoryEntry[] | null; compact?: boolean }) {
  const recommendation = contract.recommendation
    ? { icon: Lightbulb, label: 'Recommended', text: contract.recommendation, muted: false }
    // "It cannot form a view" is a fact a person needs, not an absence to
    // hide. Saying why is what the contract demands in exchange.
    : contract.recommendationWhyNot
      ? { icon: AlertTriangle, label: 'No recommendation', text: contract.recommendationWhyNot, muted: true }
      : null;
  if (compact) {
    return (
      <span className="mt-0.5 flex min-w-0 flex-col gap-0.5 text-[13px] leading-5" data-testid="decision-block-compact">
        {recommendation && (
          <span className={`truncate ${recommendation.muted ? 'text-muted-foreground' : 'text-foreground/80'}`}>
            <recommendation.icon className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
            {recommendation.text}
          </span>
        )}
        <span className="truncate text-muted-foreground">
          <Clock className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />
          {contract.impactOfDelay}
        </span>
        <HistoryStrip history={history} />
      </span>
    );
  }
  return (
    <section className="mt-4 flex flex-col gap-2 border-y border-border/70 py-3" data-testid="decision-block">
      <p className="text-[15px] leading-6 font-medium text-foreground" data-testid="decision-sentence">{contract.decision}</p>
      {recommendation && (
        <p className={`flex items-start gap-1.5 text-sm leading-6 ${recommendation.muted ? 'text-muted-foreground' : 'text-foreground/90'}`} data-testid="decision-recommendation">
          <recommendation.icon className="mt-1 size-4 shrink-0" aria-hidden />
          <span>
            <span className="text-muted-foreground">{`${recommendation.label}: `}</span>
            {recommendation.text}
          </span>
        </p>
      )}
      {contract.why.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm leading-6 text-muted-foreground" data-testid="decision-why">
          {contract.why.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
      <p className="flex items-start gap-1.5 text-sm leading-6 text-muted-foreground" data-testid="decision-impact">
        <Clock className="mt-1 size-4 shrink-0" aria-hidden />
        <span>
          <span>If this waits: </span>
          {contract.impactOfDelay}
        </span>
      </p>
      <HistoryStrip history={history} />
    </section>
  );
}

/**
 * One line of escalation — "2h: first request blocked · 6h: three blocked ·
 * 13h: four blocked". The whole point of one decision being one object: the
 * escalation is a strip on the card, never four rows in the queue.
 * @param props
 * @param props.history - The ask's history, oldest first.
 */
export function HistoryStrip({ history }: { history?: AskHistoryEntry[] | null }) {
  if (!history || history.length === 0) {
    return null;
  }
  // Newest last, and only as many as read on one line; the full history is on
  // the ask.
  const shown = history.slice(-4);
  return (
    <p className="truncate text-[12px] leading-5 text-muted-foreground" data-testid="decision-history" title={history.map(h => `${h.age ?? ''} ${h.note}`.trim()).join(' · ')}>
      {history.length > shown.length && <span>{`+${history.length - shown.length} earlier · `}</span>}
      {shown.map((h, i) => (
        <span key={`${h.at}-${h.note}`}>
          {i > 0 && ' · '}
          {h.age ? `${h.age}: ` : ''}
          {h.note}
        </span>
      ))}
    </p>
  );
}
