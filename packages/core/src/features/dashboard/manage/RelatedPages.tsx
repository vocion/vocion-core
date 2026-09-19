import type { DashboardLayoutKey } from '@/features/navigation/dashboardNav';
import { useTranslations } from 'next-intl';
import { createElement } from 'react';
import { dashboardRoute } from '@/features/navigation/dashboardNav';
import { Link } from '@/libs/I18nNavigation';

/**
 * One hairline row of sibling pages, directly under a MANAGE page's title bar:
 * "See also: Skills & tools · Evals · Marketplace".
 *
 * The Manage sections used to end at their own screen — Teams & agents, Skills
 * & tools, Evals and Marketplace each answered part of "what can this
 * workforce do" with no way across (Chris, 2026-09-18: "clean up, simplify,
 * link, make contextually consistent"). Rather than a second nav, this reads
 * the SAME registry the sidebar, the palette and the breadcrumb read
 * (`dashboardNav.ts`), so a row cannot name a page that does not exist or call
 * it something the sidebar does not. Titles come from the same
 * `DashboardLayout` keys `CombinedPageHeader` uses, falling back to the
 * registry's English title. RSC-safe: `useTranslations` in a sync server
 * component.
 * @param props
 * @param props.urls - Dashboard route urls, in the order they should read.
 */
export function RelatedPages({ urls }: { urls: readonly string[] }) {
  const t = useTranslations('DashboardLayout');
  const say = (key: DashboardLayoutKey | undefined, fallback: string) => (key ? t(key) : fallback);
  const routes = urls.map(url => dashboardRoute(url)).filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (routes.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Related pages" className="-mt-4 mb-6 flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/70 pb-3 text-[13px] text-muted-foreground">
      <span className="mr-1">{t('see_also')}</span>
      {routes.map((route, i) => (
        <span key={route.url} className="inline-flex items-center">
          {i > 0 && <span className="mx-1.5 text-border" aria-hidden>·</span>}
          <Link
            href={route.url}
            className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
          >
            {createElement(route.icon, { 'className': 'size-3.5', 'aria-hidden': true })}
            {say(route.i18nKey, route.title)}
          </Link>
        </span>
      ))}
    </nav>
  );
}
