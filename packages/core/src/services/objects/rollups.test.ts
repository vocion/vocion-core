import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { eq } = await import('drizzle-orm');
const { readRollupDeclarations, recomputeRollups } = await import('./rollups');

// A request's cost is the sum over its tasks; a release's is the sum over the
// tasks it shipped. Neither can be a page stat, so both are materialised onto
// the parent when a task changes — from a declaration in the parent's type
// file, never from anything core knows about requests.

const ORG = 'org_rollups';
const typeIds: Record<string, number> = {};
const dirs: string[] = [];
let prevPath: string | undefined;

async function seedType(slug: string): Promise<void> {
  const [row] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label: slug }).returning({ id: businessObjectTypeSchema.id });
  typeIds[slug] = row!.id;
}

async function seedObject(type: string, title: string, metadata: Record<string, unknown>, orgId = ORG): Promise<number> {
  const [row] = await db.insert(businessObjectSchema).values({ orgId, typeId: typeIds[type]!, title, metadata }).returning({ id: businessObjectSchema.id });
  return row!.id;
}

async function metaOf(id: number): Promise<Record<string, unknown>> {
  const [row] = await db.select({ metadata: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, id));
  return row!.metadata ?? {};
}

const REQUEST_ROLLUPS = [
  { parentType: 'request', rollup: { field: 'actualCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'actualCents' } },
  { parentType: 'request', rollup: { field: 'estimateCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'estimateCents' } },
  { parentType: 'request', rollup: { field: 'taskCount', from: { type: 'engineering_task', by: 'requestId' } } },
];
const RELEASE_ROLLUPS = [
  { parentType: 'release', rollup: { field: 'actualCents', from: { type: 'engineering_task', ids: 'taskIds' }, sum: 'actualCents' } },
];

beforeEach(async () => {
  prevPath = process.env.WORKSPACE_PATH;
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  for (const slug of ['request', 'engineering_task', 'release']) {
    await seedType(slug);
  }
});

afterEach(() => {
  if (prevPath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = prevPath;
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('recomputeRollups', () => {
  it('sums and counts a request\'s tasks through the task\'s requestId, from scratch, and stamps when', async () => {
    const request = await seedObject('request', 'Search is slow', { kind: 'bug' });
    const other = await seedObject('request', 'Something else', {});
    const t1 = await seedObject('engineering_task', 'Index the table', { requestId: request, estimateCents: 500, actualCents: 420 });
    await seedObject('engineering_task', 'Add the cache', { requestId: request, estimateCents: 300 }); // no actual yet
    await seedObject('engineering_task', 'Elsewhere', { requestId: other, actualCents: 999 });
    const now = new Date('2026-09-20T12:00:00Z');

    const written = await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: t1, declarations: REQUEST_ROLLUPS, now });

    expect(written).toEqual([{ type: 'request', id: request, fields: { actualCents: 420, estimateCents: 800, taskCount: 2 } }]);
    expect(await metaOf(request)).toEqual({ kind: 'bug', actualCents: 420, estimateCents: 800, taskCount: 2, rollupsUpdatedAt: '2026-09-20T12:00:00.000Z' });
    // The other request was not touched.
    expect(await metaOf(other)).toEqual({});

    // Recomputed, not incremented: the same call lands the same figure.
    await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: t1, declarations: REQUEST_ROLLUPS, now });

    expect((await metaOf(request)).actualCents).toBe(420);
  });

  it('reaches a release through the release\'s own taskIds list', async () => {
    const t1 = await seedObject('engineering_task', 'a', { actualCents: 100 });
    const t2 = await seedObject('engineering_task', 'b', { actualCents: 250 });
    const t3 = await seedObject('engineering_task', 'c', { actualCents: 9000 });
    const release = await seedObject('release', 'v1.2.0', { taskIds: [t1, t2] });
    const unrelated = await seedObject('release', 'v1.1.0', { taskIds: [t3] });

    const written = await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: t2, declarations: RELEASE_ROLLUPS });

    expect(written).toEqual([{ type: 'release', id: release, fields: { actualCents: 350 } }]);
    expect((await metaOf(release)).actualCents).toBe(350);
    expect((await metaOf(unrelated)).actualCents).toBeUndefined();
  });

  it('a child that points nowhere, or a declaration for another type, writes nothing', async () => {
    const orphan = await seedObject('engineering_task', 'orphan', { actualCents: 5 });
    const pointing = await seedObject('engineering_task', 'ghost', { requestId: 999_999, actualCents: 5 });

    expect(await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: orphan, declarations: [...REQUEST_ROLLUPS, ...RELEASE_ROLLUPS] })).toEqual([]);
    expect(await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: pointing, declarations: REQUEST_ROLLUPS })).toEqual([]);
    expect(await recomputeRollups({ orgId: ORG, childType: 'request', childId: orphan, declarations: REQUEST_ROLLUPS })).toEqual([]);
    expect(await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: orphan, declarations: [] })).toEqual([]);
  });

  it('never crosses an org', async () => {
    const request = await seedObject('request', 'ours', {});
    const [otherType] = await db.insert(businessObjectTypeSchema).values({ orgId: 'org_other', slug: 'engineering_task', label: 't' }).returning({ id: businessObjectTypeSchema.id });
    const [theirs] = await db.insert(businessObjectSchema).values({ orgId: 'org_other', typeId: otherType!.id, title: 'theirs', metadata: { requestId: request, actualCents: 777 } }).returning({ id: businessObjectSchema.id });
    const ours = await seedObject('engineering_task', 'ours', { requestId: request, actualCents: 1 });

    await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: ours, declarations: REQUEST_ROLLUPS });

    expect((await metaOf(request)).actualCents).toBe(1);
    expect(await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: theirs!.id, declarations: REQUEST_ROLLUPS })).toEqual([]);
  });
});

