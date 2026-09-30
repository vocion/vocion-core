/**
 * The device and notification endpoints (backlog 048): what the iOS app and
 * the bell call. A session names its person; a token names whoever minted it;
 * a token nobody minted is refused with why. Every token here is invented.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/ApiTokenService', () => ({ authenticateBearer: vi.fn() }));
vi.mock('@/libs/Auth', () => ({ clerkAuth: vi.fn() }));

const { db } = await import('@/libs/DB');
const { eq } = await import('drizzle-orm');
const { apiTokenSchema, notificationSchema, pushSubscriptionSchema, userSchema } = await import('@/models/Schema');
const { authenticateBearer } = await import('@/services/ApiTokenService');
const { clerkAuth } = await import('@/libs/Auth');
const devices = await import('./route');
const device = await import('./[id]/route');
const list = await import('../../notifications/route');
const read = await import('../../notifications/read/route');
const prefs = await import('../../notifications/preferences/route');

const ORG = 'org_push_route';
const JO = 'usr-push-jo';
const KAI = 'usr-push-kai';
const IOS_TOKEN = 'ef'.repeat(32);

const mockSession = vi.mocked(clerkAuth);
const mockBearer = vi.mocked(authenticateBearer);

function as(userId: string | null) {
  mockSession.mockResolvedValue({ userId, orgId: userId ? ORG : null, role: 'member', workspaceRole: 'member', has: () => false } as never);
}

const req = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request(`https://vocion.test${path}`, {
  method,
  headers: { 'content-type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

beforeEach(async () => {
  vi.clearAllMocks();
  await db.delete(pushSubscriptionSchema);
  await db.delete(notificationSchema);
  await db.delete(apiTokenSchema).where(eq(apiTokenSchema.orgId, ORG));
  await db.delete(userSchema).where(eq(userSchema.id, JO));
  await db.delete(userSchema).where(eq(userSchema.id, KAI));
  await db.insert(userSchema).values([{ id: JO, email: 'jo@kestrel.example' }, { id: KAI, email: 'kai@kestrel.example' }]);
});

describe('POST /api/v1/push/devices', () => {
  it('registers the app\'s APNs token for the signed-in person, and refreshes it on a repeat', async () => {
    as(JO);
    const res = await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'ios', token: IOS_TOKEN.toUpperCase(), bundleId: 'app.example.vocion', environment: 'production', label: 'Jo\'s iPhone' }));

    expect(res.status).toBe(201);

    const body = await res.json() as { device: { id: number; platform: string; label: string } };

    expect(body.device).toMatchObject({ platform: 'ios', label: 'Jo\'s iPhone', environment: 'production' });

    await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'ios', token: IOS_TOKEN, environment: 'production' }));
    const rows = await db.select().from(pushSubscriptionSchema);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: JO, token: IOS_TOKEN });
  });

  it('refuses what is not a device, saying what it wanted', async () => {
    as(JO);
    const bad = await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'ios', token: 'not-hex' }));

    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { message: string } }).error.message).toMatch(/APNs device token/);
    expect((await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'web', endpoint: 'http://insecure.example', keys: { p256dh: 'p', auth: 'a' } }))).status).toBe(400);
    expect((await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'fax' }))).status).toBe(400);
  });

  it('a token names the person who minted it; a token nobody minted is refused', async () => {
    as(null);
    await db.insert(apiTokenSchema).values([{ id: 'tokjo', orgId: ORG, name: 'jo', platform: 'vocion', secretHash: 'hash-jo', createdBy: JO }, { id: 'toksys', orgId: ORG, name: 'system', platform: 'vocion', secretHash: 'hash-sys', createdBy: null }] as never);
    mockBearer.mockResolvedValue({ orgId: ORG, tokenId: 'tokjo', principal: { kind: 'user', id: 'token:tokjo', role: 'member', scope: { orgId: ORG } } } as never);
    const ok = await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'ios', token: IOS_TOKEN }, { authorization: 'Bearer vcn_live_tokjo_x' }));

    expect(ok.status).toBe(201);

    mockBearer.mockResolvedValue({ orgId: ORG, tokenId: 'toksys', principal: { kind: 'user', id: 'token:toksys', role: 'member', scope: { orgId: ORG } } } as never);
    const refused = await devices.GET(req('/api/v1/push/devices', 'GET', undefined, { authorization: 'Bearer vcn_live_toksys_x' }));

    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { error: { message: string } }).error.message).toMatch(/belong to a person/);
  });
});

describe('devices: list and remove', () => {
  it('lists only this person\'s devices; another person\'s device is a 404', async () => {
    const [kais] = await db.insert(pushSubscriptionSchema).values({ userId: KAI, platform: 'web', token: 'https://push.example.com/kai', keys: { p256dh: 'p', auth: 'a' } }).returning();
    as(JO);
    await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'web', endpoint: 'https://push.example.com/jo', keys: { p256dh: 'p', auth: 'a' }, label: 'Chrome on macOS' }));
    const listed = await (await devices.GET(req('/api/v1/push/devices'))).json() as { devices: Array<{ id: number; label: string }> };

    expect(listed.devices.map(d => d.label)).toEqual(['Chrome on macOS']);
    expect((await device.DELETE(req(`/api/v1/push/devices/${kais!.id}`, 'DELETE'), { params: Promise.resolve({ id: String(kais!.id) }) })).status).toBe(404);
    expect((await device.DELETE(req(`/api/v1/push/devices/${listed.devices[0]!.id}`, 'DELETE'), { params: Promise.resolve({ id: String(listed.devices[0]!.id) }) })).status).toBe(200);

    // By endpoint, as the bell's "stop notifying this browser" does.
    await devices.POST(req('/api/v1/push/devices', 'POST', { platform: 'web', endpoint: 'https://push.example.com/jo2', keys: { p256dh: 'p', auth: 'a' } }));

    expect(await (await devices.DELETE(req('/api/v1/push/devices', 'DELETE', { endpoint: 'https://push.example.com/jo2' }))).json()).toEqual({ removed: true });
    expect(await db.select().from(pushSubscriptionSchema)).toHaveLength(1);
  });
});

describe('notifications: list, mark read, preferences', () => {
  it('lists the person\'s own, marks read, and moves one setting at a time', async () => {
    await db.insert(notificationSchema).values([
      { orgId: ORG, userId: JO, kind: 'released', title: 'Released: Dark mode is live', dedupeKey: 'released:release:1' },
      { orgId: ORG, userId: KAI, kind: 'released', title: 'Kai\'s', dedupeKey: 'released:release:1' },
    ]);
    as(JO);
    const page = await (await list.GET(req('/api/v1/notifications?unread=1'))).json() as { items: Array<{ id: number; title: string }>; unread: number };

    expect(page.items.map(i => i.title)).toEqual(['Released: Dark mode is live']);
    expect(page.unread).toBe(1);
    expect(await (await read.POST(req('/api/v1/notifications/read', 'POST', { ids: [page.items[0]!.id] }))).json()).toEqual({ marked: 1 });
    expect((await read.POST(req('/api/v1/notifications/read', 'POST', { ids: 'all' }))).status).toBe(400);

    const put = await prefs.PUT(req('/api/v1/notifications/preferences', 'PUT', { channels: { released: { email: true } } }));

    expect(put.status).toBe(200);

    const after = await put.json() as { preferences: { channels: Record<string, Record<string, boolean>> }; channels: Array<{ id: string; default: boolean }> };

    expect(after.preferences.channels).toEqual({ released: { email: true } });
    expect(after.channels.map(c => [c.id, c.default])).toEqual([['in_app', true], ['ios', true], ['web', true], ['email', false], ['slack', false]]);
    expect((await prefs.PUT(req('/api/v1/notifications/preferences', 'PUT', { quietHours: { start: 'late', end: 'early', timeZone: 'UTC' } }))).status).toBe(400);
  });
});
