import { describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, eventLogSchema } = await import('@/models/Schema');
const { createObjectType } = await import('@/services/BusinessObjectService');
const { and, eq } = await import('drizzle-orm');
const { matchesFilter } = await import('@/services/EventService');
const { readFileSync } = await import('node:fs');
const { parse } = await import('yaml');
const { fromRepoRoot } = await import('@/libs/repo-root');

/** The draft automation's filter, as the plugin ships it. */
const draftFilter = (parse(readFileSync(fromRepoRoot('packages/core/templates/plugins/software-factory/automations/release-announcement-draft.yaml'), 'utf8')) as { when: { filter: Record<string, unknown> } }).when.filter;

async function linkedEvents(orgId: string) {
  return db.select().from(eventLogSchema).where(and(eq(eventLogSchema.orgId, orgId), eq(eventLogSchema.type, 'release.linked')));
}
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
    const [request] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: reqType!.id, title: 'Request a file', status: 'active', metadata: { state: 'building', acceptance: [{ statement: 'Send someone a link to upload a file.' }, { statement: 'It arrives in your library.' }] } }).returning();
    const [task] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'Request a file', status: 'accepted', metadata: { requestId: request!.id, prUrl: `${PR}/70`, verdict: { value: 'approve', proven: 6, total: 6, criteria: [{ criterion: 'Send someone a link to upload a file.', status: 'proven', evidence: 'artifact 1201' }, { criterion: 'It arrives in your library.', status: 'unproven' }] } } }).returning();
    const [reverted] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: taskType!.id, title: 'Find a document', status: 'accepted', metadata: { requestId: 999, prUrl: `${PR}/66` } }).returning();
    const [shot] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'image', title: 'Request dialog', recordType: 'object', recordId: String(task!.id), recordRole: 'qa-screenshot' }).returning();
    const [release] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: relType!.id, title: 'app 0f0f0f0', status: 'active', metadata: { releasedAt: '2026-09-27T20:00:00Z', prUrls: [`${PR}/70`, `${PR}/66`], commits: ['abc1234 revert: find a document (#66)', '0f0f0f0 feat: request a file (#70)'] } }).returning();

    const pack = await linkRelease(ORG, release!.id);

    expect(pack).toMatchObject({ requestIds: [request!.id], taskIds: [task!.id], reverted: [`${PR}/66`] });
    expect(pack?.evidence).toEqual([{ taskId: task!.id, requestId: request!.id, prUrl: `${PR}/70`, verdict: 'approve, 1 of 2 proven', title: 'Request a file' }]);

    const [rel] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, release!.id));

    expect(rel!.metadata).toMatchObject({ shippedLine: 'Request a file — QA approve, 1 of 2 proven', requestIds: [request!.id], taskIds: [task!.id], verificationArtifactIds: [shot!.id], revertedPrUrls: [`${PR}/66`] });

    const [req] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, request!.id));

    expect(req!.metadata).toMatchObject({ state: 'shipped', shippedAt: '2026-09-27T20:00:00Z', shippedIn: release!.id });
    // Met from QA's proof, paired by words; what QA did not prove stays unmet.
    // The count is the request's lines as judged (1 of 2), not the verdict's stored 6 of 6.
    expect((req!.metadata as { acceptance: unknown[] }).acceptance).toEqual([
      { statement: 'Send someone a link to upload a file.', met: true, evidence: 'artifact 1201', provenBy: { taskId: task!.id, releaseId: release!.id } },
      { statement: 'It arrives in your library.' },
    ]);
    expect(reverted).toBeDefined();
    // Idempotent: the same release links the same pack.
    expect(await linkRelease(ORG, release!.id)).toEqual(pack);

    // The release can be said now: one release.linked, deduped across the
    // re-link, and the PM's draft automation is the one it wakes.
    const events = await linkedEvents(ORG);

    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toEqual({ releaseId: release!.id, product: null, userFacing: true, features: 1, internal: 0, announcementState: 'not-prepared', requestIds: [request!.id], taskIds: [task!.id] });
    expect(matchesFilter(events[0]!.payload, draftFilter)).toBe(true);
  });

  it('marks a release with no linked feature and only internal changes "not needed", and wakes nobody to draft it', async () => {
    const org = 'org_release_pack_internal';
    const [relType] = await createObjectType({ slug: 'release', label: 'Release' }, org);
    await createObjectType({ slug: 'engineering_task', label: 'Task' }, org);
    await createObjectType({ slug: 'request', label: 'Request' }, org);
    const [release] = await db.insert(businessObjectSchema).values({ orgId: org, typeId: relType!.id, title: 'app 1a2b3c4', status: 'active', metadata: { product: 'send', releasedAt: '2026-09-28T09:00:00Z', prUrls: [`${PR}/80`], commits: ['1a2b3c4 fix(worker): retry the lease (#80)', '5d6e7f8 ci: cache the build'] } }).returning();

    await linkRelease(org, release!.id);

    const [rel] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.id, release!.id));

    expect(rel!.metadata).toMatchObject({ announcementState: 'not-needed', shippedLine: 'No linked feature' });
    expect((rel!.metadata as Record<string, unknown>).announcement).toBeUndefined();

    const [event] = await linkedEvents(org);

    expect(event!.payload).toMatchObject({ userFacing: false, features: 0, internal: 2, announcementState: 'not-needed' });
    expect(matchesFilter(event!.payload, draftFilter)).toBe(false);
  });
});
