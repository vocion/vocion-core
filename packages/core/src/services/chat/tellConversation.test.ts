import type { ChannelConversation, ConversationChannel } from './conversationChannel';
import type { TellDeps } from './tellConversation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { slackThreadOfScope, tellConversation } from './tellConversation';

/**
 * One way to talk back to the person who asked: the app's chat always, and the medium the
 * conversation lives on through its channel, once per key. Fixtures are fictional.
 */

function deps(conversation: Omit<ChannelConversation, 'id'> | null, opts: { said?: boolean; onMedium?: boolean } = {}) {
  const calls = { append: [] as string[], say: [] as Array<{ text: string; files: number; key: string }> };
  const channel: ConversationChannel = {
    surface: 'slack',
    owns: () => true,
    say: async (_o, _c, text, o) => {
      calls.say.push({ text, files: o.files.length, key: o.key });
      return true;
    },
    alreadySaid: async () => Boolean(opts.said),
    memberOf: async () => ({ userId: null, email: null }),
    signInHint: () => '',
  };
  const d: TellDeps = {
    conversation: async () => (conversation ? { id: 5, ...conversation } : null),
    channel: async () => (opts.onMedium ? channel : null),
    saidInApp: async () => Boolean(opts.said),
    append: async (_o, _c, text) => {
      calls.append.push(text);
    },
  };
  return { d, calls };
}

const before = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://vocion.example';
});

afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = before;
});

describe('tellConversation', () => {
  it('reads a Slack thread from a conversation scope, and nothing else', () => {
    expect(slackThreadOfScope('slack:C7:1700000000.000100')).toEqual({ channelId: 'C7', threadTs: '1700000000.000100' });
    expect(slackThreadOfScope('email:thread-9')).toBeNull();
    expect(slackThreadOfScope(null)).toBeNull();
  });

  it('an app conversation hears it in the chat only', async () => {
    const { d, calls } = deps({ surface: 'web', scopeRef: null, agentSlug: 'product-manager' });

    expect(await tellConversation('org_a', 5, 'Done. [FE-9](/w/acme/dashboard/p/feature/9)', { key: 'record:9:seen_live:first' }, d)).toEqual({ said: true, channel: 'chat' });
    expect(calls.append).toEqual(['Done. [FE-9](/w/acme/dashboard/p/feature/9)']);
    expect(calls.say).toEqual([]);
  });

  it('a conversation on a medium hears it in the chat and through its channel, with absolute links and its files', async () => {
    const { d, calls } = deps({ surface: 'slack', scopeRef: 'slack:C7:1700000000.000100', agentSlug: 'product-manager' }, { onMedium: true });

    expect(await tellConversation('org_a', 5, 'Done. [FE-9](/w/acme/dashboard/p/feature/9)', { key: 'record:9:seen_live:first', files: [{ url: '/api/media/9/demo.mp4', caption: 'Demo' }] }, d)).toEqual({ said: true, channel: 'slack' });
    expect(calls.append).toEqual(['Done. [FE-9](/w/acme/dashboard/p/feature/9)']);
    expect(calls.say).toEqual([{ text: 'Done. [FE-9](https://vocion.example/w/acme/dashboard/p/feature/9)', files: 1, key: 'record:9:seen_live:first' }]);
  });

  it('says a key once, says nothing over MCP, and only a medium hears what is for a medium', async () => {
    const said = deps({ surface: 'slack', scopeRef: 'slack:C7:1.1', agentSlug: null }, { said: true, onMedium: true });

    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, said.d)).toEqual({ said: false, reason: 'already said here' });
    expect(said.calls.append).toEqual([]);
    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, deps({ surface: 'mcp', scopeRef: null, agentSlug: null }).d)).toMatchObject({ said: false, reason: expect.stringMatching(/MCP/) });
    expect(await tellConversation('org_a', 5, 'x', { key: 'k', threadOnly: true }, deps({ surface: 'web', scopeRef: null, agentSlug: null }).d)).toMatchObject({ said: false });
    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, deps(null).d)).toEqual({ said: false, reason: 'the conversation is gone' });
  });
});
