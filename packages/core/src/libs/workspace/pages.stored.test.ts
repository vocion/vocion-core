/**
 * Pages from a project's stored workspace: given the manifests an apply
 * stored, they ARE the project's pages — the mounted folder is not read for
 * them, its plugins do not join, and the project's own plugins still do.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readWorkspacePageContent, readWorkspacePages } from './pages';

const ORG = 'proj_bellwater';
let mounted: string;
const saved = { path: process.env.WORKSPACE_PATH, vars: process.env.WORKSPACE_TEMPLATE_VARS, url: process.env.BELLWATER_URL };

beforeEach(() => {
  // A mounted folder with a page and a plugin of its own — another project's.
  mounted = mkdtempSync(join(tmpdir(), 'pages-stored-'));
  mkdirSync(join(mounted, 'pages'), { recursive: true });
  writeFileSync(join(mounted, 'workspace.yaml'), 'version: 1\norgId: proj_other\nname: other\nplugins: [wiki]\n');
  writeFileSync(join(mounted, 'pages', 'theirs.yaml'), 'slug: theirs\ntitle: Theirs\narchetype: markdown\n');
  process.env.WORKSPACE_PATH = mounted;
  process.env.WORKSPACE_TEMPLATE_VARS = 'BELLWATER_URL';
  process.env.BELLWATER_URL = 'https://bellwater.example';
});

afterEach(() => {
  rmSync(mounted, { recursive: true, force: true });
  for (const [name, value] of [['WORKSPACE_PATH', saved.path], ['WORKSPACE_TEMPLATE_VARS', saved.vars], ['BELLWATER_URL', saved.url]] as const) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe('readWorkspacePages with stored manifests', () => {
  it('reads the stored manifests instead of any folder, resolving tokens and reporting a bad one by name', () => {
    const files = new Map([
      ['pages/events.yaml', 'slug: events\ntitle: Events at {{env.BELLWATER_URL}}\narchetype: markdown\n'],
      ['pages/broken.yaml', 'slug: broken\n'],
      ['pages/tour.yaml', 'steps: []\n'],
      ['pages/nested/deep.yaml', 'slug: deep\ntitle: Deep\narchetype: markdown\n'],
      ['pages/events.md', '# Events'],
    ]);

    const { pages, issues } = readWorkspacePages({ stored: { orgId: ORG, files } });

    expect(pages.map(p => p.slug)).toEqual(['events']);
    expect(pages[0]).toMatchObject({ title: 'Events at https://bellwater.example', origin: 'workspace', storedIn: ORG, sourceDir: 'pages' });
    expect(issues.map(i => i.file)).toEqual(['broken.yaml']);
    // The mounted folder's own page and its plugin's pages did not join.
    expect(pages.some(p => p.slug === 'theirs' || p.origin.startsWith('plugin:'))).toBe(false);
  });

  it('the project\'s own plugins still join, and its pages shadow theirs by slug', () => {
    const files = new Map([['pages/wiki.yaml', 'slug: wiki\ntitle: Our wiki\narchetype: markdown\n']]);

    const { pages } = readWorkspacePages({ stored: { orgId: ORG, files }, enabledPlugins: ['wiki'] });
    const wiki = pages.find(p => p.slug === 'wiki');

    expect(wiki).toMatchObject({ title: 'Our wiki', origin: 'workspace', overrides: 'plugin:wiki' });
    expect(pages.some(p => p.origin === 'plugin:wiki')).toBe(true);
  });

  it('a stored page\'s prose is never read off this disk — its sourceDir is a place in the store', () => {
    // A `pages/events.md` relative to the working directory must not answer.
    const { pages } = readWorkspacePages({ stored: { orgId: ORG, files: new Map([['pages/events.yaml', 'slug: events\ntitle: Events\narchetype: markdown\n']]) } });

    expect(readWorkspacePageContent(pages[0]!)).toBeNull();
  });
});
