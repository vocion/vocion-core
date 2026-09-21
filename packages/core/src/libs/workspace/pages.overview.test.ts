import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { PageManifestSchema, readWorkspacePages } from './pages';

// The `overview` archetype's manifest, and the Factory page the software
// factory plugin ships on it. Filesystem and schema only; what the panels
// COMPUTE is services/factory/overview.test.ts.

let dir: string | null = null;

function workspace(yaml: string) {
  dir = mkdtempSync(join(tmpdir(), 'wsx-overview-'));
  writeFileSync(join(dir, 'workspace.yaml'), yaml);
  process.env.WORKSPACE_PATH = dir;
}

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
  delete process.env.WORKSPACE_PATH;
});

const base = { slug: 'factory', title: 'Factory', archetype: 'overview' };
const panel = { kind: 'needsYou', title: 'Needs you' };

describe('the overview archetype', () => {
  it('is accepted with panels, and refused without them', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [panel] }).success).toBe(true);
    expect(PageManifestSchema.safeParse(base).success).toBe(false);
    expect(PageManifestSchema.safeParse({ ...base, panels: [] }).success).toBe(false);
  });

  it('says what an overview page is missing, rather than failing silently', () => {
    const result = PageManifestSchema.safeParse(base);

    expect(result.error?.issues.map(i => i.message)).toContain('an overview page needs panels - the ordered list it computes');
  });

  it('refuses panels on any other archetype, so a list page cannot half-become one', () => {
    const result = PageManifestSchema.safeParse({ slug: 'backlog', title: 'Backlog', archetype: 'list', panels: [panel] });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map(i => i.message)).toContain('panels belong to the overview archetype');
  });

  it('refuses a panel kind it does not implement, rather than drawing nothing', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'revenue', title: 'Revenue' }] }).success).toBe(false);
  });

  it('takes no rows, so it takes no live interval', () => {
    expect(PageManifestSchema.safeParse({ ...base, panels: [panel], live: { every: 15 } }).success).toBe(false);
  });

  it('caps a status panel at four facts - a row a person reads in one glance', () => {
    const facts = (n: number) => Array.from({ length: n }, (_, i) => ({ kind: 'field', label: `f${i}`, from: 'meta.x' }));

    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'status', title: 'S', objectType: 'product', facts: facts(4) }] }).success).toBe(true);
    expect(PageManifestSchema.safeParse({ ...base, panels: [{ kind: 'status', title: 'S', objectType: 'product', facts: facts(5) }] }).success).toBe(false);
  });

  it('defaults the active list to seven outcomes and the digest to a 24 hour fallback', () => {
    const parsed = PageManifestSchema.parse({
      ...base,
      panels: [
        { kind: 'active', title: 'Now', objectType: 'request', statusIn: ['active'] },
        { kind: 'digest', title: 'Since' },
        { kind: 'next', title: 'Next', objectType: 'request' },
      ],
    });
    const [active, digest, next] = parsed.panels!;

    expect(active).toMatchObject({ kind: 'active', limit: 7 });
    expect(digest).toMatchObject({ kind: 'digest', fallbackHours: 24 });
    // The rank orders the queue; the reason comes from meta.why, not from it.
    expect(next).toMatchObject({ kind: 'next', limit: 7, orderBy: 'meta.priority', noteFields: ['whyNote'] });
  });
});

describe('the Factory page the software factory ships', () => {
  it('is the landing page: first in Business, on the overview archetype', () => {
    workspace('plugins: [software-factory]\n');
    const { pages, issues } = readWorkspacePages();
    const factory = pages.find(p => p.slug === 'factory');

    expect(issues).toEqual([]);
    expect(factory).toMatchObject({ archetype: 'overview', title: 'Factory', origin: 'plugin:software-factory' });
    expect(factory?.nav).toMatchObject({ section: 'Business', order: 0, hidden: false });
  });

  it('answers all six questions, in order, and asks for no worker runs', () => {
    workspace('plugins: [software-factory]\n');
    const factory = readWorkspacePages().pages.find(p => p.slug === 'factory');

    expect(factory?.panels?.map(p => p.kind)).toEqual(['status', 'digest', 'active', 'next', 'needsYou', 'economics', 'autonomy']);

    // Worker runs are evidence and live on Activity. Every record type any
    // panel names is a noun a person asked for or owns, never a run.
    const types = [...JSON.stringify(factory?.panels).matchAll(/"objectType":"([^"]+)"/g)].map(m => m[1]);

    expect([...new Set(types)].sort()).toEqual(['engineering_task', 'product', 'release', 'request']);
  });

  it('grounds each panel in a record type the plugin actually defines', () => {
    workspace('plugins: [software-factory]\n');
    const factory = readWorkspacePages().pages.find(p => p.slug === 'factory');
    const [status, digest, active, next, , economics] = factory!.panels!;

    expect(status).toMatchObject({ kind: 'status', objectType: 'product' });
    expect(digest).toMatchObject({ kind: 'digest', rollups: [{ objectType: 'release', moneyField: 'meta.actualCents' }] });
    expect(active).toMatchObject({ kind: 'active', objectType: 'request', tasks: { objectType: 'engineering_task', joinField: 'meta.requestId' } });
    expect(next).toMatchObject({ kind: 'next', objectType: 'request', noteFields: ['whyNote', 'priorityReason'] });
    expect(economics).toMatchObject({ kind: 'economics', objectType: 'engineering_task', costField: 'meta.actualCents', wasteStatus: ['rejected', 'abandoned'] });
  });
});
