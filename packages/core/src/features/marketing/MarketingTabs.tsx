import { Link } from '@/libs/I18nNavigation';
import { cn } from '@/utils/Helpers';

const TAB = 'rounded-md px-2.5 py-1 text-[13px] font-medium';

/**
 * The two ranges a Marketing page reads, as links so the range lives in the address.
 * @param props - The links.
 * @param props.days - The range showing.
 * @param props.base - The page they belong to.
 */
export function RangeLinks(props: { days: number; base: string }) {
  return (
    <nav aria-label="Range" className="flex gap-1 rounded-lg bg-surface-soft p-0.5">
      {[7, 30].map(d => (
        <Link key={d} href={`${props.base}?days=${d}`} aria-current={props.days === d ? 'page' : undefined} className={cn(TAB, props.days === d ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {`${d} days`}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The Marketing app's pages: campaigns and search terms.
 * @param props - The tabs.
 * @param props.active - Which page is showing.
 * @param props.days - The range, kept across the tabs.
 */
export function MarketingTabs(props: { active: 'campaigns' | 'search-terms'; days: number }) {
  const tabs = [
    { key: 'campaigns', label: 'Campaigns', href: `/dashboard/marketing?days=${props.days}` },
    { key: 'search-terms', label: 'Search terms', href: `/dashboard/marketing/search-terms?days=${props.days}` },
  ] as const;
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Marketing" className="flex gap-1">
        {tabs.map(t => (
          <Link key={t.key} href={t.href} aria-current={props.active === t.key ? 'page' : undefined} className={cn(TAB, props.active === t.key ? 'bg-surface-soft text-foreground' : 'text-muted-foreground hover:text-foreground')}>
            {t.label}
          </Link>
        ))}
      </nav>
      <RangeLinks days={props.days} base={props.active === 'campaigns' ? '/dashboard/marketing' : '/dashboard/marketing/search-terms'} />
    </div>
  );
}
