/**
 * chat.reply_in_thread: answers in the asker's thread through the chat
 * provider, keyed per kind on the ladder, editable as a message, deduped per
 * record per thread, recorded as an outbound post, and taken back by Undo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatReplyInThreadAction as action } from './chat-reply-in-thread';

const provider = vi.hoisted(() => ({ postInThread: vi.fn(), deleteMessage: vi.fn() }));
const token = vi.hoisted(() => ({ value: { token: 'xoxb', from: 'source', sourceSlug: 'slack' } as unknown }));
vi.mock('@/services/chat/provider', async () => {
  const real = await vi.importActual<typeof import('@/services/chat/provider')>('@/services/chat/provider');
  return { ...real, chatProviderFor: async () => provider, chatTokenFor: async () => token.value };
});
const recorded = vi.hoisted(() => ({ posts: [] as Record<string, unknown>[] }));
vi.mock('@/services/chat/slackPosts', () => ({ recordSlackPost: async (input: Record<string, unknown>) => {
  recorded.posts.push(input);
  return { id: 1 };
} }));

const PERMALINK = 'https://northwind.slack.com/archives/C0REQ/p1727700000000100';
const parse = (input: Record<string, unknown>) => action.inputSchema.parse(input);

beforeEach(() => {
  provider.postInThread.mockReset().mockResolvedValue({ ts: '1727700200.000300' });
  provider.deleteMessage.mockReset().mockResolvedValue({ ok: true });
  recorded.posts.length = 0;
  token.value = { token: 'xoxb', from: 'source', sourceSlug: 'slack' };
});

describe('chat.reply_in_thread', () => {
  it('is an external, reversible write keyed per kind, with the parent rule governing a kind of its own', () => {
    expect(action.external).toBe(true);
    expect(action.undo).toBeDefined();
    expect(action.parentRuleGoverns).toBe(true);
    expect(action.policyKeyFor!(parse({ permalink: PERMALINK, text: 'Shipped.' }))).toBe('chat.reply_in_thread');
    expect(action.policyKeyFor!(parse({ permalink: PERMALINK, text: 'Not this quarter.', kind: 'sensitive' }))).toBe('chat.reply_in_thread.sensitive');
    expect(action.inputSchema.safeParse({ text: 'no thread named' }).success).toBe(false);
    expect(action.inputSchema.safeParse({ channelId: 'C0REQ', threadTs: '1.000001', text: 'ok' }).success).toBe(true);
  });

  it('refuses at the door a link that is not a message, and a workspace with no chat', async () => {
    await expect(action.precheck!({ orgId: 'org_1' }, parse({ permalink: 'https://github.com/Acme/app/pull/1', text: 'x' }))).resolves.toMatch(/not a link to a chat message/);

    token.value = null;

    await expect(action.precheck!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, text: 'x' }))).resolves.toMatch(/no chat connected/);
  });

  it('posts in the thread the permalink names, attributed to the agent, and records the reply', async () => {
    const out = await action.execute({ orgId: 'org_1', invokedBy: 'agent:product-manager', reviewedBy: 'user_1' }, parse({ permalink: PERMALINK, text: 'Filed as request #12; you will hear back here.', kind: 'update' }));

    expect(provider.postInThread).toHaveBeenCalledWith({ channelId: 'C0REQ', threadTs: '1727700000.000100', text: 'Filed as request #12; you will hear back here.' });
    expect(out).toMatchObject({ replied: true, post: { channelId: 'C0REQ', threadTs: '1727700000.000100', ts: '1727700200.000300' } });
    expect(recorded.posts).toEqual([expect.objectContaining({ orgId: 'org_1', channelId: 'C0REQ', ts: '1727700200.000300', threadTs: '1727700000.000100', kind: 'reply', agentSlug: 'product-manager', createdBy: 'user_1' })]);
  });

  it('replies in the reply\'s own thread when the permalink carries thread_ts', async () => {
    await action.execute({ orgId: 'org_1' }, parse({ permalink: `${PERMALINK.replace('p1727700000000100', 'p1727700100000200')}?thread_ts=1727700000.000100`, text: 'x' }));

    expect(provider.postInThread).toHaveBeenCalledWith(expect.objectContaining({ threadTs: '1727700000.000100' }));
  });

  it('shows the words as an editable message and maps the edit back', async () => {
    const card = await action.reviewCard!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, text: 'Draft.', kind: 'sensitive', about: 'request:12' }));

    expect(card.content).toEqual([{ kind: 'message', id: 'message', label: 'Reply', body: 'Draft.' }]);
    expect(card.badges).toContainEqual({ label: 'sensitive', tone: 'warn' });
    expect(action.applyContentEdits!(parse({ permalink: PERMALINK, text: 'Draft.' }), [{ id: 'message', body: 'Final.' }])).toMatchObject({ text: 'Final.' });
  });

  it('dedups per record per thread, never on the wording, and not at all without a record', () => {
    const a = parse({ permalink: PERMALINK, text: 'one', about: 'request:12' });

    expect(action.dedupKeyFor!(a)).toBe(action.dedupKeyFor!({ ...a, text: 'two' }));
    expect(action.dedupKeyFor!(a)).toBe('chat.reply_in_thread:c0req:1727700000.000100:request:12');
    expect(action.dedupKeyFor!(parse({ channelId: 'C0OTHER', threadTs: '1.000001', text: 'one', about: 'request:12' }))).not.toBe(action.dedupKeyFor!(a));
    expect(action.dedupKeyFor!(parse({ permalink: PERMALINK, text: 'one' }))).toBeUndefined();
  });

  it('is undone by deleting the reply, and says so when the chat refuses', async () => {
    const post = { channelId: 'C0REQ', threadTs: '1727700000.000100', ts: '1727700200.000300' };

    await expect(action.undo!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, text: 'x' }), { post })).resolves.toMatchObject({ deleted: true });
    expect(provider.deleteMessage).toHaveBeenCalledWith({ channelId: 'C0REQ', ts: '1727700200.000300' });

    provider.deleteMessage.mockResolvedValueOnce({ ok: false, error: 'Slack answered cant_delete_message.' });

    await expect(action.undo!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, text: 'x' }), { post })).rejects.toThrow(/cant_delete_message/);
    await expect(action.undo!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, text: 'x' }), {})).rejects.toThrow(/recorded no reply/);
  });
});
