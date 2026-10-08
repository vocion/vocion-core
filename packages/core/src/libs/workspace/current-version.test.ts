import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The applied-version reading on a host serving several companies.
 *
 * A rollup recompute asks for its org's applied version on every object
 * write. The cache used to hold one org, so two orgs writing in turn evicted
 * each other and every write paid the query again.
 */

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { workspaceVersionSchema } = await import('@/models/Schema');
const { folderLastAppliedTo, getCurrentWorkspaceVersion, invalidateCurrentContextShaCache, memoUntilNextApply, orgWasAppliedFrom } = await import('./current-version');

afterEach(async () => {
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
  vi.restoreAllMocks();
});

describe('getCurrentWorkspaceVersion', () => {
  it('keeps each org\'s reading, so two orgs in turn do not evict each other', async () => {
    await db.insert(workspaceVersionSchema).values([
      { orgId: 'proj_cache_northwind', sha: 'northwind01', sourcePath: '/ws/northwind', status: 'applied', appliedAt: new Date('2026-10-01T10:00:00Z') },
      { orgId: 'proj_cache_kestrel', sha: 'kestrel0001', sourcePath: '/ws/kestrel', status: 'applied', appliedAt: new Date('2026-10-01T10:00:01Z') },
    ]);
    await getCurrentWorkspaceVersion('proj_cache_northwind');
    await getCurrentWorkspaceVersion('proj_cache_kestrel');
    const select = vi.spyOn(db, 'select');

    expect((await getCurrentWorkspaceVersion('proj_cache_northwind'))?.sha).toBe('northwind01');
    expect((await getCurrentWorkspaceVersion('proj_cache_kestrel'))?.sha).toBe('kestrel0001');
    expect(select).not.toHaveBeenCalled();
  });
});

describe('memoUntilNextApply', () => {
  it('reuses a reading until the next apply clears it, and never keeps a failed one', async () => {
    let reads = 0;
    const read = async () => ++reads;

    expect(await memoUntilNextApply('k', 60_000, read)).toBe(1);
    expect(await memoUntilNextApply('k', 60_000, read)).toBe(1);

    invalidateCurrentContextShaCache();

    expect(await memoUntilNextApply('k', 60_000, read)).toBe(2);

    await expect(memoUntilNextApply('bad', 60_000, async () => {
      throw new Error('db down');
    })).rejects.toThrow('db down');

    await new Promise(r => setTimeout(r, 0));

    expect(await memoUntilNextApply('bad', 60_000, async () => 'recovered')).toBe('recovered');
  });
});

describe('what the record says about a folder', () => {
  it('names the project a folder was last applied to, and whether an org was ever applied from it', async () => {
    await db.insert(workspaceVersionSchema).values([
      { orgId: 'proj_cache_northwind', sha: 'a', sourcePath: '/ws/shared', status: 'applied', appliedAt: new Date('2026-10-01T10:00:00Z') },
      { orgId: 'proj_cache_kestrel', sha: 'b', sourcePath: '/ws/shared', status: 'applied', appliedAt: new Date('2026-10-02T10:00:00Z') },
    ]);

    expect(await folderLastAppliedTo('/ws/shared')).toBe('proj_cache_kestrel');
    expect(await folderLastAppliedTo('/ws/shared/')).toBe('proj_cache_kestrel');
    expect(await folderLastAppliedTo('/ws/nobody')).toBeNull();
    expect(await orgWasAppliedFrom('proj_cache_northwind', '/ws/shared')).toBe(true);
    expect(await orgWasAppliedFrom('proj_cache_northwind', '/ws/kestrel')).toBe(false);
  });
});
