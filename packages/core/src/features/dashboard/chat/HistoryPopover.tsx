'use client';

import { History, Search, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Popover as PopoverPrimitive } from 'radix-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
 * Picking a thread is one of the three intentional ways to resume one; the
 * "New chat" row is how you leave it. The list is the person's recent
 * threads — the pointer that no longer decides what a surface opens with.
 * @param props
 * @param props.recent - The recent threads for the current agent.
 * @param props.currentId - The thread this surface is in, if any.
 * @param props.onPick - Load a thread into the surface.
 * @param props.onNewChat - Start fresh.
 * @param props.search - Search threads by title or content.
 */
export function HistoryPopover({ recent, currentId, onPick, onNewChat, search }: {
  recent: HistoryHit[];
  currentId: number | null;
  onPick: (id: number) => void;
  onNewChat: () => void;
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
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:bg-surface-hover data-[state=open]:text-foreground"
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
          <label className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={t('search_placeholder')}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/70"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              onNewChat();
              setOpen(false);
            }}
            className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition hover:bg-muted"
          >
            <SquarePen className="size-4 text-muted-foreground" aria-hidden />
            {t('new_chat')}
          </button>
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
                    className={`flex w-full flex-col items-start rounded-lg px-2.5 py-1.5 text-left transition hover:bg-muted ${r.id === currentId ? 'bg-muted/60' : ''}`}
                  >
                    <span className="w-full truncate text-sm">{r.title || `Chat #${r.id}`}</span>
                    {r.snippet && <span className="w-full truncate text-[11px] text-muted-foreground">{r.snippet}</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
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
