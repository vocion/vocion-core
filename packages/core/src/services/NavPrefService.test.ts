import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Per-user sidebar prefs against PGlite: pins are whole-list writes in pin
 * order, deduped and capped; dismissals accumulate without duplicates; two
 * people in one org never see each other's pins.
 */
vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { userNavPrefSchema } = await import('@/models/Schema');
const { dismissNavPrompt, getNavPrefs, setNavPins } = await import('@/services/NavPrefService');

const ORG = 'org_nav_test';

beforeEach(async () => {
  await db.delete(userNavPrefSchema);
});

afterAll(async () => {
  await db.delete(userNavPrefSchema);
});

describe('NavPrefService', () => {
  it('returns empty prefs for a person with no row', async () => {
    expect(await getNavPrefs({ orgId: ORG, userId: 'u1' })).toEqual({ pins: [], dismissed: [] });
  });

  it('stores pins in pin order, deduped, and reads them back per user', async () => {
    await setNavPins({ orgId: ORG, userId: 'u1', pins: ['/dashboard/p/deal-desk', '/dashboard/teams', '/dashboard/p/deal-desk', ' '] });
    await setNavPins({ orgId: ORG, userId: 'u2', pins: ['/dashboard/agents'] });

    expect((await getNavPrefs({ orgId: ORG, userId: 'u1' })).pins).toEqual(['/dashboard/p/deal-desk', '/dashboard/teams']);
    expect((await getNavPrefs({ orgId: ORG, userId: 'u2' })).pins).toEqual(['/dashboard/agents']);
  });

  it('replaces the list on the next write (unpin + reorder are whole-list writes)', async () => {
    await setNavPins({ orgId: ORG, userId: 'u1', pins: ['a', 'b', 'c'] });
    const after = await setNavPins({ orgId: ORG, userId: 'u1', pins: ['c', 'a'] });

    expect(after.pins).toEqual(['c', 'a']);
    expect((await getNavPrefs({ orgId: ORG, userId: 'u1' })).pins).toEqual(['c', 'a']);
  });

  it('remembers dismissed prompts without duplicating them and without touching pins', async () => {
    await setNavPins({ orgId: ORG, userId: 'u1', pins: ['/dashboard/teams'] });
    await dismissNavPrompt({ orgId: ORG, userId: 'u1', id: 'invite-card' });
    const prefs = await dismissNavPrompt({ orgId: ORG, userId: 'u1', id: 'invite-card' });

    expect(prefs.dismissed).toEqual(['invite-card']);
    expect(prefs.pins).toEqual(['/dashboard/teams']);
  });

  it('caps at 40 pins', async () => {
    const many = Array.from({ length: 45 }, (_, i) => `/p/${i}`);

    expect((await setNavPins({ orgId: ORG, userId: 'u1', pins: many })).pins).toHaveLength(40);
  });
});
