import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Pinned objects against PGlite: a pin lands in the person's own
 * `user_nav_pref` row for one workspace, is read back with its live title,
 * disappears when its target is deleted or out of the person's reach, and
 * never shows in another workspace or for another person.
 */
vi.mock('@/libs/DB');
// A record opens on the page its type declares; the workspace's manifests are not under test here.
vi.mock('@/services/DataRoomService', () => ({ DATA_ROOM_TYPE: 'data_room', roomHref: (id: number) => `/dashboard/rooms/${id}` }));
vi.mock('@/services/objects/recordHref', () => ({ recordHref: async (_org: string, ref: { id: number }) => `/dashboard/p/deal/${ref.id}` }));

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema, conversationSchema, userNavPrefSchema } = await import('@/models/Schema');
const { getNavPrefs, setNavPins } = await import('@/services/NavPrefService');
const { PinError, pinObject, resolvePins, unpinKey } = await import('./PinService');
const { pinKey } = await import('@/libs/pins/pinTarget');
const { eq } = await import('drizzle-orm');

const NORTHWIND = 'org_pins_northwind';
const KESTREL = 'org_pins_kestrel';
const PAT = { orgId: NORTHWIND, userId: 'usr_pins_pat' };

async function clean() {
  await db.delete(userNavPrefSchema);
  for (const org of [NORTHWIND, KESTREL]) {
    await db.delete(artifactSchema).where(eq(artifactSchema.orgId, org));
    await db.delete(conversationSchema).where(eq(conversationSchema.orgId, org));
    await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, org));
  }
}

beforeEach(clean);

afterAll(clean);

async function conversation(orgId: string, title: string) {
  const [row] = await db.insert(conversationSchema).values({ orgId, agentSlug: 'assistant', title }).returning({ id: conversationSchema.id });
  return row!.id;
}

async function artifact(orgId: string, title: string, share: { audience?: 'me' | 'workspace'; ownerId?: string } = {}) {
  const [row] = await db.insert(artifactSchema).values({ orgId, kind: 'markdown', title, shareAudience: share.audience ?? 'workspace', shareOwnerId: share.ownerId ?? null }).returning({ id: artifactSchema.id });
  return row!.id;
}

async function record(orgId: string, typeSlug: string, title: string) {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId, slug: typeSlug, label: typeSlug }).returning({ id: businessObjectTypeSchema.id });
  const [row] = await db.insert(businessObjectSchema).values({ orgId, typeId: type!.id, title }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

describe('PinService', () => {
  it('pins a conversation and reads it back live, in pin order after section pins', async () => {
    await setNavPins({ ...PAT, pins: ['/dashboard/teams'] });
    const id = await conversation(NORTHWIND, 'Northwind renewal plan');

    const res = await pinObject(PAT, { kind: 'conversation', id: String(id) });

    expect(res.changed).toBe(true);
    expect(res.pin).toMatchObject({ kind: 'conversation', title: 'Northwind renewal plan', href: `/dashboard/chat/${id}` });
    expect((await getNavPrefs(PAT)).pins).toEqual(['/dashboard/teams', `pin:conversation:${id}`]);

    // Renamed: the pin says the new name, because it stores no title.
    await db.update(conversationSchema).set({ title: 'Northwind renewal, signed' }).where(eq(conversationSchema.id, id));

    expect((await resolvePins(PAT, (await getNavPrefs(PAT)).pins)).map(p => p.title)).toEqual(['Northwind renewal, signed']);
  });

  it('pinning twice changes nothing; unpin takes it out', async () => {
    const id = await artifact(NORTHWIND, 'Q3 pipeline table');
    await pinObject(PAT, { kind: 'artifact', id: String(id) });
    const again = await pinObject(PAT, { kind: 'artifact', id: String(id) });

    expect(again.changed).toBe(false);
    expect(again.pins).toEqual([`pin:artifact:${id}`]);

    const out = await unpinKey(PAT, `pin:artifact:${id}`);

    expect(out).toEqual({ pins: [], changed: true });
    expect((await unpinKey(PAT, `pin:artifact:${id}`)).changed).toBe(false);
  });

  it('a deleted target disappears quietly from the sidebar', async () => {
    const keep = await conversation(NORTHWIND, 'Kickoff');
    const gone = await artifact(NORTHWIND, 'Draft that will be deleted');
    await pinObject(PAT, { kind: 'conversation', id: String(keep) });
    await pinObject(PAT, { kind: 'artifact', id: String(gone) });

    await db.delete(artifactSchema).where(eq(artifactSchema.id, gone));
    const { pins } = await getNavPrefs(PAT);

    expect(pins).toHaveLength(2);
    expect((await resolvePins(PAT, pins)).map(p => p.title)).toEqual(['Kickoff']);
  });

  it('a target the person can no longer open disappears, and comes back with access', async () => {
    const id = await artifact(NORTHWIND, 'Board memo');
    await pinObject(PAT, { kind: 'artifact', id: String(id) });
    // Its owner makes it "Only me".
    await db.update(artifactSchema).set({ shareAudience: 'me', shareOwnerId: 'usr_pins_owner' }).where(eq(artifactSchema.id, id));
    const { pins } = await getNavPrefs(PAT);

    expect(await resolvePins(PAT, pins)).toEqual([]);

    await db.update(artifactSchema).set({ shareAudience: 'workspace', shareOwnerId: null }).where(eq(artifactSchema.id, id));

    expect((await resolvePins(PAT, pins)).map(p => p.title)).toEqual(['Board memo']);
  });

  it('refuses to pin what this workspace does not hold, with a sentence', async () => {
    const elsewhere = await conversation(KESTREL, 'Kestrel only');

    await expect(pinObject(PAT, { kind: 'conversation', id: String(elsewhere) })).rejects.toBeInstanceOf(PinError);
    await expect(pinObject(PAT, { kind: 'conversation', id: '999999' })).rejects.toThrow(/cannot be pinned here/);
  });

  it('scopes pins per workspace and per person: Personal keeps its own', async () => {
    const here = await record(NORTHWIND, 'deal', 'Northwind expansion');
    const there = await record(KESTREL, 'deal', 'Kestrel pilot');
    await pinObject(PAT, { kind: 'record', id: String(here) });
    await pinObject({ orgId: KESTREL, userId: PAT.userId }, { kind: 'record', id: String(there) });

    expect((await resolvePins(PAT, (await getNavPrefs(PAT)).pins)).map(p => p.title)).toEqual(['Northwind expansion']);
    expect((await getNavPrefs({ orgId: KESTREL, userId: PAT.userId })).pins).toEqual([pinKey({ kind: 'record', id: String(there) })]);
    expect((await getNavPrefs({ orgId: NORTHWIND, userId: 'usr_pins_sam' })).pins).toEqual([]);
  });

  it('a room pin reads only a data room; a record pin opens its page', async () => {
    const room = await record(NORTHWIND, 'data_room', 'Larkfield diligence');
    const deal = await record(NORTHWIND, 'deal_x', 'Contoso supply deal');
    const pins = [pinKey({ kind: 'room', id: String(room) }), pinKey({ kind: 'room', id: String(deal) }), pinKey({ kind: 'record', id: String(deal) })];

    const resolved = await resolvePins(PAT, pins);

    expect(resolved.map(p => [p.kind, p.title])).toEqual([['room', 'Larkfield diligence'], ['record', 'Contoso supply deal']]);
    expect(resolved[0]!.href).toBe(`/dashboard/rooms/${room}`);
    expect(resolved[1]!.href).toContain(String(deal));
  });
});
