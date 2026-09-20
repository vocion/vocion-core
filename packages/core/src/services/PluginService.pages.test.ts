import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { readPageForOrg } = await import('./PluginService');

// The production shape: WORKSPACE_PATH mounts one project's folder
// (metacto-revenue, no software-factory) while another project on the same
// deployment (squatch-factory) has `plugins: [software-factory]` applied, so
// its row's enabled_plugins names the plugin the folder never will.

const FACTORY_ORG = 'proj_pages_squatch';
const PLAIN_ORG = 'proj_pages_plain';
const dirs: string[] = [];
let prevPath: string | undefined;

beforeAll(async () => {
  await db.insert(tenantAccountSchema).values({ id: 'acct-pages', name: 'MetaCTO', slug: 'metacto-pages' });
  await db.insert(projectSchema).values([
    { id: FACTORY_ORG, accountId: 'acct-pages', slug: 'squatch-factory', name: 'Squatch', enabledPlugins: ['software-factory'] },
    { id: PLAIN_ORG, accountId: 'acct-pages', slug: 'plain', name: 'Plain' },
  ]);
});

beforeEach(() => {
  prevPath = process.env.WORKSPACE_PATH;
  const dir = mkdtempSync(join(tmpdir(), 'pages-org-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: t\nname: metacto-revenue\nplugins: [wiki]\n');
  process.env.WORKSPACE_PATH = dir;
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

describe('readPageForOrg', () => {
  it('finds a page from a plugin only the project turned on', async () => {
    const floor = await readPageForOrg('factory-floor', FACTORY_ORG);

    expect(floor?.origin).toBe('plugin:software-factory');
    expect(floor?.archetype).toBe('list');
  });

  it('keeps the mounted workspace\'s plugin pages for every project', async () => {
    expect((await readPageForOrg('wiki', FACTORY_ORG))?.origin).toBe('plugin:wiki');
    expect((await readPageForOrg('wiki', PLAIN_ORG))?.origin).toBe('plugin:wiki');
  });

  it('hides a plugin page from a project that has not turned the plugin on', async () => {
    expect(await readPageForOrg('factory-floor', PLAIN_ORG)).toBeNull();
    expect(await readPageForOrg('factory-floor', 'proj_pages_no_row')).toBeNull();
  });
});
