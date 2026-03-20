import { ChevronDown, Filter, Search as SearchIcon } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Badge } from '@/components/ui/badge';
import { TitleBar } from '@/features/dashboard/TitleBar';

const mockResults = [
  {
    title: 'Acme Corp - Account Health Review',
    system: 'Google Drive',
    author: 'Sarah Chen',
    date: 'Mar 14, 2026',
    snippet: 'Overall account health is trending down. Three unresolved support tickets, champion expressing frustration in Slack. Renewal in 30 days requires immediate executive attention...',
    object: 'Account',
    objectName: 'Acme Corp',
    relevance: 0.94,
  },
  {
    title: '#acme-account - "we need to talk about response times"',
    system: 'Slack',
    author: 'Sarah Chen',
    date: 'Mar 15, 2026',
    snippet: 'Honestly, we\'ve been waiting 8 days on the API rate limiting issue and I haven\'t seen any movement. We\'re starting to look at alternatives if this doesn\'t get resolved by end of week...',
    object: 'Account',
    objectName: 'Acme Corp',
    relevance: 0.91,
  },
  {
    title: 'Ticket #4821 - API rate limiting causing production failures',
    system: 'Zendesk',
    author: 'Mike Torres',
    date: 'Mar 10, 2026',
    snippet: 'Priority: High. Customer reports intermittent 429 errors when processing batch uploads. Affecting their nightly data sync pipeline. Escalation requested after 5 business days...',
    object: 'Ticket',
    objectName: '#4821',
    relevance: 0.88,
  },
  {
    title: 'Q1 2026 QBR - Acme Corp Action Items',
    system: 'Notion',
    author: 'Chris Fitkin',
    date: 'Mar 1, 2026',
    snippet: 'Action items: 1) Increase API rate limits for Enterprise tier (pending) 2) Onboard 3 new team members (done) 3) Migrate to v3 SDK (in progress) 4) Schedule monthly syncs (done) 5) Review SLA terms (pending)...',
    object: 'Account',
    objectName: 'Acme Corp',
    relevance: 0.85,
  },
  {
    title: 'ACME-1234 - Evaluate enterprise rate limit architecture',
    system: 'Jira',
    author: 'Dev Team',
    date: 'Mar 8, 2026',
    snippet: 'Epic: Platform Scalability. Current rate limiting implementation uses fixed windows per API key. Need to migrate to sliding window with per-org burst allowance. Blocking Acme Corp resolution...',
    object: 'Project',
    objectName: 'Platform Scalability',
    relevance: 0.82,
  },
  {
    title: 'Acme Corp - Master Services Agreement',
    system: 'Google Drive',
    author: 'Legal Team',
    date: 'Jan 15, 2026',
    snippet: 'Section 7.2 - Service Level Agreement: Provider shall maintain 99.9% API uptime. Response time SLA for Priority 1 issues: 4 business hours. Current breach may trigger Section 12.1 remedies...',
    object: 'Contract',
    objectName: 'Acme Corp MSA',
    relevance: 0.79,
  },
];

const _systemFilters = ['All Systems', 'Slack', 'Google Drive', 'Salesforce', 'Jira', 'Zendesk', 'Notion', 'GitHub'];
const _domainFilters = ['All Domains', 'Sales', 'Support', 'Product', 'Engineering'];

export default async function SearchPage(props: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'Search' });

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col">
      <div className="flex items-center justify-between">
        <TitleBar title={t('title')} description={t('description')} />
        <Badge variant="secondary">Phase 2</Badge>
      </div>

      {/* Search bar */}
      <div className="mb-4 flex items-center gap-2 rounded-md border border-border px-3 py-2.5">
        <SearchIcon className="size-4 shrink-0 stroke-muted-foreground" />
        <input
          type="text"
          defaultValue="Acme Corp account health"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          disabled
        />
        <button type="button" className="flex items-center gap-1 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
          Search
        </button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Filter className="size-4 stroke-muted-foreground" />
        <button type="button" className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
          All Systems
          <ChevronDown className="size-3" />
        </button>
        <button type="button" className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
          All Domains
          <ChevronDown className="size-3" />
        </button>
        <button type="button" className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
          Any Time
          <ChevronDown className="size-3" />
        </button>
        <button type="button" className="flex items-center gap-1 rounded-md bg-muted px-2.5 py-1 text-xs font-medium">
          Any Author
          <ChevronDown className="size-3" />
        </button>
        <span className="ml-auto text-xs text-muted-foreground">
          {mockResults.length}
          {' '}
          results
        </span>
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {mockResults.map((result, i) => (
          <div
            key={i}
            className="cursor-pointer rounded-md border border-border p-4 transition-colors hover:bg-muted/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="shrink-0 text-[10px]">{result.system}</Badge>
                  <span className="truncate text-sm font-semibold">{result.title}</span>
                </div>
                <div className="mt-1.5 line-clamp-2 text-sm text-muted-foreground">
                  {result.snippet}
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{result.author}</span>
                  <span>{result.date}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {result.object}
                    :
                    {' '}
                    {result.objectName}
                  </Badge>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-xs font-medium text-muted-foreground">
                  {Math.round(result.relevance * 100)}
                  % match
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
