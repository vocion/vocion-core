import { setRequestLocale } from 'next-intl/server';
import { PageTabs } from '@/features/dashboard/manage/PageTabs';
import { TitleBar } from '@/features/dashboard/TitleBar';
import { NotificationSettings } from '@/features/notifications/NotificationSettings';
import { NOTIFICATION_TABS } from '@/features/notifications/tabs';

/**
 * Notification settings — yours, in this workspace (backlog 048): each kind
 * the workspace declares × each channel, quiet hours, Slack's target and your
 * devices. The same settings as `/api/v1/notifications/preferences` and MCP.
 * @param props - Route props.
 * @param props.params - `{ locale }`.
 */
export default async function NotificationSettingsPage(props: { params: Promise<{ locale: string }> }) {
  const { locale } = await props.params;
  setRequestLocale(locale);
  return (
    <>
      <TitleBar
        title="Notification settings"
        description="Where you hear about the moments this workspace declares."
        tabs={<PageTabs tabs={NOTIFICATION_TABS} active="/dashboard/notifications/settings" />}
      />
      <NotificationSettings />
    </>
  );
}
