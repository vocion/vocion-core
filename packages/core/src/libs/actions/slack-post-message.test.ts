import type { AnnouncementInput, AnnouncementResult } from '@/services/ChatSurfaceService';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { slackPostMessageAction } from './slack-post-message';

/**
 * chat.post_message: the generic "tell the channel" write. Refused at the
 * door when the workspace bound nothing, posted through the bound channel
 * (never one an agent merely typed), editable as a message on the card,
 * deduped per record, and taken back by Undo. Fixtures are fictional.
 */

const bound = vi.hoisted(() => ({ byOrg: new Map<string, { channelId: string; teamId: string | null; agentSlug: string }>() }));
const posts = vi.hoisted(() => ({ sent: [] as AnnouncementInput[], next: null as AnnouncementResult | null }));
const deletes = vi.hoisted(() => ({ calls: [] as Array<{ channelId: string; ts?: string | null }>, ok: true }));

vi.mock('@/services/chat/boundChannel', () => ({
  boundSlackChannel: async (orgId: string, channelId?: string | null) => {
    const b = bound.byOrg.get(orgId) ?? null;
    if (!b) {
      return null;
    }
    return channelId && channelId !== b.channelId ? null : b;
  },
}));
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
});
