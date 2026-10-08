/**
 * The build-time loader: where it looks for an enterprise package, the
 * snapshot it makes, and the stubs it falls back to. Real directories under
 * the OS temp dir, a fake monorepo per test.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ENTERPRISE_SNAPSHOT_DIR, findEnterprise, linkEnterprise } from './enterpriseCheckout';

let root: string;
let core: string;

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vocion-enterprise-'));
  core = join(root, 'packages/core');
  mkdirSync(core, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('without an enterprise package', () => {
  it('resolves both specifiers to the empty stubs and clears a stale snapshot', () => {
    write(join(core, ENTERPRISE_SNAPSHOT_DIR, 'index.ts'), 'stale');

    expect(linkEnterprise(core, {})).toEqual({
      source: null,
      server: './src/libs/enterprise-none/index.ts',
      client: './src/libs/enterprise-none/client.ts',
      coreTests: [],
    });
    expect(existsSync(join(core, ENTERPRISE_SNAPSHOT_DIR))).toBe(false);
  });

  it('ignores a directory that has no index.ts', () => {
    write(join(root, 'packages/enterprise/README.md'), '# not a package');

    expect(findEnterprise(core, {})).toBeNull();
  });
});

describe('with an enterprise package', () => {
  it('snapshots a checkout at packages/enterprise, without its node_modules or .git', () => {
    const pkg = join(root, 'packages/enterprise');
    write(join(pkg, 'index.ts'), 'export const extensions = [];');
    write(join(pkg, 'modules/orgs/src/a.ts'), 'export const a = 1;');
    write(join(pkg, 'node_modules/pg/index.js'), '');
    write(join(pkg, '.git/HEAD'), '');

    const link = linkEnterprise(core, {});

    expect(link.source).toBe(pkg);
    expect(link.server).toBe(`./${ENTERPRISE_SNAPSHOT_DIR}/index.ts`);
    // No client.ts: the client half falls back to the stub.
    expect(link.client).toBe('./src/libs/enterprise-none/client.ts');
    expect(readFileSync(join(core, ENTERPRISE_SNAPSHOT_DIR, 'modules/orgs/src/a.ts'), 'utf8')).toBe('export const a = 1;');
    expect(existsSync(join(core, ENTERPRISE_SNAPSHOT_DIR, 'node_modules'))).toBe(false);
    expect(existsSync(join(core, ENTERPRISE_SNAPSHOT_DIR, '.git'))).toBe(false);
  });

  it('uses its client.ts and the tests it lists for core, refusing a glob that leaves the package', () => {
    const pkg = join(root, 'packages/enterprise');
    write(join(pkg, 'index.ts'), '');
    write(join(pkg, 'client.ts'), '');
    write(join(pkg, 'package.json'), JSON.stringify({ vocion: { coreTests: ['modules/*/test/**/*.test.ts', '../core/src/**/*.test.ts', '/etc/*.test.ts', 7] } }));

    const link = linkEnterprise(core, {});

    expect(link.client).toBe(`./${ENTERPRISE_SNAPSHOT_DIR}/client.ts`);
    expect(link.coreTests).toEqual([`${ENTERPRISE_SNAPSHOT_DIR}/modules/*/test/**/*.test.ts`]);
  });

  it('finds an npm-installed package, and VOCION_ENTERPRISE_DIR wins over both', () => {
    const installed = join(root, 'node_modules/@vocion/enterprise');
    write(join(installed, 'index.ts'), '');

    expect(findEnterprise(core, {})).toBe(installed);

    const elsewhere = join(root, 'elsewhere');
    write(join(elsewhere, 'index.ts'), '');

    expect(findEnterprise(core, { VOCION_ENTERPRISE_DIR: '../../elsewhere' })).toBe(join(core, '../../elsewhere'));
    expect(findEnterprise(core, { VOCION_ENTERPRISE_DIR: elsewhere })).toBe(elsewhere);
  });

  it('builds without it when VOCION_ENTERPRISE=off', () => {
    write(join(root, 'packages/enterprise/index.ts'), '');

    expect(findEnterprise(core, { VOCION_ENTERPRISE: 'off' })).toBeNull();
  });
});
