import type { AnnouncementInput, AnnouncementResult } from '@/services/ChatSurfaceService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slackPostMessageAction } from './slack-post-message';

/**
 * chat.post_message: the generic "tell the channel" write. Refused at the
 * door when the workspace bound nothing, posted through the bound channel
 * (never one an agent merely typed), editable as a message on the card,
 * deduped per record, and taken back by Undo. Fixtures are fictional.
 */

const bound = vi.hoisted(() => ({
  byOrg: new Map<string, { channelId: string; teamId: string | null; agentSlug: string }>(),
  more: [] as Array<{ channelId: string; teamId: string | null; agentSlug: string }>,
  names: new Map<string, string>(),
}));
const artifacts = vi.hoisted(() => ({ rows: new Map<number, { title: string; url: string; spec: Record<string, unknown>; shareAudience: string; shareOwnerId: string | null }>() }));
const posts = vi.hoisted(() => ({ sent: [] as AnnouncementInput[], next: null as AnnouncementResult | null }));
const deletes = vi.hoisted(() => ({ calls: [] as Array<{ channelId: string; ts?: string | null }>, ok: true }));

vi.mock('@/services/chat/boundChannel', () => ({
  boundSlackChannel: async (orgId: string, channelId?: string | null) => {
    const b = bound.byOrg.get(orgId) ?? null;
    if (!b) {
      return null;
    }
    if (!channelId) {
      return b;
    }
    return [b, ...bound.more].find(x => x.channelId === channelId) ?? null;
  },
  listBoundSlackChannels: async (orgId: string) => {
    const b = bound.byOrg.get(orgId);
    return b ? [b, ...bound.more] : [];
  },
}));
vi.mock('@/libs/surfaces/slackRead', () => ({
  conversationInfo: async (id: string) => (bound.names.has(id) ? { ok: true, value: { name: bound.names.get(id), isPrivate: false } } : { ok: false, error: 'channel_not_found' }),
}));
vi.mock('drizzle-orm', async orig => ({ ...(await orig<object>()), and: (...xs: unknown[]) => xs, eq: (_col: unknown, v: unknown) => v }));
vi.mock('@/libs/DB', () => {
  let id = 0;
  const chain = {
    from: () => chain,
    // The artifact lookup is `and(eq(orgId), eq(id))`, which the mock above hands over as [orgId, id].
    where: (cond: unknown[]) => {
      id = Number(cond[1]);
      return chain;
    },
    limit: async () => (artifacts.rows.has(id) ? [artifacts.rows.get(id)] : []),
  };
  return { db: { select: () => chain } };
});
vi.mock('@/libs/tools/artifacts/media', () => ({ readMediaBytes: async (_org: string, url: string) => (url.includes('missing') ? null : { bytes: new Uint8Array([1, 2, 3]) }) }));
vi.mock('@/services/factory/releaseAnnounce', () => ({ artifactImageBytes: async () => new Uint8Array([9]) }));
vi.mock('@/libs/surfaces/registry', () => ({ getSurface: (id: string) => (id === 'slack' ? { id: 'slack' } : undefined) }));
vi.mock('@/services/ChatSurfaceService', () => ({
  postAnnouncementToChannel: async (_adapter: unknown, input: AnnouncementInput) => {
    posts.sent.push(input);
    return posts.next ?? { outcome: 'posted', channelId: input.channelId, ts: '1727700000.000100', media: 'none', recorded: true, fileIds: [] };
  },
}));
vi.mock('@/libs/surfaces/slack', () => ({
  deleteSlackPost: async (post: { channelId: string; ts?: string | null }) => {
    deletes.calls.push(post);
    return deletes.ok ? { ok: true } : { ok: false, error: 'cant_delete_message' };
  },
}));
vi.mock('@/libs/notifications/slack', () => ({ slackToken: () => 'xoxb-test' }));

const parse = (input: Record<string, unknown>) => slackPostMessageAction.inputSchema.parse(input);
const ORG = 'org_northwind';

beforeEach(() => {
  bound.byOrg.set(ORG, { channelId: 'C0DELIVERY', teamId: 'T0NORTHWIND', agentSlug: 'project-controller' });
  bound.more = [];
  bound.names = new Map([['C0DELIVERY', 'delivery'], ['C0LAUNCHES', 'launches']]);
  artifacts.rows.clear();
  posts.sent.length = 0;
  posts.next = null;
  deletes.calls.length = 0;
  deletes.ok = true;
});

afterEach(() => bound.byOrg.clear());

