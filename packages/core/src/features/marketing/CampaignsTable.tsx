'use client';

import type { CampaignSort } from './campaignRows';
import type { CampaignRow } from '@/services/marketing/marketingReads';
import { Megaphone } from 'lucide-react';
import { useMemo } from 'react';
import { Column, ListHeader, ListRow, ListRows, Subline, useListUrlState } from '@/components/patterns';
import { CAMPAIGN_SORTS, money, nextSort, percent, sortCampaigns } from './campaignRows';

const LIST = {
  defaults: { tab: '', q: '', sort: 'spend', dir: 'desc' as const, chips: [] },
  sorts: CAMPAIGN_SORTS,
};

const COLUMNS = [
  { key: 'spend', label: 'Spend', kind: 'amount' as const, always: true, className: 'max-sm:w-16' },
  { key: 'clicks', label: 'Clicks', kind: 'number' as const },
  { key: 'ctr', label: 'CTR', kind: 'number' as const },
  { key: 'cpc', label: 'CPC', kind: 'number' as const },
  { key: 'conversions', label: 'Conv.', kind: 'number' as const, always: true, className: 'max-sm:w-12' },
  { key: 'cpa', label: 'Cost / conv.', kind: 'amount' as const },
];

/**
 * The account's campaigns over the range: what each spent and what it bought,
 * sorted by spend until the person clicks another heading.
 * @param props - The table.
 * @param props.rows - The campaigns, read live on the server.
 * @param props.days - The range, carried into each campaign's link.
 */
export function CampaignsTable(props: { rows: CampaignRow[]; days: number }) {
  const [list, setList] = useListUrlState(LIST);
  const sort = list.sort as CampaignSort;
  const rows = useMemo(() => sortCampaigns(props.rows, sort, list.dir), [props.rows, sort, list.dir]);
  return (
    <div data-testid="campaigns-table">
      <ListHeader
        label="Campaigns"
        title={{ key: 'name', label: 'Campaign' }}
        columns={COLUMNS}
        sort={sort}
        dir={list.dir}
        onSort={key => setList(nextSort({ sort, dir: list.dir }, key as CampaignSort))}
        icon
        chevron
      />
      <ListRows>
        {rows.map(r => (
          <ListRow
            key={r.id}
            href={`/dashboard/marketing/${r.id}?days=${props.days}`}
            icon={Megaphone}
            title={r.name}
            subline={<Subline segments={[r.status === 'ENABLED' ? 'Live' : r.status === 'PAUSED' ? 'Paused' : r.status, `${money(r.dailyBudget)} a day`, r.serving && r.serving !== 'ELIGIBLE' ? r.serving.toLowerCase().replace(/_/g, ' ') : null]} />}
            columns={(
              <>
                <Column kind="amount" always className="max-sm:w-16">{money(r.spend)}</Column>
                <Column kind="number">{r.clicks.toLocaleString('en-US')}</Column>
                <Column kind="number">{percent(r.ctr)}</Column>
                <Column kind="number">{money(r.cpc)}</Column>
                <Column kind="number" always className="max-sm:w-12">{r.conversions}</Column>
                <Column kind="amount">{money(r.costPerConversion)}</Column>
              </>
            )}
          />
        ))}
      </ListRows>
    </div>
  );
}
