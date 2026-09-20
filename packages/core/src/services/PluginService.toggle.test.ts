import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The plugin switch under a shared mount. One folder is mounted for several
 * projects; it is ONE project's workspace. A toggle from that project edits
 * the folder and applies, as always. A toggle from any other project must not
 * touch the folder — that would rewrite the mounted project's manifest — so it
 * writes `project.enabled_plugins` alone and says so, naming the repo file.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { pluginWriteTarget, restorePluginsForProject, togglePluginForProject } = await import('./PluginService');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');

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

describe('pluginWriteTarget', () => {
  it('the mounted project writes the folder; another project writes its own list, and is told the repo file', async () => {
    const dir = mount(REVENUE);

    expect(await pluginWriteTarget(REVENUE, 'metacto-revenue', dir)).toMatchObject({ mode: 'workspace', workspaceDir: dir, blocker: null, owner: null });
    expect(await pluginWriteTarget(FACTORY, 'squatch-factory', dir)).toMatchObject({ mode: 'project', blocker: null, repoFile: 'workspace/squatch-factory/workspace.yaml', owner: { slug: 'metacto-revenue', name: 'Metacto Revenue' } });
  });

  it('no folder at all is the project path too, never a blocker', async () => {
    expect(await pluginWriteTarget(FACTORY, 'squatch-factory', null)).toMatchObject({ mode: 'project', blocker: null, workspaceDir: null, owner: null });
  });

  it('a folder the map names for the project is the project\'s to write', async () => {
    const dir = mount('proj_placeholder');

    expect(await pluginWriteTarget(FACTORY, 'squatch-factory', dir, true)).toMatchObject({ mode: 'workspace', workspaceDir: dir });
  });
});

describe('togglePluginForProject', () => {
  it('the mounted project: edits workspace.yaml, applies, and the column follows', async () => {
    const dir = mount(REVENUE);
    const res = await togglePluginForProject({ orgId: REVENUE, projectSlug: 'metacto-revenue', workspaceDir: dir, slug: 'wiki', enabled: true, appliedBy: 'test' });

    expect(res).toMatchObject({ mode: 'workspace', slug: 'wiki', enabled: true, before: [], after: ['wiki'] });
    expect(res.applied?.sha).toBeTruthy();
    expect(res.note).toBeUndefined();
    expect(manifest(dir)).toMatch(/plugins: \[ wiki \]/);
    expect(manifest(dir)).toContain('# The mounted project\'s manifest.');
    expect(await enabledOf(REVENUE)).toEqual(['wiki']);
  });

  it('another project under the same mount: the folder is left alone, its list changes, and the note names the repo file', async () => {
    const dir = mount(REVENUE, 'plugins: [wiki]\n');
    const before = manifest(dir);
    const res = await togglePluginForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: dir, slug: 'proposals', enabled: true, appliedBy: 'test' });

    expect(res).toMatchObject({ mode: 'project', applied: null, before: ['software-factory'], repoFile: 'workspace/squatch-factory/workspace.yaml' });
    // Dependency-closed, the shape an apply would leave.
    expect(res.after).toEqual(['software-factory', 'data-rooms', 'proposals']);
    expect(res.note).toContain('Turned on proposals for this project only');
    expect(res.note).toContain('applied from git');
    expect(res.note).toContain('Metacto Revenue\'s (metacto-revenue)');
    expect(res.note).toContain('left alone');
    expect(res.note).toContain('add "proposals" to plugins: in workspace/squatch-factory/workspace.yaml');
    expect(manifest(dir)).toBe(before);
    expect(await enabledOf(FACTORY)).toEqual(['software-factory', 'data-rooms', 'proposals']);
    // Revenue's own list and versions are untouched — nothing was applied to anyone.
    expect(await enabledOf(REVENUE)).toEqual([]);
    expect(await db.select().from(workspaceVersionSchema)).toEqual([]);
  });

  it('turning one off for another project also drops what depended on it, in the column alone', async () => {
    const dir = mount(REVENUE);
    await db.update(projectSchema).set({ enabledPlugins: ['software-factory', 'data-rooms', 'proposals'] }).where(eq(projectSchema.id, FACTORY));
    const res = await togglePluginForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: dir, slug: 'data-rooms', enabled: false, appliedBy: 'test' });

    expect(res.after).toEqual(['software-factory']);
    expect(res.note).toContain('remove "data-rooms" from plugins: in workspace/squatch-factory/workspace.yaml');
    expect(await enabledOf(FACTORY)).toEqual(['software-factory']);
  });

  it('with no folder on this host, the project path still works and says so', async () => {
    delete process.env.WORKSPACE_PATH;
    const res = await togglePluginForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: null, slug: 'wiki', enabled: true, appliedBy: 'test' });

    expect(res.mode).toBe('project');
    expect(res.note).toContain('no workspace folder is mounted here');
    expect(await enabledOf(FACTORY)).toEqual(['software-factory', 'wiki']);
  });

  it('refuses an unknown plugin before writing anything', async () => {
    const dir = mount(REVENUE);

    await expect(togglePluginForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: dir, slug: 'ghost', enabled: true, appliedBy: 'test' })).rejects.toThrow(/unknown plugin/);
    expect(await enabledOf(FACTORY)).toEqual(['software-factory']);
  });
});

describe('restorePluginsForProject', () => {
  it('puts the list back the way it was changed — the column for another project, the file for the mounted one', async () => {
    const dir = mount(REVENUE, 'plugins: [wiki]\n');
    await togglePluginForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: dir, slug: 'wiki', enabled: true, appliedBy: 'test' });

    expect(await restorePluginsForProject({ orgId: FACTORY, projectSlug: 'squatch-factory', workspaceDir: dir, plugins: ['software-factory'], appliedBy: 'test:undo' })).toEqual({ applied: null, mode: 'project' });
    expect(await enabledOf(FACTORY)).toEqual(['software-factory']);
    expect(manifest(dir)).toMatch(/plugins: \[ ?wiki ?\]/);

    const own = await restorePluginsForProject({ orgId: REVENUE, projectSlug: 'metacto-revenue', workspaceDir: dir, plugins: [], appliedBy: 'test:undo' });

    expect(own.mode).toBe('workspace');
    expect(own.applied?.sha).toBeTruthy();
    expect(manifest(dir)).not.toContain('plugins');
  });
});
