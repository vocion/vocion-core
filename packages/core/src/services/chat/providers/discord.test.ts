import { describe, expect, it } from 'vitest';
import { parseAnyChatPermalink } from '../permalinks';
import { discordChatProvider, parseDiscordPermalink } from './discord';

/** Discord as the chat family's second provider, against a stand-in API. Fictional snowflakes. */

const CHANNEL = '1200000000000000002';
const PARENT = '1300000000000000010';

function net(handler: (url: URL, init?: RequestInit) => { status?: number; json?: unknown }) {
  const seen: { url: URL; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    seen.push({ url, init });
    const r = handler(url, init);
    return r.status === 204 ? new Response(null, { status: 204 }) : new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetchImpl, seen };
}

describe('discord permalinks', () => {
  it('reads a message link on any Discord host into its channel and message, and says it is Discord\'s', () => {
    expect(parseDiscordPermalink(`https://discord.com/channels/1200000000000000001/${CHANNEL}/${PARENT}`)).toEqual({ channelId: CHANNEL, ts: PARENT, kind: 'discord' });
    expect(parseDiscordPermalink(`https://ptb.discordapp.com/channels/@me/${CHANNEL}/${PARENT}`)).toMatchObject({ channelId: CHANNEL });
    expect(parseDiscordPermalink('https://discord.com/invite/abc')).toBeNull();
    expect(parseAnyChatPermalink('https://northwind.slack.com/archives/C0REQ/p1727700000000100')).toMatchObject({ kind: 'slack', channelId: 'C0REQ' });
    expect(parseAnyChatPermalink(`https://discord.com/channels/1/${CHANNEL}/${PARENT}`)).toMatchObject({ kind: 'discord' });
  });
});

describe('the discord chat provider', () => {
  it('reads a thread as the message and the replies that reference it, with files as fetchable ids', async () => {
    const { fetchImpl } = net((url) => {
      if (url.pathname === `/api/v10/channels/${CHANNEL}`) {
        return { json: { id: CHANNEL, name: 'requests' } };
      }
      if (url.pathname.endsWith(`/messages/${PARENT}`)) {
        return { json: { id: PARENT, channel_id: CHANNEL, content: 'Can we export to CSV?', author: { id: '11', username: 'dana' }, attachments: [{ id: '77', filename: 'mock.png', content_type: 'image/png', size: 10 }] } };
      }
      return { json: [
        { id: '1300000000000000011', channel_id: CHANNEL, content: 'Unrelated', author: { id: '12' } },
        { id: '1300000000000000012', channel_id: CHANNEL, content: 'Yes, by Friday', author: { id: '13', global_name: 'Riley' }, message_reference: { message_id: PARENT } },
      ] };
    });
    const read = await discordChatProvider('bot', fetchImpl).readThread({ channelId: CHANNEL, threadTs: PARENT });

    expect(read.ok && read.value.channel).toEqual({ id: CHANNEL, name: 'requests' });
    expect(read.ok && read.value.messages.map(m => [m.ts, m.author.name, m.text])).toEqual([[PARENT, 'dana', 'Can we export to CSV?'], ['1300000000000000012', 'Riley', 'Yes, by Friday']]);
    expect(read.ok && read.value.messages[0]!.files[0]!.id).toBe(`${CHANNEL}:${PARENT}:77`);
  });

  it('replies as a reference to the message, pings nobody, and takes the reply back on undo', async () => {
    const { fetchImpl, seen } = net((_url, init) => (init?.method === 'POST' ? { json: { id: '1300000000000000099' } } : { status: 204 }));
    const provider = discordChatProvider('bot', fetchImpl);

    await expect(provider.postInThread({ channelId: CHANNEL, threadTs: PARENT, text: 'Shipped in v1.8.' })).resolves.toEqual({ ts: '1300000000000000099' });
    expect(JSON.parse(String(seen[0]!.init?.body))).toEqual({ content: 'Shipped in v1.8.', message_reference: { message_id: PARENT, fail_if_not_exists: false }, allowed_mentions: { parse: [] } });
    await expect(provider.deleteMessage({ channelId: CHANNEL, ts: '1300000000000000099' })).resolves.toEqual({ ok: true });
    expect(seen[1]!.init?.method).toBe('DELETE');
  });

  it('reacts with the character a family name stands for, and counts a reaction already gone as removed', async () => {
    const { fetchImpl, seen } = net((_url, init) => (init?.method === 'DELETE' ? { status: 404, json: { code: 10014, message: 'Unknown Emoji' } } : { status: 204 }));
    const provider = discordChatProvider('bot', fetchImpl);

    await expect(provider.addReaction({ channelId: CHANNEL, ts: PARENT, name: 'white_check_mark' })).resolves.toEqual({ ok: true, already: false });
    expect(seen[0]!.url.pathname).toBe(`/api/v10/channels/${CHANNEL}/messages/${PARENT}/reactions/${encodeURIComponent('✅')}/@me`);
    await expect(provider.removeReaction({ channelId: CHANNEL, ts: PARENT, name: 'eyes' })).resolves.toEqual({ ok: true, absent: true });
  });

  it('knows nobody by email: Discord never tells a bot one', async () => {
    await expect(discordChatProvider('bot', net(() => ({})).fetchImpl).findUserByEmail('dana@northwind.example')).resolves.toBeNull();
  });
});
