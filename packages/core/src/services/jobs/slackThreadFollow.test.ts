import { describe, expect, it, vi } from 'vitest';
import { followText, slackThreadFollow, slackThreadOfScope } from './slackThreadFollow';

describe('the Slack thread follows the request (backlog 057)', () => {
  it('reads the thread off the conversation scope, and nothing else', () => {
    expect(slackThreadOfScope('slack:C7:1700000000.000100')).toEqual({ channelId: 'C7', threadTs: '1700000000.000100' });
    expect(slackThreadOfScope('email:thread-9')).toBeNull();
    expect(slackThreadOfScope(null)).toBeNull();
  });

  it('says the step\'s own sentence and the record\'s page, nothing more', () => {
    expect(followText({ line: 'QA approved 8 of 8; merged by Vocion', value: 'deploying' }, 'https://vocion.example/dashboard/objects/449')).toBe('QA approved 8 of 8; merged by Vocion.\nhttps://vocion.example/dashboard/objects/449');
    expect(followText({ line: '', value: 'in_qa' }, null)).toBe('Now in qa.');
  });

  const deps = (over: Partial<Parameters<typeof slackThreadFollow>[2]> = {}) => ({
    originConversation: vi.fn(async () => 474),
    scopeOf: vi.fn(async () => 'slack:C7:1700000000.000100'),
    alreadyPosted: vi.fn(async () => false),
    post: vi.fn(async () => '1700000000.000200'),
    remember: vi.fn(async () => undefined),
    ...over,
  });

  it('posts each move once into the thread the request was asked in, and remembers it', async () => {
    const d = deps();
    const out = await slackThreadFollow('org_n', { recordId: 449, typeSlug: 'request', value: 'in_qa', line: 'QA is reviewing the pull request.' }, d);

    expect(out).toMatchObject({ posted: true, channelId: 'C7', threadTs: '1700000000.000100' });
    expect(d.post).toHaveBeenCalledWith({ channelId: 'C7', threadTs: '1700000000.000100' }, expect.stringMatching(/^QA is reviewing the pull request\./));
    expect(d.remember).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org_n', channelId: 'C7', ts: '1700000000.000200', announcedLabel: 'in_qa' }));
  });

  it('stays quiet for a record that was not asked in Slack, and for a line already said', async () => {
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, deps({ originConversation: vi.fn(async () => null) }))).toEqual({ posted: false, reason: 'the record was not asked for in a conversation' });
    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, deps({ scopeOf: vi.fn(async () => 'web:page') }))).toEqual({ posted: false, reason: 'the conversation is not a Slack thread' });

    const d = deps({ alreadyPosted: vi.fn(async () => true) });

    expect(await slackThreadFollow('org_n', { recordId: 449, value: 'in_qa', line: 'x' }, d)).toEqual({ posted: false, reason: 'already said in the thread' });
    expect(d.post).not.toHaveBeenCalled();
  });
});
