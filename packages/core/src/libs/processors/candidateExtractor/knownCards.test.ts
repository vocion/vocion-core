/**
 * The `<known>` block: who is in it, who is not, and why the comparison is
 * done on the dedup key rather than on the stored field.
 *
 * Runs against PGlite through the `@/libs/DB` mock, because the query and its
 * status filter are the point, a version of this test that stubbed the query
 * would assert nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/libs/DB');

const { db } = await import('@/libs/DB');
const { actionRunSchema } = await import('@/models/Schema');
const { candidateExtractorConfigSchema } = await import('./config');
const { loadKnownCards } = await import('./knownCards');
const { eq } = await import('drizzle-orm');

const ORG = 'org_known';
const TODAY = '2026-11-10';

function configWith(over: Record<string, unknown> = {}) {
  return candidateExtractorConfigSchema.parse({
    objectType: 'event-candidate',
    agentSlug: 'event-ingestion-lead',
    dedupOn: ['title', 'startDate', 'venueName'],
    titleFrom: 'title',
    promptFragment: 'Only public events.',
    defaults: { venueName: 'Higher Ground' },
    knownCandidates: { keyedBy: 'venueName', dateField: 'startDate', horizonDays: 60 },
    seriesLabel: { sameOn: ['title', 'venueName'], differsOn: 'startDate', evidenceField: 'recurrence', flagField: 'seriesMatch' },
    ...over,
  });
}

/**
 * Queue one card, exactly as `proposeAction` would have stored it.
 * @param opts - The card to queue.
 * @param opts.title - Card title.
 * @param opts.startDate - The card's date, as stored on the proposal.
 * @param opts.venueKey - The venue's already-normalised key segment.
 * @param opts.status - Run status; pending unless stated.
 * @param opts.recurrence - The card's repeat description, if it has one.
 * @param opts.type - Object type slug; the event type unless stated.
 */
async function seedCard(opts: {
  title: string;
  startDate: string;
  venueKey: string;
  status?: string;
  recurrence?: string;
  type?: string;
}) {
  const key = `objects.propose_candidate:${opts.type ?? 'event-candidate'}|${opts.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}|${opts.startDate}|${opts.venueKey}`;
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'objects.propose_candidate',
    status: opts.status ?? 'pending',
    dedupKey: key,
    input: {
      objectType: opts.type ?? 'event-candidate',
      title: opts.title,
      fields: { title: opts.title, startDate: opts.startDate, recurrence: opts.recurrence ?? '' },
    },
  }).returning({ id: actionRunSchema.id });
  return row!.id;
}

function freshContext() {
  return { cache: new Map<string, unknown>() };
}

