'use client';

import { ChevronRight } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { dashboardRouteTitle, humanizeSegment } from '@/features/navigation/dashboardNav';
import { Link } from '@/libs/I18nNavigation';

/**
 * Shell-bar breadcrumb (B-034b §3): workspace › section › record. Registered
 * routes get their catalog title; deeper segments (slugs, ids) take the
 * page's own `<title>` when it has one, else a humanised slug. Sentence case,
 * muted, the last crumb plain. Hidden at the dashboard root and on the
 * full-page chat, which is its own surface.
 */

/** Subscribe to `<title>` changes the same way PageDock does — pages set it after paint. */
function subscribeTitle(onChange: () => void) {
  const el = document.querySelector('title');
  if (!el) {
    return () => {};
  }
  const obs = new MutationObserver(onChange);
  obs.observe(el, { childList: true, characterData: true, subtree: true });
  return () => obs.disconnect();
}

const BRAND = (process.env.NEXT_PUBLIC_BRAND_NAME || 'Vocion').toLowerCase();

/** The page's own title, or '' when it is only the app's generic one. */
function readTitle() {
  const t = document.title.replace(/\s*[|·–-]\s*Vocion.*$/i, '').trim();
  const generic = t.toLowerCase();
  if (generic === BRAND || generic === `${BRAND} dashboard` || generic === 'vocion dashboard' || generic === 'dashboard') {
    return '';
  }
  return t;
}

export function Breadcrumb() {
  const pathname = usePathname();
  const docTitle = useSyncExternalStore(subscribeTitle, readTitle, () => '');

  const parts = pathname.split('/').filter(Boolean);
  const start = parts.indexOf('dashboard');
  if (start === -1) {
    return null;
  }
  const segments = parts.slice(start + 1);
  if (segments.length === 0 || (segments.length === 1 && segments[0] === 'chat')) {
    return null;
  }

  const sectionTitle = humanizeSegment(segments[0] ?? '');
  const crumbs = segments.map((seg, i) => {
    const url = `/dashboard/${segments.slice(0, i + 1).join('/')}`;
    const registered = dashboardRouteTitle(url);
    if (registered) {
      return { url, label: registered };
    }
    const last = i === segments.length - 1;
    const useDocTitle = last && docTitle !== '' && docTitle !== sectionTitle;
    return { url, label: useDocTitle ? docTitle : humanizeSegment(seg) };
  });

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center text-[13px] sm:flex">
      <ol className="flex min-w-0 items-center gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.url} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
              {last
                ? <span className="truncate font-medium text-foreground" aria-current="page">{c.label}</span>
                : <Link href={c.url} className="truncate text-muted-foreground transition-colors hover:text-foreground">{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
