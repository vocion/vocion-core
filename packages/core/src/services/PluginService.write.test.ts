import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeWorkspacePlugins } from './PluginService';

// The file edit behind the Plugins switch: workspace.yaml keeps its comments
// and every other key; only `plugins:` moves.

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function workspace(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'plugins-write-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), yaml);
  return dir;
}

const BASE = `version: 1
# Placeholder — re-keyed at apply time.
orgId: proj_test
name: test
# The lead runs the workspace.
lead: revenue-director
surfaces: [personalization]
`;

describe('writeWorkspacePlugins', () => {
  it('adds a plugins key, keeping comments and every other key', () => {
    const dir = workspace(BASE);
    const before = writeWorkspacePlugins(dir, ['wiki']);
    const after = readFileSync(join(dir, 'workspace.yaml'), 'utf8');

    expect(before).toEqual([]);
    expect(after).toContain('# Placeholder — re-keyed at apply time.');
    expect(after).toContain('# The lead runs the workspace.');
    expect(after).toMatch(/surfaces: \[ ?personalization ?\]/);
    expect(after).toContain('lead: revenue-director');
    expect(after).toMatch(/plugins: \[ wiki \]/);
  });

  it('replaces an existing list and reports what stood before', () => {
    const dir = workspace(`${BASE}plugins: [data-rooms, proposals]\n`);
    const before = writeWorkspacePlugins(dir, ['data-rooms', 'proposals', 'wiki']);

    expect(before).toEqual(['data-rooms', 'proposals']);
    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).toMatch(/plugins: \[ data-rooms, proposals, wiki \]/);
  });

  it('removes the key when the list empties', () => {
    const dir = workspace(`${BASE}plugins: [wiki]\n`);
    writeWorkspacePlugins(dir, []);

    expect(readFileSync(join(dir, 'workspace.yaml'), 'utf8')).not.toContain('plugins');
  });
});
