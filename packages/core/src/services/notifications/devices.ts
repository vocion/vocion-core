import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { pushSubscriptionSchema } from '@/models/Schema';

/**
 * A person's registered devices (backlog 048): browsers that subscribed to
 * Web Push from the bell, and iPhones whose app registered an APNs token.
 */

export type DevicePlatform = 'web' | 'ios';

export type DeviceView = {
  id: number;
  platform: DevicePlatform;
  label: string | null;
  environment: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastError: string | null;
};

export class DeviceError extends Error {}

export type RegisterDevice
  = | { platform: 'web'; endpoint: string; keys: { p256dh: string; auth: string }; label?: string | null }
    | { platform: 'ios'; token: string; bundleId?: string | null; environment?: 'sandbox' | 'production' | null; label?: string | null };

const APNS_TOKEN = /^[0-9a-f]{32,200}$/i;

/**
 * Read an untrusted registration (the app's POST, the bell's subscribe).
 * @param raw - The body.
 */
export function parseRegistration(raw: unknown): RegisterDevice {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const label = typeof b.label === 'string' ? b.label.trim().slice(0, 80) || null : null;
  if (b.platform === 'web') {
    const endpoint = typeof b.endpoint === 'string' ? b.endpoint.trim() : '';
    const keys = (b.keys && typeof b.keys === 'object' ? b.keys : {}) as Record<string, unknown>;
    if (!/^https:\/\//.test(endpoint)) {
      throw new DeviceError('endpoint must be the https URL from the browser\'s PushSubscription');
    }
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string' || !keys.p256dh || !keys.auth) {
      throw new DeviceError('keys must carry p256dh and auth from the browser\'s PushSubscription');
    }
    return { platform: 'web', endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, label };
  }
  if (b.platform === 'ios') {
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (!APNS_TOKEN.test(token)) {
      throw new DeviceError('token must be the APNs device token, as hex');
    }
    const environment = b.environment === undefined || b.environment === null ? 'production' : b.environment;
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new DeviceError('environment must be sandbox (a build run from Xcode) or production (TestFlight, App Store)');
    }
    const bundleId = typeof b.bundleId === 'string' && b.bundleId.trim() ? b.bundleId.trim() : null;
    return { platform: 'ios', token: token.toLowerCase(), bundleId, environment, label };
  }
  throw new DeviceError('platform must be web or ios');
}

function view(r: typeof pushSubscriptionSchema.$inferSelect): DeviceView {
  return { id: r.id, platform: r.platform as DevicePlatform, label: r.label, environment: r.environment, createdAt: r.createdAt.toISOString(), lastSeenAt: r.lastSeenAt.toISOString(), lastError: r.lastError };
}

/**
 * Register (or refresh) a device for a person. The same token registered
 * again moves to whoever registered it last — a phone signed into another
 * account is that account's phone now.
 * @param userId - The person.
 * @param device - The registration.
 */
export async function registerDevice(userId: string, device: RegisterDevice): Promise<DeviceView> {
  const token = device.platform === 'web' ? device.endpoint : device.token;
  const values = {
    userId,
    platform: device.platform,
    token,
    keys: device.platform === 'web' ? device.keys : null,
    bundleId: device.platform === 'ios' ? device.bundleId ?? null : null,
    environment: device.platform === 'ios' ? device.environment ?? 'production' : null,
    label: device.label ?? null,
    lastError: null,
    lastSeenAt: new Date(),
  };
  const [row] = await db
    .insert(pushSubscriptionSchema)
    .values(values)
    .onConflictDoUpdate({ target: [pushSubscriptionSchema.platform, pushSubscriptionSchema.token], set: values })
    .returning();
  return view(row!);
}

/**
 * This person's devices, newest first.
 * @param userId - The person.
 */
export async function listDevices(userId: string): Promise<DeviceView[]> {
  const rows = await db.select().from(pushSubscriptionSchema).where(eq(pushSubscriptionSchema.userId, userId)).orderBy(desc(pushSubscriptionSchema.lastSeenAt));
  return rows.map(view);
}

/**
 * Remove one of this person's devices. Another person's device id is "not
 * found", never "forbidden".
 * @param userId - The person.
 * @param id - The device.
 */
export async function removeDevice(userId: string, id: number): Promise<boolean> {
  const rows = await db.delete(pushSubscriptionSchema).where(and(eq(pushSubscriptionSchema.id, id), eq(pushSubscriptionSchema.userId, userId))).returning({ id: pushSubscriptionSchema.id });
  return rows.length > 0;
}

/**
 * Remove a browser's subscription by its endpoint — the bell's "stop
 * notifying this device", which knows the endpoint and not the row id.
 * @param userId - The person.
 * @param endpoint - The subscription's endpoint.
 */
export async function removeWebEndpoint(userId: string, endpoint: string): Promise<boolean> {
  const rows = await db.delete(pushSubscriptionSchema).where(and(eq(pushSubscriptionSchema.platform, 'web'), eq(pushSubscriptionSchema.token, endpoint), eq(pushSubscriptionSchema.userId, userId))).returning({ id: pushSubscriptionSchema.id });
  return rows.length > 0;
}
