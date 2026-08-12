import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

// Ticket 007 · step 1 — base-pack resolution + pin check. The pack itself
// (packages/core/templates/base/pack.yaml) ships at core@1.0.0 and is
// identity-only for now; these tests prove the second-directory read and the
// load-bearing guarantee: omitting `extends` changes nothing.

const dirs: string[] = [];

/**
 * Write a throwaway workspace with the given manifest body and return its path.
 * @param manifestBody
 */
function workspace(manifestBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pack-test-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: test_org\nname: test\n${manifestBody}`);
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('loadWorkspace — base pack (extends)', () => {
  it('omitting `extends` leaves pack null (byte-for-byte unchanged path)', () => {
    const loaded = loadWorkspace(workspace(''));

    expect(loaded.pack).toBeNull();
  });

  it('bare `core` tracks the shipped version', () => {
    const loaded = loadWorkspace(workspace('extends: core\n'));

    expect(loaded.pack?.manifest.name).toBe('core');
    expect(loaded.pack?.manifest.version).toBe('1.0.0');
  });

  it('a matching version pin resolves', () => {
    const loaded = loadWorkspace(workspace('extends: core@1.0.0\n'));

    expect(loaded.pack?.manifest.version).toBe('1.0.0');
  });

  it('a pin that does not match the shipped version throws', () => {
    expect(() => loadWorkspace(workspace('extends: core@9.9.9\n')))
      .toThrow(/pins core@9\.9\.9 but the shipped pack is core@1\.0\.0/);
  });

  it('an unknown pack name throws', () => {
    expect(() => loadWorkspace(workspace('extends: bogus@1.0.0\n')))
      .toThrow(/unknown base pack "bogus"/);
  });

  it('an empty `extends` pin throws a clear error', () => {
    expect(() => loadWorkspace(workspace('extends: "@1.0.0"\n')))
      .toThrow(/invalid `extends` pin/);
  });
});
