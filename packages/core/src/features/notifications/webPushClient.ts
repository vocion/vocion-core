'use client';

/**
 * CHROME NOTIFICATIONS, THE BROWSER HALF (backlog 048). The permission is
 * asked only when a person presses "Get notified on this device" in the bell
 * or on the settings page — never on page load, which is how a site earns a
 * permanent "Block". The service worker (`/notifications-sw.js`) shows each
 * push and opens its link on click.
 */

const SW_URL = '/notifications-sw.js';

export type DevicePushState = 'unsupported' | 'not-configured' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function publicKey(): Promise<string | null> {
  const res = await fetch('/api/v1/push/config', { cache: 'no-store' });
  if (!res.ok) {
    return null;
  }
  return ((await res.json()) as { webPushPublicKey: string | null }).webPushPublicKey;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = `${base64url}${'='.repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration(SW_URL);
  return existing ?? navigator.serviceWorker.register(SW_URL, { scope: '/' });
}

/** Where this browser stands, without asking anything. */
export async function devicePushState(): Promise<DevicePushState> {
  if (!pushSupported()) {
    return 'unsupported';
  }
  if (Notification.permission === 'denied') {
    return 'denied';
  }
  const key = await publicKey().catch(() => null);
  if (!key) {
    return 'not-configured';
  }
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

function browserLabel(): string {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

/**
 * Ask for permission (the person pressed the button), subscribe, and register
 * the subscription with the workspace.
 * @returns The state afterwards, and a sentence when it did not turn on.
 */
export async function turnOnDevicePush(): Promise<{ state: DevicePushState; reason?: string }> {
  if (!pushSupported()) {
    return { state: 'unsupported', reason: 'This browser cannot show notifications.' };
  }
  const key = await publicKey();
  if (!key) {
    return { state: 'not-configured', reason: 'Chrome notifications are not set up on this server yet.' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { state: permission === 'denied' ? 'denied' : 'off', reason: permission === 'denied' ? 'Notifications are blocked for this site — allow them in the browser\'s site settings.' : 'Permission was not given.' };
  }
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  const res = await fetch('/api/v1/push/devices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ platform: 'web', endpoint: json.endpoint, keys: json.keys, label: browserLabel() }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    return { state: 'off', reason: body?.error?.message ?? 'The workspace did not accept this device.' };
  }
  return { state: 'on' };
}

/** Stop notifying this browser: unsubscribe and remove it from the workspace. */
export async function turnOffDevicePush(): Promise<DevicePushState> {
  if (!pushSupported()) {
    return 'unsupported';
  }
  const reg = await navigator.serviceWorker.getRegistration(SW_URL);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await fetch('/api/v1/push/devices', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => false);
  }
  return 'off';
}
