'use client';

import type { Chip } from '@/components/patterns';
import type { TokenOption } from '@/components/ui/token-select';
import type { InboxFacets, InboxKind, InboxSort, InboxTab } from '@/services/InboxService';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ChipRow, CompactFilters, CompactSection, FilterBar } from '@/components/patterns';
import { usePathname, useRouter } from '@/libs/I18nNavigation';
import { humaniseActionId } from '@/services/inbox/describeActionRun';
import { INBOX_KINDS } from '@/services/inbox/kinds';
import { INBOX_KIND_META } from './inboxMeta';
import { defaultSortFor, mergeSearch } from './searchParams';

const SORTS: readonly InboxSort[] = ['oldest', 'newest', 'value', 'confidence'];

/**
 * Tabs, search, sort, the kind chips and — under them — the action-kind and
 * agent chips, each row on ONE line with a "+N more" menu for the rest
 * (`ChipRow`). Every control writes to the URL and nothing else, so the page
 * re-renders on the server with the same view a person can bookmark or paste
 * into a chat. `?kind=proposal,ruling` · `?actionKind=hubspot.update` ·
 * `?agents=deal-desk` · `?q=` · `?sort=` · `?tab=`.
 *
 * On a phone all of it is ONE row of chips (`CompactFilters`): the scope
 * ("This workspace ▾"), the lane ("Open 3 ▾"), a button that opens a bottom
 * sheet with the search field, every filter and sort, and each filter that is
 * on as a removable chip. Same URL writes; only the layout changes.
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

  // Read the URL at CALL time, never from the render snapshot: a debounced
  // write would otherwise rebuild it from a snapshot taken before the user's
  // last click and drop that click. See `searchParams.ts`.
  function withParams(patch: Record<string, string | null>): string {
    const current = typeof window === 'undefined' ? params.toString() : window.location.search;
    const s = mergeSearch(current, patch);
    return s ? `${pathname}?${s}` : pathname;
  }

  const go = (patch: Record<string, string | null>) => router.replace(withParams(patch), { scroll: false });

  function toggle(key: 'kind' | 'actionKind' | 'agents', value: string) {
    const current: string[] = key === 'kind' ? kinds : key === 'actionKind' ? actionKinds : agents;
    const next = current.includes(value) ? current.filter(v => v !== value) : [...current, value];
    go({ [key]: next.join(',') });
  }

  function onSearch(value: string) {
    setDraft(value);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    // Selecting a token clears the field, which lands here with ''. When the
    // URL already says that, there is nothing to write — and writing anyway is
    // how a freshly chosen filter got overwritten by its own side effect.
    if (value.trim() === q) {
      return;
    }
    timer.current = setTimeout(() => go({ q: value.trim() }), 300);
  }

  const total = INBOX_KINDS.reduce((sum, k) => sum + counts[k], 0);
  const filtered = kinds.length > 0 || actionKinds.length > 0 || agents.length > 0 || Boolean(q);
  // Newest first everywhere. Oldest-first is the classic work-queue default and
  // it earns its keep when a queue drains; this one has not drained in fifteen
  // days, so it only ever showed the same stalled rows and made the queue look
  // dead. Chris, 2026-09-17: *"maybe default to newest first?"* The oldest age
  // is still stated in the header line, so the backlog does not become
  // invisible — it just stops being the only thing you can see.
  const defaultSort: InboxSort = defaultSortFor(tab);

  const kindChips: Chip[] = [
    { key: 'all', label: t('all'), count: total, active: kinds.length === 0, pinned: true, onToggle: () => go({ kind: null }) },
    ...INBOX_KINDS.filter(k => counts[k] > 0 || kinds.includes(k)).map<Chip>(k => ({
      key: k,
      label: INBOX_KIND_META[k].plural,
      count: counts[k],
      active: kinds.includes(k),
      title: INBOX_KIND_META[k].blurb,
      onToggle: () => toggle('kind', k),
    })),
  ];

  const facetChips: Chip[] = [
    ...facets.actionKinds.map<Chip>(k => ({ key: `action:${k.id}`, label: humaniseActionId(k.id), count: k.count, active: actionKinds.includes(k.id), title: k.id, onToggle: () => toggle('actionKind', k.id) })),
    ...facets.agents.map<Chip>(a => ({ key: `agent:${a.slug}`, label: a.slug, count: a.count, active: agents.includes(a.slug), onToggle: () => toggle('agents', a.slug) })),
  ];

  /**
   * Every filter value in the queue, as ONE option list.
   *
   * Namespaced by dimension so a selection can be split back into the three
   * URL params it came from. `FilterBar` neither knows nor cares what the
   * prefixes mean — which is what lets the same bar serve Search, the
   * Discovery calls and Personalization without learning their vocabularies.
   */
  const tokenOptions: TokenOption[] = [
    ...INBOX_KINDS.filter(k => counts[k] > 0 || kinds.includes(k)).map(k => ({
      value: `kind:${k}`,
      label: INBOX_KIND_META[k].plural,
      count: counts[k],
      group: t('filter_kind'),
    })),
    ...facets.actionKinds.map(k => ({
      value: `type:${k.id}`,
      label: humaniseActionId(k.id),
      count: k.count,
      group: t('filter_type'),
    })),
    ...facets.agents.map(a => ({
      value: `agent:${a.slug}`,
      label: a.slug,
      count: a.count,
      group: t('filter_agent'),
    })),
  ];

  const selectedTokens = [
    ...kinds.map(k => `kind:${k}`),
    ...actionKinds.map(k => `type:${k}`),
    ...agents.map(a => `agent:${a}`),
  ];

  /**
   * One write to the URL, whichever dimensions the selection touched.
   * @param next
   */
  function onTokens(next: string[]) {
    const pick = (prefix: string) => next.filter(v => v.startsWith(prefix)).map(v => v.slice(prefix.length));
    go({
      kind: pick('kind:').join(',') || null,
      actionKind: pick('type:').join(',') || null,
      agents: pick('agent:').join(',') || null,
    });
  }

  const tokenLabel = (value: string) => tokenOptions.find(o => o.value === value)?.label ?? value.slice(value.indexOf(':') + 1);
  const sortSelect = (className: string) => (
    <select
      value={sort}
      aria-label={t('sort')}
      onChange={e => go({ sort: e.target.value === defaultSort ? null : e.target.value })}
      className={className}
    >
      {SORTS.map(s => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
    </select>
  );

  return (
    <div className="space-y-3">
      <CompactFilters
        menus={[
          {
            key: 'scope',
            label: t('scope_label'),
            value: 'here',
            options: [{ key: 'here', label: t('scope_here') }, { key: 'all', label: t('scope_all') }],
            // Switching scope drops this scope's filters, as `InboxScope` does.
            onChange: key => key === 'all' && router.replace(`${pathname}?scope=all`, { scroll: false }),
          },
          {
            key: 'tab',
            label: t('title'),
            value: tab,
            options: (['open', 'decided', 'snoozed'] as InboxTab[]).map(tb => ({ key: tb, label: t(`tab_${tb}`), count: tabs[tb] })),
            onChange: key => go({ tab: key === 'open' ? null : key, sort: null }),
          },
        ]}
        active={[
          ...(q ? [{ key: '__q__', label: `“${q}”`, onRemove: () => go({ q: null }) }] : []),
          ...selectedTokens.map(v => ({ key: v, label: tokenLabel(v), onRemove: () => onTokens(selectedTokens.filter(x => x !== v)) })),
        ]}
        sheet={{
          count: selectedTokens.length + (q ? 1 : 0) + (sort === defaultSort ? 0 : 1),
          footer: filtered && (
            <button type="button" onClick={() => go({ kind: null, actionKind: null, agents: null, q: null })} className="text-sm text-muted-foreground underline-offset-2 hover:underline">
              {t('clear')}
            </button>
          ),
          children: (
            <>
              <FilterBar
                label={t('search_label')}
                placeholder={t('filter_placeholder')}
                query={draft}
                onQueryChange={onSearch}
                options={tokenOptions}
                selected={selectedTokens}
                onSelectedChange={onTokens}
                searching={t('filter_searching')}
              />
              <CompactSection label={t('filter_kind')}>
                <ChipRow chips={kindChips} size="md" label={t('filter_kind')} />
              </CompactSection>
              {facetChips.length > 0 && (
                <CompactSection label={t('filter_facets')}>
                  <ChipRow chips={facetChips} size="sm" label={t('filter_facets')} />
                </CompactSection>
              )}
              <CompactSection label={t('sort')}>
                {sortSelect('h-10 w-full rounded-lg bg-surface-soft px-3 text-base text-foreground outline-none focus:ring-2 focus:ring-ring/30')}
              </CompactSection>
            </>
          ),
        }}
      />

      <div className="hidden flex-wrap items-center gap-3 sm:flex">
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

        <label className="ml-auto flex h-9 items-center gap-2 text-xs text-muted-foreground">
          {t('sort')}
          {sortSelect('h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring/40')}
        </label>
      </div>

      {/* ONE field: the letters narrow every dimension at once and search the
          list's text at the same time, and what you pick rides as a token.
          The chip rows are not gone — they are the advanced panel, which is
          where browsing a dimension you cannot name yet belongs. */}
      <FilterBar
        className="hidden sm:flex"
        label={t('search_label')}
        placeholder={t('filter_placeholder')}
        query={draft}
        onQueryChange={onSearch}
        options={tokenOptions}
        selected={selectedTokens}
        onSelectedChange={onTokens}
        searching={t('filter_searching')}
        advancedCount={selectedTokens.length}
        advanced={(
          <div className="flex flex-col gap-3">
            <div data-testid="inbox-kind-filter">
              <ChipRow chips={kindChips} size="md" label={t('filter_kind')} />
            </div>
            {facetChips.length > 0 && <ChipRow chips={facetChips} size="sm" label={t('filter_facets')} />}
            {filtered && (
              <button
                type="button"
                onClick={() => go({ kind: null, actionKind: null, agents: null, q: null })}
                className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                {t('clear')}
              </button>
            )}
          </div>
        )}
      />

    </div>
  );
}
