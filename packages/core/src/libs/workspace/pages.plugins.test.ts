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
    // Read as a wiki, not as a table of artifacts (2026-09-24).
    expect(wiki?.archetype).toBe('wiki');
    expect(wiki?.source).toMatchObject({ kind: 'artifacts', folder: 'wiki' });
    expect(wiki?.fields ?? []).toEqual([]);
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
    // draw nothing when there is nothing to say — and the picture, which is
    // drawn rather than said.
    // No fact row of internals under the card: every field is on the row's one line, or it is not on the page (Chris, 2026-09-25).
    expect(keys).toEqual(['title', 'visual', 'status', 'blocked', 'unmet', 'summary', 'detail', 'why', 'cost', 'product']);
    // Every field sits in the subtitle so the uppercase fact list never
    // draws: five labels a person reads past to reach five values. The
    // picture is the one exception, and it is not in the fact list either —
    // it leads the block, because "PREVIEW" over a thumbnail is a caption
    // saying what a person can already see.
    // What it is, the user problem, and what it needs — nothing else on the row (Chris, 2026-09-25).
    expect(work?.primary).toEqual({ field: 'title', thumb: 'visual', subtitle: ['status', 'blocked', 'unmet', 'summary', 'detail', 'why', 'cost', 'product'] });

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

  it('ships three pages a product exec decides from, and the hidden work item', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const mine = pages.filter(p => p.origin === 'plugin:software-factory');

    expect(issues).toEqual([]);
    // The loop a person actually walks: what I own (Products), what is
    // happening to it (Work), what reached production (Releases). Nothing
    // else. Factory, Factory log, Performance and Guide explained the machine
    // and were removed on 2026-09-24; the machine can be complicated, the
    // product cannot be.
    expect(mine.map(p => p.slug).sort()).toEqual(['feature', 'products', 'releases', 'work']);
    expect(mine.every(p => p.nav.section === 'Software factory')).toBe(true);
    expect(mine.filter(p => !p.nav.hidden && !p.nav.secondary).map(p => p.slug)).toEqual(['products', 'work', 'releases']);
    expect(mine.filter(p => p.nav.secondary)).toEqual([]);
    // Only the per-record work item stays off the nav: it is reached from the
    // row that names it.
    expect(mine.filter(p => p.nav.hidden).map(p => p.slug)).toEqual(['feature']);
    // Work is the one live page: states move as workers claim and finish.
    expect(mine.filter(p => p.live).map(p => p.slug)).toEqual(['work']);

    // The pages that were merged or cut away are gone, not hidden.
    for (const slug of ['activity', 'factory', 'guide', 'performance', 'backlog', 'recommendations', 'factory-floor', 'product-board', 'costs', 'factory-log', 'team-report', 'portfolio', 'changelog']) {
      expect(pages.find(p => p.slug === slug)).toBeUndefined();
    }
  });

  it('Products reads as a product card, not as a document', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const products = pages.find(p => p.slug === 'products');

    // The page answers one question, and says so in one line rather than in a
    // paragraph explaining itself.
    expect(products?.description).toBe('How are my products doing?');

    // EVERY field sits in the subtitle. A block draws its remaining fields as
    // a definition list with an uppercase heading over each value — OUR
    // PRICE, LAST SHIPPED, OPEN WORK — which asks a reader past five labels
    // to reach five values, and filled a phone screen with two products.
    const drawn = (products?.fields ?? []).filter(f => !f.detail).map(f => f.key);
    const subtitle = products?.primary?.subtitle ?? [];

    // The card (Chris, 2026-09-24): a mark, the name, one line saying what it
    // is for, then the least a person needs to decide whether to open it.
    expect(products?.primary?.thumb).toBe('icon');
    expect(subtitle).toEqual(['tagline', 'stage', 'health', 'line', 'deps', 'open', 'lastRelease']);
    expect(products?.derive).toBe('productBoard');
    // Tapping the card opens WORK as this product's work; the rest is one ⋯ away.
    expect(products?.rowLink).toBe('/dashboard/p/work?product={meta.slug}');
    expect(products?.rowActionsAs).toBe('menu');
    expect(products?.rowActions.map(a => a.label)).toEqual(['Open work', 'Releases', 'Product record', 'Wiki']);

    for (const key of drawn) {
      expect(key === products?.primary?.field || key === products?.primary?.thumb || subtitle.includes(key), `${key} is not in the subtitle`).toBe(true);
    }

    // "Last shipped" is internal factory language; a person running a product
    // says "last release", and the release is the thing they would open.
    expect(drawn).toContain('lastRelease');
    expect(drawn).not.toContain('lastShipped');

    // Freshness is never primary card content. It is `detail`, and on a
    // healthy row it is empty and the page drops it entirely.
    expect((products?.fields ?? []).find(f => f.key === 'updated')?.detail).toBe(true);
  });

  it('Products is the one product page, and says where its counters came from', () => {
    workspace('plugins: [software-factory]\n');
    const { pages } = readWorkspacePages();
    const products = pages.find(p => p.slug === 'products');
    const releases = pages.find(p => p.slug === 'releases');

    // Products absorbed the portfolio and the Product board, which were two
    // weaker copies of one page.
    expect(products?.source).toEqual({ kind: 'objects', objectType: 'product' });
    expect(products?.nav).toMatchObject({ section: 'Software factory', order: 1, secondary: false });
    expect(readWorkspacePageContent(products!)).toContain('monitoring not connected');
    // Releases came ON to the nav: what reached production, and what happened
    // to it afterwards, is a question a person asks daily — it is not
    // forensic. It is the one net-new top-level surface.
    expect(releases?.source).toEqual({ kind: 'objects', objectType: 'release' });
    expect(releases?.sort).toEqual({ field: 'meta.releasedAt', dir: 'desc' });
    expect(releases?.nav).toMatchObject({ section: 'Software factory', order: 3, hidden: false, secondary: false });
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
