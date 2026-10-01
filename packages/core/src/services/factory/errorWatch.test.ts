import type { EnvironmentRow } from './environments';
import type { ErrorWatchDeps } from './errorWatch';
import { describe, expect, it, vi } from 'vitest';
import { compareRelease, issuesToAct, watchErrors } from './errorWatch';

/**
 * TODAY'S INCIDENT, AS A FIXTURE (2026-10-01, fictional names). A pipeline fix
 * merged as pull request #148 and deployed commit aaaaaaa to the API at
 * 14:40. From 14:43 every signed-in call answered 500: one issue (NW-API-3,
 * an engine that could not start on the runtime's CPU) took 41 events in ten
 * minutes, beside a one-off (NW-API-2). The deploy read "succeeded" and the
 * health check read ok. The watch must say the deploy caused it, and open
 * the revert.
 */
const SHA = 'aaaaaaa1111111111111111111111111111111aa';
const PULL = 'https://github.com/northwind/platform/pull/148';
const C = { token: 'sntrys_fixture_token_0001', org: 'northwind', host: 'https://us.sentry.io' };
const API: EnvironmentRow = {
  id: 204,
  title: 'northwind-api-production',
  repo: 'northwind/platform',
  meta: {
    slug: 'northwind-api-production',
    product: 'northwind-send',
    stage: 'production',
    lastDeployedSha: SHA,
    lastDeployedAt: '2026-10-01T14:40:00Z',
    lastHealth: 'ok',
    lastHealthySha: 'bbbbbbb2222222222222222222222222222222bb',
    observability: { sentry: { org: 'northwind', project: 'northwind-api' } },
  },
};
const NOW = new Date('2026-10-01T15:10:00Z');
const ISSUE = (shortId: string, firstRelease: string, firstSeen: string) => ({ ok: true as const, data: { id: shortId === 'NW-API-3' ? '77' : '76', shortId, title: 'EngineInitError: ', culprit: 'GET /v1/orgs', url: `https://northwind.sentry.io/issues/${shortId}/`, level: 'error', status: 'unresolved', project: 'northwind-api', events: 184, users: 0, firstSeen, lastSeen: '2026-10-01T15:09:00Z', firstRelease, firstReleaseAt: null, lastRelease: firstRelease } });

function harness(over: Partial<ErrorWatchDeps> = {}) {
  const notes: Array<{ id: number; line: string }> = [];
  const writes: Array<{ id: number; set: Record<string, unknown> }> = [];
  const propose = vi.fn(async () => ({ runId: 9001, status: 'done' }));
  const wake = vi.fn(async () => {});
  const escalate = vi.fn(async () => ({ askId: 55, line: 'Stopped: NW-API-3 is still firing.' }));
  const deps: Partial<ErrorWatchDeps> = {
    sentry: async () => ({ ok: true, credentials: C }),
    countErrors: async (_c, q) => ({ ok: true, data: q.release
      ? [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 120, firstAt: null, lastAt: null }]
      : [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 41, firstAt: null, lastAt: null }, { issueId: '76', shortId: 'NW-API-2', title: 'EngineInitError:', events: 1, firstAt: null, lastAt: null }] }),
    newIssues: async () => ({ ok: true, data: [] }),
    readIssue: async (_c, id) => (id === 'NW-API-3' ? ISSUE('NW-API-3', SHA, '2026-10-01T14:43:54Z') : ISSUE('NW-API-2', SHA, '2026-10-01T14:41:09Z')),
    mergedPullFor: async () => PULL,
    propose,
    wake,
    note: async (_o, id, line) => {
      notes.push({ id, line });
    },
    write: async (_o, id, set) => {
      writes.push({ id, set });
    },
    releaseFor: async () => 301,
    escalate,
    askOpen: async () => true,
    supersede: async () => undefined,
    ...over,
  };
  return { deps, notes, writes, propose, wake, escalate };
}

