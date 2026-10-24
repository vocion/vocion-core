import type { Metadata } from 'next';
import { Megaphone, Search } from 'lucide-react';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { ListEmpty, ListPage } from '@/components/patterns';
import { PluginPanel } from '@/features/dashboard/plugins/PluginPanel';
import { CampaignDetailView } from '@/features/marketing/CampaignDetailView';
import { CampaignsTable } from '@/features/marketing/CampaignsTable';
import { MarketingTabs } from '@/features/marketing/MarketingTabs';
import { SearchTermsTable } from '@/features/marketing/SearchTermsTable';
import { clerkAuth as auth } from '@/libs/Auth';
import { askInChatHref } from '@/libs/links';
import { rangeParam, readCampaign, readCampaigns, readSearchTerms } from '@/services/marketing/marketingReads';

/** What a path under /dashboard/marketing shows. */
type Shown = { kind: 'campaigns' } | { kind: 'search-terms' } | { kind: 'campaign'; id: string } | { kind: 'none' };

function shown(path: string[] | undefined): Shown {
  const [a, ...rest] = path ?? [];
  if (rest.length > 0) {
    return { kind: 'none' };
  }
  if (a === undefined) {
    return { kind: 'campaigns' };
  }
  if (a === 'search-terms') {
    return { kind: 'search-terms' };
  }
  return /^\d{1,20}$/.test(a) ? { kind: 'campaign', id: a } : { kind: 'none' };
}

export async function generateMetadata(props: { params: Promise<{ path?: string[] }> }): Promise<Metadata> {
  const s = shown((await props.params).path);
  return { title: s.kind === 'search-terms' ? 'Search terms' : s.kind === 'campaign' ? 'Campaign' : 'Marketing' };
}

/**
 * Every Marketing page in one route, so the build compiles them once (the
 * build budget, CI.yml "Build memory"). Each reads the connected Google Ads
 * account live (`services/marketing/marketingReads.ts`); nothing is stored.
 *
 *   /dashboard/marketing               campaigns: spend, clicks, CTR, CPC, conversions
 *   /dashboard/marketing/<id>          one campaign: by day, keywords, ads and their approval
 *   /dashboard/marketing/search-terms  what people searched, to exclude or bid on
 * @param props - The route.
 * @param props.params - Its params.
 * @param props.searchParams - `?days=7|30`.
 */
export default async function MarketingPage(props: { params: Promise<{ locale: string; path?: string[] }>; searchParams: Promise<{ days?: string }> }) {
  const { locale, path } = await props.params;
  setRequestLocale(locale);
  const s = shown(path);
  if (s.kind === 'none') {
    notFound();
  }
  const { orgId } = await auth();
  if (!orgId) {
    return notFound();
  }
  const days = rangeParam((await props.searchParams).days);
  const connect = <ListEmpty variant="page" icon={Megaphone} title="Google Ads isn't readable here yet" description="Connect Google Ads with one Google login; the Marketing lead reads the account from there." action={{ label: 'Connect Google Ads', href: '/dashboard/connectors' }} />;

  if (s.kind === 'campaign') {
    const read = await readCampaign(orgId, s.id, days);
    if (!read.ok) {
      return <ListPage title="Marketing" description={read.reason}>{connect}</ListPage>;
    }
    if (!read.campaign) {
      notFound();
    }
    return <CampaignDetailView campaign={read.campaign} daily={read.daily} keywords={read.keywords} ads={read.ads} days={days} from={read.from} to={read.to} />;
  }

  if (s.kind === 'search-terms') {
    const read = await readSearchTerms(orgId, days);
    return (
      <ListPage title="Search terms" description={read.ok ? `What people searched before clicking an ad, ${read.from} to ${read.to}, most spend first. Exclude what nobody meant to buy; bid on what converts.` : read.reason}>
        <MarketingTabs active="search-terms" days={days} />
        {!read.ok
          ? connect
          : read.terms.length === 0
            ? <ListEmpty variant="page" icon={Search} title="No search terms in this range" description="Google lists a search term once it has an impression." />
            : <SearchTermsTable rows={read.terms} days={days} />}
      </ListPage>
    );
  }

  const read = await readCampaigns(orgId, days);
  return (
    <ListPage title="Marketing" description={read.ok ? `Google Ads ${read.account.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}, ${read.from} to ${read.to}. Every change is a card you approve.` : read.reason}>
      <PluginPanel orgId={orgId} slug="marketing" />
      <MarketingTabs active="campaigns" days={days} />
      {!read.ok
        ? connect
        : read.campaigns.length === 0
          ? <ListEmpty variant="page" icon={Megaphone} title="No campaigns yet" description="Ask the Marketing lead to build one from a landing page." action={{ label: 'Launch a campaign', href: askInChatHref('Build and launch a Google Search campaign for this landing page at $50 a day: ') }} />
          : <CampaignsTable rows={read.campaigns} days={days} />}
    </ListPage>
  );
}
