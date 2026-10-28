/**
 * The product feature an app path belongs to, as analytics names it: the
 * first segment under `/dashboard` (`/dashboard/review/42` → `review`), or
 * the area and its first segment elsewhere (`/gtm/proposals/7` → `gtm/proposals`).
 *
 * One name per feature, so a chart counts "Review" once rather than once per
 * record id. Read from the path, never a list of pages: a new page is a new
 * feature with nothing to update here.
 * @param appPath - The app path, without locale or `/w/<slug>` (`usePathname()`).
 */
export function featureOf(appPath: string | null | undefined): string {
  const segments = (appPath ?? '').split(/[?#]/)[0]!.split('/').filter(s => s !== '');
  const [area, page] = segments;
  if (!area) {
    return 'home';
  }
  if (area === 'dashboard') {
    return page ?? 'home';
  }
  return page ? `${area}/${page}` : area;
}
