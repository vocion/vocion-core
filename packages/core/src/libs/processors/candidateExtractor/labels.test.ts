/**
 * Series and duplicate labels: what the model said, what the dedup keys say,
 * and what happens when they disagree.
 *
 * Nothing here merges or refreshes another card; every assertion is about one
 * sentence written into one configured field before the proposal is made.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { candidateExtractorConfigSchema } = await import('./config');
const { labelRecords } = await import('./labels');
const { eq } = await import('drizzle-orm');

const ORG = 'org_labels';

const config = candidateExtractorConfigSchema.parse({
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only public events.',
  seriesLabel: {
    sameOn: ['title', 'venueName'],
    differsOn: 'startDate',
    evidenceField: 'recurrence',
    flagField: 'seriesMatch',
  },
});

/**
 * Queue one card with the dedup key `proposeAction` would have derived.
 * @param opts - The card to queue.
 * @param opts.title - The title's already-normalised key segment.
 * @param opts.startDate - The card's date segment.
 * @param opts.venue - The venue's already-normalised key segment.
 * @param opts.status - Run status; pending unless stated.
 * @param opts.recurrence - The card's repeat description, if it has one.
 */
async function seedCard(opts: {
  title?: string;
  startDate: string;
  venue?: string;
  status?: string;
  recurrence?: string;
}) {
  const title = opts.title ?? 'open-mic-night';
  const venue = opts.venue ?? 'higher-ground';
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'objects.propose_candidate',
    status: opts.status ?? 'pending',
    dedupKey: `objects.propose_candidate:event-candidate|${title}|${opts.startDate}|${venue}`,
    input: { fields: { recurrence: opts.recurrence ?? '' } },
  }).returning({ id: actionRunSchema.id });
  return row!.id;
}

function record(over: Record<string, unknown> = {}) {
  const { fields, ...rest } = over as { fields?: Record<string, unknown> };
  const built: { fields: Record<string, unknown>; confidence: number; issues: string[] } = {
    fields: {
      title: 'Open Mic Night',
      startDate: '2026-11-19',
      venueName: 'Higher Ground',
      ...fields,
    },
    confidence: 0.9,
    issues: [],
    ...rest,
  };
  return built;
}

describe('series and duplicate labels', () => {
  beforeEach(async () => {
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
  });

  it('writes the series label the model asked for', async () => {
    const records = [record({ seriesOf: 41 })];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBe('part of series 41');
    expect(counts.series_labeled).toBe(1);
  });

  it('writes the duplicate label the model asked for, and no series label', async () => {
    const records = [record({ duplicateOf: 77, seriesOf: 41 })];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBe('possible duplicate of 77');
    expect(counts.duplicate_flagged).toBe(1);
    expect(counts.series_labeled).toBeUndefined();
  });

  it('falls back to the sibling rule when the model said nothing', async () => {
    const anchor = await seedCard({ startDate: '2026-11-12', recurrence: 'every Thursday' });
    const records = [record()];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBe(`part of series ${anchor}`);
    expect(counts.series_labeled).toBe(1);
  });

  it('counts an anchor whose card a person already approved', async () => {
    const anchor = await seedCard({ startDate: '2026-11-12', recurrence: 'every Thursday', status: 'done' });
    const records = [record()];

    await labelRecords({ orgId: ORG, config, records });

    // `done` is where an approved candidate ends, and it is exactly what a
    // later occurrence should point at.
    expect(records[0]?.fields.seriesMatch).toBe(`part of series ${anchor}`);
  });

  it('labels on two siblings even when neither carries evidence', async () => {
    const first = await seedCard({ startDate: '2026-11-05' });
    await seedCard({ startDate: '2026-11-12' });
    const records = [record()];

    await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBe(`part of series ${first}`);
  });

  it('says nothing for one evidence-free sibling', async () => {
    await seedCard({ startDate: '2026-11-12' });
    const records = [record()];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBeUndefined();
    expect(counts.series_labeled).toBeUndefined();
  });

  it('does not treat the same title at another venue as a sibling', async () => {
    await seedCard({ startDate: '2026-11-12', venue: 'the-flynn', recurrence: 'every Thursday' });
    const records = [record()];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBeUndefined();
    expect(counts.series_labeled).toBeUndefined();
  });

  it('does not treat the same day as a sibling, that is a duplicate, not a series', async () => {
    await seedCard({ startDate: '2026-11-19', venue: 'higher-ground', recurrence: 'every Thursday' });
    const records = [record()];

    await labelRecords({ orgId: ORG, config, records });

    expect(records[0]?.fields.seriesMatch).toBeUndefined();
  });

  it('counts a disagreement and lets the model win', async () => {
    const anchor = await seedCard({ startDate: '2026-11-12', recurrence: 'every Thursday' });
    const records = [record({ seriesOf: 41 })];

    const counts = await labelRecords({ orgId: ORG, config, records });

    expect(anchor).not.toBe(41);
    expect(records[0]?.fields.seriesMatch).toBe('part of series 41');
    expect(counts.series_disagreement).toBe(1);
  });
});
