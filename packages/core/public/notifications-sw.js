/*
 * Vocion notifications service worker (backlog 048).
 *
 * Registered only when a person presses "Get notified on this device"
 * (`features/notifications/webPushClient.ts`). Shows each Web Push the server
 * sends (`libs/notifications/webPush.ts` writes { id, kind, title, body, url })
 * and, on click, focuses a tab already on that page, else moves an open
 * Vocion tab there, else opens one.
 */

globalThis.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Vocion';
  event.waitUntil(globalThis.registration.showNotification(title, {
    body: data.body || '',
    tag: data.id ? `vocion-notification-${data.id}` : undefined,
    icon: '/icon',
    badge: '/icon',
    data: { url: data.url || '/', id: data.id || null },
  }));
});

globalThis.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', globalThis.location.origin).href;
  event.waitUntil((async () => {
    const windows = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const exact = windows.find(w => w.url === target);
    if (exact) {
      return exact.focus();
    }
    const ours = windows.find(w => new URL(w.url).origin === globalThis.location.origin);
    if (ours) {
      await ours.focus();
      return ours.navigate(target);
    }
    return globalThis.clients.openWindow(target);
  })());
});
