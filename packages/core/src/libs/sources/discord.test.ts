import { describe, expect, it, vi } from 'vitest';
import { familyOfKind } from '@/libs/connectors/families';
import { snowflakeAt, snowflakeTime } from '@/libs/discord/client';
import { platformForConnectorSlug, validatePlatformCredential } from '@/libs/platforms/registry';
import { discordConnector, inspectDiscord, syncDiscord } from '@/libs/sources/discord';
import { getConnector } from '@/libs/sources/registry';

/** Discord against a stand-in API: channels, message pages, the /ask registration. Ids are fictional snowflakes. */

const TOKEN = `MTE${'x'.repeat(60)}`;
const GUILD = '1200000000000000001';
const CHANNEL = '1200000000000000002';

function message(id: string, content: string, extra: Record<string, unknown> = {}) {
  return { id, channel_id: CHANNEL, content, timestamp: '2026-10-06T15:00:00.000Z', author: { id: '1100000000000000003', username: 'dana', global_name: 'Dana' }, ...extra };
}

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

describe('the discord connector', () => {
  it('is a chat-family connector on the discord platform', () => {
    expect(getConnector('discord')).toBe(discordConnector);
    expect(platformForConnectorSlug('discord')?.id).toBe('discord');
    expect(familyOfKind('discord')).toBe('chat');
    expect(validatePlatformCredential('discord', { token: TOKEN })).toEqual({ token: TOKEN });
    expect(() => validatePlatformCredential('discord', { token: TOKEN, publicKey: 'not-hex' })).toThrow(/Public key/);
  });

  it('turns a moment into a snowflake and back', () => {
    const at = new Date('2026-10-01T00:00:00Z');

    expect(snowflakeTime(snowflakeAt(at)).toISOString()).toBe(at.toISOString());
  });

  it('syncs a channel\'s messages one document each, paging after the last, and skips empty ones', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => message(String(BigInt('1300000000000000000') + BigInt(i + 1)), `note ${i + 1}`));
    const page2 = [message('1300000000000000200', 'Kestrel Capital wants the deck', { attachments: [{ id: '9', filename: 'brief.pdf' }] }), message('1300000000000000201', '')];
    const { fetchImpl, seen } = net((url) => {
      if (url.pathname === `/api/v10/channels/${CHANNEL}`) {
        return { json: { id: CHANNEL, name: 'deals', type: 0, guild_id: GUILD } };
      }
      const after = url.searchParams.get('after');
      return { json: after === '1300000000000000100' ? page2 : page1 };
    });
    const docs = [];
    for await (const doc of syncDiscord({ sourceId: 3, orgId: 'org_a', config: { channels: [CHANNEL] }, credentials: { token: TOKEN } }, fetchImpl)) {
      docs.push(doc);
    }

    expect(docs).toHaveLength(101);
    expect(docs[100]).toMatchObject({ externalId: `discord:${CHANNEL}:1300000000000000200`, uri: `https://discord.com/channels/${GUILD}/${CHANNEL}/1300000000000000200`, content: 'Dana: Kestrel Capital wants the deck\n[attachment: brief.pdf]' });
    expect(new Headers(seen[0]!.init?.headers).get('authorization')).toBe(`Bot ${TOKEN}`);
  });

  it('reports a channel the bot lost, so the run keeps the rest and tombstones nothing', async () => {
    const onProgress = vi.fn();
    const { fetchImpl } = net(url => (url.pathname.endsWith('/messages') ? { status: 403, json: { code: 50001, message: 'Missing Access' } } : { json: { id: CHANNEL, name: 'deals', type: 0 } }));
    const docs = [];
    for await (const doc of syncDiscord({ sourceId: 3, orgId: 'org_a', config: { channels: [CHANNEL] }, credentials: { token: TOKEN }, onProgress }, fetchImpl)) {
      docs.push(doc);
    }

    expect(docs).toEqual([]);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: expect.stringMatching(/cannot see or act in that channel/) }));
  });

  it('tests the connection: the bot, its channels, and registers /ask', async () => {
    const { fetchImpl, seen } = net((url, init) => {
      switch (url.pathname) {
        case '/api/v10/users/@me': return { json: { id: '1', username: 'vocion-bot' } };
        case '/api/v10/users/@me/guilds': return { json: [{ id: GUILD, name: 'Northwind' }] };
        case `/api/v10/guilds/${GUILD}/channels`: return { json: [{ id: CHANNEL, name: 'deals', type: 0 }, { id: '7', name: 'Voice', type: 2 }] };
        case '/api/v10/oauth2/applications/@me': return { json: { id: '1400000000000000001' } };
        case '/api/v10/applications/1400000000000000001/commands': return init?.method === 'POST' ? { json: { id: 'cmd' } } : { status: 405 };
        default: return { status: 404 };
      }
    });
    const res = await inspectDiscord({ credentials: { token: TOKEN, publicKey: 'a'.repeat(64) } }, fetchImpl);

    expect(res).toMatchObject({ authorized: true, error: null });
    expect(res.checks.map(c => [c.key, c.ok])).toEqual([['bot', true], ['channels', true], ['ask', true]]);
    expect(res.checks[1]!.detail).toBe('1 channel: #deals');
    expect(JSON.parse(String(seen.find(s => s.init?.method === 'POST')!.init!.body))).toMatchObject({ name: 'ask' });
  });

  it('fails a refused token in words', async () => {
    const { fetchImpl } = net(() => ({ status: 401, json: { message: '401: Unauthorized', code: 0 } }));

    await expect(inspectDiscord({ credentials: { token: TOKEN } }, fetchImpl)).resolves.toMatchObject({ authorized: false, error: expect.stringMatching(/refused the bot token/) });
  });
});

describe('which Discord bot a workspace uses', () => {
  it('uses each workspace\'s own stored bot, then the server\'s', async () => {
    vi.resetModules();
    const stored: Record<string, Record<string, string>> = { org_a: { token: 'bot-a' }, org_b: { token: 'bot-b', publicKey: 'b'.repeat(64) } };
    vi.doMock('@/services/ApiTokenService', () => ({ resolvePlatformCredential: async (orgId: string, platform: string) => (platform === 'discord' ? stored[orgId] ?? null : null) }));
    process.env.DISCORD_BOT_TOKEN = 'bot-server';
    const { discordCredentialsFor } = await import('@/libs/discord/client');

    expect(await discordCredentialsFor('org_a')).toEqual({ token: 'bot-a', publicKey: null });
    expect(await discordCredentialsFor('org_b')).toEqual({ token: 'bot-b', publicKey: 'b'.repeat(64) });
    expect((await discordCredentialsFor('org_c'))?.token).toBe('bot-server');

    delete process.env.DISCORD_BOT_TOKEN;
    vi.doUnmock('@/services/ApiTokenService');
  });
});
