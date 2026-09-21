import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The drift banner's facts, per project. A deployment hosts several projects
 * on one mounted `WORKSPACE_PATH`; before this the check compared that
 * folder's sha against EVERY project's applied sha, so a project applied
 * from its own repo (squatch-factory under a metacto-revenue mount) read as
 * permanently stale, and its Apply button would have written revenue's
 * workspace over it. Now the folder is compared only against the project it
 * belongs to, git-managed projects are never offered Apply, an apply in
 * flight says nothing, and Apply refuses rather than guesses.
 */

vi.mock('@/libs/DB');
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { guardAuth, guardRole } = await import('./AuthGuards');
const { applyNow, driftDiff, driftStatus } = await import('./Workspace');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');

const REVENUE = 'proj_drift_revenue';
const FACTORY = 'proj_drift_factory';
const dirs: string[] = [];
let prevPath: string | undefined;
let prevMap: string | undefined;

function call<T = unknown>(route: unknown, input: unknown = undefined): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

function signedInAs(projectId: string) {
  const ctx = { userId: 'usr-1', orgId: projectId, accountId: 'acct-drift', projectId, role: 'admin', has: () => true };
  vi.mocked(guardAuth).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardAuth>>);
  vi.mocked(guardRole).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardRole>>);
}

/**
 * A workspace folder naming `orgId`, mounted as WORKSPACE_PATH.
 * @param orgId
 */
function mount(orgId: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'drift-ws-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${orgId}\nname: ${orgId}\n`);
  process.env.WORKSPACE_PATH = dir;
  return dir;
}

async function applied(orgId: string, over: Partial<{ sha: string; sourcePath: string | null; appliedBy: string; appliedAt: Date }> = {}) {
  await db.insert(workspaceVersionSchema).values({ orgId, sha: 'oldsha000000', sourcePath: null, status: 'applied', appliedBy: 'cli', appliedAt: new Date(Date.now() - 3_600_000), ...over });
  invalidateCurrentContextShaCache();
}

async function versionsOf(orgId: string) {
  return db.select().from(workspaceVersionSchema).where(eq(workspaceVersionSchema.orgId, orgId));
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-drift', name: 'MetaCTO', slug: 'metacto-drift' });
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: 'acct-drift', slug: 'metacto-revenue', name: 'Metacto Revenue' },
    { id: FACTORY, accountId: 'acct-drift', slug: 'squatch-factory', name: 'Squatch', enabledPlugins: ['software-factory'] },
  ]);
});

beforeEach(() => {
  prevPath = process.env.WORKSPACE_PATH;
  prevMap = process.env.VOCION_WORKSPACE_MAP;
  delete process.env.VOCION_WORKSPACE_MAP;
  invalidateCurrentContextShaCache();
});

