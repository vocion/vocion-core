import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

/**
 * Write an agent file into a workspace's agents/ dir.
 * @param dir
 * @param slug
 * @param body
 */
function writeAgent(dir: string, slug: string, body: string): void {
  mkdirSync(join(dir, 'agents'), { recursive: true });
  writeFileSync(join(dir, 'agents', `${slug}.yaml`), body);
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

describe('loadWorkspace — compose against the (empty) core pack', () => {
  it('a workspace-only agent under `extends: core` (activating nothing) loads as origin: workspace', () => {
    // `use` omitted → use: none, so no base agents are pulled; only the
    // workspace's own agent loads, as origin: workspace.
    const dir = workspace('extends: core\n');
    writeAgent(dir, 'my-agent', 'slug: my-agent\nname: Mine\nsystemPrompt: You help.\n');
    const loaded = loadWorkspace(dir);

    expect(loaded.pack?.manifest.version).toBe('1.0.0');
    expect(loaded.agents).toHaveLength(1);
    expect(loaded.agents[0]!.origin).toBe('workspace');
  });

  it('an `extends: core` marker with no matching base default is a hard error', () => {
    const dir = workspace('extends: core\n');
    writeAgent(dir, 'ghost', 'extends: core\nname: Ghost\nslug: ghost\n');

    expect(() => loadWorkspace(dir)).toThrow(/the base pack ships no such agent/);
  });

  it('an `extends: core` marker with no base pack at all is a hard error', () => {
    const dir = workspace(''); // no `extends:` in workspace.yaml
    writeAgent(dir, 'orphan', 'extends: core\nname: Orphan\nslug: orphan\n');

    expect(() => loadWorkspace(dir)).toThrow(/pins no base pack/);
  });
});
