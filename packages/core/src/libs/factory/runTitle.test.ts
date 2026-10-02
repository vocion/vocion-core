import { describe, expect, it } from 'vitest';
import { runTitle } from './runTitle';

/**
 * Every list of runs titles them here (Chris, 2026-10-02, FE-370): what the
 * run did and found, never an automation slug, a mission's charter line, a
 * worker's log line or a bare code.
 */
describe('a run is titled by what it did and found', () => {
  const PR = 'https://github.com/example/northwind-portal/pull/175';

  it('a build that shipped: the attempt, its checks, its pull request', () => {
    expect(runTitle({ kind: 'build', status: 'completed', attempt: 3, prUrl: PR, checks: Array.from({ length: 6 }, (_, i) => ({ name: `c${i}`, passed: true })) })).toBe('Built attempt 3 · 6/6 checks · PR #175');
  });

  it('a build that failed names the check that failed, from its checks or its failures', () => {
    expect(runTitle({ kind: 'build', status: 'failed', attempt: 1, checks: [{ name: 'npm run test', passed: false }, { name: 'lint', passed: true }] })).toBe('Built attempt 1 · failed `test`');
    expect(runTitle({ kind: 'build', status: 'failed', attempt: 1, failedChecks: ['test'] })).toBe('Built attempt 1 · failed `test`');
    expect(runTitle({ kind: 'build', status: 'failed', attempt: 2 })).toBe('Built attempt 2 · failed');
  });

  it('a build still going, queued, or that never started', () => {
    expect(runTitle({ kind: 'build', status: 'running', attempt: 2 })).toBe('Building attempt 2');
    expect(runTitle({ kind: 'build', status: 'queued', attempt: 2, of: 3 })).toBe('Attempt 2 of 3 queued');
    expect(runTitle({ kind: 'build', status: 'failed', executed: false, attempt: 2 })).toBe('Attempt 2 did not start');
  });

  it('an agent run reads in its automation\'s words, with what the record it wrote says', () => {
    expect(runTitle({ kind: 'agent', status: 'completed', label: 'Checked it live', doing: 'Checking it live', result: 'seen 4 of 4' })).toBe('Checked it live · seen 4 of 4');
    expect(runTitle({ kind: 'agent', status: 'completed', label: 'QA reviewed', attempt: 2, result: 'sent back: the header still wraps at 390px' })).toBe('QA reviewed attempt 2 · sent back: the header still wraps at 390px');
    expect(runTitle({ kind: 'agent', status: 'completed', label: 'Drafted the release note' })).toBe('Drafted the release note');
    expect(runTitle({ kind: 'agent', status: 'running', label: 'Checked it live', doing: 'Checking it live' })).toBe('Checking it live');
    expect(runTitle({ kind: 'agent', status: 'failed', label: 'Drew the mockup', doing: 'Drawing the mockup' })).toBe('Drawing the mockup · did not finish');
  });

  it('never the machine title or a bare code', () => {
    expect(runTitle({ kind: 'agent', status: 'completed', stored: 'release-live-check: Every criterion is proven, or it is named as unproven' })).toBe('Agent run');
    expect(runTitle({ kind: 'agent', status: 'completed', stored: 'RUN-477' })).toBe('Agent run');
    expect(runTitle({ kind: 'agent', status: 'completed', stored: 'Draft the board pack for Kestrel Capital' })).toBe('Draft the board pack for Kestrel Capital');
  });
});
