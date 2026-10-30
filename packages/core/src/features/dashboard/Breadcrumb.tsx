'use client';

import { ChevronRight } from 'lucide-react';

import { useSyncExternalStore } from 'react';
import { buildCrumbs } from '@/features/dashboard/breadcrumbModel';
import { useExplicitBreadcrumbTrail } from '@/features/dashboard/BreadcrumbTrail';
import { Link, usePathname } from '@/libs/I18nNavigation';

/**
 * Shell-bar breadcrumb (B-034b §3): workspace › section › record. Registered
 * routes get their catalog title (a tab of a combined page shows its page
 * first: "Teams & agents › Agents"); deeper segments (slugs, ids) take the
 * page's own `<title>` when it has one, else a humanised slug. Sentence case,
 * muted, the last crumb plain. Starts with the workspace name when the shell
 * knows it, so "which workspace am I in" is answered top-left of the page.
 * The crumb rule itself lives in `breadcrumbModel.ts`.
 */

/**
 * Subscribe to `<title>` changes the same way PageDock does — pages set it after paint.
 * @param onChange
 */
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

/**
 * The page's own title, or '' when it is only the app's generic one. On an
 * Org-branded install the tab reads "<page> · <Org>" and the default is
 * "<Org> · Vocion" (`libs/branding/orgBrand.ts` brandTitle), so the Org's
 * name is stripped too: the crumb read "Finance Team › Metacto" on every page
 * that set no title of its own (2026-10-20).
 * @param brandName - The Org's brand name, when the Org leads the install.
 */
function readTitle(brandName?: string | null) {
  let t = document.title.replace(/\s*[|·–-]\s*Vocion.*$/i, '').trim();
  if (brandName) {
    const suffix = ` · ${brandName}`;
    t = t === brandName ? '' : t.endsWith(suffix) ? t.slice(0, -suffix.length).trim() : t;
  }
  const generic = t.toLowerCase();
  if (generic === BRAND || generic === `${BRAND} dashboard` || generic === 'vocion dashboard' || generic === 'dashboard') {
    return '';
  }
  return t;
}

export function Breadcrumb({ workspaceName, brandName = null }: { workspaceName?: string | null; brandName?: string | null } = {}) {
  const pathname = usePathname();
  const docTitle = useSyncExternalStore(subscribeTitle, () => readTitle(brandName), () => '');

  const explicit = useExplicitBreadcrumbTrail();
  const crumbs = explicit
    ? [...(workspaceName ? [{ url: '/dashboard', label: workspaceName }] : []), ...explicit]
    : buildCrumbs({ pathname, docTitle, workspaceName });
  if (!crumbs) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="flex max-w-full min-w-0 items-center overflow-x-auto text-[12px] [scrollbar-width:none] sm:text-[13px] [&::-webkit-scrollbar]:hidden">
      <ol className="flex min-w-max items-center gap-1">
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <li key={c.url} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />}
              {last
                ? <span className="block max-w-44 truncate font-medium text-foreground sm:max-w-72" aria-current="page">{c.label}</span>
                : <Link href={c.url} className="block max-w-36 truncate py-2 text-muted-foreground transition-colors hover:text-foreground sm:max-w-48">{c.label}</Link>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
