import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { eq } = await import('drizzle-orm');
const { linkRelease, shippedPrs } = await import('./releasePack');

const ORG = 'org_release_pack';
const PR = 'https://github.com/acme/app/pull';

describe('shippedPrs', () => {
  it('ships what the release names, minus what a revert in its own notes undid (#66, 2026-09-27)', () => {
    const meta = {
      prUrls: [`${PR}/66`, `${PR}/68`, `${PR}/70/files`],
      commits: ['a1b2c3d revert: find a document (#66), merged by mistake (#68)', 'd4e5f6a logic: find a document (#66)', '0f0f0f0 feat: request a file (#70)'],
    };

    expect(shippedPrs(meta)).toEqual({ shipped: [`${PR}/70`], reverted: [`${PR}/66`, `${PR}/68`] });
    expect(shippedPrs({})).toEqual({ shipped: [], reverted: [] });
  });
});

describe('linkRelease', () => {
  it('links the request and task, carries the verdict and screenshots, and marks the request shipped', async () => {
    const [reqType] = await createObjectType({ slug: 'request', label: 'Request' }, ORG);
    const [taskType] = await createObjectType({ slug: 'engineering_task', label: 'Task' }, ORG);
    const [relType] = await createObjectType({ slug: 'release', label: 'Release' }, ORG);
    const [request] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: reqType!.id, title: 'Request a file', status: 'active', metadata: { state: 'building' } }).returning();
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'Request a file', status: 'accepted', metadata: { requestId: request!.id, prUrl: `${PR}/70`, verdict: { value: 'approve', proven: 6, total: 6 } } }).returning();
    const [reverted] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'Find a document', status: 'accepted', metadata: { requestId: 999, prUrl: `${PR}/66` } }).returning();
    const [shot] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'image', title: 'Request dialog', recordType: 'object', recordId: String(task!.id), recordRole: 'qa-screenshot' }).returning();
    const [release] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: relType!.id, title: 'app 0f0f0f0', status: 'active', metadata: { releasedAt: '2026-09-27T20:00:00Z', prUrls: [`${PR}/70`, `${PR}/66`], commits: ['abc1234 revert: find a document (#66)', '0f0f0f0 feat: request a file (#70)'] } }).returning();

    const pack = await linkRelease(ORG, release!.id);

    expect(pack).toMatchObject({ requestIds: [request!.id], taskIds: [task!.id], reverted: [`${PR}/66`] });
    expect(pack?.evidence).toEqual([{ taskId: task!.id, requestId: request!.id, prUrl: `${PR}/70`, verdict: 'approve, 6 of 6 proven' }]);

    const [rel] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, release!.id));

    expect(rel!.metadata).toMatchObject({ shippedLine: 'Request a file — QA approve, 6 of 6 proven', requestIds: [request!.id], taskIds: [task!.id], verificationArtifactIds: [shot!.id], revertedPrUrls: [`${PR}/66`] });

    const [req] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, request!.id));

    expect(req!.metadata).toMatchObject({ state: 'shipped', shippedAt: '2026-09-27T20:00:00Z', shippedIn: release!.id });
    expect(reverted).toBeDefined();
    // Idempotent: the same release links the same pack.
    expect(await linkRelease(ORG, release!.id)).toEqual(pack);
  });
});
