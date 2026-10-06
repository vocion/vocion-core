import type { AskerFollowDeps } from './askerFollow';
import { describe, expect, it, vi } from 'vitest';
import { askerFollow, askerKey, askerLine, askerRecording } from './askerFollow';

/**
 * The asker hears back where they asked, by what the record's type says to tell for a move
 * (`x-tell`), once each. Fixtures are fictional.
 */

const TELL_LIVE = 'Done ✅ "{title}" is live in production and checked. {line}';

function deps(over: Partial<AskerFollowDeps> = {}) {
  const told: Array<{ text: string; key: string; files: number; threadOnly?: boolean }> = [];
  const marked: Array<{ channel: string; status: string }> = [];
  const d: AskerFollowDeps = {
    record: async () => ({ conversationId: 77, title: 'Opened by N', reopenedAt: null }),
    pageHref: async () => 'https://vocion.example/w/sq/dashboard/p/feature/478',
    shareUrl: async () => null,
    waitingCard: async () => null,
    tell: async (_o, _c, text, opts) => {
      told.push({ text, key: opts.key, files: opts.files?.length ?? 0, ...(opts.threadOnly ? { threadOnly: true } : {}) });
      return { said: true, channel: 'slack' };
    },
    markTold: async (_o, _r, t) => {
      marked.push({ channel: t.channel, status: t.status });
    },
    captionOf: async () => 'The feature in use',
    ...over,
  };
  return { d, told, marked };
}

const move = (over: Record<string, unknown> = {}) => ({ recordId: 478, typeSlug: 'request', value: 'seen_live', groupRole: 'done', needsYou: false, transition: 'live_seen', line: 'Seen live: 4 of 4', tell: TELL_LIVE, at: '2026-10-06T15:00:00Z', ...over });

describe('askerFollow', () => {
  it('says the end in the type\'s words with the page, and records that the asker was told', async () => {
    const { d, told, marked } = deps();

    expect(await askerFollow('org_sq', move(), d)).toMatchObject({ said: true, told: true });
    expect(told).toEqual([{ text: 'Done ✅ "Opened by N" is live in production and checked. Seen live: 4 of 4.\nFeature page: https://vocion.example/w/sq/dashboard/p/feature/478', key: 'record:478:seen_live:first', files: 0 }]);
    expect(marked).toEqual([{ channel: 'slack', status: 'sent' }]);
  });

  it('says nothing for a move the type does not tell (a send-back that retries by itself, QA, the deploy)', async () => {
    const { d, told } = deps();

    expect(await askerFollow('org_sq', move({ value: 'changes_asked', groupRole: 'progress', needsYou: true, transition: 'live_changes', tell: '' }), d)).toEqual({ said: false, reason: 'the type tells the asker nothing for this move' });
    expect(told).toEqual([]);
  });

  it('a merge waiting on a person says how to decide it, and carries the card\'s demo', async () => {
    const { d, told, marked } = deps({ waitingCard: async () => ({ verbs: { approve: 'Merge', reject: 'Hold' }, video: { url: '/api/media/478/demo.mp4', caption: 'The demo' } }) });

    await askerFollow('org_sq', move({ value: 'awaiting_merge', groupRole: 'progress', needsYou: true, transition: 'merge_waits', line: 'QA approved 7 of 7', tell: 'Ready to merge, and the merge waits on you. {line}' }), d);

    expect(told[0]).toMatchObject({ text: 'Ready to merge, and the merge waits on you. QA approved 7 of 7.\nMerge or Hold: reply here, or decide it in Vocion.\nFeature page: https://vocion.example/w/sq/dashboard/p/feature/478', files: 1 });
    expect(marked).toEqual([]);
  });

  it('says nothing for a record that was not asked in a conversation', async () => {
    const { d } = deps({ record: async () => ({ conversationId: null, title: 'x', reopenedAt: null }) });

    expect(await askerFollow('org_sq', move(), d)).toMatchObject({ said: false, reason: expect.stringMatching(/not asked for in a conversation/) });
  });

  it('keys the end once until a reopen, and a waiting move by its sentence', () => {
    expect(askerKey(478, 'seen_live', 'done', 'Seen live: 4 of 4', null)).toBe(askerKey(478, 'seen_live', 'done', 'Seen live: 3 of 4', null));
    expect(askerKey(478, 'seen_live', 'done', 'x', '2026-10-07T00:00:00Z')).not.toBe(askerKey(478, 'seen_live', 'done', 'x', null));
    expect(askerKey(478, 'stopped', 'progress', 'No worker', null)).not.toBe(askerKey(478, 'stopped', 'progress', 'Checks failed 3 times', null));
  });

  it('fills the words without leaving a gap where the sentence was empty', () => {
    expect(askerLine('Blocked, and it needs you: {line}', { line: '', title: 't' }, { href: null, shareUrl: null, waiting: null })).toBe('Blocked, and it needs you:');
  });

  it('carries a filed demo into the thread only, once per conversation', async () => {
    const tell = vi.fn(async () => ({ said: true as const, channel: 'slack' as const }));
    const { d } = deps({ tell });

    const out = await askerRecording('org_sq', { artifactId: 4195, url: '/api/media/478/demo.mp4', recordIds: '478,478' }, d);

    expect(out.posted).toBe(1);
    expect(tell).toHaveBeenCalledWith('org_sq', 77, 'The feature in use', { key: 'recording:/api/media/478/demo.mp4', files: [{ url: '/api/media/478/demo.mp4', caption: 'The feature in use', artifactId: 4195 }], threadOnly: true, url: '/api/media/478/demo.mp4' });
  });
});
