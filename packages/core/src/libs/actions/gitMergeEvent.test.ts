import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergedPullEvent, pullRequestLifecycleEvents } from '@/libs/github/events';

const mergePull = vi.fn();
const emitEvent = vi.fn(async () => ({ ok: true }));
vi.mock('@/services/factory/githubMerge', () => ({ mergePull }));
vi.mock('@/services/EventService', () => ({ emitEvent }));

const { getAction } = await import('@/libs/actions/registry');

const PR = {
  number: 158,
  title: 'Build the api image on a native arm64 runner',
  html_url: 'https://github.com/northwind/app/pull/158',
  state: 'closed',
  user: { login: 'vocion-bot' },
  head: { sha: 'abc1234def5678', ref: 'factory/t346' },
  base: { ref: 'main' },
  created_at: '2026-10-01T23:40:00Z',
  updated_at: '2026-10-01T23:51:30Z',
  merged_at: '2026-10-01T23:51:30Z',
  merge_commit_sha: 'b8a7210a8289',
  merged_by: { login: 'vocion-bot' },
} as never;

beforeEach(() => {
  mergePull.mockReset();
  emitEvent.mockClear();
});

describe('Vocion raises pr.merged for its own merge at once', () => {
  it('emits the same event the sync would, with its dedupe key', async () => {
    mergePull.mockResolvedValue({ merged: true, sha: 'b8a7210a8289', already: false, repo: 'northwind/app', pull: PR });

    await getAction('git.merge')!.execute({ orgId: 'org_x' } as never, { externalRef: { url: 'https://github.com/northwind/app/pull/158' }, commitSha: 'abc1234' });

    const expected = mergedPullEvent('northwind/app', PR);

    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_x', type: 'pr.merged', dedupeKey: expected.dedupeKey }));
  });

  it('raises nothing when the pull request was already merged', async () => {
    mergePull.mockResolvedValue({ merged: true, sha: 'b8a7210a8289', already: true, repo: 'northwind/app', pull: null });

    await getAction('git.merge')!.execute({ orgId: 'org_x' } as never, { externalRef: { url: 'https://github.com/northwind/app/pull/158' }, commitSha: 'abc1234' });

    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('is the event the sync builds for the same merge', () => {
    const fromSync = pullRequestLifecycleEvents('northwind/app', PR, new Date('2026-10-01T23:00:00Z')).find(e => e.type === 'pr.merged');

    expect(fromSync).toEqual(mergedPullEvent('northwind/app', PR));
  });
});
