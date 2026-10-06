import type { TellDeps } from './tellConversation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slackThreadOfScope, tellConversation } from './tellConversation';

/**
 * One way to talk back to the person who asked: the app's chat always, the Slack thread when the
 * conversation is one, once per key. Fixtures are fictional.
 */

function deps(conversation: { surface: string; scopeRef: string | null; agentSlug: string | null } | null, said = false) {
  const calls = { append: [] as string[], post: [] as Array<{ text: string; files: number }>, remember: [] as Array<{ key: string; text: string }> };
  const d: TellDeps = {
    conversation: async () => conversation,
    alreadySaid: vi.fn(async () => said),
    append: async (_o, _c, text) => {
      calls.append.push(text);
    },
    post: async (_o, _t, text, _a, files) => {
      calls.post.push({ text, files: files.length });
      return '1700000000.000900';
    },
    remember: async (input) => {
      calls.remember.push({ key: input.key, text: input.text });
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
    expect(calls.post).toEqual([]);
  });

  it('a Slack thread hears it in the chat and the thread, with absolute links and its files, remembered by key', async () => {
    const { d, calls } = deps({ surface: 'slack', scopeRef: 'slack:C7:1700000000.000100', agentSlug: 'product-manager' });

    expect(await tellConversation('org_a', 5, 'Done. [FE-9](/w/acme/dashboard/p/feature/9)', { key: 'record:9:seen_live:first', files: [{ url: '/api/media/9/demo.mp4', caption: 'Demo' }] }, d)).toEqual({ said: true, channel: 'slack' });
    expect(calls.append).toEqual(['Done. [FE-9](/w/acme/dashboard/p/feature/9)']);
    expect(calls.post).toEqual([{ text: 'Done. [FE-9](https://vocion.example/w/acme/dashboard/p/feature/9)', files: 1 }]);
    expect(calls.remember).toEqual([{ key: 'record:9:seen_live:first', text: 'Done. [FE-9](https://vocion.example/w/acme/dashboard/p/feature/9)' }]);
  });

  it('says a key once, says nothing over MCP, and only a thread hears what is for a thread', async () => {
    const said = deps({ surface: 'slack', scopeRef: 'slack:C7:1.1', agentSlug: null }, true);

    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, said.d)).toEqual({ said: false, reason: 'already said here' });
    expect(said.calls.append).toEqual([]);

    const mcp = deps({ surface: 'mcp', scopeRef: null, agentSlug: null });

    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, mcp.d)).toMatchObject({ said: false, reason: expect.stringMatching(/MCP/) });

    const app = deps({ surface: 'web', scopeRef: null, agentSlug: null });

    expect(await tellConversation('org_a', 5, 'x', { key: 'k', threadOnly: true }, app.d)).toMatchObject({ said: false });
    expect(await tellConversation('org_a', 5, 'x', { key: 'k' }, deps(null).d)).toEqual({ said: false, reason: 'the conversation is gone' });
  });
});
