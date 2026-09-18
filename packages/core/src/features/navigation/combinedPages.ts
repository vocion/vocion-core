import type { DashboardRoute } from '@/features/navigation/dashboardNav';
import { dashboardRoute, tabsOf } from '@/features/navigation/dashboardNav';

/**
 * A combined page — one URL that owns a tab strip, each tab its own route —
 * resolved from either the owner's URL or any tab's. Pure, so tab deep-links
 * are unit-testable: `combinedPage('/dashboard/agents')` is the Teams & agents
 * page with Agents active.
 */
export type CombinedPage = {
  owner: DashboardRoute;
  /** Owner first, then its tabs, in registry order. */
  tabs: DashboardRoute[];
  active: DashboardRoute;
};

export function combinedPage(url: string): CombinedPage | undefined {
  const active = dashboardRoute(url);
  if (!active) {
    return undefined;
  }
  const ownerUrl = active.tabOf ?? active.url;
  const owner = dashboardRoute(ownerUrl);
  const tabs = tabsOf(ownerUrl);
  if (!owner || tabs.length === 0) {
    return undefined;
  }
  return { owner, tabs, active };
}

/**
 * `document.title` for a tab: "Agents · Teams & agents"; the owner's own tab is just the page.
 * @param url
 */
export function combinedPageTitle(url: string): string | undefined {
  const page = combinedPage(url);
  if (!page) {
    return undefined;
  }
  return page.active.tabOf ? `${page.active.title} · ${page.owner.title}` : page.owner.title;
}
