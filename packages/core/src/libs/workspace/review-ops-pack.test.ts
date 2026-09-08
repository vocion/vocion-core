import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

// The review-ops layer of the base pack (core@2.1.0), end to end through the
// real pack directory at packages/core/templates/base — not a fixture copy.
// A workspace pins core@2.1.0, activates review-coordinator, and its skills
// come along transitively, exactly as the RevOps defaults do.
//
// Note: `core@2.1.0` is the BASE PACK version from templates/base/pack.yaml.
// It is unrelated to the @vocion/core release version and must never be
// rewritten to match a release tag.

const dirs: string[] = [];

/**
 * Write a throwaway workspace with the given manifest body and return its path.
 * @param manifestBody - Lines appended to the generated workspace.yaml.
 * @param files - Extra files to write, keyed by path relative to the workspace.
 */
function makeWorkspace(manifestBody: string, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'review-ops-'));
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

describe('review-ops layer — base review agents served from core', () => {
  it('activating the coordinator serves it from core with its skills pulled transitively', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.1.0\nuse:\n  agents: [review-coordinator]\n'));

    expect(bySlug(ws.agents, 'review-coordinator')?.origin).toBe('core');

    // Skills come along because the agent declares them — never hand-listed.
    expect(bySlug(ws.skills, 'triage-review-queue')?.origin).toBe('core');
    expect(bySlug(ws.skills, 'draft-for-approval')?.origin).toBe('core');
  });

  it('activating only the coordinator does not pull the analyst or its skill', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.1.0\nuse:\n  agents: [review-coordinator]\n'));

    expect(bySlug(ws.agents, 'queue-analyst')).toBeUndefined();
    expect(bySlug(ws.skills, 'queue-health')).toBeUndefined();
  });

  it('the analyst activates independently and pulls queue-health', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.1.0\nuse:\n  agents: [queue-analyst]\n'));

    expect(bySlug(ws.agents, 'queue-analyst')?.origin).toBe('core');
    expect(bySlug(ws.skills, 'queue-health')?.origin).toBe('core');
    expect(bySlug(ws.agents, 'review-coordinator')).toBeUndefined();
  });

  it('draft-for-approval loads with its body and says the output is a draft', () => {
    const ws = loadWorkspace(makeWorkspace('extends: core@2.1.0\nuse:\n  agents: [review-coordinator]\n'));

    const draft = bySlug(ws.skills, 'draft-for-approval');

    expect(draft?.kind).toBe('skill');
    expect(draft?.body).toContain('DRAFT for human approval');
  });

  it('the review layer composes alongside the commercial defaults', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@2.1.0\nuse:\n  agents: [review-coordinator, revenue-director]\n',
    ));

    expect(bySlug(ws.agents, 'review-coordinator')?.origin).toBe('core');
    expect(bySlug(ws.agents, 'revenue-director')?.origin).toBe('core');
    expect(bySlug(ws.skills, 'triage-review-queue')?.origin).toBe('core');
    expect(bySlug(ws.skills, 'pipeline-health')?.origin).toBe('core');
  });

  it('a thin workspace override layers on top of the coordinator (origin: merged)', () => {
    const ws = loadWorkspace(makeWorkspace(
      'extends: core@2.1.0\nuse:\n  agents: [review-coordinator]\n',
      { 'agents/review-coordinator.yaml': 'extends: core\nslug: review-coordinator\nname: Review Coordinator (Acme)\nsystemPrompt: Acme-specific review guidance.\n' },
    ));

    const coordinator = bySlug(ws.agents, 'review-coordinator');

    expect(coordinator?.origin).toBe('merged');
    expect(coordinator?.name).toBe('Review Coordinator (Acme)');
    expect(coordinator?.resolvedSystemPrompt).toBe('Acme-specific review guidance.');
    // Inherited from the base file, untouched by the override.
    expect(coordinator?.skills).toEqual(['triage-review-queue', 'draft-for-approval']);
  });
});
