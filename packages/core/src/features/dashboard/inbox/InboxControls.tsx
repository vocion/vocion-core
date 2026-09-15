'use client';

import type { InboxFacets, InboxSort, InboxTab } from '@/services/InboxService';
import { Search, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { humaniseActionId } from '@/services/inbox/describeActionRun';

const SORT_LABEL: Record<InboxSort, string> = {
  oldest: 'Oldest first',
  value: 'Highest value',
  confidence: 'Highest confidence',
  newest: 'Newest',
};

const TAB_LABEL: Record<InboxTab, string> = { open: 'Open', decided: 'Decided', snoozed: 'Snoozed' };

/**
 * Tabs, search, sort, and the kind / agent chips. Every control writes to the
 * URL and nothing else, so the page re-renders on the server with the same
 * view a person can bookmark or paste into a chat.
 * @param props
 * @param props.tab
 * @param props.q
 * @param props.sort
 * @param props.kinds
 * @param props.agents
 * @param props.facets
 * @param props.tabs
 */
export function InboxControls({ tab, q, sort, kinds, agents, facets, tabs }: {
  tab: InboxTab;
  q: string;
  sort: InboxSort;
  kinds: string[];
  agents: string[];
  facets: InboxFacets;
  tabs: Record<InboxTab, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [draft, setDraft] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the URL changes from elsewhere (back button).
  useEffect(() => {
    // eslint-disable-next-line react-hooks-extra/no-direct-set-state-in-use-effect -- mirrors the URL; the URL is the state
    setDraft(q);
  }, [q]);

  function withParams(patch: Record<string, string | null>): string {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') {
        next.delete(k);
      } else {
        next.set(k, v);
      }
    }
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  }

  const go = (patch: Record<string, string | null>) => router.replace(withParams(patch), { scroll: false });

  function toggle(key: 'kinds' | 'agents', value: string) {
    const current = key === 'kinds' ? kinds : agents;
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    go({ [key]: next.join(',') });
  }

  function onSearch(value: string) {
    setDraft(value);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => go({ q: value.trim() }), 300);
  }

  const chip = (active: boolean) =>
    `inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs transition ${
      active ? 'border-foreground/70 bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Inbox tabs" className="flex h-9 items-stretch rounded-md border border-border p-0.5 text-sm">
          {(['open', 'decided', 'snoozed'] as InboxTab[]).map(t => (
            <button
              key={t}
              type="button"
              aria-current={tab === t ? 'page' : undefined}
              onClick={() => go({ tab: t === 'open' ? null : t, sort: null })}
              className={`inline-flex items-center gap-1.5 rounded-[5px] px-3 transition ${tab === t ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {TAB_LABEL[t]}
              <span className={`text-[11px] tabular-nums ${tab === t ? 'text-background/70' : 'text-muted-foreground/70'}`}>{tabs[t]}</span>
            </button>
          ))}
        </nav>

        <label className="relative flex h-9 min-w-0 flex-1 items-center sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={e => onSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                go({ q: draft.trim() });
              }
            }}
            placeholder="Search deals, contacts, agents…"
            aria-label="Search the inbox"
            className="h-9 w-full rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          {draft && (
            <button type="button" onClick={() => onSearch('')} aria-label="Clear search" className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>

        <label className="ml-auto flex h-9 items-center gap-2 text-xs text-muted-foreground">
          Sort
          <select
            value={sort}
            onChange={e => go({ sort: e.target.value === (tab === 'decided' ? 'newest' : 'oldest') ? null : e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {(Object.keys(SORT_LABEL) as InboxSort[]).map(s => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
          </select>
        </label>
      </div>

      {(facets.actionKinds.length > 0 || facets.agents.length > 0) && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          {facets.actionKinds.map(k => (
            <button key={k.id} type="button" aria-pressed={kinds.includes(k.id)} onClick={() => toggle('kinds', k.id)} className={chip(kinds.includes(k.id))}>
              {humaniseActionId(k.id)}
              <span className="tabular-nums opacity-70">{k.count}</span>
            </button>
          ))}
          {facets.actionKinds.length > 0 && facets.agents.length > 0 && <span className="mx-1 self-center text-border">|</span>}
          {facets.agents.map(a => (
            <button key={a.slug} type="button" aria-pressed={agents.includes(a.slug)} onClick={() => toggle('agents', a.slug)} className={chip(agents.includes(a.slug))}>
              {a.slug}
              <span className="tabular-nums opacity-70">{a.count}</span>
            </button>
          ))}
          {(kinds.length > 0 || agents.length > 0 || q) && (
            <button type="button" onClick={() => go({ kinds: null, agents: null, q: null })} className="inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
