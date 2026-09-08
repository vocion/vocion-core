'use client';

import { ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { dashboardRouteTitle, humanizeSegment } from '@/features/navigation/dashboardNav';
import { Link } from '@/libs/I18nNavigation';

/**
 * Shell-bar breadcrumb derived from the pathname: registered routes get their
 * catalog title, deeper segments (slugs, ids) are humanized. The last crumb
 * is plain text; the ones before it link. Hidden at the dashboard root and on
 * the full-page chat, which is its own surface.
 */
export function AppBreadcrumb() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  const start = parts.indexOf('dashboard');
  if (start === -1) {
    return null;
  }
  const segments = parts.slice(start + 1);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'chat')) {
    return null;
  }

  const crumbs = segments.map((seg, i) => {
    const url = `/dashboard/${segments.slice(0, i + 1).join('/')}`;
    return { url, label: dashboardRouteTitle(url) ?? humanizeSegment(seg) };
  });

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center text-sm sm:flex">
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.url} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden />}
              {last
                ? <span className="truncate font-medium text-foreground" aria-current="page">{c.label}</span>
                : <Link href={c.url} className="truncate text-muted-foreground transition hover:text-foreground">{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