describe('slackPostMessageAction', () => {
  it('is an external, reversible write keyed on its own id', () => {
    expect(slackPostMessageAction.external).toBe(true);
    expect(slackPostMessageAction.undo).toBeDefined();
    expect(slackPostMessageAction.policyKeyFor).toBeUndefined();
    expect(slackPostMessageAction.inputSchema.safeParse({}).success).toBe(false);
    expect(slackPostMessageAction.inputSchema.safeParse({ text: 'Margin flag.' }).success).toBe(true);
  });

  it('refuses at the door when the workspace bound no channel, so nothing is queued to fail later', async () => {
    bound.byOrg.clear();

    const reason = await slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'hello' }));

    expect(reason).toMatch(/no Slack channel bound/);
    expect(reason).toMatch(/chat-bindings/);
  });

  it('refuses a channel this workspace did not bind, however the agent named it', async () => {
    const reason = await slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'hello', channelId: 'C0SOMEONEELSE' }));

    expect(reason).toMatch(/C0SOMEONEELSE is not bound to this workspace/);
    expect(reason).toMatch(/Bound: #delivery \(C0DELIVERY\)/);
    await expect(slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'hello', channelId: 'C0DELIVERY' }))).resolves.toBeUndefined();
    await expect(slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'hello' }))).resolves.toBeUndefined();
  });

  it('posts to the bound channel, attributed to the proposing agent, and records where it landed', async () => {
    const out = await slackPostMessageAction.execute(
      { orgId: ORG, invokedBy: 'agent:project-controller', reviewedBy: 'user_reviewer' },
      parse({ text: 'Margin flag · Northwind Portal — 41% against the 50% line.', title: 'Margin flag — Northwind Portal' }),
    );

    expect(posts.sent).toHaveLength(1);
    expect(posts.sent[0]).toMatchObject({
      orgId: ORG,
      channelId: 'C0DELIVERY',
      teamId: 'T0NORTHWIND',
      text: 'Margin flag · Northwind Portal — 41% against the 50% line.',
      agentSlug: 'project-controller',
      announcedLabel: 'Margin flag — Northwind Portal',
      createdBy: 'user_reviewer',
    });
    expect(out).toMatchObject({ posted: true, post: { channelId: 'C0DELIVERY', ts: '1727700000.000100', fileIds: [] } });
  });

  it('fails loudly, with Slack\'s reason, rather than reporting a post that did not happen', async () => {
    posts.next = { outcome: 'failed', error: 'channel_not_found' };

    await expect(slackPostMessageAction.execute({ orgId: ORG }, parse({ text: 'hello' }))).rejects.toThrow(/channel_not_found/);

    bound.byOrg.clear();

    await expect(slackPostMessageAction.execute({ orgId: ORG }, parse({ text: 'hello' }))).rejects.toThrow(/no Slack channel bound/);
  });

  it('Undo deletes the post it made, and says so when Slack refuses', async () => {
    const result = { posted: true, post: { channelId: 'C0DELIVERY', ts: '1727700000.000100', fileIds: [] } };

    const out = await slackPostMessageAction.undo!({ orgId: ORG }, parse({ text: 'hello' }), result);

    expect(deletes.calls).toEqual([{ channelId: 'C0DELIVERY', ts: '1727700000.000100', fileIds: [] }]);
    expect(out).toMatchObject({ deleted: true });

    deletes.ok = false;

    await expect(slackPostMessageAction.undo!({ orgId: ORG }, parse({ text: 'hello' }), result)).rejects.toThrow(/cant_delete_message/);
    await expect(slackPostMessageAction.undo!({ orgId: ORG }, parse({ text: 'hello' }), { posted: true })).rejects.toThrow(/nothing to take back/);
  });

  it('presents the words as an editable message and maps the edit back onto the text', async () => {
    const input = parse({ text: 'first draft', title: 'Margin flag — Northwind Portal', about: 'project:northwind-portal' });

    const card = await slackPostMessageAction.reviewCard!({ orgId: ORG }, input);

    expect(card.title).toBe('Post to Slack — Margin flag — Northwind Portal');
    expect(card.content).toEqual([{ kind: 'message', id: 'message', label: 'Message', body: 'first draft' }]);
    expect(card.headline).toMatch(/Slack channel C0DELIVERY now/);
    expect(card.fields).toEqual(expect.arrayContaining([{ label: 'Channel', value: 'Slack channel C0DELIVERY' }, { label: 'Bound to', value: 'project-controller' }]));
    expect(card.verbs).toEqual({ approve: 'Approve & post', reject: 'Decline' });

    expect(slackPostMessageAction.applyContentEdits!(input, [{ id: 'message', body: 'edited by a person' }])).toMatchObject({ text: 'edited by a person', title: 'Margin flag — Northwind Portal' });
    expect(slackPostMessageAction.applyContentEdits!(input, [{ id: 'other', body: 'x' }])).toEqual(input);
  });

  it('dedups on what the post is about, per channel, and never on the wording', () => {
    const a = slackPostMessageAction.dedupKeyFor!(parse({ text: 'Margin 41%', about: 'project:Northwind-Portal' }));
    const b = slackPostMessageAction.dedupKeyFor!(parse({ text: 'Margin now 39%', about: 'project:northwind-portal' }));

    expect(a).toBe('chat.post_message:default:project:northwind-portal');
    expect(b).toBe(a);
    expect(slackPostMessageAction.dedupKeyFor!(parse({ text: 'x', about: 'project:northwind-portal', channelId: 'C0OTHER' }))).not.toBe(a);
    expect(slackPostMessageAction.dedupKeyFor!(parse({ text: 'a one-off' }))).toBeUndefined();
  });

  it('finds a channel the way a person names it, and refuses a name nothing bound (walk 26)', async () => {
    bound.more = [{ channelId: 'C0LAUNCHES', teamId: 'T0NORTHWIND', agentSlug: 'ceo' }];

    await slackPostMessageAction.execute({ orgId: ORG }, parse({ text: 'Shipped.', channelId: '#Launches' }));

    expect(posts.sent[0]).toMatchObject({ channelId: 'C0LAUNCHES' });

    const reason = await slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'Shipped.', channelId: '#vocion-slack-test' }));

    expect(reason).toMatch(/No Slack channel named #vocion-slack-test is bound/);
    expect(reason).toMatch(/#delivery \(C0DELIVERY\), #launches \(C0LAUNCHES\)/);
  });

  it('does not send a post that names no channel to a direct message (walk 26: an announcement landed in a DM)', async () => {
    bound.byOrg.set(ORG, { channelId: 'D0ADAMSDM', teamId: 'T0NORTHWIND', agentSlug: 'ceo' });
    bound.more = [{ channelId: 'C0LAUNCHES', teamId: 'T0NORTHWIND', agentSlug: 'ceo' }];

    const reason = await slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'Shipped.' }));

    expect(reason).toMatch(/first bound Slack channel is a direct message/);
    expect(reason).toMatch(/D0ADAMSDM \(a direct message\), #launches \(C0LAUNCHES\)/);
    await expect(slackPostMessageAction.execute({ orgId: ORG }, parse({ text: 'Shipped.' }))).rejects.toThrow(/direct message/);
    expect(posts.sent).toHaveLength(0);
    await expect(slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'Shipped.', channelId: 'D0ADAMSDM' }))).resolves.toBeUndefined();
  });

  it('carries the pictures and videos it names as uploaded files, and Undo takes them back', async () => {
    artifacts.rows.set(4195, { title: 'Narrated: Feature demo of FE-9', url: '/api/media/9/feature-demo-narrated-ab12.mp4', spec: {}, shareAudience: 'workspace', shareOwnerId: null });
    artifacts.rows.set(4188, { title: 'Live screenshot', url: '', spec: { url: '/api/artifacts/org-1/org-1.png', caption: 'The chip reads (1)' }, shareAudience: 'workspace', shareOwnerId: null });
    posts.next = { outcome: 'posted', channelId: 'C0DELIVERY', ts: '', media: 'uploaded', recorded: true, fileIds: ['F01', 'F02'] };

    const out = await slackPostMessageAction.execute({ orgId: ORG }, parse({ text: 'Shipped.', media: [4195, 4188] }));

    expect(posts.sent[0]!.images).toEqual([
      { url: '/api/media/9/feature-demo-narrated-ab12.mp4', caption: 'Narrated: Feature demo of FE-9', filename: 'feature-demo-narrated-ab12.mp4' },
      { url: '/api/artifacts/org-1/org-1.png', caption: 'The chip reads (1)', filename: 'org-1.png' },
    ]);
    await expect(posts.sent[0]!.fetchImage!({ url: '/api/media/9/feature-demo-narrated-ab12.mp4', caption: '' })).resolves.toEqual(new Uint8Array([1, 2, 3]));
    expect(out).toMatchObject({ line: 'Posted to Slack channel C0DELIVERY with 2 attached.' });

    await slackPostMessageAction.undo!({ orgId: ORG }, parse({ text: 'Shipped.' }), out);

    expect(deletes.calls).toEqual([{ channelId: 'C0DELIVERY', ts: null, fileIds: ['F01', 'F02'] }]);
  });

  it('refuses media that is missing, owner-only, not a picture or video, or unreadable', async () => {
    artifacts.rows.set(1, { title: 'Mine', url: '/api/media/9/a.mp4', spec: {}, shareAudience: 'me', shareOwnerId: 'user_a' });
    artifacts.rows.set(2, { title: 'Notes', url: '', spec: {}, shareAudience: 'workspace', shareOwnerId: null });
    artifacts.rows.set(3, { title: 'Gone', url: '/api/media/9/missing.mp4', spec: {}, shareAudience: 'workspace', shareOwnerId: null });
    const check = (id: number) => slackPostMessageAction.precheck!({ orgId: ORG }, parse({ text: 'x', media: [id] }));

    await expect(check(99)).resolves.toMatch(/Artifact 99 is not one this workspace's members can open/);
    await expect(check(1)).resolves.toMatch(/Artifact 1 is not one/);
    await expect(check(2)).resolves.toMatch(/not a picture or a video/);
    await expect(check(3)).resolves.toMatch(/could not be read/);
  });
});
