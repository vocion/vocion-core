/**
 * The sha of a workspace folder outside git is a hash of what is in it: each
 * file's path inside the folder and its bytes. The same files anywhere hash
 * the same — an import staged in a temporary folder, reviewed, then staged
 * again to apply — and an edit that keeps every file name still moves it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

const ROOT = mkdtempSync(join(tmpdir(), 'vocion-sha-test-'));

function folder(files: Record<string, string>): string {
  const dir = mkdtempSync(join(ROOT, 'ws-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const FILES = {
  'workspace.yaml': 'version: 1\norgId: proj_northwind\nname: Northwind\n',
  'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPrompt: You scout accounts.\n',
};

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

describe('a workspace folder outside git', () => {
  it('hashes the same wherever the same files sit', () => {
    expect(loadWorkspace(folder(FILES)).sha).toBe(loadWorkspace(folder(FILES)).sha);
    expect(loadWorkspace(folder(FILES)).sha).toMatch(/^local-[0-9a-f]{12}$/);
  });

  it('moves when a file changes and keeps its name', () => {
    const edited = { ...FILES, 'agents/scout.yaml': 'slug: scout\nname: Scout\nsystemPrompt: You scout accounts, and only accounts.\n' };

    expect(loadWorkspace(folder(edited)).sha).not.toBe(loadWorkspace(folder(FILES)).sha);
  });

  it('moves when the manifest\'s settings change', () => {
    const goal = { ...FILES, 'workspace.yaml': `${FILES['workspace.yaml']}goal: Every account briefed.\n` };

    expect(loadWorkspace(folder(goal)).sha).not.toBe(loadWorkspace(folder(FILES)).sha);
  });
});
