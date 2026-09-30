'use client';

import type { ClientNotification } from './notificationClient';
import { Bell, BellDot } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Column, ListEmpty, ListRow, ListRows, ListSkeleton, ListToolbar, Subline } from '@/components/patterns';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { useRouter } from '@/libs/I18nNavigation';
import { ageLabel } from '@/libs/timeAgo';
import { deliveryLine, fetchNotifications, markNotificationsRead, NOTIFICATIONS_CHANGED } from './notificationClient';

const TABS = [{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread' }] as const;

/**
 * The notifications page's rows (List archetype). A row opens its record and
 * marks itself read; ⌘-click still opens it in a new tab.
 */
export function NotificationList() {
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [items, setItems] = useState<ClientNotification[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const apply = useCallback((page: Awaited<ReturnType<typeof fetchNotifications>>, append: boolean) => {
    setItems(list => (append && list ? [...list, ...page.items] : page.items));
    setUnread(page.unread);
    setNextBefore(page.nextBefore);
    setNow(Date.now());
    setError(null);
  }, []);

  useEffect(() => {
    let live = true;
    const read = () => fetchNotifications({ limit: 50, unread: tab === 'unread' })
      .then(page => live && apply(page, false))
      .catch((err: Error) => live && setError(err.message));
    void read();
    window.addEventListener(NOTIFICATIONS_CHANGED, read);
    return () => {
      live = false;
      window.removeEventListener(NOTIFICATIONS_CHANGED, read);
    };
  }, [tab, apply]);

  const older = async (before: number) => {
    await fetchNotifications({ limit: 50, unread: tab === 'unread', before })
      .then(page => apply(page, true))
      .catch((err: Error) => toast.error('Could not load older notifications', { description: err.message }));
  };

  const open = async (n: ClientNotification) => {
    if (!n.read) {
      await markNotificationsRead([n.id]).catch(() => {});
    }
    if (n.link) {
      router.push(n.link);
    }
  };

  const markAll = async () => {
    await markNotificationsRead('all').catch((err: Error) => toast.error('Could not mark them read', { description: err.message }));
  };

  if (items === null && !error) {
    return <ListSkeleton />;
  }
  return (
    <>
      <ListToolbar
        tabs={{ items: TABS.map(t => ({ ...t, ...(t.key === 'unread' ? { count: unread } : {}) })), value: tab, onChange: key => setTab(key === 'unread' ? 'unread' : 'all'), label: 'Notifications' }}
        trailing={unread > 0 ? <Button variant="ghost" size="sm" onClick={() => void markAll()}>Mark all read</Button> : undefined}
      />
      {error && <ListEmpty variant="inline" title="Could not load notifications" description={error} />}
      {!error && items?.length === 0 && (
        tab === 'unread'
          ? <ListEmpty variant="inline" title="Nothing unread." />
          : <ListEmpty icon={Bell} title="No notifications yet" description="Only the moments this workspace declares notify — a plugin's, or your workspace's own. Choose where you hear them in Settings." action={{ label: 'Notification settings', href: '/dashboard/notifications/settings' }} />
      )}
      {!error && items && items.length > 0 && (
        <ListRows>
          {items.map((n) => {
            const delivery = deliveryLine(n.deliveries);
            return (
              <ListRow
                key={n.id}
                data-testid="notification-row"
                href={n.link ?? undefined}
                onSelect={() => void open(n)}
                onClick={n.link ? undefined : () => void open(n)}
                icon={n.read ? Bell : BellDot}
                title={<span className={n.read ? 'font-normal text-muted-foreground' : undefined}>{n.title}</span>}
                subline={<Subline separator="·" segments={[n.body, delivery]} />}
                columns={(
                  <>
                    <Column kind="status" align="left">{n.kindLabel}</Column>
                    <Column kind="date" always>{ageLabel(new Date(n.createdAt), now)}</Column>
                  </>
                )}
              />
            );
          })}
        </ListRows>
      )}
      {nextBefore !== null && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void older(nextBefore)}>Older</Button>
        </div>
      )}
    </>
  );
}
