'use client';

import type { BriefingDecision } from '@/services/briefings/document';
import type { InboxItem } from '@/services/InboxService';
import { AlertTriangle } from 'lucide-react';
import { ListRow, ListRows } from '@/components/ui/list-row';
import { InboxRow } from '@/features/dashboard/inbox/InboxRow';
import { Link } from '@/libs/I18nNavigation';
import { decisionHeadline } from '@/services/briefings/budget';

/**
 * "Needs your decision" — the inbox, quoted.
 *
 * The rule from `docs/specs/briefing-v2.md` §2 and ticket #348 is that the
 * same decision goes to the same place, so these ARE inbox rows: the briefing
 * holds the editorial judgement (which three, and why each one matters now)
 * and `InboxRow` holds the decision (the verbs, the endpoints, the pending
 * pattern, the toast). There is no second decision UI here to drift from the
 * first — approve from the brief and approve from `/dashboard/inbox` are one
 * code path.
 *
 * A card whose row is no longer open — decided between the brief being
 * written and being read — is shown as decided rather than silently dropped.
 * @param props
 * @param props.cards - The judgment cards the document carries, in order.
 * @param props.live - The open inbox right now, keyed by the same `key` the cards carry.
 * @param props.queued - The lower-priority remainder, for the headline.
 * @param props.queued.batchable
 * @param props.queued.background
 * @param props.href - Where the queue lives.
 */
export function DecisionCards({ cards, live, queued, href }: {
  cards: BriefingDecision[];
  live: InboxItem[];
  queued: { batchable: number; background: number };
  href: string;
}) {
  const byKey = new Map(live.map(i => [i.key, i]));
  const open = cards.filter(c => byKey.has(c.key));
  const settled = cards.filter(c => !byKey.has(c.key));
  const queuedTotal = queued.batchable + queued.background;

  return (
    <section data-briefing-section="decisions">
      <h2 className="not-prose text-base font-semibold tracking-tight">Needs your decision</h2>
      <p className="not-prose mt-0.5 mb-3 text-[13px] text-muted-foreground">
        {decisionHeadline(open.length, queuedTotal + settled.length)}
      </p>

      {open.length > 0 && (
        <ul className="not-prose divide-y divide-border border-y border-border">
          {open.map((card) => {
            const item = byKey.get(card.key)!;
            return (
              <InboxRow key={card.key} item={item} tab="open" why={whyLine(card)} />
            );
          })}
        </ul>
      )}

      {open.some(c => c.incident) && (
        <p className="not-prose mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>
            {`A brief shows at most three decisions. ${incidentReason(open)}`}
          </span>
        </p>
      )}

      {settled.length > 0 && (
        <ListRows className="not-prose mt-2">
          {settled.map(card => (
            <ListRow key={card.key} href={card.href} title={card.title} meta="Decided since this brief was written" />
          ))}
        </ListRows>
      )}

      {queuedTotal > 0 && (
        <p className="not-prose mt-3 text-[13px]">
          <Link href={href} className="text-brand-amber-deep hover:opacity-80">Open the queue</Link>
          <span className="text-muted-foreground">
            {` — ${queued.batchable} safe to batch, ${queued.background} background.`}
          </span>
        </p>
      )}
    </section>
  );
}

/**
 * The why-now line, plus the evidence the recommendation rests on.
 * @param card
 */
function whyLine(card: BriefingDecision): string {
  const evidence = card.evidence.length > 0 ? ` · ${card.evidence.map(e => e.label).join(' · ')}` : '';
  return `${card.whyNow}${evidence}`;
}

/**
 * Said out loud when the budget is exceeded, never quietly (spec §2).
 * @param cards
 */
function incidentReason(cards: BriefingDecision[]): string {
  const reasons = cards.filter(c => c.incident && c.incidentReason).map(c => c.incidentReason!);
  return reasons.length > 0 ? `Shown anyway: ${reasons.join('; ')}.` : 'The extra cards are flagged as incidents.';
}
