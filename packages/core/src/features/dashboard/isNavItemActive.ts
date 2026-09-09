/**
 * Whether a nav item is the current page. Prefix-matches so a detail route
 * (`/dashboard/agents/sales-assistant`) lights up its section (`/dashboard/agents`).
 * Pathnames may carry a locale prefix, so the match is on the tail.
 * @param pathname - Current pathname from `usePathname()`.
 * @param url - The nav item's URL.
 * @returns True when the item should render as active.
 */
export function isNavItemActive(pathname: string, url: string): boolean {
  if (url.startsWith('http')) {
    return false;
  }
  return pathname === url || pathname.endsWith(url) || pathname.includes(`${url}/`);
}