afterEach(async () => {
  process.env.WORKSPACE_PATH = prevPath;
  if (prevMap === undefined) {
    delete process.env.VOCION_WORKSPACE_MAP;
  } else {
    process.env.VOCION_WORKSPACE_MAP = prevMap;
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
});

type Status = {
  available: true;
  projectId: string;
  path: string;
  currentSha: string;
  appliedSha: string | null;
  neverApplied: boolean;
  own: boolean;
  owner: { id: string; slug: string; name: string } | null;
  deployManaged: boolean;
  inFlight: boolean;
  drifted: boolean;
};

describe('driftStatus', () => {
  it('a project whose folder is mounted and applied from it: drift is a differing sha', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    signedInAs(REVENUE);
    const s = await call<Status>(driftStatus);

    expect(s.available).toBe(true);
    expect(s).toMatchObject({ projectId: REVENUE, own: true, owner: null, deployManaged: false, inFlight: false, drifted: true, neverApplied: false });
    expect(s.currentSha).not.toBe('oldsha000000');
  });

  it('nothing applied yet: the folder is ours by its manifest, and there is no drift to speak of', async () => {
    mount(REVENUE);
    signedInAs(REVENUE);

    expect(await call<Status>(driftStatus)).toMatchObject({ own: true, neverApplied: true, drifted: false });
  });

  it('another project under the same mount: not drifted, not ours, and the owner is named', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    await applied(FACTORY, { sourcePath: '/srv/squatch/workspace', sha: 'squatch000001' });
    signedInAs(FACTORY);
    const s = await call<Status>(driftStatus);

    expect(s).toMatchObject({ own: false, drifted: false, projectId: FACTORY });
    expect(s.owner).toMatchObject({ id: REVENUE, slug: 'metacto-revenue', name: 'Metacto Revenue' });
  });

  it('a project applied by a pipeline, or from a read-only folder, is deploy-managed', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir, appliedBy: 'deploy' });
    signedInAs(REVENUE);

    expect(await call<Status>(driftStatus)).toMatchObject({ own: true, deployManaged: true, drifted: true });
  });

  it('an applied version newer than the folder is a deploy in flight — nothing is stale', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir, appliedAt: new Date(Date.now() + 60_000) });
    signedInAs(REVENUE);

    expect(await call<Status>(driftStatus)).toMatchObject({ own: true, inFlight: true, drifted: false });
  });

  it('a folder the map names for the project is the project\'s, whatever the manifest says', async () => {
    const dir = mount('proj_placeholder');
    process.env.VOCION_WORKSPACE_MAP = `squatch-factory:${dir}`;
    await applied(FACTORY, { sourcePath: '/srv/elsewhere' });
    signedInAs(FACTORY);

    expect(await call<Status>(driftStatus)).toMatchObject({ own: true, drifted: true });
  });
});

describe('driftDiff', () => {
  it('is a dry run for the project\'s own folder, and refused for another\'s', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    signedInAs(REVENUE);
    const diff = await call<{ changes: number; counts: Record<string, { created: number; updated: number; unchanged: number }> }>(driftDiff);

    expect(diff.counts.agents).toEqual({ created: 0, updated: 0, unchanged: 0 });
    expect(diff.changes).toBe(0);
    expect(await versionsOf(REVENUE)).toHaveLength(1);

    signedInAs(FACTORY);

    await expect(call(driftDiff)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('applyNow', () => {
  it('refuses to apply the mounted folder to a project it does not belong to, and writes nothing', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    await applied(FACTORY, { sourcePath: '/srv/squatch/workspace', sha: 'squatch000001' });
    signedInAs(FACTORY);
    const status = await call<Status>(driftStatus);

    await expect(call(applyNow, { sha: status.currentSha })).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('/srv/squatch/workspace') });
    expect(await versionsOf(FACTORY)).toHaveLength(1);
  });

  it('refuses when git applies this project', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir, appliedBy: 'deploy' });
    signedInAs(REVENUE);
    const status = await call<Status>(driftStatus);

    await expect(call(applyNow, { sha: status.currentSha })).rejects.toMatchObject({ code: 'FORBIDDEN', message: expect.stringContaining('deploy') });
    expect(await versionsOf(REVENUE)).toHaveLength(1);
  });

  it('refuses when the folder moved on since the diff was reviewed', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    signedInAs(REVENUE);

    await expect(call(applyNow, { sha: 'stale-reviewed-sha' })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await versionsOf(REVENUE)).toHaveLength(1);
  });

  it('applies the project\'s own folder once the reviewed sha still stands', async () => {
    const dir = mount(REVENUE);
    await applied(REVENUE, { sourcePath: dir });
    signedInAs(REVENUE);
    const status = await call<Status>(driftStatus);
    const result = await call<{ sha: string; errors: unknown[] }>(applyNow, { sha: status.currentSha });

    expect(result.sha).toBe(status.currentSha);
    expect(result.errors).toEqual([]);

    const rows = await versionsOf(REVENUE);

    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.sha === status.currentSha)).toMatchObject({ appliedBy: 'ui-drift-banner', sourcePath: dir });
    // Applied and in sync: the banner has nothing more to say.
    expect(await call<Status>(driftStatus)).toMatchObject({ drifted: false });
  });
});
