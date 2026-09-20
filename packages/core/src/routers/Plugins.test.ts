import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Plugins routes under a shared mount: `list` says where a toggle would
 * write, and `set` never edits another project's folder (see
 * PluginService.toggle.test for the write itself).
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
vi.mock('./AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { guardAuth, guardRole, loadProject } = await import('./AuthGuards');
const { list, set } = await import('./Plugins');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');

function call<T = unknown>(route: unknown, input: unknown = undefined): Promise<T> {
  const procedure = route as { '~orpc': { handler: (opts: { input: unknown; context: object }) => Promise<T> } };
  return procedure['~orpc'].handler({ input, context: {} });
}

function signedInAs(projectId: string) {
  const ctx = { userId: 'usr-1', orgId: projectId, accountId: 'acct-toggle', projectId, role: 'admin', has: () => true };
  vi.mocked(guardAuth).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardAuth>>);
  vi.mocked(guardRole).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof guardRole>>);
  vi.mocked(loadProject).mockImplementation(async (id: string) => (await db.select().from(projectSchema).where(eq(projectSchema.id, id)))[0] ?? null);
}

const REVENUE = 'proj_toggle_revenue';
const FACTORY = 'proj_toggle_factory';
const dirs: string[] = [];
let prevPath: string | undefined;
let prevMap: string | undefined;

/**
 * A workspace folder naming `orgId`, mounted as WORKSPACE_PATH — the one folder every project on this host sees.
 * @param orgId
 * @param plugins
 */
function mount(orgId: string, plugins = ''): string {
  const dir = mkdtempSync(join(tmpdir(), 'toggle-ws-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\n# The mounted project's manifest.\norgId: ${orgId}\nname: Metacto Revenue\n${plugins}`);
  process.env.WORKSPACE_PATH = dir;
  return dir;
}

const manifest = (dir: string) => readFileSync(join(dir, 'workspace.yaml'), 'utf8');

async function enabledOf(orgId: string): Promise<string[]> {
  const [row] = await db.select({ enabledPlugins: projectSchema.enabledPlugins }).from(projectSchema).where(eq(projectSchema.id, orgId));
  return row?.enabledPlugins ?? [];
}

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-toggle', name: 'MetaCTO', slug: 'metacto-toggle' });
  await db.insert(projectSchema).values([
    { id: REVENUE, accountId: 'acct-toggle', slug: 'metacto-revenue', name: 'Metacto Revenue' },
    { id: FACTORY, accountId: 'acct-toggle', slug: 'squatch-factory', name: 'Squatch', enabledPlugins: ['software-factory'] },
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
  await db.update(projectSchema).set({ enabledPlugins: ['software-factory'] }).where(eq(projectSchema.id, FACTORY));
  await db.update(projectSchema).set({ enabledPlugins: [] }).where(eq(projectSchema.id, REVENUE));
  await db.delete(workspaceVersionSchema);
  invalidateCurrentContextShaCache();
});

describe('plugins.list', () => {
  it('says the mounted project writes its folder, and another project writes its own list', async () => {
    mount(REVENUE);
    signedInAs(REVENUE);

    expect(await call<{ writes: string; writeBlocker: string | null }>(list)).toMatchObject({ writes: 'workspace', writeBlocker: null });

    signedInAs(FACTORY);

    expect(await call<{ writes: string; writeBlocker: string | null; repoFile: string; enabled: string[] }>(list)).toMatchObject({ writes: 'project', writeBlocker: null, repoFile: 'workspace/squatch-factory/workspace.yaml', enabled: ['software-factory'] });
  });
});

describe('plugins.set', () => {
  it('from another project under the mount: the folder is untouched, the project\'s list changes, the response says so', async () => {
    const dir = mount(REVENUE, 'plugins: [wiki]\n');
    const before = manifest(dir);
    signedInAs(FACTORY);
    const res = await call<{ mode: string; after: string[]; note?: string; applied: unknown }>(set, { slug: 'wiki', enabled: true });

    expect(res).toMatchObject({ mode: 'project', applied: null, after: ['software-factory', 'wiki'] });
    expect(res.note).toContain('workspace/squatch-factory/workspace.yaml');
    expect(manifest(dir)).toBe(before);
    expect(await enabledOf(FACTORY)).toEqual(['software-factory', 'wiki']);
    expect(await enabledOf(REVENUE)).toEqual([]);
  });

  it('from the mounted project: edits the folder and applies, as before', async () => {
    const dir = mount(REVENUE);
    signedInAs(REVENUE);
    const res = await call<{ mode: string; applied: { sha: string } | null }>(set, { slug: 'wiki', enabled: true });

    expect(res.mode).toBe('workspace');
    expect(res.applied?.sha).toBeTruthy();
    expect(manifest(dir)).toMatch(/plugins: \[ wiki \]/);
    expect(await enabledOf(REVENUE)).toEqual(['wiki']);
  });

  it('still refuses a plugin this core does not ship', async () => {
    mount(REVENUE);
    signedInAs(FACTORY);

    await expect(call(set, { slug: 'ghost', enabled: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
