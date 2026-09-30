import type { ChatImageFetcher, ChatMessage, ChatReplyTarget, ChatSurfaceAdapter } from '@/libs/surfaces/types';
import { Buffer } from 'node:buffer';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Publishing a release's announcement with its picture (backlog 043): the
 * words and the live screenshot posted together to the workspace's bound
 * Slack channel, the post recorded on the release, a failure written where
 * the page reads it, and Undo taking the post back. PGlite; Slack is a fake
 * adapter. Fictional fixtures (Relay, a Northwind product).
 */

vi.mock('@/libs/DB');

type Sent = { target: ChatReplyTarget; message: ChatMessage; fetchImage?: ChatImageFetcher };
const sent: Sent[] = [];
let replyError: Error | null = null;
let uploaded = true;

const fake: ChatSurfaceAdapter = {
  id: 'slack',
  verify: () => ({ ok: true }),
  parse: () => ({ kind: 'ignore', reason: 'n/a' }),
  reply: async (target, message, opts) => {
    if (replyError) {
      throw replyError;
    }
    const msg = typeof message === 'string' ? { text: message } : message;
    sent.push({ target, message: msg, fetchImage: opts?.fetchImage });
    const bytes = msg.images?.[0] && opts?.fetchImage ? await opts.fetchImage(msg.images[0]) : null;
    return uploaded && bytes
      ? { channelId: target.channelId, ts: '', media: 'uploaded' as const, fileIds: ['F0RELAY1'] }
      : { channelId: target.channelId, ts: '1727700000.000100', media: 'unreachable' as const };
  },
};

vi.mock('@/libs/surfaces/registry', () => ({ getSurface: (id: string) => (id === 'slack' ? fake : undefined), listSurfaces: () => [fake] }));

const deleted: Array<Record<string, unknown>> = [];
vi.mock('@/libs/surfaces/slack', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/libs/surfaces/slack')>();
  return { ...real, deleteSlackPost: async (post: Record<string, unknown>) => {
    deleted.push(post);
    return { ok: true };
  } };
});

const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47]);
vi.mock('@/libs/tools/artifacts/serve', () => ({
  resolveArtifactFile: async (opts: { callerOrgId: string; id: string; lookupRow: (id: number) => Promise<{ orgId: string } | null> }) => {
    const row = await opts.lookupRow(Number(opts.id));
    return row && row.orgId === opts.callerOrgId ? { status: 200, body: Buffer.from(PNG), headers: { 'Content-Type': 'image/png' } } : { status: 404 };
  },
}));

const { db } = await import('@/libs/DB');
const { artifactSchema, businessObjectSchema, businessObjectTypeSchema, chatChannelBindingSchema, slackPostSchema } = await import('@/models/Schema');
const svc = await import('./releaseAnnounce');

const ORG = 'org_relay_announce';
let releaseId = 0;
let imageId = 0;

async function meta(): Promise<Record<string, unknown>> {
  const [row] = await db.select({ meta: businessObjectSchema.metadata }).from(businessObjectSchema).where(eq(businessObjectSchema.id, releaseId));
  return (row?.meta ?? {}) as Record<string, unknown>;
}

