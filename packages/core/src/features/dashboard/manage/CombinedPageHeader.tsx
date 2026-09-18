import type { DashboardLayoutKey } from '@/features/navigation/dashboardNav';
import { useTranslations } from 'next-intl';
import { PageTabs } from '@/features/dashboard/manage/PageTabs';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { combinedPage } from '@/features/navigation/combinedPages';

/**
 * The title bar of a combined MANAGE page: the page's registry title, the
 * active tab's one-line description, and the tab strip. Every tab is a route
 * in `dashboardNav.ts` (`tabOf` names the owner), so the page, the sidebar,
 * the palette and the breadcrumb agree on what the tabs are and what they are
 * called. RSC-safe: `useTranslations` works in a sync server component.
 * @param props
 * @param props.active - URL of the tab being rendered.
 * @param props.description - That tab's one-line description.
 * @param props.actions - Optional page-level controls (see `TitleBar`).
 */
export function CombinedPageHeader({ active, description, actions }: {
  active: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const t = useTranslations('DashboardLayout');
  const page = combinedPage(active);
  if (!page) {
    return <TitleBar title={active} description={description} actions={actions} />;
  }
  const say = (key: DashboardLayoutKey | undefined, fallback: string) => (key ? t(key) : fallback);
  return (
    <TitleBar
      title={say(page.owner.i18nKey, page.owner.title)}
      description={description}
      actions={actions}
      tabs={(
        <PageTabs
          active={active}
          tabs={page.tabs.map(tab => ({
            url: tab.url,
            icon: tab.icon,
            label: tab.tabOf ? say(tab.i18nKey, tab.title) : say(tab.tabI18nKey, tab.tabTitle ?? tab.title),
          }))}
        />
      )}
    />
  );
}
