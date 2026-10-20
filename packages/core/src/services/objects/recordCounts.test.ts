import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { countActiveRecordsByType } = await import('./recordCounts');

const ORG = 'org_record_counts';

describe('countActiveRecordsByType', () => {
  beforeEach(async () => {
    await db.delete(businessObjectSchema);
    await db.delete(businessObjectTypeSchema);
  });

  it('counts records filed through Review (approved) beside active ones, never candidates or rejected', async () => {
    const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'finance_entity', label: 'Legal entity' }).returning();
    await db.insert(businessObjectSchema).values([
      { orgId: ORG, typeId: type!.id, title: 'MetaCTO, LLC', status: 'approved' },
      { orgId: ORG, typeId: type!.id, title: 'Holdings', status: 'active' },
      { orgId: ORG, typeId: type!.id, title: 'Draft', status: 'candidate' },
      { orgId: ORG, typeId: type!.id, title: 'Wrong', status: 'rejected' },
    ]);

    expect(await countActiveRecordsByType(ORG, ['finance_entity'])).toEqual({ finance_entity: 2 });
  });
});
