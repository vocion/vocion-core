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

  it('Work is one queue over the request noun, and the outcome is the row', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');

    // Work replaced the Backlog, Recommendations and the Factory floor. Those
    // were three views of one thing. The request is the row; the engineering
    // tasks it spawned are COUNTED on it, and the chain of contract, runs,
    // checks and pull request is one tap away on the report.
    expect(issues).toEqual([]);
    expect(work?.origin).toBe('plugin:software-factory');
    expect(work?.archetype).toBe('list');
    expect(work?.source).toEqual({ kind: 'objects', objectType: 'request' });
    expect(work?.groupBy).toBe('meta.state');
    expect(work?.stats?.map(s => s.label)).toContain('Waiting on a person');
    expect(work?.fields?.find(f => f.key === 'tasks')).toMatchObject({ from: 'meta.taskCount' });
    expect(work?.rowLink).toBe('/dashboard/objects/{id}');
    expect(work?.rowActions).toEqual([{ label: 'Report', href: '/dashboard/p/feature/{id}' }]);
    // Declined requests are the archive, not the queue.
    expect(work?.filters).toEqual([{ field: 'meta.state', op: 'neq', value: 'out_of_scope' }]);
  });

  it('every Work row carries a reason from the closed list, never a bare priority', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');
    const keys = work?.fields?.map(f => f.key) ?? [];

    // A number like 62 explains nothing. `meta.why` is the closed list of
    // reason codes and `meta.priorityReason` is the same judgement in a
    // sentence. A request ranked before the codes existed shows an empty
    // cell, which is honest; a number in its place would not be.
    expect(keys).toContain('why');
    expect(work?.fields?.find(f => f.key === 'why')).toMatchObject({ from: 'meta.why' });
    expect(work?.fields?.find(f => f.key === 'reason')).toMatchObject({ from: 'meta.priorityReason' });
    expect(keys).not.toContain('priority');
    expect(work?.fields?.some(f => f.from === 'meta.priority')).toBe(false);
  });

  it('the software factory ships five surfaces, not ten, and buries the evidence', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const mine = pages.filter(p => p.origin === 'plugin:software-factory');

    expect(issues).toEqual([]);
    // Business is what a person manages: the 60-second control plane, the
    // products, the queue, the economics. Activity is evidence and lives
    // under Advanced. The feature report and the releases detail are reached
    // from a row rather than from the nav.
    expect(mine.map(p => p.slug).sort()).toEqual(['activity', 'factory', 'feature', 'performance', 'products', 'releases', 'work']);
    expect(mine.filter(p => p.nav.section === 'Business' && !p.nav.hidden).map(p => p.slug)).toEqual(['factory', 'products', 'work', 'performance']);
    expect(mine.filter(p => p.nav.section === 'Advanced' && !p.nav.hidden).map(p => p.slug)).toEqual(['activity']);
    expect(mine.filter(p => p.nav.hidden).map(p => p.slug).sort()).toEqual(['feature', 'releases']);

    // The pages that were merged away are gone, not hidden.
    for (const slug of ['backlog', 'recommendations', 'factory-floor', 'product-board', 'costs', 'factory-log', 'team-report', 'portfolio', 'changelog']) {
      expect(pages.find(p => p.slug === slug)).toBeUndefined();
    }
  });

  it('Work and Activity are live, and Activity reads the worker heartbeat', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const activity = pages.find(p => p.slug === 'activity');
    const fields = Object.fromEntries((activity?.fields ?? []).map(f => [f.key, f]));

    // A worker heartbeats every ~30s; 15s keeps a running row moving without
    // a request the database would notice. No other page is live.
    expect(issues).toEqual([]);
    expect(pages.find(p => p.slug === 'work')?.live).toEqual({ every: 15 });
    expect(activity?.live).toEqual({ every: 15 });
    expect(pages.filter(p => p.origin === 'plugin:software-factory' && p.live).map(p => p.slug).sort()).toEqual(['activity', 'work']);
    expect(activity?.source).toEqual({ kind: 'workerRuns', kinds: ['worker', 'lead', 'red-team'], limit: 200 });
    // What the worker said, when it last spoke, how long its lease holds, whether it was told to stop.
    expect(fields.progress).toMatchObject({ from: 'meta.progress', format: 'progress' });
    expect(fields.heartbeat).toMatchObject({ from: 'meta.heartbeatAt', format: 'relative' });
    expect(fields.lease).toMatchObject({ from: 'meta.leaseExpiresAt', format: 'relative' });
    expect(fields.stop).toMatchObject({ from: 'meta.stopRequested', format: 'badge', tones: { true: 'warn' } });
  });

  it('Products is the one product page, and says where its counters came from', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const products = pages.find(p => p.slug === 'products');
    const releases = pages.find(p => p.slug === 'releases');

    // Products absorbed the portfolio and the Product board, which were two
    // weaker copies of one page.
    expect(products?.source).toEqual({ kind: 'objects', objectType: 'product' });
    expect(products?.nav).toMatchObject({ section: 'Business', order: 1 });
    expect(readWorkspacePageContent(products!)).toContain('agent-maintained');
    // Releases keeps the detail, off the nav, newest first.
    expect(releases?.source).toEqual({ kind: 'objects', objectType: 'release' });
    expect(releases?.sort).toEqual({ field: 'meta.releasedAt', dir: 'desc' });
    expect(releases?.nav.hidden).toBe(true);
  });

  it('Performance leads with four numbers and never blends the two autonomy measures', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const perf = pages.find(p => p.slug === 'performance');
    const fields = Object.fromEntries((perf?.fields ?? []).map(f => [f.key, f]));
    const labels = (perf?.stats ?? []).map(s => s.label);

    expect(issues).toEqual([]);
    // Rows are requests; the figures are rolled up onto the record when a
    // task's cost is written, so the page never computes across types.
    expect(perf?.source).toEqual({ kind: 'objects', objectType: 'request' });
    expect(perf?.groupBy).toBe('meta.tags');
    expect(fields.estimate).toMatchObject({ from: 'meta.estimateCents', format: 'money', total: true });
    expect(fields.actual).toMatchObject({ from: 'meta.actualCents', format: 'money', total: true });
    expect(fields.variance).toMatchObject({ from: 'meta.varianceCents', format: 'money', total: true });

    // The four headline numbers come first, in order, before the evidence.
    expect(labels.slice(0, 4)).toEqual([
      'Spent this month',
      'Accepted changes (requests shipped)',
      'Cost per accepted change',
      'Waste: spent, then answered instead of shipped',
    ]);

    // Work autonomy and human attention are named separately. "94%
    // auto-completed" beside "32 need attention" creates questions, not
    // confidence, so neither is averaged into the other.
    expect(labels.filter(l => l.startsWith('Work autonomy:'))).toHaveLength(2);
    expect(labels.filter(l => l.startsWith('Human attention:'))).toHaveLength(2);
    expect(labels.some(l => /^Autonomy$/.test(l))).toBe(false);

    const stats = Object.fromEntries((perf?.stats ?? []).map(s => [s.label, s]));

    expect(stats['Spent this month']).toMatchObject({ kind: 'sum', where: { field: 'meta.rollupsUpdatedAt', op: 'since', value: 'month' } });
    expect(stats['Average cost of a feature']).toMatchObject({ kind: 'avg', format: 'money', where: { op: 'in', value: ['gap', 'idea'] } });
    expect(stats['Average cost of a bug']).toMatchObject({ kind: 'avg', format: 'money', where: { op: 'eq', value: 'bug' } });
    expect(readWorkspacePageContent(perf!)).toContain('estimated');
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
      const work = pages.find(p => p.slug === 'work');

      expect(issues).toEqual([]);
      expect(work?.origin).toBe('plugin:software-factory');
      expect(pagePlugin(work!)).toBe('software-factory');
      expect(pages.map(p => p.slug)).not.toContain('wiki');
    });

    it('load beside the mounted workspace\'s plugins, each plugin once', () => {
      workspace('plugins: [wiki]\n');
      const { pages, issues } = readWorkspacePages({ enabledPlugins: ['wiki', 'software-factory'] });

      expect(issues).toEqual([]);
      expect(pages.filter(p => p.slug === 'wiki')).toHaveLength(1);
      expect(pages.find(p => p.slug === 'wiki')?.origin).toBe('plugin:wiki');
      expect(pages.find(p => p.slug === 'work')?.origin).toBe('plugin:software-factory');
    });

    it('still yield to a same-slug workspace page', () => {
      workspace('', { 'pages/work.yaml': 'slug: work\ntitle: Our work\narchetype: markdown\n' });
      const work = readWorkspacePages({ enabledPlugins: ['software-factory'] }).pages.filter(p => p.slug === 'work');

      expect(work).toHaveLength(1);
      expect(work[0]?.origin).toBe('workspace');
      expect(work[0]?.title).toBe('Our work');
    });

    it('are read even with no workspace mounted at all', () => {
      delete process.env.WORKSPACE_PATH;

      expect(readWorkspacePages({ enabledPlugins: ['software-factory'] }).pages.find(p => p.slug === 'work')?.origin).toBe('plugin:software-factory');
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
      expect(readWorkspacePages().pages.map(p => p.slug)).not.toContain('work');
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
      expect(pages.find(p => p.slug === 'work')?.origin).toBe('plugin:software-factory');
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
