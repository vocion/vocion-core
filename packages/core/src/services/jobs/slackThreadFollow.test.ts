import { describe, expect, it, vi } from 'vitest';
import { doneText, followText, slackThreadFollow, slackThreadOfScope, slackThreadRecording } from './slackThreadFollow';

describe('the Slack thread follows the request (backlog 057)', () => {
  it('reads the thread off the conversation scope, and nothing else', () => {
    expect(slackThreadOfScope('slack:C7:1700000000.000100')).toEqual({ channelId: 'C7', threadTs: '1700000000.000100' });
    expect(slackThreadOfScope('email:thread-9')).toBeNull();
    expect(slackThreadOfScope(null)).toBeNull();
  });

  it('says the step\'s own sentence and the record\'s page, nothing more', () => {
    expect(followText({ line: 'QA approved 8 of 8; merged by Vocion', value: 'deploying' }, 'https://vocion.example/w/acme/dashboard/p/feature/449')).toBe('QA approved 8 of 8; merged by Vocion.\nhttps://vocion.example/w/acme/dashboard/p/feature/449');
    expect(followText({ line: '', value: 'in_qa' }, null)).toBe('Now in qa.');
  });

  it('when a card waits, says how to decide it from the thread, in the card\'s own verbs', () => {
    expect(followText({ line: 'QA approved 8 of 8; the merge waits on a person.', value: 'awaiting_merge' }, 'https://vocion.example/p/feature/449', { verbs: { approve: 'Merge', reject: 'Hold' } }))
      .toBe('QA approved 8 of 8; the merge waits on a person.\nMerge or Hold: reply here, or decide it in Vocion.\nhttps://vocion.example/p/feature/449');
  });

  const deps = (over: Partial<Parameters<typeof slackThreadFollow>[2]> = {}) => ({
    originConversation: vi.fn(async () => 474),
    scopeOf: vi.fn(async () => 'slack:C7:1700000000.000100'),
    pageHref: vi.fn(async (_o: string, type: string | null, id: number) => `https://vocion.example/w/acme/dashboard/p/${type ?? 'objects'}/${id}`),
    waitingCard: vi.fn(async () => null),
    alreadyPosted: vi.fn(async () => false),
    post: vi.fn(async () => '1700000000.000200'),
    attach: vi.fn(async () => true),
    captionOf: vi.fn(async () => 'Feature demo · narrated by Bella'),
    alreadyAttached: vi.fn(async () => false),
    doneFacts: vi.fn(async () => ({ title: 'Passcode switch beside access', live: 'seen' as const, reached: 5, total: 5, shareUrl: 'https://vocion.example/share/feature/abc' })),
    remember: vi.fn(async () => undefined),
    ...over,
  });

  it('posts each move once into the thread the request was asked in, with the page its workspace declares, and remembers it', async () => {
    const d = deps();
    const out = await slackThreadFollow('org_n', { recordId: 449, typeSlug: 'request', value: 'changes_asked', needsYou: true, line: 'QA is reviewing the pull request.' }, d);

    expect(out).toMatchObject({ posted: true, channelId: 'C7', threadTs: '1700000000.000100', attached: false });
    expect(d.pageHref).toHaveBeenCalledWith('org_n', 'request', 449);
    expect(d.post).toHaveBeenCalledWith({ channelId: 'C7', threadTs: '1700000000.000100' }, 'QA is reviewing the pull request.\nhttps://vocion.example/w/acme/dashboard/p/request/449');
    expect(d.remember).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_n', channelId: 'C7', ts: '1700000000.000200', announcedLabel: 'changes_asked', announcedUrl: 'https://vocion.example/w/acme/dashboard/p/request/449' }));
    expect(d.attach).not.toHaveBeenCalled();
  });

  it('when the move waits on a person, carries the card\'s demo under the words and says a reply decides it', async () => {
    const d = deps({ waitingCard: vi.fn(async () => ({ runId: 7049, title: 'Merge #152', verbs: { approve: 'Merge', reject: 'Hold' }, video: { url: '/api/media/449/demo-narrated.mp4', caption: 'Feature demo, built from the branch' } })) });
    const out = await slackThreadFollow('org_n', { recordId: 449, typeSlug: 'request', value: 'awaiting_merge', needsYou: true, line: 'QA approved 8 of 8; the merge waits on a person.' }, d);

    expect(out).toMatchObject({ posted: true, attached: true });
    expect(d.waitingCard).toHaveBeenCalledWith('org_n', 474);
    expect(d.post).toHaveBeenCalledWith(expect.anything(), 'QA approved 8 of 8; the merge waits on a person.\nMerge or Hold: reply here, or decide it in Vocion.\nhttps://vocion.example/w/acme/dashboard/p/request/449');
    expect(d.attach).toHaveBeenCalledWith('org_n', { channelId: 'C7', threadTs: '1700000000.000100' }, { url: '/api/media/449/demo-narrated.mp4', caption: 'Feature demo, built from the branch' });
  });

  it('a card with no demo, or a demo Slack would not take, leaves the words standing', async () => {
    const noVideo = deps({ waitingCard: vi.fn(async () => ({ runId: 1, title: 't', verbs: { approve: 'Merge', reject: 'Hold' }, video: null })) });

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'awaiting_merge', needsYou: true, line: 'x' }, noVideo)).toMatchObject({ posted: true, attached: false });
    expect(noVideo.attach).not.toHaveBeenCalled();

    const refused = deps({ waitingCard: vi.fn(async () => ({ runId: 1, title: 't', verbs: { approve: 'Merge', reject: 'Hold' }, video: { url: '/api/media/449/demo.webm', caption: 'c' } })), attach: vi.fn(async () => {
      throw new Error('files:write missing');
    }) });

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'awaiting_merge', needsYou: true, line: 'x' }, refused)).toMatchObject({ posted: true, attached: false });
    expect(refused.post).toHaveBeenCalledTimes(1);
  });

  it('stays quiet for a record that was not asked in Slack, and for a line already said', async () => {
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', needsYou: true, line: 'x' }, deps({ originConversation: vi.fn(async () => null) }))).toEqual({ posted: false, reason: 'the record was not asked for in a conversation' });
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', needsYou: true, line: 'x' }, deps({ scopeOf: vi.fn(async () => 'web:page') }))).toEqual({ posted: false, reason: 'the conversation is not a Slack thread' });

    const d = deps({ alreadyPosted: vi.fn(async () => true) });

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', needsYou: true, line: 'x' }, d)).toEqual({ posted: false, reason: 'already said in the thread' });
    expect(d.post).not.toHaveBeenCalled();
  });

  it('says nothing for a move the Work page carries (building, in QA, deploying)', async () => {
    const d = deps();

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'building', groupRole: 'progress', line: 'RUN-9 is building.' }, d)).toEqual({ posted: false, reason: 'a move the Work page carries, not the thread' });
    expect(d.post).not.toHaveBeenCalled();
  });

  it('when it is done and seen on production, posts one friendly message with the page and the share link', async () => {
    const d = deps();
    const out = await slackThreadFollow('org_n', { recordId: 457, typeSlug: 'request', value: 'seen_live', groupRole: 'done', line: 'Seen live: 5 of 5 states reached (GET /v1/share … 200)' }, d);

    expect(out).toMatchObject({ posted: true });
    expect(d.post).toHaveBeenCalledWith(expect.anything(), 'Done ✅ "Passcode switch beside access" is live in production and tested: everything you asked for was seen working on production.\nFeature page: https://vocion.example/w/acme/dashboard/p/request/457\nShare it: https://vocion.example/share/feature/abc');
  });

  it('done but not yet seen on production waits for the check', async () => {
    const d = deps({ doneFacts: vi.fn(async () => ({ title: 't', live: null, reached: 0, total: 0, shareUrl: null })) });

    expect(await slackThreadFollow('org_n', { recordId: 457, value: 'shipped', groupRole: 'done', line: 'Shipped in release #463.' }, d)).toEqual({ posted: false, reason: 'done, but not yet seen on production' });
    expect(doneText({ title: 'Stars', live: 'seen', reached: 4, total: 5, shareUrl: null }, null)).toBe('Done ✅ "Stars" is live in production and tested: 4 of 5 things you asked for were seen working on production.');
  });

  describe('a filed recording reaches the thread (gap 6)', () => {
    it('posts the caption and uploads the file once per thread, and remembers the URL', async () => {
      const d = deps();
      const out = await slackThreadRecording('org_n', { artifactId: 3587, url: '/api/media/226/feature-demo-narrated.mp4', recordIds: '226', role: 'feature-demo-narrated', narrated: true }, d);

      expect(out).toEqual({ posted: 1, attached: 1, skipped: [] });
      expect(d.captionOf).toHaveBeenCalledWith('org_n', 3587);
      expect(d.post).toHaveBeenCalledWith({ channelId: 'C7', threadTs: '1700000000.000100' }, 'Feature demo · narrated by Bella');
      expect(d.attach).toHaveBeenCalledWith('org_n', { channelId: 'C7', threadTs: '1700000000.000100' }, { url: '/api/media/226/feature-demo-narrated.mp4', caption: 'Feature demo · narrated by Bella' });
      expect(d.remember).toHaveBeenCalledWith(expect.objectContaining({ announcedUrl: '/api/media/226/feature-demo-narrated.mp4', announcedLabel: 'feature-demo-narrated', text: 'Feature demo · narrated by Bella' }));
    });

    it('a recording filed on two records that share a thread, or already in it, goes once', async () => {
      const twice = deps();

      expect(await slackThreadRecording('org_n', { artifactId: 1, url: '/api/media/226/a.mp4', recordIds: '226,227' }, twice)).toMatchObject({ posted: 1, attached: 1 });
      expect(twice.post).toHaveBeenCalledTimes(1);

      const had = deps({ alreadyAttached: vi.fn(async () => true) });

      expect(await slackThreadRecording('org_n', { artifactId: 1, url: '/api/media/226/a.mp4', recordIds: '226' }, had)).toEqual({ posted: 0, attached: 0, skipped: ['the thread for record 226 already has it'] });
      expect(had.post).not.toHaveBeenCalled();
    });

    it('stays quiet for a record not asked in Slack, and for an event naming no recording', async () => {
      const d = deps({ scopeOf: vi.fn(async () => 'web:page') });

      expect(await slackThreadRecording('org_n', { artifactId: 1, url: '/api/media/226/a.mp4', recordIds: '226' }, d)).toEqual({ posted: 0, attached: 0, skipped: ['record 226 was not asked in a Slack thread'] });
      expect(await slackThreadRecording('org_n', { artifactId: 1, recordIds: '226' }, deps())).toEqual({ posted: 0, attached: 0, skipped: ['the event names no recording or no record'] });
    });
  });
});
