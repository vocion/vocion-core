'use client';

import type { AppFront as AppFrontData } from '@/libs/chat/appFront';
import { ArrowRight } from 'lucide-react';
import { DetailMeta, MetaChip } from '@/components/patterns/DetailPage';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { PROMPT_PILL_CLASS } from './SuggestionPills';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The app's Chat page, before anything is said: the attention entry first —
 * "What needs my attention today?", asked of the app's lead, over the counts
 * of what waits on a person from this app's agents, each count a link to
 * where those items are — then the app's briefing in compact form: its
 * date, headline, how many decisions it put in front of you, and its top
 * moves, each a link to the full brief. A brief from another day says its
 * date; one left stale by a failed run says so with the run. What is missing
 * is left out (`libs/chat/appFront.ts`).
 * @param props - The front and what to do with the ask.
 * @param props.front - This app's front.
 * @param props.onAsk - Sends the attention ask to the app's lead.
 */
export function AppFront({ front, onAsk }: { front: AppFrontData; onAsk: (prompt: string, agentSlug: string | null) => void }) {
  const b = front.briefing;
  return (
    <section data-testid="app-front" aria-label="Today" className="mx-auto w-full max-w-xl pt-6 text-left">
      <button
        type="button"
        data-testid="app-front-attention"
        onClick={() => onAsk(front.prompt, front.leadSlug)}
        className={cn(PROMPT_PILL_CLASS, 'py-2 pr-3 pl-4 text-[14px] font-medium text-foreground')}
      >
        <span className="min-w-0 break-words">What needs my attention today?</span>
        <ArrowRight className="size-4 shrink-0" aria-hidden />
      </button>
      <DetailMeta
        className="mt-2.5 pl-1"
        items={[
          ...front.counts.map(c => (
            <Link key={c.key} href={c.href} data-testid="app-front-count" className="hover:text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
              <span className="font-medium text-foreground tabular-nums">{c.count}</span>
              {` ${c.label}`}
            </Link>
          )),
          front.more && (
            <Link key="more" href={front.more.href} data-testid="app-front-more" className="hover:text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
              <span className="font-medium text-foreground tabular-nums">{front.more.count}</span>
              {front.counts.length > 0 ? ' more in Review' : ` waiting in Review`}
            </Link>
          ),
        ]}
      />
      {b && (
        <div data-testid="app-front-briefing" className="mt-5 border-t border-border/70 pt-4">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-muted-foreground">
            <MetaChip>Briefing</MetaChip>
            <span data-testid="app-front-briefing-date">{b.today ? 'Today' : b.dateLabel}</span>
          </div>
          <Link href={b.href} className="mt-1 block text-[15px] leading-snug font-medium text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
            {b.title}
          </Link>
          {b.failedRun && (
            <p data-testid="app-front-briefing-failed" className="mt-1 text-[12.5px] text-fail">
              {`Not today's: the run that writes it failed. `}
              <Link href={b.failedRun.href} className="underline decoration-border underline-offset-2 hover:decoration-current">See the run</Link>
            </p>
          )}
          {b.headline && <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">{b.headline}</p>}
          {(b.decisions > 0 || b.moves.length > 0) && (
            <div className="mt-2.5 text-[13px]">
              {b.decisions > 0 && (
                <Link href={b.href} data-testid="app-front-decisions" className="font-medium text-foreground hover:underline hover:decoration-border hover:underline-offset-4">
                  {`${b.decisions} ${plural(b.decisions, 'needs', 'need')} your decision`}
                </Link>
              )}
              {b.moves.length > 0 && (
                <ol className="mt-1.5 space-y-1">
                  {b.moves.map((move, i) => (
                    <li key={move} className="flex gap-2 text-muted-foreground">
                      <span className="w-3 shrink-0 text-right tabular-nums">{i + 1}</span>
                      <Link href={b.href} data-testid="app-front-move" className="min-w-0 break-words hover:text-foreground hover:underline hover:decoration-border hover:underline-offset-4">{move}</Link>
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
