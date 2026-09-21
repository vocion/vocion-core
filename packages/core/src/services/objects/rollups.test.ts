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
    expect(decls.filter(d => d.parentType === 'request').map(d => d.rollup.field).sort()).toEqual(['actualCents', 'estimateCents', 'taskCount', 'varianceCents']);
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
