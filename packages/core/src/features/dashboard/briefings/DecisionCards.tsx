'use client';

import type { BriefingDecision } from '@/services/briefings/document';
import type { InboxItem } from '@/services/InboxService';
import { AlertTriangle } from 'lucide-react';
import { ListRow, ListRows, Section } from '@/components/patterns';
import { InboxRow } from '@/features/dashboard/inbox/InboxRow';
import { PreviewRef } from '@/features/preview/EvidenceRefs';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { Link } from '@/libs/I18nNavigation';
import { briefingEvidenceRef } from '@/libs/preview/evidenceRef';
import { decisionHeadline } from '@/services/briefings/budget';

const SECTION_EYEBROW = 'Needs your decision';

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
 * **Every route out of this section goes to the surface that does the thing.**
 * The queue links open the inbox filtered to a kind; a card opens its own
 * detail screen. Nothing here opens the conversation with prefilled text —
 * "Do this: 4 learning candidates to adopt or reject" as a chat message is a
 * prompt pretending to be an action, and the person ends up doing the work
 * twice.
 *
 * A card whose row is no longer open — decided between the brief being
 * written and being read — is shown as decided rather than silently dropped.
 * @param props
 * @param props.cards - The judgment cards the document carries, in order.
 * @param props.live - The open inbox right now, keyed by the same `key` the cards carry.
 * @param props.queued - The lower-priority remainder, for the headline.
 * @param props.queued.batchable - Proposals of a kind this person almost always approves.
 * @param props.queued.background - Everything else still waiting.
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
    <Section
      eyebrow={SECTION_EYEBROW}
      data-testid="briefing-decisions"
      action={queuedTotal > 0
        ? <Link href={href} className="text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">Open the queue</Link>
        : undefined}
    >
      <p className="mb-3 text-[13px] text-muted-foreground" data-slot="decisions-headline">
        {decisionHeadline(open.length, queuedTotal + settled.length)}
      </p>

      {open.length > 0 && (
        <div data-slot="decision-rows">
          <ListRows className="border-y border-border/70">
            {open.map(card => (
              <div key={card.key}>
                <InboxRow item={byKey.get(card.key)!} tab="open" why={whyLine(card)} />
                <Evidence card={card} />
              </div>
            ))}
          </ListRows>
        </div>
      )}

      {open.some(c => c.incident) && (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          <span>{`A brief shows at most three decisions. ${incidentReason(open)}`}</span>
        </p>
      )}

      {settled.length > 0 && (
        <ListRows className="mt-2">
          {settled.map(card => <ListRow key={card.key} href={card.href} title={card.title} subline="Decided since this brief was written" />)}
        </ListRows>
      )}

      {queuedTotal > 0 && (
        // Each count is a link to the inbox filtered to what it counts — the
        // number and the way to work it are the same control.
        <p className="mt-3 text-[13px] text-muted-foreground" data-slot="queue-links">
          {queued.batchable > 0 && (
            <Link href={`${href}?kind=proposal`} className="underline decoration-border underline-offset-2 hover:text-foreground">
              {`${queued.batchable} safe to batch`}
            </Link>
          )}
          {queued.batchable > 0 && queued.background > 0 && <span aria-hidden>{' · '}</span>}
          {queued.background > 0 && (
            <Link href={href} className="underline decoration-border underline-offset-2 hover:text-foreground">
              {`${queued.background} background`}
            </Link>
          )}
        </p>
      )}
      <PreviewPanel />
    </Section>
  );
}

/**
 * The why-now line. The evidence used to be appended to it as flat labels;
 * it is a row of openable references now (see `Evidence`).
 * @param card
 */
function whyLine(card: BriefingDecision): string {
  return card.whyNow;
}

/**
 * What the recommendation rests on, each openable in the preview panel
 * without leaving the brief. An `inbox` reference is a decision rather than a
 * reference to confirm, so it stays a link.
 * @param props
 * @param props.card
 */
function Evidence({ card }: { card: BriefingDecision }) {
  if (card.evidence.length === 0) {
    return null;
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pb-2 text-[12px] text-muted-foreground" data-slot="decision-evidence">
      {card.evidence.map((e) => {
        const ref = briefingEvidenceRef(e);
        return ref
          ? <PreviewRef key={`${e.kind}-${e.id}`} recordRef={ref} label={e.label} className="text-[12px]" />
          : (
              <Link key={`${e.kind}-${e.id}`} href={e.href ?? '/dashboard/inbox'} className="underline decoration-border underline-offset-2 hover:text-foreground">
                {e.label}
              </Link>
            );
      })}
    </p>
  );
}

/**
 * Said out loud when the budget is exceeded, never quietly (spec §2).
 * @param cards
 */
function incidentReason(cards: BriefingDecision[]): string {
  const reasons = cards.filter(c => c.incident && c.incidentReason).map(c => c.incidentReason!);
  return reasons.length > 0 ? `Shown anyway: ${reasons.join('; ')}.` : 'The extra cards are flagged as incidents.';
}
