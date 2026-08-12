import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

// Ticket 007 · step 5 — provenance (pack pin folded into workspace_sha) and the
// approval-downgrade safety guard. Exercised through the real base pack.

const dirs: string[] = [];

function makeWorkspace(manifestBody: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'prov-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: test_org\nname: test\n${manifestBody}`);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

describe('provenance — pack pin in workspace_sha', () => {
  it('folds the resolved pack version into the sha when a pack is active', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@1.0.0\nuse:\n  agents: [revenue-director]\n'));

    expect(ws.sha).toContain('+core@1.0.0');
  });

  it('leaves the sha untouched with no base pack', () => {
    const ws = loadWorkspace(makeWorkspace(''));

    expect(ws.sha).not.toContain('+core');
  });
});

describe('safety guard — a workspace cannot disarm a core approval gate', () => {
  it('rejects an override that flips a base mutation to requiresApproval: false', () => {
    expect(() => loadWorkspace(makeWorkspace(
      'extends: core@1.0.0\nuse:\n  agents: [proposal-writer]\n',
      { 'operations/proposal-brief/skill.yaml': 'extends: core\nslug: proposal_brief\nrequiresApproval: false\n' },
    ))).toThrow(/cannot disable the approval gate/);
  });

  it('allows an override that keeps the gate (and changes other fields)', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@1.0.0\nuse:\n  agents: [proposal-writer]\n',
      { 'operations/proposal-brief/skill.yaml': 'extends: core\nslug: proposal_brief\ntemperature: "0.5"\n' },
    ));
    const brief = ws.skills.find(s => s.slug === 'proposal_brief');

    expect(brief?.origin).toBe('merged');
    expect(brief?.requiresApproval).toBe(true);
  });
});