beforeEach(async () => {
  sent.length = 0;
  deleted.length = 0;
  replyError = null;
  uploaded = true;
  vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-fixture-not-a-token');
  await db.delete(slackPostSchema);
  await db.delete(chatChannelBindingSchema);
  await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
  await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'release', label: 'Release' }).returning({ id: businessObjectTypeSchema.id });
  const [art] = await db.insert(artifactSchema).values({ orgId: ORG, kind: 'file', title: 'Resume banner · desktop · live', url: '/api/artifacts/relay-live/resume.png', spec: { filename: 'resume.png', contentType: 'image/png' } }).returning({ id: artifactSchema.id });
  imageId = art!.id;
  const [rel] = await db.insert(businessObjectSchema).values({ orgId: ORG, typeId: type!.id, title: 'Uploads that survive a bad connection', metadata: { product: 'relay', announcement: 'Uploads now pick up where they stopped, even on a bad connection.', notesSource: 'human', announcementImageArtifactId: imageId } }).returning({ id: businessObjectSchema.id });
  releaseId = rel!.id;
  await db.insert(chatChannelBindingSchema).values({ orgId: ORG, surface: 'slack', teamId: 'T0NW', channelId: 'C0RELAY', agentSlug: 'product-manager' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('where the announcement goes', () => {
  it('is Slack with a Slack app and a bound channel, and a copy without either', async () => {
    expect(await svc.announceMode(ORG)).toBe('slack');

    vi.stubEnv('SLACK_BOT_TOKEN', '');

    expect(await svc.announceMode(ORG)).toBe('copy');

    vi.stubEnv('SLACK_BOT_TOKEN', 'xoxb-fixture-not-a-token');
    await db.delete(chatChannelBindingSchema);

    expect(await svc.announceMode(ORG)).toBe('copy');
  });
});

describe('publishing to Slack', () => {
  it('posts the words with the picture uploaded, and records where it landed on the release', async () => {
    const out = await svc.publishAnnouncementToSlack({ orgId: ORG, releaseId, runId: 88, by: 'usr_fixture', now: new Date('2026-09-30T10:00:00Z') });

    expect(sent).toHaveLength(1);
    expect(sent[0]!.target.channelId).toBe('C0RELAY');
    expect(sent[0]!.message.text).toBe('Uploads now pick up where they stopped, even on a bad connection.');
    expect(sent[0]!.message.images).toEqual([{ url: '/api/artifacts/relay-live/resume.png', caption: 'Uploads that survive a bad connection' }]);
    // The picture sits behind our sign-in, so its bytes are read here, for this org.
    expect(await sent[0]!.fetchImage!({ url: '/api/artifacts/relay-live/resume.png', caption: '' })).toEqual(PNG);
    expect(out.line).toBe('Posted to Slack with its picture.');

    const m = await meta();

    expect(m.announcedAt).toBe('2026-09-30T10:00:00.000Z');
    expect(m.announcementState).toBe('published');
    expect(m.announcedTo).toEqual({ channels: ['Slack'], post: { surface: 'slack', channelId: 'C0RELAY', ts: null, fileIds: ['F0RELAY1'], media: 'uploaded', runId: 88 } });
  });

  it('says so when the picture could not travel', async () => {
    uploaded = false;
    const out = await svc.publishAnnouncementToSlack({ orgId: ORG, releaseId });

    expect(out.line).toContain('without its picture');
    expect(out.post.ts).toBe('1727700000.000100');
  });

  it('writes the reason on the release when Slack refuses, and a later success clears it', async () => {
    replyError = new Error('Slack chat.postMessage failed: not_in_channel');

    await expect(svc.publishAnnouncementToSlack({ orgId: ORG, releaseId })).rejects.toThrow('not_in_channel');
    expect((await meta()).announceFailure).toMatchObject({ error: 'Slack refused the post: Slack chat.postMessage failed: not_in_channel.', surface: 'slack' });
    expect((await meta()).announcedAt).toBeUndefined();

    replyError = null;
    await svc.publishAnnouncementToSlack({ orgId: ORG, releaseId });

    expect((await meta()).announceFailure).toBeUndefined();
  });

  it('refuses, with the reason on the release, when the workspace has no Slack connection', async () => {
    await db.delete(chatChannelBindingSchema);

    await expect(svc.publishAnnouncementToSlack({ orgId: ORG, releaseId })).rejects.toThrow(/no Slack connection/);
    expect((await meta()).announceFailure).toMatchObject({ surface: 'slack' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a release with nothing written yet', async () => {
    await db.update(businessObjectSchema).set({ metadata: { product: 'relay' } }).where(eq(businessObjectSchema.id, releaseId));

    await expect(svc.publishAnnouncementToSlack({ orgId: ORG, releaseId })).rejects.toThrow(/no announcement written/);
  });

  it('never reads another workspace\'s picture', async () => {
    expect(await svc.artifactImageBytes('org_someone_else', imageId)).toBeNull();
    expect(await svc.artifactImageBytes(ORG, imageId)).toEqual(PNG);
  });
});

describe('undo', () => {
  it('deletes the post and puts the release back to approved, words kept', async () => {
    const { post } = await svc.publishAnnouncementToSlack({ orgId: ORG, releaseId, runId: 88 });
    const out = await svc.unpublishAnnouncement(ORG, releaseId, post);

    expect(deleted).toEqual([{ channelId: 'C0RELAY', ts: null, fileIds: ['F0RELAY1'], media: 'uploaded', runId: 88, surface: 'slack' }]);
    expect(out.line).toContain('deleted');

    const m = await meta();

    expect(m.announcedAt).toBeUndefined();
    expect(m.announcementState).toBe('approved');
    expect(m.announcedTo).toEqual({ channels: [] });
    expect(m.announcement).toBe('Uploads now pick up where they stopped, even on a bad connection.');
  });
});
