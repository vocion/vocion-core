import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The per-viewer "since you last looked" stamp, against PGlite.
 *
 * Three properties the Factory page depends on, and each is a way the digest
 * could quietly lie if it broke:
 *
 *  - a person who has never opened the page reads null, so the panel can say
 *    the window is a fallback rather than pretend it is their own memory;
 *  - recording a visit returns the stamp from BEFORE it, so a reload does not
 *    empty the digest it just drew;
 *  - two people in one org, and one person across two pages, never read each
 *    other's stamp.
 */
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userNavPrefSchema } = await import('@/models/Schema');
const { dismissNavPrompt, getNavPrefs, getPageLastSeen, markPageSeen, setNavPins } = await import('@/services/NavPrefService');

const ORG = 'org_page_seen_test';
const T1 = new Date('2026-09-20T09:00:00.000Z');
const T2 = new Date('2026-09-21T09:00:00.000Z');

beforeEach(async () => {
  await db.delete(userNavPrefSchema);
});

afterAll(async () => {
  await db.delete(userNavPrefSchema);
});

describe('page last-seen', () => {
  it('reads null for a person who has never opened the page', async () => {
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toBeNull();

    await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'factory', at: T1 });

    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'other' })).toBeNull();
  });

  it('records the visit and hands back the stamp from before it', async () => {
    expect(await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'factory', at: T1 })).toBeNull();
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toEqual(T1);

    // The second visit still measures from the first, so a reload does not
    // empty the digest it drew a second ago.
    expect(await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'factory', at: T2 })).toEqual(T1);
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toEqual(T2);
  });

  it('keeps one page\'s stamp out of another\'s, and one person\'s out of another\'s', async () => {
    await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'factory', at: T1 });
    await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'performance', at: T2 });
    await markPageSeen({ orgId: ORG, userId: 'u2', slug: 'factory', at: T2 });

    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toEqual(T1);
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'performance' })).toEqual(T2);
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u2', slug: 'factory' })).toEqual(T2);
    expect(await getPageLastSeen({ orgId: 'other_org', userId: 'u1', slug: 'factory' })).toBeNull();
  });

  it('shares the row with the pins and dismissals without clobbering either', async () => {
    await setNavPins({ orgId: ORG, userId: 'u1', pins: ['/dashboard/p/factory'] });
    await dismissNavPrompt({ orgId: ORG, userId: 'u1', id: 'invite-card' });
    await markPageSeen({ orgId: ORG, userId: 'u1', slug: 'factory', at: T1 });

    expect(await getNavPrefs({ orgId: ORG, userId: 'u1' })).toEqual({ pins: ['/dashboard/p/factory'], dismissed: ['invite-card'] });
    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toEqual(T1);

    await setNavPins({ orgId: ORG, userId: 'u1', pins: ['/dashboard/teams'] });

    expect(await getPageLastSeen({ orgId: ORG, userId: 'u1', slug: 'factory' })).toEqual(T1);
  });
});
