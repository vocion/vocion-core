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
    const ws = loadWorkspace(makeWorkspace('extends: core@2.0.0\nuse:\n  agents: [revenue-director]\n'));

    expect(ws.sha).toContain('+core@2.0.0');
  });

  it('leaves the sha untouched with no base pack', () => {
    const ws = loadWorkspace(makeWorkspace(''));

    expect(ws.sha).not.toContain('+core');
  });
});

describe('folder override — a workspace skill replaces the base outright', () => {
  it('mounts the activated base skill as origin core with no workspace copy', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.0.0\nuse:\n  agents: [revenue-director]\n'));
    const skill = ws.skills.find(s => s.slug === 'pipeline-health');

    expect(skill?.origin).toBe('core');
    expect(skill?.body).toContain('open pipeline');
  });

  it('a same-slug workspace folder replaces the base whole-file (origin override)', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@2.0.0\nuse:\n  agents: [revenue-director]\n',
      { 'skills/pipeline-health/SKILL.md': '---\nslug: pipeline-health\nname: Pipeline Health\ndescription: workspace version\nversion: 2\n---\n\nWorkspace body wins outright.\n' },
    ));
    const skill = ws.skills.find(s => s.slug === 'pipeline-health');

    expect(skill?.origin).toBe('override');
    expect(skill?.body).toBe('Workspace body wins outright.');
  });

  it('a same-slug folder without activation is a hard error, not a silent win', () => {
    expect(() => loadWorkspace(makeWorkspace(
      'extends: core@2.0.0\n',
      { 'skills/pipeline-health/SKILL.md': '---\nslug: pipeline-health\nname: Pipeline Health\ndescription: shadow\n---\n\nbody\n' },
    ))).toThrow(/collides with a base default the workspace has not activated/);
  });

  it('an activated base skill pulls its attached playbooks transitively', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.0.0\nuse:\n  skills: [draft-warm-touch]\n'));

    expect(ws.skills.map(s => s.slug)).toContain('draft-warm-touch');
    expect(ws.playbooks.map(p => p.slug)).toContain('warming-etiquette');
    expect(ws.playbooks.find(p => p.slug === 'warming-etiquette')?.origin).toBe('core');
  });

  it('a reference that resolves to nothing fails the load', () => {
    expect(() => loadWorkspace(makeWorkspace(
      'extends: core@2.0.0\n',
      { 'agents/loner.yaml': 'slug: loner\nname: Loner\nsystemPrompt: hi\nskills: [ghost-skill]\n' },
    ))).toThrow(/names skill "ghost-skill", which resolves to nothing/);
  });
});
