'use client';

import type { AppFront as AppFrontData } from '@/libs/chat/appFront';
import { ArrowRight } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { DetailMeta, MetaChip } from '@/components/patterns/DetailPage';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { PROMPT_PILL_CLASS } from './SuggestionPills';

const LINK = 'hover:text-foreground hover:underline hover:decoration-border hover:underline-offset-4';

/**
 * The app's Chat page, before anything is said: the attention entry first —
 * "What needs my attention today?", asked of the app's lead, over the counts
 * of what waits on a person from this app's agents, each count a link to
 * where those items are, and what waits from outside the app — then the
 * app's briefing in compact form: its date, headline, how many decisions it
 * put in front of you, and its top moves, each a link to the full brief. A
 * brief from another day says its date; one left stale by a failed run says
 * so with the run. What is missing is left out (`libs/chat/appFront.ts`).
 * @param props - The front and what to do with the ask.
 * @param props.front - This app's front.
 * @param props.onAsk - Sends the attention ask to the app's lead.
 */
export function AppFront({ front, onAsk }: { front: AppFrontData; onAsk: (prompt: string, agentSlug: string | null) => void }) {
  const t = useTranslations('Chat');
  const format = useFormatter();
  const b = front.briefing;
  // The brief's day in the workspace's zone, in the person's language.
  const day = b ? format.dateTime(new Date(b.publishedAt), { weekday: 'short', month: 'short', day: 'numeric', timeZone: b.timeZone }) : '';
  const prompt = b
    ? t(b.today ? 'app_front_prompt_today' : 'app_front_prompt_dated', { title: b.title, day })
    : t('app_front_prompt');
  return (
    <section data-testid="app-front" aria-label={t('app_front_label')} className="mx-auto w-full max-w-xl pt-6 text-left">
      <button
        type="button"
        data-testid="app-front-attention"
        onClick={() => onAsk(prompt, front.leadSlug)}
        className={cn(PROMPT_PILL_CLASS, 'py-2 pr-3 pl-4 text-[14px] font-medium text-foreground')}
      >
        <span className="min-w-0 break-words">{t('app_front_attention')}</span>
        <ArrowRight className="size-4 shrink-0" aria-hidden />
      </button>
      <DetailMeta
        className="mt-2.5 pl-1"
        items={[
          ...front.counts.map(c => (
            <Link key={c.key} href={c.href} data-testid="app-front-count" className={LINK}>
              <span className="font-medium text-foreground tabular-nums">{c.count}</span>
              {` ${c.label}`}
            </Link>
          )),
          front.more && (
            <Link key="more" href={front.more.href} data-testid="app-front-more" className={LINK}>
              {t(front.counts.length > 0 ? 'app_front_more' : 'app_front_waiting', { count: front.more.count })}
            </Link>
          ),
          front.outside && (
            <Link key="outside" href={front.outside.href} data-testid="app-front-outside" className={LINK}>
              {t('app_front_outside', { count: front.outside.count, app: front.appName })}
            </Link>
          ),
        ]}
      />
      {b && (
        <div data-testid="app-front-briefing" className="mt-5 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
            <MetaChip>{t('app_front_briefing')}</MetaChip>
            <span data-testid="app-front-briefing-date">{b.today ? t('app_front_today') : day}</span>
          </div>
          <Link href={b.href} className="mt-1 block text-[15px] leading-snug font-medium text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
            {b.title}
          </Link>
          {b.failedRun && (
            <p data-testid="app-front-briefing-failed" className="mt-1 text-[12.5px] text-fail">
              {`${t('app_front_failed')} `}
              <Link href={b.failedRun.href} className="underline decoration-border underline-offset-2 hover:decoration-current">{t('app_front_see_run')}</Link>
            </p>
          )}
          {b.headline && <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{b.headline}</p>}
          {(b.decisions > 0 || b.moves.length > 0) && (
            <div className="mt-2.5 text-[13px]">
              {b.decisions > 0 && (
                <Link href={b.href} data-testid="app-front-decisions" className="font-medium text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
                  {t('app_front_decisions', { count: b.decisions })}
                </Link>
              )}
              {b.moves.length > 0 && (
                <ol className="mt-1.5 space-y-1">
                  {b.moves.map((move, i) => (
                    <li key={move} className="flex gap-2 text-muted-foreground">
                      <span className="w-3 shrink-0 text-right tabular-nums">{i + 1}</span>
                      <Link href={b.href} data-testid="app-front-move" className={cn('min-w-0 break-words', LINK)}>{move}</Link>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
