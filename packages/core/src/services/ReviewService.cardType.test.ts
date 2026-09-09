/**
 * Filtering the review queue by CARD TYPE, which is a different axis from the
 * plane. `ListOptions.kind` is workflow / mission / action, and production
 * holds 557 pending items that are all one plane — so nothing filtered them.
 *
 * The properties that make the filter real rather than cosmetic:
 *
 *   - it runs in the WHERE clause, so `total` stays truthful under it and a
 *     filtered page draws its whole window from the matching rows;
 *   - the per-type counts come from one query over every pending row, not from
 *     whatever the current page holds;
 *   - the type list is whatever the org has pending, so a newly registered
 *     action type appears with no UI change;
 *   - an unknown type returns nothing, never everything.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ cancelMission: vi.fn(), resumeMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ cancelWorkflow: vi.fn(), resumeWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { registerAction } = await import('@/libs/actions/registry');
const { listPending, listPendingPage, pendingActionTypes, pendingCount } = await import('@/services/ReviewService');

const ORG = 'org_card_type';

/** The queue as production holds it: one plane, five types, wildly uneven. */
const MIX: Array<[string, number]> = [
  ['hubspot.update', 291],
  ['gmail.send', 180],
  ['personalization.enroll', 46],
  ['discovery.review_proposal', 36],
  ['objects.propose_candidate', 4],
];

registerAction({
  id: 'personalization.enroll',
  name: 'Enroll MQL in sequence',
  description: 'test',
  inputSchema: z.object({}),
  grant: 'enroll',
  external: true,
  execute: async () => ({ ok: true }),
});

async function seedQueue() {
  for (const [actionId, n] of MIX) {
    await db.insert(actionRunSchema).values(
      Array.from({ length: n }, (_, i) => ({
        orgId: ORG,
        actionId,
        input: { i } as never,
        status: 'pending',
      })),
    );
  }
}

beforeEach(async () => {
  await db.delete(actionRunSchema);
});

afterAll(async () => {
  await db.delete(actionRunSchema);
});

describe('actionIds on ListOptions', () => {
  it('narrows to one type, and the total narrows with it', async () => {
    await seedQueue();

    const page = await listPendingPage(ORG, { actionIds: ['personalization.enroll'], limit: 50 });

    expect(page.total).toBe(46);
    expect(page.items).toHaveLength(46);
    expect(new Set(page.items.map(i => i.title))).toEqual(new Set(['Action · personalization.enroll']));
  });

  it('makes every enroll card reachable without deciding another type first', async () => {
    await seedQueue();

    const unfiltered = await listPendingPage(ORG, { limit: 50 });
    const filtered = await listPendingPage(ORG, { actionIds: ['personalization.enroll'], limit: 50 });
    const enrollIn = (page: { items: Array<{ title: string }> }) =>
      page.items.filter(i => i.title.includes('personalization.enroll')).length;

    // Unfiltered, the newest-50 window reaches only a fraction of the enroll
    // cards — the rest are behind 511 items of other types.
    expect(unfiltered.total).toBe(557);
    expect(enrollIn(unfiltered)).toBeLessThan(46);
    // Filtered, all 46 fit in one window with nothing of another type in it.
    expect(filtered.items).toHaveLength(46);
    expect(filtered.items).toHaveLength(filtered.total);
    expect(enrollIn(filtered)).toBe(46);
  });

  it('accepts several types at once', async () => {
    await seedQueue();

    const page = await listPendingPage(ORG, {
      actionIds: ['personalization.enroll', 'objects.propose_candidate'],
      limit: 200,
    });

    expect(page.total).toBe(50);
  });

  it('returns nothing for a type this org has never produced', async () => {
    await seedQueue();

    expect((await listPendingPage(ORG, { actionIds: ['nope.nothing'] })).total).toBe(0);
    // And an empty array is "no type matches", not "every type".
    expect((await listPendingPage(ORG, { actionIds: [] })).total).toBe(0);
  });

  it('leaves the other planes alone — this is an action-plane filter', async () => {
    await seedQueue();

    // `pendingCount` runs every plane; the workflow and mission planes hold
    // nothing here, so the filtered count is the action plane's.
    expect(await pendingCount(ORG, { actionIds: ['personalization.enroll'] })).toBe(46);
    expect(await pendingCount(ORG)).toBe(557);
  });

  it('does not change the unfiltered queue', async () => {
    await seedQueue();

    expect(await listPending(ORG)).toHaveLength(557);
  });
});

describe('pendingActionTypes', () => {
  it('counts every pending row per type, not the current page', async () => {
    await seedQueue();

    const types = await pendingActionTypes(ORG);

    expect(types.map(t => [t.actionId, t.count])).toEqual([
      ['hubspot.update', 291],
      ['gmail.send', 180],
      ['personalization.enroll', 46],
      ['discovery.review_proposal', 36],
      ['objects.propose_candidate', 4],
    ]);
    expect(types.reduce((n, t) => n + t.count, 0)).toBe(557);
  });

  it('labels a type with what its action registered as its name', async () => {
    await seedQueue();

    const types = await pendingActionTypes(ORG);

    expect(types.find(t => t.actionId === 'personalization.enroll')?.label).toBe('Enroll MQL in sequence');
    // Every production type is registered, so every chip has a real name.
    expect(types.every(t => t.label !== t.actionId)).toBe(true);
  });

  it('falls back to the slug for a type with no registered action, never a blank chip', async () => {
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'unregistered.thing', input: {}, status: 'pending' });

    expect((await pendingActionTypes(ORG))[0]?.label).toBe('unregistered.thing');
  });

  it('lists only what is present, so a new type needs no UI change', async () => {
    await db.insert(actionRunSchema).values({ orgId: ORG, actionId: 'brand.new_type', input: {}, status: 'pending' });

    expect(await pendingActionTypes(ORG)).toEqual([{ actionId: 'brand.new_type', label: 'brand.new_type', count: 1 }]);
  });

  it('counts nothing for an org with an empty queue', async () => {
    expect(await pendingActionTypes('org_nobody')).toEqual([]);
  });

  it('excludes decided rows, matching the queue itself', async () => {
    await db.insert(actionRunSchema).values([
      { orgId: ORG, actionId: 'a.b', input: {}, status: 'pending' },
      { orgId: ORG, actionId: 'a.b', input: {}, status: 'executed' },
      { orgId: ORG, actionId: 'a.b', input: {}, status: 'rejected' },
    ]);

    expect((await pendingActionTypes(ORG))[0]?.count).toBe(1);
  });
});
