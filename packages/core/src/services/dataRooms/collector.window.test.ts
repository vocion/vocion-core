/**
 * What one run of the collector is allowed to look at.
 *
 * The defect this pins: the candidate query used to require
 * `last_seen_at >= the run's cutoff`, so a run only ever saw the documents
 * that connector had just changed. A room opened today could therefore never
 * collect the thread that named its client last week — and on a live install
 * with hourly incremental syncs, that is every document it has.
 *
 * The bound matters just as much as the reach, so the second case asserts
 * what a run still refuses to read: material in the window that names no
 * room, and material that names a room but fell out of the window.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { businessObjectSchema, businessObjectTypeSchema, knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { listDataRooms } = await import('@/services/DataRoomService');
const { collectAfterSync, roomSignalTerms } = await import('@/services/dataRooms/collector');

const ORG = 'org_collector_window';
const DAY = 86_400_000;
const now = new Date();
const ago = (days: number): Date => new Date(now.getTime() - days * DAY);

let sourceId = 0;

async function seedRoom(): Promise<number> {
  const [type] = await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug: 'data_room', label: 'Data room' }).returning({ id: businessObjectTypeSchema.id });
  const [room] = await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: type!.id,
    title: 'Northwind — Hiring agents',
    status: 'active',
    metadata: { client: 'Northwind', aliases: ['northwind logistics'], domains: ['northwind.example'], cast: [{ name: 'Amy Larkin', email: 'amy@northwind.example' }] },
  }).returning({ id: businessObjectSchema.id });
  return room!.id;
}

async function seedDoc(opts: { externalId: string; title: string; metadata: Record<string, unknown>; ingested: Date; lastSeen: Date; text: string }): Promise<number> {
  const [doc] = await db.insert(knowledgeDocumentSchema).values({
    orgId: ORG,
    sourceId,
    externalId: opts.externalId,
    uri: `https://mail.example/${opts.externalId}`,
    title: opts.title,
    metadata: opts.metadata,
    contentHash: opts.externalId,
    ingestedAt: opts.ingested,
    lastSeenAt: opts.lastSeen,
  }).returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values({
    documentId: doc!.id,
    orgId: ORG,
    chunkIdx: 0,
    content: opts.text,
    contentTokens: 8,
    embedding: Array.from({ length: 1536 }, () => 0),
  });
  return doc!.id;
}

const payload = () => ({
  sourceId,
  sourceSlug: 'gmail',
  connector: 'gmail',
  incremental: true,
  created: 0,
  updated: 0,
  unchanged: 0,
  tombstoned: 0,
  errors: 0,
  completedAt: now.toISOString(),
});

beforeEach(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(knowledgeSourceSchema);
  const [source] = await db.insert(knowledgeSourceSchema).values({ orgId: ORG, slug: 'gmail', kind: 'plugin', configJson: { _connector: 'gmail' } }).returning({ id: knowledgeSourceSchema.id });
  sourceId = source!.id;
});

afterAll(async () => {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(businessObjectSchema);
  await db.delete(businessObjectTypeSchema);
  await db.delete(knowledgeSourceSchema);
});

describe('roomSignalTerms', () => {
  it('selects on the room\'s identity, never on its cast, and drops what is too short to search on', async () => {
    const roomId = await seedRoom();
    const rooms = await listDataRooms(ORG);

    expect(rooms.map(r => r.id)).toEqual([roomId]);
    // `amy@northwind.example` is on the cast and scores; it must not select,
    // or a room's own side pulls the whole mailbox into every run.
    expect(roomSignalTerms(rooms).sort()).toEqual(['northwind', 'northwind logistics', 'northwind.example']);
    expect(roomSignalTerms([{ ...rooms[0]!, meta: { client: 'ACE', aliases: ['x'] } }])).toEqual([]);
  });
});

describe('collectAfterSync — what one run looks at', () => {
  it('files material the room already had, not only what this run touched', async () => {
    const roomId = await seedRoom();
    // Ingested a week ago and untouched since: no sync will ever "touch" it
    // again, because the connector only re-sends a document that changed.
    const backlog = await seedDoc({
      externalId: 'thread-1',
      title: 'Re: Northwind — hiring agents proposal',
      metadata: { kind: 'gmail-message', from: 'Amy Larkin <amy@northwind.example>' },
      ingested: ago(7),
      lastSeen: ago(7),
      text: 'Thanks for the walkthrough on Tuesday.',
    });
    // What this run actually touched, and it is not material for any room.
    const noise = await seedDoc({
      externalId: 'thread-2',
      title: 'Your Contoso Supply invoice is ready',
      metadata: { kind: 'gmail-message', from: 'Billing <no-reply@contoso.example>' },
      ingested: now,
      lastSeen: now,
      text: 'Invoice 4182 is attached.',
    });

    const report = await collectAfterSync(ORG, payload());

    expect(report).toMatchObject({ filed: 1, asked: 0, scanned: 2 });

    const [room] = await listDataRooms(ORG);

    expect(room!.id).toBe(roomId);
    expect(room!.meta.sources).toHaveLength(1);
    expect(room!.meta.sources![0]).toMatchObject({ documentId: backlog, kind: 'email', channel: 'gmail', filedBy: 'auto' });
    expect(room!.meta.sources![0]!.evidence!.join(' ')).toContain('domain northwind.example');
    expect(report.scanned).toBe(2);
    expect(noise).toBeGreaterThan(0);
  });

  it('reads no further than that: not the rest of the window, and not past its edge', async () => {
    await seedRoom();
    await seedDoc({
      externalId: 'thread-3',
      title: 'Kestrel Capital — quarterly update',
      metadata: { kind: 'gmail-message', from: 'Dana Reyes <dana@kestrel.example>' },
      ingested: ago(3),
      lastSeen: ago(3),
      text: 'Nothing here belongs to any open room.',
    });
    await seedDoc({
      externalId: 'thread-4',
      title: 'Northwind — kickoff notes',
      metadata: { kind: 'gmail-message', from: 'Amy Larkin <amy@northwind.example>' },
      ingested: ago(45),
      lastSeen: ago(45),
      text: 'Older than the window the collector works in.',
    });

    const report = await collectAfterSync(ORG, payload());

    expect(report).toMatchObject({ filed: 0, asked: 0, scanned: 0 });
  });
});
