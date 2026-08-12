import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

// Ticket 007 · step 4 — the proving vertical, end to end through the real base
// pack (packages/core/templates/base). A workspace pins core@1.0.0, activates
// revenue-director + proposal-writer, and their operations come along
// transitively — with a thin workspace override layered on top.

const dirs: string[] = [];

function makeWorkspace(manifestBody: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'proving-'));
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

const bySlug = <T extends { slug: string }>(xs: T[], slug: string) => xs.find(x => x.slug === slug);

describe('proving vertical — base RevOps agents served from core', () => {
  it('activating both agents serves them from core with their operations pulled transitively', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@1.0.0\nuse:\n  agents: [revenue-director, proposal-writer]\n'));

    const director = bySlug(ws.agents, 'revenue-director');
    const writer = bySlug(ws.agents, 'proposal-writer');

    expect(director?.origin).toBe('core');
    expect(writer?.origin).toBe('core');

    // Skills come along because the agents declare them — never hand-listed.
    expect(bySlug(ws.skills, 'pipeline_health')?.origin).toBe('core');
    expect(bySlug(ws.skills, 'proposal_brief')?.origin).toBe('core');
  });

  it('the core mutation keeps its approval gate', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@1.0.0\nuse:\n  agents: [proposal-writer]\n'));

    expect(bySlug(ws.skills, 'proposal_brief')?.requiresApproval).toBe(true);
  });

  it('activating only the director does not pull the writer or its operation', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@1.0.0\nuse:\n  agents: [revenue-director]\n'));

    expect(bySlug(ws.agents, 'proposal-writer')).toBeUndefined();
    expect(bySlug(ws.skills, 'proposal_brief')).toBeUndefined();
    expect(bySlug(ws.skills, 'pipeline_health')?.origin).toBe('core'); // director's, pulled
  });

  it('a thin workspace override layers on top (origin: merged) and the hierarchy still resolves', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@1.0.0\nuse:\n  agents: [revenue-director, proposal-writer]\n',
      { 'agents/proposal-writer.yaml': 'extends: core\nslug: proposal-writer\nname: Proposal Writer (Acme voice)\nsystemPrompt: Acme-specific proposal guidance.\n' },
    ));

    const writer = bySlug(ws.agents, 'proposal-writer');

    expect(writer?.origin).toBe('merged');
    expect(writer?.name).toBe('Proposal Writer (Acme voice)'); // scalar replaced
    expect(writer?.resolvedSystemPrompt).toBe('Acme-specific proposal guidance.');
    expect(writer?.skills).toEqual(['proposal_brief']); // inherited from base (untouched)
    // loadWorkspace ran assertAgentHierarchy on the merged set without throwing.
    expect(bySlug(ws.agents, 'revenue-director')?.origin).toBe('core');
  });
});
