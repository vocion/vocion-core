import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { eq } from 'drizzle-orm';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `plugin.enable` from a conversation, under a shared mount: for a project
 * whose folder is not the one mounted here, the card says where the write
 * goes, execute changes the project's list alone and carries the note, and
 * undo puts the list back the same way. The mounted project's manifest is
 * never edited from another project.
 */

vi.mock('@/libs/DB');
vi.mock('@/services/chat/synthesis', () => ({ invalidateChipCache: vi.fn() }));
// `@/routers/Workspace` (the folder resolver) imports AuthGuards, which pulls
// in next-auth and does not import cleanly here — a factory, as in
// Workspace.test.ts. The action itself never touches it.
vi.mock('@/routers/AuthGuards', () => ({
  guardAuth: vi.fn(),
  guardRole: vi.fn(),
  loadProject: vi.fn(),
}));

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema, workspaceVersionSchema } = await import('@/models/Schema');
const { pluginEnableAction } = await import('./plugin-enable');
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

describe('plugin.enable under a shared mount', () => {
  it('precheck lets another project through — its list can always be written', async () => {
    mount(REVENUE);

    expect(await pluginEnableAction.precheck!({ orgId: FACTORY }, { slug: 'wiki', enabled: true })).toBeUndefined();
    expect(await pluginEnableAction.precheck!({ orgId: FACTORY }, { slug: 'ghost', enabled: true })).toMatch(/no plugin "ghost"/);
  });

  it('the card says the write is this project\'s list only, and names the repo file', async () => {
    mount(REVENUE);
    const card = await pluginEnableAction.reviewCard!({ orgId: FACTORY }, { slug: 'wiki', enabled: true });

    expect(card.fields.find(f => f.label === 'Writes')?.value).toContain('workspace/squatch-factory/workspace.yaml');
    expect(card.nextAction).toContain('left alone');
    expect(card.nextAction).toContain('workspace/squatch-factory/workspace.yaml');

    const own = await pluginEnableAction.reviewCard!({ orgId: REVENUE }, { slug: 'wiki', enabled: true });

    expect(own.fields.find(f => f.label === 'Writes')).toBeUndefined();
    expect(own.nextAction).toContain('edits workspace.yaml');
  });

  it('execute leaves the folder alone, changes the project\'s list, and returns the note; undo puts it back', async () => {
    const dir = mount(REVENUE, 'plugins: [wiki]\n');
    const before = manifest(dir);
    const result = await pluginEnableAction.execute({ orgId: FACTORY, invokedBy: 'agent:orchestrator' }, { slug: 'proposals', enabled: true });

    expect(result).toMatchObject({ mode: 'project', applied: null, before: ['software-factory'], after: ['software-factory', 'data-rooms', 'proposals'], repoFile: 'workspace/squatch-factory/workspace.yaml' });
    expect(String(result.note)).toContain('applied from git');
    expect(manifest(dir)).toBe(before);
    expect(await enabledOf(FACTORY)).toEqual(['software-factory', 'data-rooms', 'proposals']);

    expect(await pluginEnableAction.undo!({ orgId: FACTORY }, { slug: 'proposals', enabled: true }, result)).toMatchObject({ restored: ['software-factory'], applied: null, mode: 'project' });
    expect(await enabledOf(FACTORY)).toEqual(['software-factory']);
    expect(manifest(dir)).toBe(before);
  });

  it('for the mounted project it edits the folder and applies, as before', async () => {
    const dir = mount(REVENUE);
    const result = await pluginEnableAction.execute({ orgId: REVENUE }, { slug: 'wiki', enabled: true });

    expect(result.mode).toBe('workspace');
    expect(result.note).toBeUndefined();
    expect(manifest(dir)).toMatch(/plugins: \[ wiki \]/);
    expect(await enabledOf(REVENUE)).toEqual(['wiki']);
  });
});
