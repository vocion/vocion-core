/**
 * THE READ-THROUGH, WHEN GMAIL DOES NOT COOPERATE. A copy past its TTL is
 * refreshed with the credentials of the mailbox the thread lives in, and of
 * no other; and when that refresh fails (a refused token, a rate limit, a
 * 5xx, the thread gone) the last copy still answers, marked stale with its
 * age, rather than nothing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');
vi.mock('@/libs/sources/gmail', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/libs/sources/gmail')>();
  return { ...actual, fetchGmailThreadDoc: vi.fn() };
});
vi.mock('@/services/SourceCredentialService', () => ({ getCredentialsForSource: vi.fn() }));

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { fetchGmailThreadDoc } = await import('@/libs/sources/gmail');
const { getCredentialsForSource } = await import('@/services/SourceCredentialService');
const { readGmailThread } = await import('./threadRead');

const ORG = 'org_thread_read';
const ZERO_VEC = Array.from({ length: 1536 }, () => 0);

async function seed() {
  const [rowan] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail-rowan', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning();
  const [iris] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail-iris', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning();
  const [copy] = await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId: rowan!.id,
    externalId: 'gmail-thread:t-42',
    title: 'Phase 2 priorities (2 messages)',
    contentHash: 'copy',
    metadata: { kind: 'gmail-thread', threadId: 't-42', messageCount: 2, latestMessageId: 'm2', fetchedAt: '2026-10-01T00:00:00.000Z' },
  }).returning();
  await db.insert(knowledgeChunkSchema).values({ documentId: copy!.id, orgId: ORG, chunkIdx: 0, content: 'From: Dana Reyes <dana@kestrel.example>\nSubject: Phase 2 priorities\nCan we talk Friday?', contentTokens: 10, embedding: ZERO_VEC });
  return { rowan: { id: rowan!.id, slug: rowan!.slug }, iris: { id: iris!.id, slug: iris!.slug } };
}

afterEach(async () => {
  vi.mocked(fetchGmailThreadDoc).mockReset();
  vi.mocked(getCredentialsForSource).mockReset();
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('a stale copy and a failing Gmail', () => {
  it.each([
    ['a refused token', new Error('Gmail thread fetch failed: 401')],
    ['a rate limit', new Error('Gmail thread fetch failed: 429')],
    ['Gmail down', new Error('Gmail thread fetch failed: 503')],
  ])('answers with the last copy, marked stale with its age, on %s', async (_, failure) => {
    const { rowan, iris } = await seed();
    vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'x' } as never);
    vi.mocked(fetchGmailThreadDoc).mockRejectedValue(failure);

    const read = await readGmailThread({ orgId: ORG, sources: [rowan, iris], threadId: 't-42', mailboxSourceId: rowan.id });

    expect(read).toMatchObject({ source: 'cache', stale: true, staleBecause: 'live_failed', fetchedAt: '2026-10-01T00:00:00.000Z' });
    expect(read.source !== 'none' && read.content).toContain('Can we talk Friday?');
  });

  it('answers with the last copy when Gmail says the thread is gone', async () => {
    const { rowan } = await seed();
    vi.mocked(getCredentialsForSource).mockResolvedValue({ token: 'x' } as never);
    vi.mocked(fetchGmailThreadDoc).mockResolvedValue(null);

    await expect(readGmailThread({ orgId: ORG, sources: [rowan], threadId: 't-42' })).resolves.toMatchObject({ source: 'cache', stale: true, staleBecause: 'live_failed' });
  });
});

describe('whose credentials read the thread', () => {
  it('uses the thread\'s own mailbox, never another connected one', async () => {
    const { rowan, iris } = await seed();
    // Only Iris's mailbox has credentials; the thread lives in Rowan's.
    vi.mocked(getCredentialsForSource).mockImplementation(async (_org, slug) => (slug === iris.slug ? { token: 'iris' } : null) as never);

    const read = await readGmailThread({ orgId: ORG, sources: [rowan, iris], threadId: 't-42', mailboxSourceId: rowan.id });

    expect(fetchGmailThreadDoc).not.toHaveBeenCalled();
    expect(read).toMatchObject({ source: 'cache', stale: true, staleBecause: 'no_credentials' });
  });
});
