'use client';

import type { ClientNotification } from './notificationClient';
import type { DevicePushState } from './webPushClient';
import { Bell, BellRing, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Link, useRouter } from '@/libs/I18nNavigation';
import { timeAgo } from '@/libs/timeAgo';
import { cn } from '@/utils/Helpers';
import { fetchNotifications, markNotificationsRead } from './notificationClient';
import { useUnreadNotifications } from './useUnreadNotifications';
import { devicePushState, turnOnDevicePush } from './webPushClient';

/**
 * THE BELL (backlog 048) — in the shell's top bar on every page, desktop and
 * phone. The badge is the unread count; the panel is the latest few, each
 * opening its record and marking itself read; "Mark all read"; the full list
 * and the settings one tap away; and, when this browser could be notified
 * and is not, the one place the browser's permission is asked for.
 * @param props - Props.
 * @param props.label - The bar's translated "Notifications".
 */
export function NotificationBell({ label }: { label: string }) {
  const { unread, refresh } = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ClientNotification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<DevicePushState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const router = useRouter();

  useEffect(() => {
    if (!open) {
      return;
    }
    let live = true;
    fetchNotifications({ limit: 8 })
      .then((page) => {
        if (live) {
          setItems(page.items);
          setNow(Date.now());
          setError(null);
        }
      })
      .catch((err: Error) => live && setError(err.message));
    devicePushState().then(s => live && setDevice(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [open]);

  const openOne = async (n: ClientNotification) => {
    setOpen(false);
    if (!n.read) {
      await markNotificationsRead([n.id]).catch(() => {});
    }
    if (n.link) {
      router.push(n.link);
    }
  };

  const markAll = async () => {
    await markNotificationsRead('all').catch((err: Error) => toast.error('Could not mark them read', { description: err.message }));
    setItems(list => list?.map(n => ({ ...n, read: true })) ?? list);
    refresh();
  };

  const turnOn = async () => {
    const out = await turnOnDevicePush().catch((err: Error) => ({ state: 'off' as const, reason: err.message }));
    setDevice(out.state);
    if (out.state === 'on') {
      toast.success('This device will be notified');
    } else if (out.reason) {
      toast.error('Notifications are not on for this device', { description: out.reason });
    }
  };

  const count = unread ?? 0;
  const badge = count > 99 ? '99+' : String(count);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={count > 0 ? `${label}: ${count} unread` : label}
              data-testid="notification-bell"
              className="relative flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground data-[state=open]:text-foreground sm:size-9"
            >
              <Bell className="size-4" aria-hidden />
              {count > 0 && (
                <span data-testid="notification-badge" className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-amber-deep px-1 text-[10px] leading-none font-semibold text-white tabular-nums sm:top-0.5 sm:right-0.5">
                  {badge}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-[min(22rem,calc(100vw-1rem))] p-0">
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <span className="text-sm font-medium">{label}</span>
          {count > 0 && (
            <button type="button" onClick={markAll} className="rounded-md px-2 py-1 text-[12px] text-muted-foreground hover:bg-surface-hover hover:text-foreground">
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {error && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">{`Could not load notifications: ${error}`}</p>}
          {!error && items === null && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Loading…</p>}
          {!error && items?.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No notifications yet.</p>}
          {!error && items && items.length > 0 && (
            <ul className="divide-y divide-border/70">
              {items.map(n => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openOne(n)} className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-hover" data-testid="notification-item">
                    <span aria-hidden className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-brand-amber-deep')} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-[13px]', n.read ? 'text-muted-foreground' : 'font-medium text-foreground')}>{n.title}</span>
                      {n.body && <span className="block truncate text-[12px] text-muted-foreground">{n.body}</span>}
                      <span className="block text-[11px] text-muted-foreground/80">{`${n.kindLabel} · ${timeAgo(new Date(n.createdAt), now)}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {device === 'off' && (
          <button type="button" onClick={() => void turnOn()} className="flex w-full items-center gap-2 border-t border-border/70 px-3 py-2.5 text-left text-[13px] hover:bg-surface-hover" data-testid="notification-device-on">
            <BellRing className="size-4 text-brand-amber-deep" aria-hidden />
            Get notified on this device
          </button>
        )}
        <div className="flex items-center justify-between border-t border-border/70 px-3 py-2 text-[12px]">
          <Link href="/dashboard/notifications" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
            All notifications
          </Link>
          <Link href="/dashboard/notifications/settings" onClick={() => setOpen(false)} className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <Settings2 className="size-3.5" aria-hidden />
            Settings
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
