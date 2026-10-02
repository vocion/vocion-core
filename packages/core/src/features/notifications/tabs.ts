import type { PageTab } from '@/features/dashboard/manage/PageTabs';

/** The notifications pages' two tabs: the list and the settings. */
export const NOTIFICATION_TABS: PageTab[] = [
  { url: '/dashboard/notifications', label: 'All notifications' },
  { url: '/dashboard/notifications/settings', label: 'Settings' },
];
