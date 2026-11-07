import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('@/libs/repo-root', () => ({ fromRepoRoot: () => fixture.root }));
const { loadPlugin, resolvePlugins, withoutPluginDependents } = await import('./plugins');

function module(slug: string, manifest: Record<string, unknown> = {}, types: string[] = [], pages: Record<string, unknown> = {}) {
  const dir = join(fixture.root, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.yaml'), stringify({ slug, name: slug, version: '1.0.0', description: 'A fixture module', ...manifest }));
  for (const type of types) {
    mkdirSync(join(dir, 'objects', type), { recursive: true });
    writeFileSync(join(dir, 'objects', type, 'type.yaml'), stringify({ slug: type, label: type }));
  }
  for (const [name, body] of Object.entries(pages)) {
    mkdirSync(join(dir, 'pages'), { recursive: true });
    writeFileSync(join(dir, 'pages', `${name}.yaml`), stringify(body));
  }
}

beforeEach(() => {
  fixture.root = mkdtempSync(join(tmpdir(), 'module-contract-'));
});

afterEach(() => {
  rmSync(fixture.root, { recursive: true, force: true });
});

describe('native module data contracts', () => {
  it('mounts a consumer collection over a dependency export without copying its type', () => {
    module('crm', { data: { exports: ['company'] } }, ['company']);
    module('delivery', {
      depends: ['crm'],
      data: { imports: [{ module: 'crm', objects: ['company'] }], collections: [{ page: 'customers', objectType: 'company' }] },
    }, [], { customers: { slug: 'customers', title: 'Customers', archetype: 'list', source: { kind: 'objects', objectType: 'company' } } });

    expect(resolvePlugins(['delivery']).map(p => p.manifest.slug)).toEqual(['crm', 'delivery']);
  });

  it('refuses dangling exports and undeclared imports before install', () => {
    module('crm', { data: { exports: ['company'] } });

    expect(() => resolvePlugins(['crm'])).toThrow('no owned object definition');

    module('crm', { data: { exports: ['company'] } }, ['company']);
    module('delivery', { data: { imports: [{ module: 'crm', objects: ['company'] }] } });

    expect(() => resolvePlugins(['crm', 'delivery'])).toThrow('explicit depends');
  });

  it('refuses reading a private type through an import', () => {
    module('crm', { data: { exports: [] } }, ['company']);
    module('delivery', { depends: ['crm'], data: { imports: [{ module: 'crm', objects: ['company'] }] } });

    expect(() => resolvePlugins(['delivery'])).toThrow('does not export');
  });

  it('refuses competing ownership and miswired collection pages', () => {
    module('crm', {}, ['company']);
    module('delivery', {}, ['company']);

    expect(() => resolvePlugins(['crm', 'delivery'])).toThrow('shipped by both');

    module('crm', { data: { collections: [{ page: 'customers', objectType: 'company' }] } }, ['company'], {
      customers: { slug: 'customers', title: 'Customers', archetype: 'list', source: { kind: 'objects', objectType: 'unrelated' } },
    });

    expect(() => resolvePlugins(['crm'])).toThrow('must be a list over');
  });

  it('disables every transitive dependent while retaining unrelated modules', () => {
    module('crm');
    module('sales', { depends: ['crm'] });
    module('forecast', { depends: ['sales'] });
    module('wiki');
    const remaining = withoutPluginDependents(['forecast', 'wiki'], 'crm');

    expect(remaining).toEqual(['wiki']);
    expect(resolvePlugins(remaining).map(p => p.manifest.slug)).toEqual(['wiki']);
    expect(withoutPluginDependents(['crm', 'sales', 'forecast', 'wiki'], 'sales')).toEqual(['crm', 'wiki']);
  });

  it('rejects traversal and dependency cycles', () => {
    expect(() => loadPlugin('../outside')).toThrow('invalid plugin slug');

    module('crm', { depends: ['sales'] });
    module('sales', { depends: ['crm'] });

    expect(() => resolvePlugins(['crm'])).toThrow('dependency cycle');
  });
});
