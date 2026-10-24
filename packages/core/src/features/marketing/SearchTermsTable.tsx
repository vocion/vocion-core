'use client';

import type { TermSort } from './campaignRows';
import type { SearchTermRow } from '@/services/marketing/marketingReads';
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, ListHeader, ListRow, ListRows, Subline, useListUrlState } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { client } from '@/libs/Orpc';
import { money, nextSort, sortTerms, TERM_SORTS } from './campaignRows';

const LIST = {
  defaults: { tab: '', q: '', sort: 'spend', dir: 'desc' as const, chips: [] },
  sorts: TERM_SORTS,
};

const COLUMNS = [
  { key: 'spend', label: 'Spend', kind: 'amount' as const, always: true, className: 'max-sm:w-16' },
  { key: 'clicks', label: 'Clicks', kind: 'number' as const },
  { key: 'conversions', label: 'Conv.', kind: 'number' as const },
];

type Done = { kind: 'negative' | 'keyword'; line: string } | { kind: 'error'; line: string };

/**
 * What people actually searched, most spend first. Each row offers the two
 * moves a person makes on a search term: keep it out (a negative on its
 * campaign) or bid on it (an exact keyword in its ad group). A tap here is the
 * person's own decision, so it runs at once, with Undo in Review
 * (`review.actAsPerson`).
 * @param props - The table.
 * @param props.rows - The search terms, read live on the server.
 * @param props.days - The range they cover, for the reason on the change.
 */
export function SearchTermsTable(props: { rows: SearchTermRow[]; days: number }) {
  const [list, setList] = useListUrlState(LIST);
  const sort = list.sort as TermSort;
  const rows = useMemo(() => sortTerms(props.rows, sort, list.dir), [props.rows, sort, list.dir]);
  const [done, setDone] = useState<Record<string, Done>>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function act(r: SearchTermRow, kind: 'negative' | 'keyword') {
    const key = `${r.adGroupId}:${r.term}`;
    setBusy(key);
    const reason = `${r.clicks} clicks, ${money(r.spend)}, ${r.conversions} conversions in the last ${props.days} days`;
    try {
      const res = kind === 'negative'
        ? await client.review.actAsPerson({ actionId: 'google_ads.add_negatives', input: { campaign_id: r.campaignId, terms: [{ text: r.term, match: 'PHRASE' }], reason } })
        : await client.review.actAsPerson({ actionId: 'google_ads.add_keywords', input: { ad_group_id: r.adGroupId, keywords: [{ text: r.term, match: 'EXACT' }], reason } });
      const outcome = (res as { outcome?: string }).outcome;
      setDone(d => ({ ...d, [key]: { kind, line: outcome === 'pending' ? 'Waiting in Review' : kind === 'negative' ? 'Added as a negative' : 'Added as a keyword' } }));
    } catch (err) {
      setDone(d => ({ ...d, [key]: { kind: 'error', line: err instanceof Error ? err.message : 'Google Ads did not take it.' } }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div data-testid="search-terms-table">
      <ListHeader
        label="Search terms"
        title={{ key: 'term', label: 'Search term' }}
        columns={COLUMNS}
        sort={sort}
        dir={list.dir}
        onSort={key => setList(nextSort({ sort, dir: list.dir }, key as TermSort))}
        icon
      />
      <ListRows>
        {rows.map((r) => {
          const key = `${r.adGroupId}:${r.term}`;
          const result = done[key];
          return (
            <ListRow
              key={key}
              icon={Search}
              title={r.term}
              subline={<Subline segments={[r.campaign, r.adGroup, r.already ? `already a ${r.already}` : null, result ? result.line : null]} />}
              columns={(
                <>
                  <Column kind="amount" always className="max-sm:w-16">{money(r.spend)}</Column>
                  <Column kind="number">{r.clicks}</Column>
                  <Column kind="number">{r.conversions}</Column>
                </>
              )}
              actions={r.already || (result && result.kind !== 'error')
                ? undefined
                : (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="outline" disabled={busy === key} onClick={() => void act(r, 'negative')}>Exclude</Button>
                      <Button size="sm" variant="ghost" disabled={busy === key} onClick={() => void act(r, 'keyword')}>Add keyword</Button>
                    </span>
                  )}
            />
          );
        })}
      </ListRows>
    </div>
  );
}