describe('known cards block', () => {
  beforeEach(async () => {
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
  });

  it('gives an aggregator source no block at all', async () => {
    await seedCard({ title: 'Open Mic Night', startDate: '2026-11-12', venueKey: 'none' });

    // No default for the keyed-by field. A blank normalises to `none`, which
    // is exactly what a venue-less card's segment holds, so this check has to
    // happen BEFORE normalising or every such card would match.
    const known = await loadKnownCards({
      orgId: ORG,
      config: configWith({ defaults: undefined }),
      syncContext: freshContext(),
      today: TODAY,
    });

    expect(known.text).toBe('');
    expect(known.ids.size).toBe(0);
  });

  it('matches a venue on its dedup-key segment, normalised the way the key is', async () => {
    const mine = await seedCard({ title: 'Open Mic Night', startDate: '2026-11-12', venueKey: 'higher-ground' });
    await seedCard({ title: 'Other Mic', startDate: '2026-11-13', venueKey: 'the-flynn' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });

    expect([...known.ids]).toEqual([mine]);
    expect(known.text).toContain('Open Mic Night');
    expect(known.text).not.toContain('Other Mic');
  });

  it('keeps pending, failed and done cards, and nothing else', async () => {
    const pending = await seedCard({ title: 'A Show', startDate: '2026-11-12', venueKey: 'higher-ground' });
    const failed = await seedCard({ title: 'B Show', startDate: '2026-11-13', venueKey: 'higher-ground', status: 'failed' });
    const done = await seedCard({ title: 'C Show', startDate: '2026-11-14', venueKey: 'higher-ground', status: 'done' });
    await seedCard({ title: 'D Show', startDate: '2026-11-15', venueKey: 'higher-ground', status: 'rejected' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });

    expect([...known.ids].sort((a, b) => a - b)).toEqual([pending, failed, done].sort((a, b) => a - b));
  });

  it('holds the date window open only from today to the horizon', async () => {
    await seedCard({ title: 'Yesterday', startDate: '2026-11-09', venueKey: 'higher-ground' });
    const inside = await seedCard({ title: 'Soon', startDate: '2026-11-12', venueKey: 'higher-ground' });
    await seedCard({ title: 'Next Year', startDate: '2027-06-01', venueKey: 'higher-ground' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });

    expect([...known.ids]).toEqual([inside]);
  });

  it('parses a date-time value, never compares it as text', async () => {
    const withTime = await seedCard({ title: 'Evening Show', startDate: '2026-11-12T20:00:00Z', venueKey: 'higher-ground' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });

    expect([...known.ids]).toEqual([withTime]);
    expect(known.cards[0]?.date).toBe('2026-11-12');
  });

  it('ignores cards of another object type on the same venue', async () => {
    await seedCard({ title: 'A Venue', startDate: '2026-11-12', venueKey: 'higher-ground', type: 'venue-candidate' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });

    expect(known.ids.size).toBe(0);
  });

  it('caps the block by item count and by characters', async () => {
    for (let day = 11; day < 26; day++) {
      await seedCard({ title: `Show ${day}`, startDate: `2026-11-${day}`, venueKey: 'higher-ground' });
    }

    const byItems = await loadKnownCards({
      orgId: ORG,
      config: configWith({ knownCandidates: { keyedBy: 'venueName', dateField: 'startDate', maxItems: 3 } }),
      syncContext: freshContext(),
      today: TODAY,
    });
    const byChars = await loadKnownCards({
      orgId: ORG,
      config: configWith({ knownCandidates: { keyedBy: 'venueName', dateField: 'startDate', maxChars: 90 } }),
      syncContext: freshContext(),
      today: TODAY,
    });

    expect(byItems.cards).toHaveLength(3);
    expect(byChars.text.length).toBeLessThanOrEqual(90);
    expect(byChars.cards.length).toBeGreaterThan(0);
  });

  it('loads once per sync, whatever the document count', async () => {
    await seedCard({ title: 'Open Mic Night', startDate: '2026-11-12', venueKey: 'higher-ground' });
    const syncContext = freshContext();

    const first = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext, today: TODAY });
    await seedCard({ title: 'Added Mid Sync', startDate: '2026-11-13', venueKey: 'higher-ground' });
    const second = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext, today: TODAY });

    // The intra-sync blindness is a known limit, not a bug: the sibling rule
    // in `labels.ts` is what catches a card proposed earlier in the same run.
    expect(second).toBe(first);
    expect(second.ids.size).toBe(1);
  });

  it('renders the recurrence as the fourth column, or a dash', async () => {
    await seedCard({ title: 'Open Mic Night', startDate: '2026-11-12', venueKey: 'higher-ground', recurrence: 'every Thursday' });
    await seedCard({ title: 'One Off', startDate: '2026-11-13', venueKey: 'higher-ground' });

    const known = await loadKnownCards({ orgId: ORG, config: configWith(), syncContext: freshContext(), today: TODAY });
    const [first, second] = known.text.split('\n');

    expect(first).toContain('| 2026-11-12 | Open Mic Night | every Thursday');
    expect(second).toContain('| One Off | -');
  });
});
