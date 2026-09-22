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

  it('Work is one queue over the request noun, read as four lanes', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');

    // Work replaced the Backlog, Recommendations and the Factory floor. Those
    // were three views of one thing. The outcome is the row, and the seven
    // internal states are read as the four lanes a person manages, by the
    // named derivation rather than by the manifest.
    expect(issues).toEqual([]);
    expect(work?.origin).toBe('plugin:software-factory');
    expect(work?.archetype).toBe('list');
    expect(work?.source).toEqual({ kind: 'objects', objectType: 'request' });
    expect(work?.derive).toBe('workQueue');
    expect(work?.groupBy).toBe('meta.lane');
    expect(work?.sort).toEqual({ field: 'meta.order', dir: 'asc' });
    // The row IS the drill-down; the "Report" affordance beside it is gone.
    expect(work?.rowLink).toBe('/dashboard/p/feature/{id}');
    expect(work?.rowActions).toEqual([]);
  });

  it('Work carries no figures on top, because each tab counts itself', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');

    // The four-figure top line was three of the same numbers the tabs now
    // carry, said twice, over a queue two of them had already summarised.
    expect(work?.stats ?? []).toEqual([]);
    expect(work?.groupsAs).toBe('tabs');
    expect(work?.groupBy).toBe('meta.lane');
    // Blocks, not a table: sixteen columns on a phone was a sideways scroll.
    expect(work?.layout).toBe('block');
  });

  it('a Work row is about five things, and says why in words', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');
    const keys = work?.fields?.map(f => f.key) ?? [];

    // The outcome, why it is here, what is happening to it, which product,
    // what it costs. Plus the rank and the conditional facts, both of which
    // draw nothing when there is nothing to say.
    expect(keys).toEqual(['title', 'status', 'gap', 'flags', 'detail', 'why', 'cost', 'product', 'rank']);
    // Every field sits in the subtitle so the uppercase fact list never
    // draws: five labels a person reads past to reach five values.
    expect(work?.primary).toEqual({ field: 'title', subtitle: ['status', 'gap', 'flags', 'rank', 'detail', 'why', 'cost', 'product'] });

    // Sixteen fields became these. The record's own vocabulary is gone.
    // `status` is the derived badge — "Blocked", "Decide" — never the
    // record's own `state`, which is where `triaged` and `in_scope` live.
    for (const gone of ['state', 'decision', 'proposed', 'kind', 'severity', 'size', 'channel', 'tasks', 'estimate', 'actual', 'asked', 'decided', 'reason']) {
      expect(keys).not.toContain(gone);
    }
  });

  it('every Work row carries a reason in human words, never a code and never a bare priority', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const work = pages.find(p => p.slug === 'work');
    const keys = work?.fields?.map(f => f.key) ?? [];

    // A number like 62 explains nothing, and neither does `manual_toil`. The
    // codes are still the closed list underneath; the row reads the sentence
    // the derivation built from them, and a row with no reason says nothing
    // at all rather than "not recorded".
    expect(keys).toContain('why');
    expect(work?.fields?.find(f => f.key === 'why')).toMatchObject({ from: 'meta.whyLine' });
    expect(work?.fields?.some(f => f.from === 'meta.why')).toBe(false);
    expect(work?.fields?.some(f => f.from === 'meta.priority')).toBe(false);
    expect(keys).not.toContain('priority');
  });

  it('the software factory ships five surfaces, not ten, and buries the evidence', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const mine = pages.filter(p => p.origin === 'plugin:software-factory');

    expect(issues).toEqual([]);
    // Business is what a person manages: the 60-second control plane, the
    // products, the queue, the economics, and what a person wants next.
    // Activity is evidence and lives under Advanced. The feature report and
    // the releases detail are reached from a row rather than from the nav.
    expect(mine.map(p => p.slug).sort()).toEqual(['activity', 'factory', 'feature', 'guide', 'performance', 'products', 'releases', 'work']);
    expect(mine.filter(p => p.nav.section === 'Business' && !p.nav.hidden).map(p => p.slug)).toEqual(['factory', 'products', 'work', 'performance', 'guide']);
    expect(mine.filter(p => p.nav.section === 'Advanced' && !p.nav.hidden).map(p => p.slug)).toEqual(['activity']);
    expect(mine.filter(p => p.nav.hidden).map(p => p.slug).sort()).toEqual(['feature', 'releases']);

    // Guide is the fourth verb: what a person wants next. It is a row in
    // Business rather than an object list, because operating intent is a file
    // in the workspace and the core route at /dashboard/guide renders it.
    expect(pages.find(p => p.slug === 'guide')).toMatchObject({ archetype: 'link', href: '/dashboard/guide', nav: { section: 'Business', order: 4 } });

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

  it('Activity splits the four facts one status column was carrying', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const activity = pages.find(p => p.slug === 'activity');
    const fields = Object.fromEntries((activity?.fields ?? []).map(f => [f.key, f]));
    const stats = Object.fromEntries((activity?.stats ?? []).map(st => [st.label, st]));

    expect(issues).toEqual([]);
    // Execution, verification, output and task disposition are four columns
    // reading four accessors. The row that said "failed / complete / passed /
    // opened" can no longer be written, because nothing on this page reads
    // `status` as the answer to all four questions.
    expect(fields.execution).toMatchObject({ from: 'meta.execution', format: 'badge' });
    expect(fields.verification).toMatchObject({ from: 'meta.verification', format: 'badge' });
    expect(fields.output).toMatchObject({ from: 'meta.output', format: 'badge' });
    expect(fields.disposition).toMatchObject({ from: 'meta.disposition', format: 'badge' });
    expect(fields.failureClass).toMatchObject({ from: 'meta.failureClass', format: 'badge' });
    expect(fields.recovery).toMatchObject({ from: 'meta.recoveryNote' });
    // The raw column is still reachable, as evidence inside the row.
    expect(fields.rawStatus).toMatchObject({ from: 'status', detail: true });

    // The unit is the task, not the run.
    expect(activity?.groupBy).toBe('meta.taskKey');
    // Default row: what happened, then result, recovery, cost, duration, PR, time.
    expect(activity?.primary).toEqual({ field: 'headline', subtitle: ['execution', 'verification', 'output', 'failureClass', 'recovery'] });
    expect((activity?.fields ?? []).filter(f => !f.detail).map(f => f.key))
      .toEqual(['headline', 'execution', 'verification', 'output', 'disposition', 'failureClass', 'recovery', 'cents', 'duration', 'pr', 'created']);

    // The number the old strip never reported, plus the one that beats it.
    expect(Object.keys(stats)).toContain('Failed');
    expect(stats.Failed).toMatchObject({ kind: 'countWhere', where: { field: 'meta.execution', op: 'eq', value: 'failed' } });
    expect(stats.Recovered).toMatchObject({ where: { field: 'meta.recovery', op: 'in', value: ['retried', 'preserved'] } });
    expect(stats.Unresolved).toMatchObject({ where: { field: 'meta.recovery', op: 'eq', value: 'unresolved' } });
    expect(stats.Spend).toMatchObject({ kind: 'sum', field: 'meta.cents', format: 'money' });
    expect(stats['Spend on unsuccessful attempts']).toMatchObject({ kind: 'sum', where: { field: 'meta.successful', op: 'eq', value: false } });
    // "0 lost" is a tile spent saying a thing did not happen.
    expect(stats.Lost).toMatchObject({ hideWhenZero: true });

    // Every heartbeat-era field is evidence now, not a column.
    for (const key of ['agent', 'model', 'tokens', 'heartbeat', 'lease', 'summary', 'progress']) {
      expect(fields[key]).toMatchObject({ detail: true });
    }

    // Activity means activity: the timeline is the default, the run table is
    // a view, and the surfaces that are genuinely other records say so.
    expect((activity?.views ?? []).map(v => v.key)).toEqual(['all', 'runs', 'unresolved', 'contract', 'environment', 'verification', 'releases', 'decisions']);
    expect(activity?.views?.[0]?.key).toBe('all');
    expect(activity?.views?.[0]?.filters).toBeUndefined();
    expect(activity?.views?.find(v => v.key === 'releases')).toMatchObject({ href: '/dashboard/p/releases' });

    // Back to the outcome the run served: the report when the run named a
    // request, the task record when it only named a task.
    expect(activity?.rowActions).toEqual([{ label: 'Outcome', href: ['/dashboard/p/feature/{meta.requestId}', '/dashboard/objects/{meta.taskRecordId}'] }]);
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

  it('Performance answers one question, in four numbers that each carry their direction', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const perf = pages.find(p => p.slug === 'performance');
    const stats = Object.fromEntries((perf?.stats ?? []).map(s => [s.label, s]));
    const headline = (perf?.stats ?? []).filter(s => s.group === undefined).map(s => s.label);

    expect(issues).toEqual([]);
    expect(perf?.source).toEqual({ kind: 'objects', objectType: 'request' });
    // It is its figures. Listing the requests under them made it a second
    // Backlog — the same rows, in a worse order, under headings that were not
    // about them. The source stays, because the figures come from it.
    expect(perf?.showRows).toBe(false);
    expect(perf?.fields ?? []).toEqual([]);

    // FOUR headline numbers: are we shipping faster, is quality holding, is
    // it costing less, does it need less of me.
    expect(headline).toEqual([
      'Speed to release',
      'Cost per release',
      'Accepted first pass',
      'Human time per release',
    ]);

    // Every one of them carries its DIRECTION. A figure alone is nearly
    // unreadable: "$1.28 per release" says almost nothing against "$1.28,
    // down 38%".
    for (const label of headline) {
      expect(stats[label]?.compare).toBe('prior');
      expect(stats[label]?.goodWhen).toBeDefined();
    }

    // Which way is GOOD is declared, never inferred: cost falling is good and
    // quality falling is not, and no arithmetic can tell them apart.
    expect(stats['Cost per release']?.goodWhen).toBe('down');
    expect(stats['Accepted first pass']?.goodWhen).toBe('up');

    // One canonical unit. A reader who divides any two figures gets a third,
    // which is only true while they all count releases.
    expect(stats['Cost per release']).toMatchObject({
      kind: 'ratio',
      field: 'meta.actualCents',
      format: 'money',
      where: { field: 'meta.state', op: 'eq', value: 'shipped' },
    });
    // "Outcome" is abstract AI language; release is software language. It is
    // gone from every LABEL — the notes may still use the word in prose where
    // they are describing something that is genuinely not a release.
    expect((perf?.stats ?? []).map(s => s.label).join(' ')).not.toMatch(/outcome/i);

    // An honest answer is not waste, and rework is still the figure that
    // replaced it — now under Needs attention, hidden while it is zero.
    expect(Object.keys(stats).some(l => /waste/i.test(l))).toBe(false);
    expect(stats['Rework spend']).toMatchObject({ kind: 'sum', field: 'meta.reworkCents', format: 'money', hideWhenZero: true });
    expect(stats['Defects reported']?.hideWhenZero).toBe(true);
    expect(JSON.stringify(perf?.stats)).not.toContain('"value":"answered"');

    // Every figure still says what it counts — as DATA the methodology page
    // is written from, not as a paragraph under each tile.
    for (const s of perf?.stats ?? []) {
      expect(s.note, `${s.label} has no note`).toBeTruthy();
    }
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
