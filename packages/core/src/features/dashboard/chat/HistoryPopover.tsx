'use client';

import { History, MessagesSquare, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentDot } from '@/components/ui/agent-dot';
import { BAR_ICON_BUTTON } from '@/components/ui/buttonVariants';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { nounCode } from '@/libs/codes';
import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';
import { chatHotkeyLabel } from './chatHotkeys';

export type HistoryHit = {
  id: number;
  title: string;
  agentSlug?: string;
  updatedAt?: Date | string;
  snippet?: string | null;
};

/**
 * The rail's history: recent threads grouped Today / Yesterday / Older, with
 * a search box over titles and message content (agent-chat-surface.md §9).
 * Picking a thread is one of the three intentional ways to resume one. The
 * last, separated row is the way out to every conversation (Chris,
 * 2026-09-18: "history and all conversations should be combined"); New chat
 * is a top-level icon beside this one, not a row in here.
 * @param props
 * @param props.agents
 * @param props.recent - The recent threads for the current agent.
 * @param props.currentId - The thread this surface is in, if any.
 * @param props.onPick - Load a thread into the surface.
 * @param props.search - Search threads by title or content.
 */
export function HistoryPopover({ recent, currentId, onPick, search, agents = [] }: {
  /** The surface's agents, so a row shows who it was with. */
  agents?: ReadonlyArray<{ slug: string; name: string; accent?: string | null }>;
  recent: HistoryHit[];
  currentId: number | null;
  onPick: (id: number) => void;
  search: (q: string) => Promise<HistoryHit[]>;
}) {
  const t = useTranslations('Chat');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HistoryHit[] | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Debounced search; blank shows the recent list.
  useEffect(() => {
    const term = q.trim();
    if (!term) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks-extra/no-direct-set-state-in-use-effect
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      search(term).then((rows) => {
        if (!cancelled) {
          setHits(rows);
        }
      }).catch(() => {
        if (!cancelled) {
          setHits([]);
        }
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, search]);

  const rows = hits ?? recent;
  const groups = useMemo(() => groupByDay(rows), [rows]);

  const pick = (id: number) => {
    onPick(id);
    setOpen(false);
    setQ('');
  };

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverPrimitive.Trigger
            aria-label={t('conversations')}
            className={BAR_ICON_BUTTON}
          >
            <History className="size-4" aria-hidden />
          </PopoverPrimitive.Trigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="end" collisionPadding={8}>{t('conversations')}</TooltipContent>
      </Tooltip>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          side="bottom"
          sideOffset={6}
          // The rail sits on the viewport's right edge: without a collision
          // margin this 20rem panel renders past it.
          collisionPadding={8}
          // Land the caret in the search box when the popover opens.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            inputRef.current?.focus();
          }}
          className="z-50 w-[min(20rem,calc(100vw-1rem))] rounded-xl border border-border bg-background p-2 shadow-(--shadow-pop) outline-none"
        >
          <label className="flex items-center gap-2 rounded-lg bg-surface-soft px-2.5 py-1.5 text-sm">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('search_placeholder')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </label>
          <div className="mt-1 max-h-80 overflow-y-auto">
            {rows.length === 0 && (
              <div className="px-2.5 py-3 text-xs text-muted-foreground">{hits ? t('history_no_match') : t('history_empty')}</div>
            )}
            {groups.map(g => (
              <div key={g.key} className="mt-1">
                <div className="px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  {g.key === 'today' ? t('history_today') : g.key === 'yesterday' ? t('history_yesterday') : t('history_older')}
                </div>
                {g.rows.map(r => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => pick(r.id)}
                    aria-current={r.id === currentId ? 'true' : undefined}
                    // One menu row (polish pass, 2026-10-23): who it was with,
                    // the title, and when, on the right.
                    className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-surface-hover', r.id === currentId && 'bg-surface-hover')}
                  >
                    {(() => {
                      const who = agents.find(a => a.slug === r.agentSlug);
                      return who ? <AgentDot name={who.name} accent={who.accent} size="xs" decorative /> : <span className="size-4 shrink-0" aria-hidden />;
                    })()}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{r.title || nounCode('conversation', r.id)}</span>
                      {r.snippet && <span className="block truncate text-[11px] text-muted-foreground">{r.snippet}</span>}
                    </span>
                    {r.updatedAt && <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortAgo(new Date(r.updatedAt), Date.now())}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          <Link
            href="/dashboard/conversations"
            onClick={() => setOpen(false)}
            data-testid="all-conversations"
            className="mt-1 flex items-center gap-2 rounded-lg border-t border-border/60 px-2.5 pt-2 pb-1.5 text-sm text-foreground/85 transition-colors hover:bg-surface-hover"
          >
            <MessagesSquare className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex-1">{t('all_conversations')}</span>
            <span className="text-[11px] tracking-widest text-muted-foreground">{chatHotkeyLabel('all-conversations')}</span>
          </Link>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

/**
 * Bucket threads by the day they were last touched. Rows with no timestamp
 * (the recent list from `conversations.list` carries none) land in "today"
 * as the most recent-first list they already are.
 * @param rows
 */
export function groupByDay(rows: HistoryHit[]): Array<{ key: 'today' | 'yesterday' | 'older'; rows: HistoryHit[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const buckets: Record<'today' | 'yesterday' | 'older', HistoryHit[]> = { today: [], yesterday: [], older: [] };
  for (const r of rows) {
    const ts = r.updatedAt ? new Date(r.updatedAt).getTime() : Number.NaN;
    if (!Number.isFinite(ts) || ts >= startOfToday) {
      buckets.today.push(r);
    } else if (ts >= startOfYesterday) {
      buckets.yesterday.push(r);
    } else {
      buckets.older.push(r);
    }
  }
  return (['today', 'yesterday', 'older'] as const).filter(k => buckets[k].length > 0).map(k => ({ key: k, rows: buckets[k] }));
}

/**
 * When, as short as a menu row allows: "now", "5m", "3h", then the weekday
 * within a week, then the date.
 * @param at - When the conversation last moved.
 * @param now - The clock, in ms.
 */
export function shortAgo(at: Date, now: number): string {
  const minutes = Math.max(0, Math.round((now - at.getTime()) / 60000));
  if (minutes < 1) {
    return 'now';
  }
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  if (hours < 24 * 7) {
    return at.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
