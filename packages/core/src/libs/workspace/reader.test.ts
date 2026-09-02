import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPrimitiveFiles } from './reader';

// Ticket 007 · step 6 — the drilldown surfaces both layers: the workspace
// override (editable) and the inherited core base default (read-only), against
// the real base pack (packages/core/templates/base).

const dirs: string[] = [];
let prevWorkspacePath: string | undefined;

beforeEach(() => {
  prevWorkspacePath = process.env.WORKSPACE_PATH;
});

afterEach(() => {
  if (prevWorkspacePath === undefined) {
    delete process.env.WORKSPACE_PATH;
  } else {
    process.env.WORKSPACE_PATH = prevWorkspacePath;
  }
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function workspaceAt(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'reader-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), 'version: 1\norgId: test_org\nname: test\n');
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  process.env.WORKSPACE_PATH = dir;
  return dir;
}

describe('readPrimitiveFiles — layered provenance', () => {
  it('an inherited core default (no workspace file) shows the core layer alone', () => {
    workspaceAt();
    const res = readPrimitiveFiles('agent', 'revenue-director');

    expect(res).not.toBeNull();
    expect(res!.files).toHaveLength(1);
    expect(res!.files[0]!.layer).toBe('core');
    expect(res!.files[0]!.fullPath).toBeUndefined(); // read-only
    expect(res!.files[0]!.content).toContain('slug: revenue-director');
  });

  it('an override shows the workspace layer (editable) on top of the core layer', () => {
    workspaceAt({ 'agents/revenue-director.yaml': 'extends: core\nslug: revenue-director\nname: Ours\n' });
    const res = readPrimitiveFiles('agent', 'revenue-director');
    const layers = res!.files.map(f => f.layer);

    expect(layers).toContain('workspace');
    expect(layers).toContain('core');

    const ws = res!.files.find(f => f.layer === 'workspace');

    expect(ws!.fullPath).toBeDefined(); // editable
  });

  it('a workspace-only primitive with no base twin shows only the workspace layer', () => {
    workspaceAt({ 'agents/custom.yaml': 'slug: custom\nname: Custom\nsystemPrompt: hi\n' });
    const res = readPrimitiveFiles('agent', 'custom');

    expect(res!.files).toHaveLength(1);
    expect(res!.files[0]!.layer).toBe('workspace');
  });

  it('a base skill is surfaced as a core layer for its drilldown', () => {
    workspaceAt();
    const res = readPrimitiveFiles('skill', 'proposal-brief');

    expect(res).not.toBeNull();
    expect(res!.files.every(f => f.layer === 'core')).toBe(true);
    expect(res!.files.some(f => f.content.includes('DRAFT for human approval'))).toBe(true);
  });
});
