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

  it('the software-factory ships five rows in its own section — three object lists, the run log, and a link to the team report', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const mine = pages.filter(p => p.origin === 'plugin:software-factory');

    expect(issues).toEqual([]);
    // The portfolio comes first (order 0) and its section is AppCurious; the
    // evidence pages sit under Software factory.
    expect(mine.map(p => p.slug)).toEqual(['portfolio', 'backlog', 'releases', 'changelog', 'factory-floor', 'product-board', 'factory-log', 'team-report']);
    expect(mine.filter(p => p.nav.section === 'AppCurious').map(p => p.slug)).toEqual(['portfolio', 'releases', 'changelog']);
    expect(mine.filter(p => p.nav.section === 'Software factory')).toHaveLength(5);
    expect(pages.find(p => p.slug === 'backlog')?.source).toEqual({ kind: 'objects', objectType: 'request' });
    expect(pages.find(p => p.slug === 'backlog')?.filters).toEqual([{ field: 'meta.state', op: 'in', value: ['new', 'triaged', 'in_scope'] }]);
    expect(pages.find(p => p.slug === 'product-board')?.source).toEqual({ kind: 'objects', objectType: 'product' });
    // The log is the workerRuns source; the PR column is a link into result.
    expect(pages.find(p => p.slug === 'factory-log')?.source).toEqual({ kind: 'workerRuns', kinds: ['worker', 'lead', 'red-team'], limit: 200 });
    expect(pages.find(p => p.slug === 'factory-log')?.fields?.find(f => f.key === 'pr')).toMatchObject({ from: 'meta.result.pr_url', format: 'link' });
    // The report is a row for a core route, not a second report.
    expect(pages.find(p => p.slug === 'team-report')).toMatchObject({ archetype: 'link', href: '/dashboard/team-report' });
  });

  it('the portfolio reads agent-maintained counters off the product record, and says so', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const portfolio = pages.find(p => p.slug === 'portfolio');
    const releases = pages.find(p => p.slug === 'releases');

    expect(portfolio?.source).toEqual({ kind: 'objects', objectType: 'product' });
    expect(portfolio?.nav).toMatchObject({ section: 'AppCurious', order: 0 });

    // Every maintained counter carries its provenance in the label; revenue says it has no source.
    const labels = portfolio?.fields?.map(f => f.label ?? f.key) ?? [];

    expect(labels.filter(l => l.includes('agent-maintained'))).toHaveLength(4);
    expect(labels).toContain('Revenue (no source yet)');
    expect(readWorkspacePageContent(portfolio!)).toContain('agent-maintained');
    expect(releases?.source).toEqual({ kind: 'objects', objectType: 'release' });
    expect(releases?.sort).toEqual({ field: 'meta.releasedAt', dir: 'desc' });
    // The changelog is the same rows for the public's eyes: the announcement line, never the diff.
    expect(pages.find(p => p.slug === 'changelog')).toMatchObject({ source: { kind: 'objects', objectType: 'release' }, nav: { section: 'AppCurious' } });
    expect(pages.find(p => p.slug === 'changelog')?.fields?.map(f => f.from)).toContain('meta.announcement');
    // Size class is on the backlog and the floor as a badge.
    expect(pages.find(p => p.slug === 'backlog')?.fields?.find(f => f.key === 'size')).toMatchObject({ from: 'meta.sizeClass', format: 'badge' });
    expect(pages.find(p => p.slug === 'factory-floor')?.fields?.find(f => f.key === 'size')).toMatchObject({ from: 'meta.sizeClass', format: 'badge' });
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

  // One mounted folder serves several projects, so the folder's `plugins:`
  // is only the primary project's word. The project's own list
  // (`project.enabled_plugins`) joins the same pipeline, same dedupe.
  describe('a project\'s own plugins', () => {
    it('contribute their pages when the mounted workspace has none on', () => {
      workspace('');
      const { pages, issues } = readWorkspacePages({ enabledPlugins: ['software-factory'] });
      const floor = pages.find(p => p.slug === 'factory-floor');

      expect(issues).toEqual([]);
      expect(floor?.origin).toBe('plugin:software-factory');
      expect(pagePlugin(floor!)).toBe('software-factory');
      expect(pages.map(p => p.slug)).not.toContain('wiki');
    });

    it('load beside the mounted workspace\'s plugins, each plugin once', () => {
      workspace('plugins: [wiki]\n');
      const { pages, issues } = readWorkspacePages({ enabledPlugins: ['wiki', 'software-factory'] });

      expect(issues).toEqual([]);
      expect(pages.filter(p => p.slug === 'wiki')).toHaveLength(1);
      expect(pages.find(p => p.slug === 'wiki')?.origin).toBe('plugin:wiki');
      expect(pages.find(p => p.slug === 'factory-floor')?.origin).toBe('plugin:software-factory');
    });

    it('still yield to a same-slug workspace page', () => {
      workspace('', { 'pages/factory-floor.yaml': 'slug: factory-floor\ntitle: Our floor\narchetype: markdown\n' });
      const floor = readWorkspacePages({ enabledPlugins: ['software-factory'] }).pages.filter(p => p.slug === 'factory-floor');

      expect(floor).toHaveLength(1);
      expect(floor[0]?.origin).toBe('workspace');
      expect(floor[0]?.title).toBe('Our floor');
    });

    it('are read even with no workspace mounted at all', () => {
      delete process.env.WORKSPACE_PATH;

      expect(readWorkspacePages({ enabledPlugins: ['software-factory'] }).pages.find(p => p.slug === 'factory-floor')?.origin).toBe('plugin:software-factory');
    });

    it('report a plugin this core no longer ships instead of throwing', () => {
      workspace('plugins: [wiki]\n');
      const { pages, issues } = readWorkspacePages({ enabledPlugins: ['ghost'] });

      expect(issues).toEqual([expect.objectContaining({ file: 'plugin:ghost' })]);
      expect(pages.find(p => p.slug === 'wiki')?.origin).toBe('plugin:wiki');
    });

    it('change nothing when no list is given', () => {
      workspace('plugins: [wiki]\n');

      expect(readWorkspacePages().pages.map(p => p.slug)).toEqual(readWorkspacePages({}).pages.map(p => p.slug));
      expect(readWorkspacePages().pages.map(p => p.slug)).not.toContain('factory-floor');
    });
  });

  // One folder is mounted for several projects. Its own pages, and its
  // plugins' pages, are the mounted project's; another project under the
  // same mount sees only its own plugins' pages.
  describe('a folder that is another project\'s', () => {
    it('contributes neither its pages nor its plugins\' when mounted is false', () => {
      workspace('plugins: [wiki]\n', { 'pages/ours.yaml': 'slug: ours\ntitle: Ours\narchetype: markdown\n' });
      const { pages, issues } = readWorkspacePages({ enabledPlugins: ['software-factory'], mounted: false });

      expect(issues).toEqual([]);
      expect(pages.map(p => p.slug)).not.toContain('ours');
      expect(pages.map(p => p.slug)).not.toContain('wiki');
      expect(pages.find(p => p.slug === 'factory-floor')?.origin).toBe('plugin:software-factory');
    });

    it('is read in full for the project it belongs to, and by default', () => {
      workspace('plugins: [wiki]\n', { 'pages/ours.yaml': 'slug: ours\ntitle: Ours\narchetype: markdown\n' });

      expect(readWorkspacePages({ mounted: true }).pages.map(p => p.slug)).toEqual(expect.arrayContaining(['ours', 'wiki']));
      expect(readWorkspacePages().pages.map(p => p.slug)).toEqual(expect.arrayContaining(['ours', 'wiki']));
    });

    it('a project with no plugins of its own sees nothing under a foreign mount', () => {
      workspace('plugins: [wiki]\n', { 'pages/ours.yaml': 'slug: ours\ntitle: Ours\narchetype: markdown\n' });

      expect(readWorkspacePages({ enabledPlugins: [], mounted: false }).pages).toEqual([]);
    });
  });

  it('the artifacts source validates its narrowing', () => {
    expect(PageManifestSchema.safeParse({ slug: 'x', title: 'X', archetype: 'list', source: { kind: 'artifacts', folder: 'wiki', artifactKind: 'markdown' } }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ slug: 'x', title: 'X', archetype: 'list', source: { kind: 'artifacts', limit: 0 } }).success).toBe(false);
  });
});
