import { describe, expect, it, vi } from 'vitest';
import { followText, slackThreadFollow, slackThreadOfScope } from './slackThreadFollow';

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
    remember: vi.fn(async () => undefined),
    ...over,
  });

  it('posts each move once into the thread the request was asked in, with the page its workspace declares, and remembers it', async () => {
    const d = deps();
    const out = await slackThreadFollow('org_n', { recordId: 449, typeSlug: 'request', value: 'in_qa', line: 'QA is reviewing the pull request.' }, d);

    expect(out).toMatchObject({ posted: true, channelId: 'C7', threadTs: '1700000000.000100', attached: false });
    expect(d.pageHref).toHaveBeenCalledWith('org_n', 'request', 449);
    expect(d.post).toHaveBeenCalledWith({ channelId: 'C7', threadTs: '1700000000.000100' }, 'QA is reviewing the pull request.\nhttps://vocion.example/w/acme/dashboard/p/request/449');
    expect(d.remember).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_n', channelId: 'C7', ts: '1700000000.000200', announcedLabel: 'in_qa', announcedUrl: 'https://vocion.example/w/acme/dashboard/p/request/449' }));
    expect(d.waitingCard).not.toHaveBeenCalled();
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
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, deps({ originConversation: vi.fn(async () => null) }))).toEqual({ posted: false, reason: 'the record was not asked for in a conversation' });
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, deps({ scopeOf: vi.fn(async () => 'web:page') }))).toEqual({ posted: false, reason: 'the conversation is not a Slack thread' });

    const d = deps({ alreadyPosted: vi.fn(async () => true) });

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, d)).toEqual({ posted: false, reason: 'already said in the thread' });
    expect(d.post).not.toHaveBeenCalled();
  });
});