describe('the error watch, on today\'s incident', () => {
  it('says the deploy caused it and opens the revert, done for you, on the environment and the release', async () => {
    const h = harness();
    const out = await watchErrors('org_1', { owner: 'release-engineer' }, NOW, h.deps, [API]);

    expect(h.propose).toHaveBeenCalledTimes(1);
    expect(h.propose).toHaveBeenCalledWith('org_1', expect.objectContaining({ actionId: 'github.revert_pull', owner: 'release-engineer', input: expect.objectContaining({ url: PULL, recordId: 204 }) }));

    const line = out.acted.find(a => a.did === 'revert done: NW-API-3')!.line!;

    expect(line).toBe('NW-API-3 (EngineInitError) on northwind-api-production: 41 events in 10 minutes. Caused by the deploy of aaaaaaa at 2026-10-01T14:40:00Z: NW-API-3 was first seen in that release, at 2026-10-01T14:43:54Z. → revert opened of northwind/platform/pull/148 (action #9001); it merges on green, and Undo puts the release back.');
    // Written where it is read: the environment and the release it ran on.
    expect(h.notes.filter(n => n.line === line).map(n => n.id)).toEqual([204, 301]);
    // The Release engineer is woken to file the incident, told the revert is open.
    expect(h.wake).toHaveBeenCalledWith('org_1', expect.objectContaining({ shortId: 'NW-API-3', verdict: 'last-deploy', pull: PULL, revertActionRunId: 9001, environmentId: 204, releaseId: 301 }));

    // Its recovery is on the record, so the next pass does not revert twice.
    const watch = h.writes.at(-1)!.set.errorWatch as { issues: Record<string, { steps: Array<{ kind: string }> }> };

    expect(watch.issues['NW-API-3']!.steps.map(s => s.kind)).toEqual(['revert']);
  });

  it('acts on the busy issue and on what the new release carries, not on a one-off', () => {
    const picked = issuesToAct({
      window: [{ issueId: '77', shortId: 'NW-API-3', title: null, events: 41, firstAt: null, lastAt: null }, { issueId: '76', shortId: 'NW-API-2', title: null, events: 1, firstAt: null, lastAt: null }],
      onRelease: [],
      threshold: 20,
    });

    expect(picked.map(i => i.shortId)).toEqual(['NW-API-3']);
    expect(issuesToAct({ window: [], onRelease: [{ issueId: '76', shortId: 'NW-API-2', title: null, events: 1, firstAt: null, lastAt: null }], threshold: 20 }).map(i => i.shortId)).toEqual(['NW-API-2']);
  });

  it('wakes the Release engineer to file the bug when an older release brought it, and reverts nothing', async () => {
    const h = harness({ readIssue: async (_c, id) => ISSUE(id, 'ccccccc3', '2026-09-20T00:00:00Z'), countErrors: async () => ({ ok: true, data: [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 41, firstAt: null, lastAt: null }] }) });
    const out = await watchErrors('org_1', { owner: 'release-engineer' }, new Date('2026-10-01T18:00:00Z'), h.deps, [API]);

    expect(h.propose).not.toHaveBeenCalled();
    expect(h.wake).toHaveBeenCalledWith('org_1', expect.objectContaining({ verdict: 'earlier-deploy', revertActionRunId: 0 }));
    expect(out.acted[0]!.line).toMatch(/first seen in release ccccccc, not in aaaaaaa.*The Release engineer has it, to file the bug/);
  });

  it('asks a person once when it still fires an hour after every step, and closes when it goes quiet', async () => {
    const meta = { ...API.meta, errorWatch: { issues: { 'NW-API-3': { shortId: 'NW-API-3', url: 'u', since: '2026-10-01T14:50:00Z', events: 41, cause: 'last-deploy', line: '', steps: [{ kind: 'revert', at: '2026-10-01T14:50:00Z', actionRunId: 9001, status: 'done', url: PULL }, { kind: 'wake', at: '2026-10-01T15:00:00Z' }] } } } };
    const h = harness();
    await watchErrors('org_1', { owner: 'release-engineer' }, new Date('2026-10-01T16:30:00Z'), h.deps, [{ ...API, meta }]);

    expect(h.escalate).toHaveBeenCalledTimes(1);
    expect(h.propose).not.toHaveBeenCalled();

    const quiet = harness({ countErrors: async () => ({ ok: true, data: [] }) });
    const out = await watchErrors('org_1', {}, new Date('2026-10-01T16:30:00Z'), quiet.deps, [{ ...API, meta }]);

    expect(out.acted[0]!.line).toBe('NW-API-3 has stopped on northwind-api-production: no event in 10 minutes, after the revert and the Release engineer\'s fix.');
  });

  it('says once, on the environment, when Sentry cannot be read', async () => {
    const h = harness({ sentry: async () => ({ ok: false, message: 'No Sentry token is stored for this workspace.' }) });
    await watchErrors('org_1', {}, NOW, h.deps, [API]);

    expect(h.notes).toEqual([{ id: 204, line: 'Errors are not being watched: No Sentry token is stored for this workspace.' }]);

    const again = harness({ sentry: async () => ({ ok: false, message: 'No Sentry token is stored for this workspace.' }) });
    await watchErrors('org_1', {}, NOW, again.deps, [{ ...API, meta: { ...API.meta, errorWatch: { unread: 'No Sentry token is stored for this workspace.' } } }]);

    expect(again.notes).toEqual([]);
  });

  it('reads nothing for an environment that names no error tracking', async () => {
    const h = harness();
    const out = await watchErrors('org_1', {}, NOW, h.deps, [{ ...API, meta: { ...API.meta, observability: {} } }]);

    expect(out.acted).toEqual([]);
    expect(h.notes).toEqual([]);
  });
});

describe('after a deploy: this release against the stretch before it', () => {
  it('names an issue first seen in the release as a finding, in plain words', async () => {
    const h = harness({
      countErrors: async (_c, q) => ({ ok: true, data: q.release ? [{ issueId: '77', shortId: 'NW-API-3', title: 'EngineInitError:', events: 41, firstAt: null, lastAt: null }] : [] }),
      newIssues: async () => ({ ok: true, data: [ISSUE('NW-API-3', SHA, '2026-10-01T14:43:54Z').data] }),
    });
    const found = await compareRelease('org_1', API, new Date('2026-10-01T14:52:00Z'), h.deps);

    expect(found).toMatchObject({ state: 'new', sha: SHA });
    expect(found!.line).toBe('After aaaaaaa deployed to northwind-api-production: NW-API-3 (EngineInitError) is new in this release, 41 events in 12 minutes.');
  });

  it('calls a spike a spike, and a quiet release clean', async () => {
    const spike = harness({ countErrors: async (_c, q) => ({ ok: true, data: [{ issueId: '7', shortId: 'NW-API-1', title: 'Timeout', events: q.release ? 30 : 5, firstAt: null, lastAt: null }] }) });

    expect((await compareRelease('org_1', API, NOW, spike.deps))!.line).toMatch(/NW-API-1 \(Timeout\) is firing 6 times as often, 30 events in 30 minutes/);

    const clean = harness({ countErrors: async () => ({ ok: true, data: [] }) });

    expect(await compareRelease('org_1', API, NOW, clean.deps)).toMatchObject({ state: 'clean', line: 'No new or spiking error on northwind-api-production since aaaaaaa deployed 30 minutes ago.' });
  });
});
