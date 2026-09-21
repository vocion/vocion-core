import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { projectSchema, tenantAccountSchema } = await import('@/models/Schema');
const { readPageForOrg } = await import('./PluginService');
const { invalidateCurrentContextShaCache } = await import('@/libs/workspace/current-version');

// The production shape: WORKSPACE_PATH mounts one project's folder
// (metacto-revenue, no software-factory) while another project on the same
// deployment (squatch-factory) has `plugins: [software-factory]` applied, so
// its row's enabled_plugins names the plugin the folder never will — and the
// folder's own pages (revenue's wiki) are not squatch-factory's to show.

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
  // The folder names the project it belongs to; nothing has been applied yet.
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: ${PLAIN_ORG}\nname: metacto-revenue\nplugins: [wiki]\n`);
  mkdirSync(join(dir, 'pages'));
  writeFileSync(join(dir, 'pages', 'ours.yaml'), 'slug: ours\ntitle: Ours\narchetype: markdown\n');
  process.env.WORKSPACE_PATH = dir;
  invalidateCurrentContextShaCache();
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

  it('shows the mounted folder\'s pages — its own and its plugins\' — to the project the folder belongs to', async () => {
    expect((await readPageForOrg('wiki', PLAIN_ORG))?.origin).toBe('plugin:wiki');
    expect((await readPageForOrg('ours', PLAIN_ORG))?.origin).toBe('workspace');
  });

  it('hides the mounted folder\'s pages from another project under the same mount', async () => {
    // squatch-factory never authored revenue's wiki or its pages/ — only its
    // own plugins' pages are its to see.
    expect(await readPageForOrg('wiki', FACTORY_ORG)).toBeNull();
    expect(await readPageForOrg('ours', FACTORY_ORG)).toBeNull();
    expect((await readPageForOrg('factory-floor', FACTORY_ORG))?.origin).toBe('plugin:software-factory');
  });

  it('hides a plugin page from a project that has not turned the plugin on', async () => {
    expect(await readPageForOrg('factory-floor', PLAIN_ORG)).toBeNull();
    expect(await readPageForOrg('factory-floor', 'proj_pages_no_row')).toBeNull();
  });
});
