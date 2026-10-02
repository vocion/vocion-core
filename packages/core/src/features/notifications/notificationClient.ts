'use client';

/**
 * The browser's calls for notifications — the same `/api/v1` endpoints an
 * integrator and the iOS app use, so the bell, the pages and the API are one
 * path (principle 6).
 */

export type ClientDelivery = { channel: string; channelLabel: string; status: string; detail: string | null; attempts: number; sentAt: string | null };

export type ClientNotification = {
  id: number;
  kind: string;
  kindLabel: string;
  title: string;
  body: string | null;
  link: string | null;
  record: { type: string; id: string } | null;
  read: boolean;
  createdAt: string;
  deliveries: ClientDelivery[];
};

export type ClientPage = { items: ClientNotification[]; unread: number; nextBefore: number | null };

/** Said once, anywhere a notification is read, so every bell on the page moves. */
export const NOTIFICATIONS_CHANGED = 'vocion:notifications-changed';

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export async function fetchUnreadCount(): Promise<number> {
  const out = await json<{ unread: number }>(await fetch('/api/v1/notifications/unread-count', { cache: 'no-store' }));
  return out.unread;
}

export async function fetchNotifications(opts: { limit?: number; unread?: boolean; before?: number } = {}): Promise<ClientPage> {
  const q = new URLSearchParams();
  if (opts.limit) {
    q.set('limit', String(opts.limit));
  }
  if (opts.unread) {
    q.set('unread', '1');
  }
  if (opts.before) {
    q.set('before', String(opts.before));
  }
  return json<ClientPage>(await fetch(`/api/v1/notifications?${q}`, { cache: 'no-store' }));
}

export async function markNotificationsRead(ids: number[] | 'all'): Promise<number> {
  const out = await json<{ marked: number }>(await fetch('/api/v1/notifications/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ids === 'all' ? { all: true } : { ids }),
  }));
  announceNotificationsChanged();
  return out.marked;
}

/**
 * The one line that says a channel did not deliver, and why — a failed or
 * skipped delivery is said where the notification is read, never silent.
 * Pending retries say so too. Delivered channels say nothing.
 * @param deliveries - The notification's channels.
 */
export function deliveryLine(deliveries: readonly ClientDelivery[]): string | null {
  const said = deliveries
    .filter(d => d.channel !== 'in_app' && d.status !== 'sent')
    .map(d => `${d.channelLabel} ${d.status === 'pending' ? (d.detail ? `retrying — ${d.detail}` : 'on its way') : `${d.status}${d.detail ? ` — ${d.detail}` : ''}`}`);
  return said.length > 0 ? said.join(' · ') : null;
}
