import type { EnvironmentRow } from './environments';
import { describe, expect, it } from 'vitest';
import { correlateIssue, deployCauseOf, sameCommit } from './errorCause';

const DEPLOYED = 'aaaaaaa1111111111111111111111111111111aa';
const ENV = { slug: 'northwind-api-production', stage: 'production', lastDeployedSha: DEPLOYED, lastDeployedAt: '2026-10-01T14:40:00Z', lastHealthySha: 'bbbbbbb2222222222222222222222222222222bb', observability: { sentry: { org: 'northwind', project: 'northwind-api' } } };

describe('did the last deploy cause it', () => {
  it('reads a commit and its short form as the same release', () => {
    expect(sameCommit(DEPLOYED, 'aaaaaaa1')).toBe(true);
    expect(sameCommit('aaaaaa', DEPLOYED)).toBe(false);
    expect(sameCommit(DEPLOYED, 'bbbbbbb2')).toBe(false);
  });

  it('is the last deploy when the issue was first seen in the deployed release, after it was deployed', () => {
    const c = deployCauseOf({ shortId: 'NW-API-3', firstRelease: DEPLOYED, firstSeen: '2026-10-01T14:43:54Z' }, ENV);

    expect(c.verdict).toBe('last-deploy');
    expect(c.line).toBe('Caused by the deploy of aaaaaaa at 2026-10-01T14:40:00Z: NW-API-3 was first seen in that release, at 2026-10-01T14:43:54Z.');
    expect(c.healthySha).toBe(ENV.lastHealthySha);
  });

  it('takes traffic a little before the run reports done', () => {
    expect(deployCauseOf({ shortId: 'NW-API-3', firstRelease: DEPLOYED, firstSeen: '2026-10-01T14:35:00Z' }, ENV).verdict).toBe('last-deploy');
    expect(deployCauseOf({ shortId: 'NW-API-3', firstRelease: DEPLOYED, firstSeen: '2026-10-01T13:00:00Z' }, ENV).verdict).toBe('earlier-deploy');
  });

  it('is not the last deploy when it came in another release, and unknown without a release or a deploy', () => {
    expect(deployCauseOf({ shortId: 'NW-API-1', firstRelease: 'ccccccc3', firstSeen: '2026-09-20T00:00:00Z' }, ENV).verdict).toBe('earlier-deploy');
    expect(deployCauseOf({ shortId: 'NW-API-1', firstRelease: null, firstSeen: null }, ENV).verdict).toBe('unknown');
    expect(deployCauseOf({ shortId: 'NW-API-1', firstRelease: DEPLOYED, firstSeen: null }, {}).verdict).toBe('unknown');
  });

  it('finds the environment that reports to the project, and the pull request behind the release', async () => {
    const rows: EnvironmentRow[] = [
      { id: 7, title: 'northwind-api-staging', meta: { ...ENV, slug: 'northwind-api-staging', stage: 'staging' }, repo: 'northwind/platform' },
      { id: 8, title: 'northwind-api-production', meta: ENV, repo: 'northwind/platform' },
      { id: 9, title: 'northwind-web-production', meta: { ...ENV, observability: { sentry: { org: 'northwind', project: 'northwind-web' } } }, repo: 'northwind/platform' },
    ];
    const asked: string[] = [];
    const c = await correlateIssue('org_1', { shortId: 'NW-API-3', firstRelease: DEPLOYED, firstSeen: '2026-10-01T14:43:54Z' }, { org: 'northwind', project: 'northwind-api', environment: 'production' }, {
      rows,
      mergedPullFor: async (_o, repo, sha) => {
        asked.push(`${repo}@${sha}`);
        return 'https://github.com/northwind/platform/pull/148';
      },
    });

    expect(c).toMatchObject({ verdict: 'last-deploy', environment: { id: 8, slug: 'northwind-api-production', repo: 'northwind/platform' }, pull: 'https://github.com/northwind/platform/pull/148' });
    expect(asked).toEqual([`northwind/platform@${DEPLOYED}`]);

    const none = await correlateIssue('org_1', { shortId: 'X-1', firstRelease: DEPLOYED, firstSeen: null }, { org: 'northwind', project: 'other' }, { rows });

    expect(none.verdict).toBe('unknown');
    expect(none.line).toMatch(/No environment record names northwind\/other/);
  });
});