describe('readRollupDeclarations', () => {
  it('reads the software-factory plugin\'s declarations when the mounted workspace turns it on', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollups-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: t\nplugins: [software-factory]\n');
    process.env.WORKSPACE_PATH = dir;

    const decls = await readRollupDeclarations(ORG);

    // The request sums its tasks through the task's requestId; the release
    // through its own taskIds. Both carry the estimate/actual pair.
    expect(decls.filter(d => d.parentType === 'request').map(d => d.rollup.field).sort()).toEqual(['acceptedTaskCount', 'actualCents', 'awaitingReviewTaskCount', 'estimateCents', 'reworkCents', 'reworkTaskCount', 'runningTaskCount', 'shippedAt', 'taskCount', 'varianceCents']);
    // Whether a worker is actually on it, so the Work queue can read a
    // request that says `building` with nothing running as stopped.
    expect(decls.find(d => d.parentType === 'request' && d.rollup.field === 'runningTaskCount')?.rollup).toEqual({ field: 'runningTaskCount', from: { type: 'engineering_task', by: 'requestId' }, where: { field: 'status', in: ['dispatched', 'running'] } });
    // Rework is the same children, narrowed to the ones that were thrown
    // away; the ship date comes the other way round, off the release that
    // names the request.
    expect(decls.find(d => d.parentType === 'request' && d.rollup.field === 'reworkCents')?.rollup).toEqual({ field: 'reworkCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'actualCents', where: { field: 'status', in: ['rejected', 'abandoned'] } });
    expect(decls.find(d => d.parentType === 'request' && d.rollup.field === 'shippedAt')?.rollup).toEqual({ field: 'shippedAt', from: { type: 'release', inList: 'requestIds' }, min: 'releasedAt' });
    expect(decls.find(d => d.parentType === 'request' && d.rollup.field === 'actualCents')?.rollup).toEqual({ field: 'actualCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'actualCents' });
    expect(decls.find(d => d.parentType === 'release' && d.rollup.field === 'actualCents')?.rollup).toEqual({ field: 'actualCents', from: { type: 'engineering_task', ids: 'taskIds' }, sum: 'actualCents' });
    expect(decls.find(d => d.parentType === 'request' && d.rollup.field === 'taskCount')?.rollup.sum).toBeUndefined();
  });

  it('a workspace type of the same slug replaces the plugin\'s declarations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rollups-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: t\nplugins: [software-factory]\n');
    mkdirSync(join(dir, 'objects', 'request'), { recursive: true });
    writeFileSync(join(dir, 'objects', 'request', 'type.yaml'), 'slug: request\nlabel: Request\nrollups:\n  - {field: spend, from: {type: engineering_task, by: requestId}, sum: actualCents}\n');
    process.env.WORKSPACE_PATH = dir;

    const decls = await readRollupDeclarations(ORG);

    expect(decls.filter(d => d.parentType === 'request').map(d => d.rollup.field)).toEqual(['spend']);
    expect(decls.some(d => d.parentType === 'release')).toBe(true);
  });

  it('is empty with nothing mounted and nothing on the project', async () => {
    delete process.env.WORKSPACE_PATH;

    expect(await readRollupDeclarations(ORG)).toEqual([]);
  });
});

describe('rollups that are not sums', () => {
  it('counts only the children a `where` keeps, so rework sits beside total spend on one record', async () => {
    const request = await seedObject('request', 'Rename Send to Stamp', {});
    const kept = await seedObject('engineering_task', 'The one that landed', { requestId: request, actualCents: 1185 });
    await db.update(businessObjectSchema).set({ status: 'accepted' }).where(eq(businessObjectSchema.id, kept));
    for (const [title, cents, status] of [['Attempt one', 0, 'rejected'], ['Attempt two', 41, 'rejected'], ['Attempt three', 1186, 'abandoned']] as const) {
      const id = await seedObject('engineering_task', title, { requestId: request, actualCents: cents });
      await db.update(businessObjectSchema).set({ status }).where(eq(businessObjectSchema.id, id));
    }
    const declarations = [
      { parentType: 'request', rollup: { field: 'actualCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'actualCents' } },
      { parentType: 'request', rollup: { field: 'reworkCents', from: { type: 'engineering_task', by: 'requestId' }, sum: 'actualCents', where: { field: 'status', in: ['rejected', 'abandoned'] } } },
      { parentType: 'request', rollup: { field: 'reworkTaskCount', from: { type: 'engineering_task', by: 'requestId' }, where: { field: 'status', in: ['rejected', 'abandoned'] } } },
    ];

    await recomputeRollups({ orgId: ORG, childType: 'engineering_task', childId: kept, declarations });
    const meta = await metaOf(request);

    // Everything it took, and the part of it that bought nothing.
    expect(meta.actualCents).toBe(2412);
    expect(meta.reworkCents).toBe(1227);
    expect(meta.reworkTaskCount).toBe(3);
  });

  it('writes the earliest child date, through a link the CHILD holds as a list', async () => {
    const request = await seedObject('request', 'Send a link by email', { askedAt: '2026-09-21T00:00:00Z' });
    const other = await seedObject('request', 'Something else', {});
    await seedObject('release', 'Second deploy of the same change', { requestIds: [request], releasedAt: '2026-09-21T14:37:06.740Z' });
    const first = await seedObject('release', 'First deploy', { requestIds: [request, other], releasedAt: '2026-09-21T14:30:55.542Z' });
    const declarations = [{ parentType: 'request', rollup: { field: 'shippedAt', from: { type: 'release', inList: 'requestIds' }, min: 'releasedAt' } }];

    const written = await recomputeRollups({ orgId: ORG, childType: 'release', childId: first, declarations });

    // Both requests the release names are recomputed, and each takes the
    // EARLIEST release that carried it: the ship moment, not the latest
    // redeploy of the same commit.
    expect(written.map(w => w.id).sort()).toEqual([request, other].sort());
    expect((await metaOf(request)).shippedAt).toBe('2026-09-21T14:30:55.542Z');
    expect((await metaOf(other)).shippedAt).toBe('2026-09-21T14:30:55.542Z');
  });

  it('leaves the date unwritten rather than null when no child carries one', async () => {
    const request = await seedObject('request', 'Not shipped yet', { kind: 'gap' });
    const release = await seedObject('release', 'A deploy with no date', { requestIds: [request] });
    const declarations = [{ parentType: 'request', rollup: { field: 'shippedAt', from: { type: 'release', inList: 'requestIds' }, min: 'releasedAt' } }];

    await recomputeRollups({ orgId: ORG, childType: 'release', childId: release, declarations });

    // An empty cell says "has not shipped"; a null would say "shipped at no
    // time", and the page would have to guess which.
    expect(await metaOf(request)).not.toHaveProperty('shippedAt');
    expect((await metaOf(request)).kind).toBe('gap');
  });
});
