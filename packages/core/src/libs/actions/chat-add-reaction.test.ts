/**
 * chat.add_reaction: a reaction on the message that became a request; one
 * already there counts as added, Undo removes it, one per message and name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { chatAddReactionAction as action } from './chat-add-reaction';

const provider = vi.hoisted(() => ({ addReaction: vi.fn(), removeReaction: vi.fn() }));
vi.mock('@/services/chat/provider', async () => {
  const real = await vi.importActual<typeof import('@/services/chat/provider')>('@/services/chat/provider');
  return { ...real, chatProviderFor: async () => provider, chatTokenFor: async () => ({ token: 'xoxb', from: 'deployment', sourceSlug: null }) };
});

const PERMALINK = 'https://northwind.slack.com/archives/C0REQ/p1727700000000100';
const parse = (input: Record<string, unknown>) => action.inputSchema.parse(input);

beforeEach(() => {
  provider.addReaction.mockReset().mockResolvedValue({ ok: true, already: false });
  provider.removeReaction.mockReset().mockResolvedValue({ ok: true, absent: false });
});

describe('chat.add_reaction', () => {
  it('takes an emoji short name without colons, and names the message by link or ids', () => {
    expect(action.external).toBe(true);
    expect(action.inputSchema.safeParse({ permalink: PERMALINK, name: ':eyes:' }).success).toBe(false);
    expect(action.inputSchema.safeParse({ permalink: PERMALINK, name: 'white_check_mark' }).success).toBe(true);
    expect(action.inputSchema.safeParse({ name: 'eyes' }).success).toBe(false);
    expect(action.inputSchema.safeParse({ channelId: 'C0REQ', ts: '1.000001', name: 'eyes' }).success).toBe(true);
  });

  it('adds the reaction to the message the link names; one already there is done', async () => {
    await expect(action.execute({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes', reason: 'read and filed as request #12' }))).resolves.toMatchObject({ reacted: true, already: false, message: { channelId: 'C0REQ', ts: '1727700000.000100' } });
    expect(provider.addReaction).toHaveBeenCalledWith({ channelId: 'C0REQ', ts: '1727700000.000100', name: 'eyes' });

    provider.addReaction.mockResolvedValueOnce({ ok: true, already: true });

    await expect(action.execute({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes' }))).resolves.toMatchObject({ reacted: true, already: true });

    provider.addReaction.mockResolvedValueOnce({ ok: false, error: 'Adding a reaction needs the `reactions:write` scope on the Slack app; it was not granted.' });

    await expect(action.execute({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes' }))).rejects.toThrow(/reactions:write/);
  });

  it('is one reaction per message and name', () => {
    const a = parse({ permalink: PERMALINK, name: 'eyes' });

    expect(action.dedupKeyFor!(a)).toBe(action.dedupKeyFor!(parse({ channelId: 'C0REQ', ts: '1727700000.000100', name: 'eyes', reason: 'different words' })));
    expect(action.dedupKeyFor!(a)).not.toBe(action.dedupKeyFor!(parse({ permalink: PERMALINK, name: 'white_check_mark' })));
  });

  it('is undone by removing it; one already gone is removed', async () => {
    await expect(action.undo!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes' }), { message: { channelId: 'C0REQ', ts: '1727700000.000100' } })).resolves.toMatchObject({ removed: true, absent: false });
    expect(provider.removeReaction).toHaveBeenCalledWith({ channelId: 'C0REQ', ts: '1727700000.000100', name: 'eyes' });

    provider.removeReaction.mockResolvedValueOnce({ ok: true, absent: true });

    await expect(action.undo!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes' }), {})).resolves.toMatchObject({ removed: true, absent: true });
  });

  it('refuses a link that is not a message at the door', async () => {
    await expect(action.precheck!({ orgId: 'org_1' }, parse({ permalink: 'https://example.com/not-a-message', name: 'eyes' }))).resolves.toMatch(/not a link to a chat message/);
    await expect(action.precheck!({ orgId: 'org_1' }, parse({ permalink: PERMALINK, name: 'eyes' }))).resolves.toBeUndefined();
  });
});
