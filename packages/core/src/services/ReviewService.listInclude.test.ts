/**
 * Inlining the candidate payload on the queue list.
 *
 * The option exists because a client that buckets the queue by something
 * inside the payload otherwise fetches one detail per row, and these tests
 * care most about it being ADDITIVE: vocion-core is shared, so a caller that
 * does not ask must get exactly what it got before the option existed, down
 * to the keys present on the object.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/services/MissionService', () => ({ resumeMission: vi.fn(), cancelMission: vi.fn() }));
vi.mock('@/services/SkillService', () => ({ approveSkillRun: vi.fn(), rejectSkillRun: vi.fn() }));
vi.mock('@/services/WorkflowService', () => ({ resumeWorkflow: vi.fn(), cancelWorkflow: vi.fn() }));

const { db } = await import('@/libs/DB');
const { actionRunSchema, missionRunSchema, reviewAssignmentSchema, userActivityEventSchema } = await import('@/models/Schema');
const { listPendingPage } = await import('@/services/ReviewService');

const ORG = 'org_list_include';
const INPUT = { objectType: 'event-candidate', title: 'Radio Bean', fields: { startDate: '2026-10-01' } };
const PROPOSAL = { confidence: 0.82, rationale: 'Extracted from a listing' };

async function seedRun(): Promise<number> {
  const [row] = await db
    .insert(actionRunSchema)
    .values({ orgId: ORG, actionId: 'objects.propose_candidate', status: 'pending', input: INPUT, proposal: PROPOSAL as never })
    .returning({ id: actionRunSchema.id });
  return row!.id;
}

const clean = async () => {
  await db.delete(userActivityEventSchema);
  await db.delete(reviewAssignmentSchema);
  await db.delete(actionRunSchema);
  await db.delete(missionRunSchema);
};

beforeEach(clean);

afterAll(clean);

describe('listPendingPage include', () => {
  it('carries no payload keys at all when nothing was asked for', async () => {
    await seedRun();
    const page = await listPendingPage(ORG, { kind: 'action' });
    const [item] = page.items;

    // Not "input is undefined": the key must be absent, so the serialised row
    // is byte-identical to what every existing tenant already receives.
    expect(item).toBeDefined();
    expect(Object.keys(item!)).not.toContain('input');
    expect(Object.keys(item!)).not.toContain('proposal');
  });

  it('inlines the input when asked, and still not the proposal', async () => {
    await seedRun();
    const page = await listPendingPage(ORG, { kind: 'action', include: ['input'] });
    const [item] = page.items;

    expect(item!.input).toEqual(INPUT);
    expect(Object.keys(item!)).not.toContain('proposal');
  });

  it('inlines both when both are asked for', async () => {
    await seedRun();
    const page = await listPendingPage(ORG, { kind: 'action', include: ['input', 'proposal'] });
    const [item] = page.items;

    expect(item!.input).toEqual(INPUT);
    expect(item!.proposal).toMatchObject({ confidence: 0.82 });
  });

  it('carries when the item entered the queue, without being asked', async () => {
    const before = new Date();
    await seedRun();
    const page = await listPendingPage(ORG, { kind: 'action' });
    const [item] = page.items;

    // On the thin row on purpose: "how long has this been waiting" is the
    // queue's own question, and no client should fetch a detail to ask it.
    expect(item!.createdAt).toBeInstanceOf(Date);
    expect(item!.createdAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5000);
  });

  it('leaves paging and totals exactly as they were', async () => {
    await seedRun();
    await seedRun();
    await seedRun();
    const thin = await listPendingPage(ORG, { kind: 'action', limit: 2 });
    const fat = await listPendingPage(ORG, { kind: 'action', limit: 2, include: ['input'] });

    expect(fat.total).toBe(thin.total);
    expect(fat.limit).toBe(thin.limit);
    expect(fat.items.map(i => i.id)).toEqual(thin.items.map(i => i.id));
  });
});
