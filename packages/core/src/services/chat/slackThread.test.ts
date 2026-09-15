import type { ChatInbound } from '@/libs/surfaces/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { slackPostSchema } = await import('@/models/Schema');
const { findOurPost, latestAnnouncement, ourPostsInThread, recordSlackPost, threadAlreadyNoticed } = await import('./slackPosts');
const { buildSlackThreadContext, scopeGapSentence, threadPageContext } = await import('./slackThread');
const { describeThread } = await import('./pageContext');

const ORG = 'org_slack_thread';
const CHANNEL = 'GPRIVATE1';
const PARENT_TS = '1000.0001';

const inbound: ChatInbound = {
  surface: 'slack',
  teamId: 'TEAM1',
  channelId: CHANNEL,
  threadRef: PARENT_TS,
  messageRef: '1000.0002',
  externalUserId: 'UASKER',
  text: 'any screenshots to go with this?',
  isDirect: false,
};

/**
 * A Slack API stand-in. Every method answers from `answers`; anything not
 * listed comes back `missing_scope`, which is how the live app behaves today.
 * @param answers - Method name → response body.
 */
function slackStub(answers: Record<string, Record<string, unknown>>): typeof fetch {
  return (async (url: string | URL) => {
    const method = String(url).split('/').pop() ?? '';
    const body = answers[method] ?? { ok: false, error: 'missing_scope' };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
}

const NO_SCOPES = new Set<string>();

beforeEach(async () => {
  await db.delete(slackPostSchema);
});

describe('recordSlackPost', () => {
  it('remembers what we posted, and what it was announcing', async () => {
    const row = await recordSlackPost({
      orgId: ORG,
      projectId: ORG,
      teamId: 'TEAM1',
      channelId: CHANNEL,
      ts: PARENT_TS,
      kind: 'announcement',
      agentSlug: 'release-lead',
      text: 'Release 2.80.1 is out.',
      announcedLabel: 'Release 2.80.1',
      announcedUrl: 'https://example.test/releases/2-80-1',
      images: [{ url: 'https://example.test/shot.png', caption: 'the inbox' }],
    });

    expect(row).not.toBeNull();
    expect(row!.announcedLabel).toBe('Release 2.80.1');
    expect(row!.images).toEqual([{ url: 'https://example.test/shot.png', caption: 'the inbox' }]);

    // The lookups the thread context depends on.
    expect((await findOurPost(CHANNEL, PARENT_TS))?.text).toBe('Release 2.80.1 is out.');
    expect(await ourPostsInThread(CHANNEL, PARENT_TS)).toHaveLength(1);
    expect((await latestAnnouncement(ORG, CHANNEL))?.ts).toBe(PARENT_TS);
  });

  it('records one row per Slack message, and skips a post Slack gave no id for', async () => {
    const base = { orgId: ORG, channelId: CHANNEL, ts: PARENT_TS, kind: 'reply' as const, text: 'hello' };

    expect(await recordSlackPost(base)).not.toBeNull();
    // A redelivery must not double-record.
    expect(await recordSlackPost({ ...base, text: 'hello again' })).toBeNull();
    // Nothing to key it by; a blank ts would collide with the next blank one.
    expect(await recordSlackPost({ ...base, ts: '' })).toBeNull();
  });

  it('says once per thread that a scope is missing', async () => {
    expect(await threadAlreadyNoticed(CHANNEL, PARENT_TS)).toBe(false);

    await recordSlackPost({ orgId: ORG, channelId: CHANNEL, ts: '1000.0003', threadTs: PARENT_TS, kind: 'reply', text: 'answer', degradedNotice: true });

    expect(await threadAlreadyNoticed(CHANNEL, PARENT_TS)).toBe(true);
  });
});

describe('buildSlackThreadContext', () => {
  it('(a) resolves our own parent with no Slack scopes at all', async () => {
    await recordSlackPost({
      orgId: ORG,
      channelId: CHANNEL,
      ts: PARENT_TS,
      kind: 'announcement',
      text: 'Release 2.80.1 is out — the inbox is now one list.',
      announcedLabel: 'Release 2.80.1',
      announcedUrl: 'https://example.test/releases/2-80-1',
    });

    const ctx = await buildSlackThreadContext(inbound, { orgId: ORG, name: 'Workforce', slug: 'workforce' }, {
      token: 'xoxb-test',
      baseUrl: 'https://slack.test/api',
      fetchImpl: slackStub({}), // every call: missing_scope
      scopes: NO_SCOPES,
    });

    // The whole point: the parent is ours, so no scope was needed to know it.
    expect(ctx.parentIsOurs).toBe(true);
    expect(ctx.parent?.text).toContain('Release 2.80.1 is out');
    expect(ctx.announced).toEqual({ label: 'Release 2.80.1', url: 'https://example.test/releases/2-80-1' });
    expect(ctx.workspaceName).toBe('Workforce');
    expect(ctx.workspaceSlug).toBe('workforce');
    // Reading the channel's NAME still needed a scope it does not have.
    expect(ctx.gaps?.map(g => g.scope)).toContain('groups:read');
    // Images here go through Block Kit, because `files:write` is absent.
    expect(ctx.mediaMode).toBe('blocks');

    // And the note the model reads resolves "this".
    const note = describeThread(ctx);

    expect(note).toContain('I posted');
    expect(note).toContain('When someone says "this" in this thread, that is what they mean.');
  });

  it('(b) names the exact missing scope when the parent is someone else\'s and nothing is granted', async () => {
    const ctx = await buildSlackThreadContext(inbound, { orgId: ORG, name: 'Workforce', slug: 'workforce' }, {
      token: 'xoxb-test',
      baseUrl: 'https://slack.test/api',
      fetchImpl: slackStub({}),
      scopes: NO_SCOPES,
    });

    expect(ctx.parentIsOurs).toBe(false);
    expect(ctx.parent).toBeUndefined();

    // A private channel reads with `groups:history`, not `channels:history`.
    const history = ctx.gaps?.find(g => g.scope === 'groups:history');

    expect(history?.wouldHave).toBe('read the message this thread started with');

    // The sentence the channel actually hears — never "no page context here".
    const sentence = scopeGapSentence(ctx);

    expect(sentence).toContain('groups:history');
    expect(sentence).toContain('read the message this thread started with');
    expect(sentence).toContain('reinstall the app');
    expect(sentence).not.toContain('no page context');

    // And the model is told the same thing, with the scope named.
    expect(describeThread(ctx)).toContain('`groups:history`');
  });

  it('(c) reads the channel, the parent, the replies and the posters when every scope is granted', async () => {
    const ctx = await buildSlackThreadContext(inbound, { orgId: ORG, name: 'Workforce', slug: 'workforce' }, {
      token: 'xoxb-test',
      baseUrl: 'https://slack.test/api',
      scopes: new Set(['groups:read', 'groups:history', 'users:read', 'files:write']),
      fetchImpl: slackStub({
        'conversations.info': { ok: true, channel: { name: 'releases', is_private: true } },
        'conversations.replies': {
          ok: true,
          messages: [
            { ts: PARENT_TS, text: 'Release 2.80.1 is out.', user: 'UPOSTER' },
            { ts: '1000.00015', text: 'nice one', user: 'UOTHER' },
            { ts: '1000.0002', text: 'any screenshots to go with this?', user: 'UASKER' },
          ],
        },
        'users.info': { ok: true, user: { profile: { display_name: 'A Teammate' } } },
      }),
    });

    expect(ctx.channelName).toBe('releases');
    expect(ctx.parentIsOurs).toBe(false);
    expect(ctx.parent?.text).toBe('Release 2.80.1 is out.');
    expect(ctx.parent?.author).toBe('A Teammate');
    // The message being answered is not echoed back as a reply.
    expect(ctx.replies?.map(r => r.text)).toEqual(['nice one']);
    expect(ctx.posters?.map(p => p.name)).toContain('A Teammate');
    expect(ctx.gaps ?? []).toHaveLength(0);
    expect(scopeGapSentence(ctx)).toBe('');
    expect(ctx.mediaMode).toBe('upload');
  });

  it('carries the thread into the slot a page context would fill', async () => {
    const ctx = await buildSlackThreadContext(inbound, { orgId: ORG }, {
      token: 'xoxb-test',
      baseUrl: 'https://slack.test/api',
      fetchImpl: slackStub({ 'conversations.info': { ok: true, channel: { name: 'releases', is_private: true } } }),
      scopes: NO_SCOPES,
    });
    const page = threadPageContext(ctx);

    expect(page.title).toBe('#releases');
    expect(page.thread).toBe(ctx);
  });
});
