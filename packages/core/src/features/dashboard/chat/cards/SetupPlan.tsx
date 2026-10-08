'use client';

import type { RecommendedAction } from '../types';
import { useTranslations } from 'next-intl';
import { ConnectLinkCard, isConnectLinkCard } from '../ConnectLinkCard';
import { BrandPreviewCard, isBrandCard } from './BrandPreviewCard';
import { isSetupCard, SetupCard } from './SetupCard';

/**
 * A SETUP PLAN READS AS A PLAN.
 *
 * The workspace lead's `propose_setup` puts three to six steps under one
 * reply. Through the suggested-actions strip they were one card in view and
 * the rest behind a swipe — a plan nobody could see whole. Here they are one
 * column, in the order the lead put them (the app, the systems it reads, the
 * people and agents who use it), each pressed on its own. A connection in the
 * plan is the ordinary connect card, in its place in the order; "Make it
 * yours" is the brand preview card, last.
 *
 * No frame around the column: each step is the one bordered surface, grouped
 * by an eyebrow and a gap (patterns.md, "a bordered surface never contains
 * another").
 */

/**
 * The cards of a reply that belong to its setup plan, in order — every setup
 * step, and the connect cards drawn beside them. Empty when the reply has no
 * setup step, so an ordinary reply keeps its strip.
 * @param recs - The reply's cards.
 */
export function setupPlanOf(recs: readonly RecommendedAction[]): RecommendedAction[] {
  return recs.some(isSetupCard) ? recs.filter(r => isSetupCard(r) || isConnectLinkCard(r) || isBrandCard(r)) : [];
}

/**
 * The plan, one step per row.
 * @param props - The steps.
 * @param props.recs - The plan's cards, in order.
 * @param props.replyInProgress - True while the reply holding them is still streaming.
 */
export function SetupPlan({ recs, replyInProgress = false }: { recs: RecommendedAction[]; replyInProgress?: boolean }) {
  const t = useTranslations('Onboarding');
  return (
    <div className="mt-3 min-w-0" data-testid="setup-plan">
      <div className="px-1 text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{t('plan_eyebrow')}</div>
      <div className="mt-1.5 flex flex-col gap-2 [&>*]:mt-0">
        {recs.map((rec, i) => (isSetupCard(rec)
          ? <SetupCard key={rec.id ?? i} rec={rec} />
          : isBrandCard(rec)
            ? <BrandPreviewCard key={rec.id ?? i} rec={rec} />
            : <ConnectLinkCard key={rec.id ?? i} rec={rec} replyInProgress={replyInProgress} />))}
      </div>
    </div>
  );
}
