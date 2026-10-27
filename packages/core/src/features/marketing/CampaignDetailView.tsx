'use client';

import type { CampaignRow } from '@/services/marketing/marketingReads';
import { KeyRound, Megaphone } from 'lucide-react';
import { Column, DetailPage, ListRow, ListRows, Section, Stat, StatRow, Subline } from '@/components/patterns';
import { ChartView } from '@/libs/charts/ChartView';
import { money, percent } from './campaignRows';
import { RangeLinks } from './MarketingTabs';

type Keyword = { criterionId?: string; keyword?: string; matchType?: string; status?: string; spend?: number; clicks?: number; conversions?: number };
type Ad = { adId?: string; approval?: string; review?: string; policyTopics?: string[]; headlines?: string[]; finalUrl?: string | null; status?: string };

/**
 * One campaign: what it spent and bought, by day, and the keywords and ads
 * that did it, with each ad's approval at Google.
 * @param props - The campaign.
 * @param props.campaign - Its totals over the range.
 * @param props.daily - Its days.
 * @param props.keywords - Its keywords.
 * @param props.ads - Its ads.
 * @param props.days - The range.
 * @param props.from - First day.
 * @param props.to - Last day.
 */
export function CampaignDetailView(props: { campaign: CampaignRow; daily: Array<{ date: string; spend: number; clicks: number; conversions: number }>; keywords: Keyword[]; ads: Ad[]; days: number; from: string; to: string }) {
  const c = props.campaign;
  const daily = props.daily;
  return (
    <DetailPage
      crumbs={[{ label: 'Paid Marketing', href: '/dashboard/marketing' }, { label: c.name }]}
      title={c.name}
      subtitle={`${c.status === 'ENABLED' ? 'Live' : c.status === 'PAUSED' ? 'Paused' : c.status} · ${money(c.dailyBudget)} a day · ${props.from} to ${props.to}`}
      actions={<RangeLinks days={props.days} base={`/dashboard/marketing/${c.id}`} />}
      data-testid="campaign-detail"
    >
      <StatRow aria-label="Totals">
        <Stat label="Spend" value={money(c.spend)} />
        <Stat label="Clicks" value={c.clicks.toLocaleString('en-US')} note={`${percent(c.ctr)} of ${c.impressions.toLocaleString('en-US')} impressions`} />
        <Stat label="Cost per click" value={money(c.cpc)} />
        <Stat label="Conversions" value={c.conversions} note={c.costPerConversion === null ? 'none counted' : `${money(c.costPerConversion)} each`} />
      </StatRow>

      {daily.length > 1 && (
        <Section eyebrow="By day">
          <ChartView spec={{ title: `${money(c.spend)} on ${c.clicks} clicks over ${props.days} days`, type: 'bar', x: daily.map(d => d.date.slice(5)), series: [{ name: 'Spend', values: daily.map(d => d.spend) }], format: 'currency', aggregation: 'period', source: 'Google Ads', asOf: props.to }} />
        </Section>
      )}

      <Section eyebrow={`Keywords (${props.keywords.length})`}>
        <ListRows>
          {props.keywords.map(k => (
            <ListRow
              key={k.criterionId ?? k.keyword}
              icon={KeyRound}
              title={k.matchType === 'EXACT' ? `[${k.keyword}]` : k.matchType === 'PHRASE' ? `"${k.keyword}"` : String(k.keyword)}
              subline={<Subline segments={[k.status === 'ENABLED' ? 'Live' : k.status ?? null]} />}
              columns={(
                <>
                  <Column kind="amount" always>{money(k.spend ?? 0)}</Column>
                  <Column kind="number">{k.clicks ?? 0}</Column>
                  <Column kind="number">{k.conversions ?? 0}</Column>
                </>
              )}
            />
          ))}
        </ListRows>
      </Section>

      <Section eyebrow="Ads">
        <ListRows>
          {props.ads.map(a => (
            <ListRow
              key={a.adId}
              icon={Megaphone}
              title={(a.headlines ?? []).slice(0, 3).join(' · ') || `Ad ${a.adId}`}
              subline={<Subline segments={[a.approval === 'APPROVED' ? 'Approved' : a.approval === 'APPROVED_LIMITED' ? 'Approved, limited' : a.approval === 'DISAPPROVED' ? 'Disapproved' : a.review === 'REVIEW_IN_PROGRESS' ? 'In review at Google' : (a.approval ?? null), a.policyTopics?.length ? a.policyTopics.join(', ') : null, a.finalUrl ?? null]} />}
            />
          ))}
        </ListRows>
      </Section>
    </DetailPage>
  );
}
