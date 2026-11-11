/**
 * A card is drawn when its page has something new to show: the same card under two updates in a
 * row is noise in a thread. The words always go.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Post = { images?: Array<{ url: string; caption: string }> };
const posts: Post[] = [];
const replies: Array<{ text: string; preview?: unknown }> = [];

vi.mock('@/libs/surfaces/registry', () => ({
  getSurface: () => ({ reply: async (_t: unknown, msg: { text: string; preview?: unknown }) => {
    replies.push(msg);
    return { ts: `1.00${replies.length}` };
  } }),
}));
vi.mock('@/services/ChatSurfaceService', () => ({ agentPersona: async () => null }));
vi.mock('@/services/chat/slackPosts', () => ({
  ourPostsInThread: async () => posts,
  recordSlackPost: async (input: Post) => {
    posts.push({ images: input.images ?? [] });
    return null;
  },
}));

const { slackChannel } = await import('./slackChannel');

const conversation = { id: 12, scopeRef: 'slack:C7:1.001', agentSlug: 'factory-desk' } as never;
const card = { title: 'NW-16 Copy link on each row', url: 'https://factory.example/t/NW-16', description: 'Waiting on a cost check' };
const say = (key: string, preview = card) => slackChannel.say('org_n', conversation, 'An update.', { key, files: [], url: preview.url, preview });

describe('a page\'s card in a Slack thread', () => {
  beforeEach(() => {
    posts.length = 0;
    replies.length = 0;
  });

  it('is drawn once while it reads the same, and again when what it says changed', async () => {
    await say('mcp:factory:u1');
    await say('mcp:factory:u2');
    await say('mcp:factory:u3', { ...card, description: 'Building' });

    expect(replies.map(r => Boolean(r.preview))).toEqual([true, false, true]);
    expect(replies.every(r => r.text === 'An update.')).toBe(true);
  });

  it('draws a different page\'s card beside it', async () => {
    await say('mcp:factory:u1');
    await say('mcp:factory:u4', { ...card, url: 'https://factory.example/t/NW-17', title: 'NW-17 Delete a clip' });

    expect(replies.map(r => Boolean(r.preview))).toEqual([true, true]);
  });
});
