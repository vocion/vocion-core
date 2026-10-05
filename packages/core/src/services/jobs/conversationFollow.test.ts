import { describe, expect, it, vi } from 'vitest';
import { conversationFollow, followLine, worthSaying } from './conversationFollow';

describe('the asker hears back where they asked (2026-10-05)', () => {
  it('speaks when a decision waits on the person and when the work is done, and stays quiet in between', () => {
    expect(worthSaying({ groupRole: 'progress', needsYou: false })).toBe(false);
    expect(worthSaying({ groupRole: 'progress', needsYou: true })).toBe(true);
    expect(worthSaying({ groupRole: 'done', needsYou: false })).toBe(true);
    expect(worthSaying({ groupRole: 'proposed', needsYou: false })).toBe(false);
  });

  it('says the step\'s own sentence, the feature page, and the share link only when it is done and on', () => {
    expect(followLine({ line: 'Seen live: 4 of 4 states reached', value: 'seen_live', groupRole: 'done' }, 'https://vocion.example/w/acme/dashboard/p/feature/453', 'https://vocion.example/share/feature/abc')).toBe('Seen live: 4 of 4 states reached.\nFeature page: https://vocion.example/w/acme/dashboard/p/feature/453\nShare it: https://vocion.example/share/feature/abc');
    expect(followLine({ line: 'QA approved 8 of 8; the merge waits on a person.', value: 'awaiting_merge', groupRole: 'progress' }, 'https://vocion.example/p/feature/453', 'https://vocion.example/share/feature/abc')).toBe('QA approved 8 of 8; the merge waits on a person.\nFeature page: https://vocion.example/p/feature/453');
    expect(followLine({ line: '', value: 'seen_live', groupRole: 'done' }, null, null)).toBe('Now seen live.');
  });

  const deps = (over: Partial<Parameters<typeof conversationFollow>[2]> = {}) => ({
    originConversation: vi.fn(async () => 478),
    conversation: vi.fn(async () => ({ surface: 'web', scopeRef: null, agentSlug: 'product-manager' })),
    pageHref: vi.fn(async (_o: string, t: string | null, id: number) => `https://vocion.example/w/acme/dashboard/p/${t}/${id}`),
    shareUrl: vi.fn(async () => 'https://vocion.example/share/feature/abc'),
    alreadySaid: vi.fn(async () => false),
    say: vi.fn(async () => undefined),
    markTold: vi.fn(async () => undefined),
    ...over,
  });

  it('on the end, says it in the conversation as its own agent, with the links, and writes told on the record', async () => {
    const d = deps();
    const out = await conversationFollow('org_n', { recordId: 453, typeSlug: 'request', value: 'seen_live', groupRole: 'done', needsYou: false, line: 'Seen live: 4 of 4 states reached.', at: '2026-10-05T03:05:51.000Z' }, d);

    expect(out).toMatchObject({ posted: true, conversationId: 478, told: true });
    expect(d.say).toHaveBeenCalledWith('org_n', 478, 'Seen live: 4 of 4 states reached.\nFeature page: https://vocion.example/w/acme/dashboard/p/request/453\nShare it: https://vocion.example/share/feature/abc', 'product-manager');
    expect(d.markTold).toHaveBeenCalledWith('org_n', 453, { at: '2026-10-05T03:05:51.000Z', channel: 'chat', what: expect.stringContaining('Seen live'), status: 'sent' });
  });

  it('on a decision that waits, says it without a share link and writes nothing as told', async () => {
    const d = deps();
    const out = await conversationFollow('org_n', { recordId: 453, typeSlug: 'request', value: 'awaiting_merge', groupRole: 'progress', needsYou: true, line: 'QA approved 7 of 7; the merge waits on a person.' }, d);

    expect(out).toMatchObject({ posted: true, told: false });
    expect(d.shareUrl).not.toHaveBeenCalled();
    expect(d.markTold).not.toHaveBeenCalled();
  });

  it('stays quiet for a move the Work page carries, a record not asked in a conversation, a Slack thread, and a line already said', async () => {
    expect(await conversationFollow('org_n', { recordId: 453, value: 'building', groupRole: 'progress', needsYou: false, line: 'x' }, deps())).toEqual({ posted: false, reason: 'a move the Work page carries, not the chat' });
    expect(await conversationFollow('org_n', { recordId: 453, value: 'shipped', groupRole: 'done', line: 'x' }, deps({ originConversation: vi.fn(async () => null) }))).toEqual({ posted: false, reason: 'the record was not asked for in a conversation' });
    expect(await conversationFollow('org_n', { recordId: 453, value: 'shipped', groupRole: 'done', line: 'x' }, deps({ conversation: vi.fn(async () => ({ surface: 'slack', scopeRef: 'slack:C7:1.2', agentSlug: null })) }))).toMatchObject({ posted: false, reason: expect.stringContaining('Slack') });

    const d = deps({ alreadySaid: vi.fn(async () => true) });

    expect(await conversationFollow('org_n', { recordId: 453, value: 'shipped', groupRole: 'done', line: 'x' }, d)).toEqual({ posted: false, reason: 'already said in the conversation' });
    expect(d.say).not.toHaveBeenCalled();
  });
});
