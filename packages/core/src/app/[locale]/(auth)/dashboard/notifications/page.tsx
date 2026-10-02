import { setRequestLocale } from 'next-intl/server';
import { ListPage } from '@/components/patterns';
import { PageTabs } from '@/features/dashboard/manage/PageTabs';
import { NotificationList } from '@/features/notifications/NotificationList';
import { NOTIFICATION_TABS } from '@/features/notifications/tabs';

/**
 * Notifications — every notification this person has in this workspace, the
 * bell's full list (backlog 048). A row opens its record and marks itself
 * read; a channel that did not deliver says so on the row.
 * @param props - Route props.
 * @param props.params - `{ locale }`.
 */
export default async function NotificationsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return (
    <ListPage title="Notifications" description="Only the moments this workspace declares notify you. A row opens what it is about.">
      <div className="-mt-3 mb-4">
        <PageTabs tabs={NOTIFICATION_TABS} active="/dashboard/notifications" />
      </div>
      <NotificationList />
    </ListPage>
  );
}
