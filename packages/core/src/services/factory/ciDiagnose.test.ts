/**
 * `ci.diagnose` is a typed read (backlog 049): the model answers through one
 * tool whose schema is the four causes, the evidence it reads is GitHub's own,
 * and a read that fails or answers off-schema is null — never a guess.
 */
import type { CheckLogs } from './githubChecks';
import { describe, expect, it, vi } from 'vitest';
import { diagnoseCi, evidenceText } from './ciDiagnose';

const logs: CheckLogs = {
  repo: 'Acme/northwind-core',
  number: 7,
  headSha: 'abc123def456',
  baseBranch: 'main',
  checkCount: 3,
  failing: [{ name: 'test', conclusion: 'failure', url: null, step: 'Run the suite', annotations: ['apps/web/src/rooms.test.ts:42 expected 200, got 403'], summary: null, logTail: 'FAIL rooms.test.ts > opens an invited room' }],
  changedFiles: ['apps/web/src/rooms.ts'],
};

function model(args: unknown) {
  const invoke = vi.fn(async () => ({ tool_calls: [{ name: 'report_ci_cause', args }] }));
  const bindTools = vi.fn(() => ({ invoke }));
  return { m: { bindTools } as never, bindTools, invoke };
}

describe('diagnoseCi', () => {
  it('returns the typed cause the model reported, bound to its one tool', async () => {
    const { m, bindTools } = model({ cause: 'flaky', why: 'A timeout in a network call the change does not touch.', failing: 'rooms.test.ts > opens an invited room' });

    const d = await diagnoseCi({ orgId: 'org_1', prUrl: 'https://github.com/Acme/northwind-core/pull/7', logs }, m);

    expect(d).toEqual({ cause: 'flaky', why: 'A timeout in a network call the change does not touch.', failing: 'rooms.test.ts > opens an invited room' });
    expect(bindTools).toHaveBeenCalledWith([expect.objectContaining({ name: 'report_ci_cause' })], { tool_choice: 'report_ci_cause' });
  });

  it('is null for an answer off the schema, and for a read that throws', async () => {
    expect(await diagnoseCi({ orgId: 'org_1', prUrl: 'https://github.com/Acme/northwind-core/pull/7', logs }, model({ cause: 'cosmic_rays', why: 'x', failing: null }).m)).toBeNull();

    const broken = { bindTools: () => ({ invoke: async () => {
      throw new Error('model unavailable');
    } }) } as never;

    expect(await diagnoseCi({ orgId: 'org_1', prUrl: 'https://github.com/Acme/northwind-core/pull/7', logs }, broken)).toBeNull();
  });
});

describe('evidenceText', () => {
  it('carries the annotations, the log tail, the files changed and the base branch\'s checks', () => {
    const text = evidenceText({ orgId: 'org_1', prUrl: 'https://github.com/Acme/northwind-core/pull/7', logs, base: { branch: 'main', sha: 'a1a1a1a1a1a1', failing: ['test'], complete: true } });

    expect(text).toContain('apps/web/src/rooms.test.ts:42 expected 200, got 403');
    expect(text).toContain('FAIL rooms.test.ts > opens an invited room');
    expect(text).toContain('apps/web/src/rooms.ts');
    expect(text).toContain('The branch it targets (main @ a1a1a1a1a1a1): failing test.');
  });
});
