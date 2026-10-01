/**
 * A code names one object type in a workspace (`libs/codes.ts`): the loader
 * settles every type's code, refuses two types declaring one code, and names
 * both, so `workspace:check` fails before an apply could make FE-294 ambiguous.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadWorkspace } from './loader';

const dirs: string[] = [];

function workspace(types: Record<string, string>, plugins: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc-codes-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'workspace.yaml'), `version: 1\norgId: proj_codes\nname: Northwind\nplugins: [${plugins.join(', ')}]\n`);
  for (const [slug, body] of Object.entries(types)) {
    mkdirSync(join(dir, 'objects', slug), { recursive: true });
    writeFileSync(join(dir, 'objects', slug, 'type.yaml'), `slug: ${slug}\nlabel: ${slug}\n${body}`);
  }
  return dir;
}

afterAll(() => {
  for (const d of dirs) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe('object type codes', () => {
  it('reads declared codes and derives the rest, widened past a clash', () => {
    const ws = loadWorkspace(workspace({ deal: '', proposal: '', product: '', follow_up: 'code: FUP\n' }));
    const codes = Object.fromEntries(ws.objectTypes.map(t => [t.slug, t.resolvedCode]));

    expect(codes.deal).toBe('DEAL');
    expect(codes.follow_up).toBe('FUP');
    expect(new Set([codes.proposal, codes.product]).size).toBe(2);
  });

  it('settles the software-factory plugin\'s declared codes', () => {
    const ws = loadWorkspace(workspace({}, ['software-factory']));
    const codes = Object.fromEntries(ws.objectTypes.map(t => [t.slug, t.resolvedCode]));

    expect(codes).toMatchObject({ request: 'FE', architecture_plan: 'PL', engineering_task: 'TK', release: 'REL', environment: 'ENV', product: 'PRD', repo: 'REPO' });
  });

  it('refuses two types declaring one code, naming both', () => {
    expect(() => loadWorkspace(workspace({ deal: 'code: DL\n', lead: 'code: DL\n' }))).toThrow(/"deal" and "lead" both declare code DL/);
  });

  it('refuses a workspace type taking a plugin type\'s code', () => {
    expect(() => loadWorkspace(workspace({ feature: 'code: FE\n' }, ['software-factory']))).toThrow(/both declare code FE/);
  });

  it('refuses a core noun\'s code and a malformed one', () => {
    expect(() => loadWorkspace(workspace({ runbook: 'code: RUN\n' }))).toThrow(/which is core's/);
    expect(() => loadWorkspace(workspace({ deal: 'code: deal-x\n' }))).toThrow(/2–5 uppercase letters/);
  });
});
