/**
 * The revisit backfill: a dry run counts, per source, the split repeating
 * calendar entries a processor already finished on and writes nothing; an
 * apply gives exactly those a revisit time, and a re-run finds none. Every
 * name is fictional.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } = await import('@/models/Schema');
const { backfillProcessorRevisits } = await import('./ProcessorRevisitBackfill');

const ORG = 'org_revisit_backfill';
const OTHER = 'org_revisit_backfill_other';
const FEED = 'https://bellwaterhall.example/feed.ics';
const EXTRACTOR = { slug: 'candidate-extractor', config: {} };
const earlier = new Date('2026-01-01T00:00:00.000Z');

async function wipe() {
  await db.delete(knowledgeChunkSchema);
  await db.delete(knowledgeDocumentSchema);
  await db.delete(knowledgeSourceSchema);
}

async function source(orgId: string, slug: string, processor?: typeof EXTRACTOR) {
  const [row] = await db.insert(knowledgeSourceSchema).values({
    orgId,
    slug,
    kind: 'web',
    configJson: processor ? { _connector: 'web', _processor: processor } : { _connector: 'web' },
  }).returning({ id: knowledgeSourceSchema.id });
  return row!.id;
}

async function document(sourceId: number, orgId: string, externalId: string, chunks: string[], over: Partial<typeof knowledgeDocumentSchema.$inferInsert> = {}) {
  const [row] = await db.insert(knowledgeDocumentSchema).values({
    orgId,
    sourceId,
    externalId,
    contentHash: `hash-${externalId}`,
    metadata: { contentType: 'text/calendar', feedUrl: FEED },
    processedHash: `hash-${externalId}`,
    ...over,
  }).returning({ id: knowledgeDocumentSchema.id });
  await db.insert(knowledgeChunkSchema).values(chunks.map((content, chunkIdx) => ({
    documentId: row!.id,
    orgId,
    chunkIdx,
    content,
    contentTokens: 10,
    embedding: Array.from<number>({ length: 1536 }).fill(0.1),
    metadata: {},
  })));
  return row!.id;
}

const weekly = 'BEGIN:VEVENT\nUID:weekly@bellwaterhall.example\nSUMMARY:Open Mic Night\nDTSTART:20260903T230000Z\nRRULE:FREQ=WEEKLY\nEND:VEVENT';

async function revisitOf(id: number) {
  const [row] = await db.select({ at: knowledgeDocumentSchema.processorRevisitAt }).from(knowledgeDocumentSchema).where(eq(knowledgeDocumentSchema.id, id));
  return row?.at ?? null;
}

let matching: number[] = [];
let settled = 0;
let elsewhere = 0;

beforeEach(async () => {
  await wipe();
  const calendar = await source(ORG, 'bellwater-calendar', EXTRACTOR);
  const plain = await source(ORG, 'bellwater-archive');
  const other = await source(OTHER, 'corvina-calendar', EXTRACTOR);
  matching = [
    await document(calendar, ORG, `${FEED}#weekly`, [weekly]),
    // The rule in a later chunk, written with a parameter.
    await document(calendar, ORG, `${FEED}#daily`, ['BEGIN:VEVENT\nUID:daily@bellwaterhall.example\nSUMMARY:Morning Swim', 'RRULE;X-NOTE=1:FREQ=DAILY\nEND:VEVENT']),
  ];
  settled = await document(calendar, ORG, `${FEED}#settled`, [weekly], { processorRevisitAt: earlier });
  // A one-off entry, one no processor finished on, one whose rule is only mentioned, a whole feed, and a web page.
  await document(calendar, ORG, `${FEED}#once`, ['BEGIN:VEVENT\nUID:once@bellwaterhall.example\nDTSTART:20261001T230000Z\nEND:VEVENT'], { metadata: { feedUrl: FEED, endsOn: '2026-10-01' } });
  await document(calendar, ORG, `${FEED}#unread`, [weekly], { processedHash: null });
  await document(calendar, ORG, `${FEED}#mention`, ['BEGIN:VEVENT\nUID:mention@bellwaterhall.example\nDESCRIPTION:repeats per RRULE:FREQ=WEEKLY\nEND:VEVENT']);
  await document(calendar, ORG, FEED, [`BEGIN:VCALENDAR\n${weekly}\nEND:VCALENDAR`]);
  await document(calendar, ORG, 'https://bellwaterhall.example/events', [weekly], { metadata: {} });
  // Its text changed after the last finished run, so the sync reads it anyway.
  await document(calendar, ORG, `${FEED}#changed`, [weekly], { processedHash: 'hash-older' });
  // A source that runs no processor, and one that runs another.
  await document(plain, ORG, `${FEED}#archived`, [weekly]);
  await document(await source(ORG, 'bellwater-digest', { slug: 'digest', config: {} }), ORG, `${FEED}#digest`, [weekly]);
  elsewhere = await document(other, OTHER, `${FEED}#other`, [weekly]);
});

afterAll(wipe);

describe('backfillProcessorRevisits', () => {
  it('dry run counts the entries per source and writes nothing', async () => {
    const counts = await backfillProcessorRevisits({ orgId: ORG });

    expect(counts).toEqual({ matched: 2, marked: 0, bySource: { [`${ORG}/bellwater-calendar`]: 2 } });
    expect(await Promise.all(matching.map(revisitOf))).toEqual([null, null]);
  });

  it('covers every workspace when none is named', async () => {
    const counts = await backfillProcessorRevisits();

    expect(counts.bySource).toEqual({ [`${ORG}/bellwater-calendar`]: 2, [`${OTHER}/corvina-calendar`]: 1 });
  });

  it('apply gives exactly those entries a revisit time of now, and a re-run finds none', async () => {
    const before = Date.now();
    const first = await backfillProcessorRevisits({ orgId: ORG, apply: true });

    expect(first).toMatchObject({ matched: 2, marked: 2 });

    for (const id of matching) {
      expect((await revisitOf(id))?.getTime()).toBeGreaterThanOrEqual(before - 1_000);
    }

    expect(await revisitOf(settled)).toEqual(earlier);
    expect(await revisitOf(elsewhere)).toBeNull();
    expect(await backfillProcessorRevisits({ orgId: ORG, apply: true })).toEqual({ matched: 0, marked: 0, bySource: {} });
  });
});
