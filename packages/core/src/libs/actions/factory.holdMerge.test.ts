import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { gitMergeAction, holdMerge } = await import('./factory');

const ORG = 'org_hold_merge';

describe('a held merge', () => {
  it('sends the task back to Changes asked with the person\'s reason, keeping the judged criteria', async () => {
    const [type] = await createObjectType({ slug: 'engineering_task', label: 'Task' }, ORG);
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Find a document', status: 'accepted', metadata: { status: 'accepted', verdict: { value: 'approve', proven: 8, total: 8, criteria: [{ criterion: 'URL state', status: 'proven' }] } } }).returning();

    await holdMerge(ORG, task!.id, 'The URL shot was taken mid-debounce; ?q= never shows.');

    const [row] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, task!.id));

    expect(row!.status).toBe('changes_requested');
    expect(row!.metadata).toMatchObject({ status: 'changes_requested', verdict: { value: 'changes', heldBy: 'person', proven: 8, note: 'A person held the merge: The URL shot was taken mid-debounce; ?q= never shows.', criteria: [{ criterion: 'URL state', status: 'proven' }] } });
  });

  it('is what rejecting the merge card does', () => {
    expect(typeof gitMergeAction.onRejected).toBe('function');
  });
});
