import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PageManifestSchema, pagePlugin, readWorkspacePageContent, readWorkspacePages } from './pages';

// Plugin pages ride the same loader as workspace pages: an enabled plugin's
// pages/ dir joins the list, a same-slug workspace page wins, and prose is
// read beside the YAML that declared it.

const dirs: string[] = [];
let prevPath: string | undefined;

beforeEach(() => {
  prevPath = process.env.WORKSPACE_PATH;
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

function workspace(manifestBody: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pages-plugins-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: t\nname: t\n${manifestBody}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  process.env.WORKSPACE_PATH = dir;
  return dir;
}

describe('plugin pages', () => {
  it('an enabled plugin\'s pages appear with their origin and prose', () => {
    workspace('plugins: [wiki]\n');
    const { pages, issues } = readWorkspacePages();
    const wiki = pages.find(p => p.slug === 'wiki');
    const guide = pages.find(p => p.slug === 'wiki-guide');

    expect(issues).toEqual([]);
    expect(wiki?.origin).toBe('plugin:wiki');
    expect(wiki?.archetype).toBe('list');
    expect(wiki?.source).toMatchObject({ kind: 'artifacts', folder: 'wiki' });
    expect(guide?.nav.hidden).toBe(true);
    expect(readWorkspacePageContent(guide!)).toContain('# How the wiki works');
  });

  it('the software-factory floor is a list over the engineering_task object', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const floor = pages.find(p => p.slug === 'factory-floor');

    // The task is the record a person reads and the worker_run underneath it
    // is the lease — so the floor needs no worker-run source, only the
    // objects source the list archetype already has.
    expect(issues).toEqual([]);
    expect(floor?.origin).toBe('plugin:software-factory');
    expect(floor?.archetype).toBe('list');
    expect(floor?.source).toEqual({ kind: 'objects', objectType: 'engineering_task' });
    expect(floor?.stats?.map(s => s.label)).toContain('Waiting on a person');
    expect(floor?.rowLink).toBe('/dashboard/objects/{id}');
  });

  it('a workspace page with the same slug replaces the plugin\'s', () => {
    workspace('plugins: [wiki]\n', { 'pages/wiki.yaml': 'slug: wiki\ntitle: Our wiki\narchetype: markdown\n', 'pages/wiki.md': 'Ours.' });
    const { pages } = readWorkspacePages();
    const wiki = pages.filter(p => p.slug === 'wiki');

    expect(wiki).toHaveLength(1);
    expect(wiki[0]?.origin).toBe('workspace');
    expect(wiki[0]?.title).toBe('Our wiki');
    expect(readWorkspacePageContent(wiki[0]!)).toBe('Ours.');
  });

  it('a plugin that is off contributes nothing', () => {
    workspace('');

    expect(readWorkspacePages().pages.map(p => p.slug)).not.toContain('wiki');
  });

  it('names the plugin that shipped a page, and null for one the workspace wrote', () => {
    workspace('plugins: [wiki]\n', { 'pages/ours.yaml': 'slug: ours\ntitle: Ours\narchetype: markdown\n' });
    const { pages } = readWorkspacePages();

    // The panel a plugin page carries is decided by where the YAML came from,
    // never by the page's slug — so this is the one place `origin` is parsed.
    expect(pagePlugin(pages.find(p => p.slug === 'wiki')!)).toBe('wiki');
    expect(pagePlugin(pages.find(p => p.slug === 'ours')!)).toBeNull();
  });

  it('the artifacts source validates its narrowing', () => {
    expect(PageManifestSchema.safeParse({ slug: 'x', title: 'X', archetype: 'list', source: { kind: 'artifacts', folder: 'wiki', artifactKind: 'markdown' } }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ slug: 'x', title: 'X', archetype: 'list', source: { kind: 'artifacts', limit: 0 } }).success).toBe(false);
  });
});
