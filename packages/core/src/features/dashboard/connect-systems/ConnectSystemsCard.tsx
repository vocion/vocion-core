'use client';

import type { RecommendedAction } from '@/features/dashboard/chat/types';
import { Check, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CONNECT_SYSTEMS_CARD_KIND } from '@/libs/cards/card';
import { connectSystemsInputOfHref } from '@/libs/connect/systemsLink';
import { CONNECT_SYSTEMS_FINISHED_EVENT, startConnectSystems } from './launch';

/**
 * Whether a card is "Connect your systems" (`connect_system`).
 * @param rec - The card as the chat holds it.
 */
export function isConnectSystemsCard(rec: RecommendedAction): boolean {
  return rec.kind === CONNECT_SYSTEMS_CARD_KIND && connectSystemsInputOfHref(rec.href) !== null;
}

/**
 * The card in the transcript. Fresh from the agent, the chat session docks the
 * walk-through above the composer at once (`useChatSession`, on the live
 * `card` event) — the person asked for it — and the card stays here as the way
 * back in ("Start"). Once the walk is done it is its summary.
 * @param props - The card.
 * @param props.rec - The card.
 */
export function ConnectSystemsCard({ rec }: { rec: RecommendedAction }) {
  const input = connectSystemsInputOfHref(rec.href);
  // The walk this card started finished just now: show its summary without waiting for a reload.
  const [finished, setFinished] = useState<string | null>(null);
  useEffect(() => {
    const onFinished = (e: Event) => {
      const detail = (e as CustomEvent<{ cardId: string; summary: string }>).detail;
      if (detail?.cardId && detail.cardId === rec.id) {
        setFinished(detail.summary);
      }
    };
    window.addEventListener(CONNECT_SYSTEMS_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(CONNECT_SYSTEMS_FINISHED_EVENT, onFinished);
  }, [rec.id]);
  const body = finished ?? rec.body;

  if (rec.state === 'decided' || finished !== null) {
    return (
      <div data-testid="connect-systems-card" data-state="decided" className="mt-2.5 flex items-start gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-sm">
        <Check className="mt-0.5 size-4 shrink-0 text-[var(--brand-pass)]" aria-hidden />
        <span className="min-w-0">
          <span className="font-semibold">{rec.label}</span>
          {body && <span className="block text-[13px] text-muted-foreground" data-testid="connect-systems-card-summary">{body}</span>}
        </span>
      </div>
    );
  }
  return (
    <div data-testid="connect-systems-card" className="mt-2.5 flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-amber-tint text-brand-amber-deep">
        <Plug className="size-3.5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold">{rec.label}</span>
      <button
        type="button"
        onClick={() => input && startConnectSystems({ input, ...(rec.id ? { cardId: rec.id } : {}) })}
        data-testid="connect-systems-start"
        className="rounded-full bg-action px-3 py-1 text-[13px] font-medium text-action-foreground transition hover:opacity-90"
      >
        {rec.hrefLabel ?? 'Start'}
      </button>
    </div>
  );
}
