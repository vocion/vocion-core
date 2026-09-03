import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { leadBriefSchema } = await import('@/models/Schema');
const { saveHandoffBrief } = await import('@/services/PersonalizationQueueService');

const ORG = 'org_handoff_test';
const REF = 'contacts:9412';
const REVIEW_SECTIONS = [{ heading: 'Prospect', body: 'Pete Laverick, CEO.' }];

async function seedLead() {
  const [row] = await db.insert(leadBriefSchema).values({
    orgId: ORG,
    contactRef: REF,
    contactName: 'Pete Laverick',
    triggerType: 'new',
    status: 'ready_for_review',
    sections: REVIEW_SECTIONS,
    claims: [{ text: 'Publishes compliance updates.', kind: 'fact', source: 'https://example.com' }],
    confidence: 0.72,
  }).returning();
  return row!;
}

beforeEach(async () => {
  await db.delete(leadBriefSchema);
});

afterAll(async () => {
  await db.delete(leadBriefSchema);
});

describe('saveHandoffBrief', () => {
  it('stores the call prep and the trigger', async () => {
    await seedLead();

    const result = await saveHandoffBrief(ORG, {
      contactRef: REF,
      trigger: 'reply',
      sections: [{ heading: 'Where the thread stands', body: 'Two sends, one reply.' }],
    });

    expect(result).toMatchObject({ saved: true, contactRef: REF, reviewSectionCount: 1 });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row!.handoffSections).toEqual([{ heading: 'Where the thread stands', body: 'Two sends, one reply.' }]);
    expect(row!.handoffTrigger).toBe('reply');
    expect(row!.handoffAt).toBeInstanceOf(Date);
  });

  it('leaves the review brief, its evidence, and the lane exactly as they were', async () => {
    const before = await seedLead();

    await saveHandoffBrief(ORG, {
      contactRef: REF,
      trigger: 'routed',
      sections: [{ heading: 'Where the thread stands', body: 'A reviewer routed this.' }],
    });

    const [after] = await db.select().from(leadBriefSchema);

    expect(after!.sections).toEqual(before.sections);
    expect(after!.claims).toEqual(before.claims);
    expect(after!.confidence).toBe(before.confidence);
    expect(after!.status).toBe(before.status);
    expect(after!.briefedAt).toEqual(before.briefedAt);
  });

  it('a re-run replaces only the handoff brief', async () => {
    await seedLead();
    await saveHandoffBrief(ORG, { contactRef: REF, trigger: 'reply', sections: [{ heading: 'First', body: 'one' }] });

    await saveHandoffBrief(ORG, { contactRef: REF, trigger: 'intent', sections: [{ heading: 'Second', body: 'two' }] });

    const [row] = await db.select().from(leadBriefSchema);

    expect(row!.handoffSections).toEqual([{ heading: 'Second', body: 'two' }]);
    expect(row!.handoffTrigger).toBe('intent');
    expect(row!.sections).toEqual(REVIEW_SECTIONS);
  });

  it('an unknown lead saves nothing and says so, rather than failing silently', async () => {
    const result = await saveHandoffBrief(ORG, {
      contactRef: 'contacts:nobody',
      trigger: 'reply',
      sections: [{ heading: 'Where the thread stands', body: 'x' }],
    });

    expect(result).toEqual({ saved: false, contactRef: 'contacts:nobody' });
  });
});
