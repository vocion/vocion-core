'use client';

import type { InboxFacets, InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { Search, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { humaniseActionId } from '@/services/inbox/describeActionRun';
import { INBOX_KINDS } from '@/services/inbox/kinds';
import { INBOX_KIND_META } from './inboxMeta';

const SORTS: readonly InboxSort[] = ['oldest', 'newest', 'value', 'confidence'];

/**
 * Tabs, search, sort, the kind chips and — under them — the action-kind and
 * agent chips. Every control writes to the URL and nothing else, so the page
 * re-renders on the server with the same view a person can bookmark or paste
 * into a chat. `?kind=proposal,ruling` · `?actionKind=hubspot.update` ·
 * `?agents=deal-desk` · `?q=` · `?sort=` · `?tab=`.
 * @param props
 * @param props.tab
 * @param props.q
 * @param props.sort
 * @param props.kinds
 * @param props.actionKinds
 * @param props.agents
 * @param props.facets
 * @param props.counts
 * @param props.tabs
 */
export function InboxControls({ tab, q, sort, kinds, actionKinds, agents, facets, counts, tabs }: {
  tab: InboxTab;
  q: string;
  sort: InboxSort;
  kinds: InboxKind[];
  actionKinds: string[];
  agents: string[];
  facets: InboxFacets;
  counts: Record<InboxKind, number>;
  tabs: Record<InboxTab, number>;
}) {
  const t = useTranslations('Inbox');
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

  function toggle(key: 'kind' | 'actionKind' | 'agents', value: string) {
    const current = key === 'kind' ? kinds : key === 'actionKind' ? actionKinds : agents;
    const next = (current as string[]).includes(value) ? (current as string[]).filter(v => v !== value) : [...current, value];
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
    `inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] transition focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none ${
      active ? 'bg-[var(--action,var(--foreground))] text-[var(--action-foreground,var(--background))]' : 'text-foreground/80 hover:bg-[var(--surface-hover,var(--muted))]'
    }`;
  const smallChip = (active: boolean) =>
    `inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs transition ${
      active ? 'border-foreground/70 bg-foreground text-background' : 'border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground'
    }`;

  const total = INBOX_KINDS.reduce((sum, k) => sum + counts[k], 0);
  const presentKinds = INBOX_KINDS.filter(k => counts[k] > 0 || kinds.includes(k));
  const filtered = kinds.length > 0 || actionKinds.length > 0 || agents.length > 0 || Boolean(q);
  const defaultSort: InboxSort = tab === 'decided' ? 'newest' : 'oldest';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Inbox tabs" className="flex h-9 items-stretch rounded-md border border-border p-0.5 text-sm">
          {(['open', 'decided', 'snoozed'] as InboxTab[]).map(tb => (
            <button
              key={tb}
              type="button"
              aria-current={tab === tb ? 'page' : undefined}
              onClick={() => go({ tab: tb === 'open' ? null : tb, sort: null })}
              className={`inline-flex items-center gap-1.5 rounded-[5px] px-3 transition ${tab === tb ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'}`}
            >
              {t(`tab_${tb}`)}
              <span className={`text-[11px] tabular-nums ${tab === tb ? 'text-background/70' : 'text-muted-foreground/70'}`}>{tabs[tb]}</span>
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
            placeholder={t('search_placeholder')}
            aria-label={t('search_label')}
            className="h-9 w-full rounded-md border border-border bg-background pr-8 pl-8 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          {draft && (
            <button type="button" onClick={() => onSearch('')} aria-label={t('clear_search')} className="absolute right-2 rounded p-0.5 text-muted-foreground hover:text-foreground">
              <X className="size-3.5" aria-hidden />
            </button>
          )}
        </label>

        <label className="ml-auto flex h-9 items-center gap-2 text-xs text-muted-foreground">
          {t('sort')}
          <select
            value={sort}
            onChange={e => go({ sort: e.target.value === defaultSort ? null : e.target.value })}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40"
          >
            {SORTS.map(s => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
          </select>
        </label>
      </div>

      {/* The kind chips: "All · 12" then each kind present, filled in ink when active. Multi-select. */}
      <div role="group" aria-label={t('filter_kind')} data-testid="inbox-kind-filter" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
        <button type="button" aria-pressed={kinds.length === 0} onClick={() => go({ kind: null })} className={chip(kinds.length === 0)}>
          {t('all')}
          <span aria-hidden className="opacity-50">·</span>
          <span className="tabular-nums opacity-70">{total}</span>
        </button>
        {presentKinds.map(k => (
          <button key={k} type="button" aria-pressed={kinds.includes(k)} onClick={() => toggle('kind', k)} className={chip(kinds.includes(k))} title={INBOX_KIND_META[k].blurb}>
            {INBOX_KIND_META[k].plural}
            <span aria-hidden className="opacity-50">·</span>
            <span className="tabular-nums opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>

      {(facets.actionKinds.length > 0 || facets.agents.length > 0) && (
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:flex-wrap sm:px-0">
          {facets.actionKinds.map(k => (
            <button key={k.id} type="button" aria-pressed={actionKinds.includes(k.id)} onClick={() => toggle('actionKind', k.id)} className={smallChip(actionKinds.includes(k.id))} title={k.id}>
              {humaniseActionId(k.id)}
              <span className="tabular-nums opacity-70">{k.count}</span>
            </button>
          ))}
          {facets.actionKinds.length > 0 && facets.agents.length > 0 && <span className="mx-1 self-center text-border">|</span>}
          {facets.agents.map(a => (
            <button key={a.slug} type="button" aria-pressed={agents.includes(a.slug)} onClick={() => toggle('agents', a.slug)} className={smallChip(agents.includes(a.slug))}>
              {a.slug}
              <span className="tabular-nums opacity-70">{a.count}</span>
            </button>
          ))}
          {filtered && (
            <button type="button" onClick={() => go({ kind: null, actionKind: null, agents: null, q: null })} className="inline-flex h-7 shrink-0 items-center gap-1 px-2 text-xs whitespace-nowrap text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {t('clear')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
