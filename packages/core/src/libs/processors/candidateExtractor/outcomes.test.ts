/**
 * The three outcomes a sync can have for one record, against the real action
 * on PGlite: a new card, the same card refreshed the next day, and nothing at
 * all once a person has decided it.
 *
 * Also the exact dedup key, spelled out. It is the string every one of those
 * outcomes turns on, it is what a re-scrape has to reproduce byte for byte,
 * and a change to it silently re-proposes every card in the queue, so it is
 * asserted literally rather than derived, which would only assert that the
 * code agrees with itself.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncBudget } from '../budget';

vi.mock('@/libs/DB');
// Mocked rather than spied on: the real module loads `libs/Env`, which demands
// a DATABASE_URL this suite has no use for, its database being the PGlite mock.
vi.mock('@/libs/Logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }));

const { db } = await import('@/libs/DB');
const { logger } = await import('@/libs/Logger');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema, objectDocumentLinkSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { candidateExtractorConfigSchema } = await import('./config');
const { proposeRecords } = await import('./propose');
const { eq } = await import('drizzle-orm');

const dryRunLines = vi.mocked(logger.info);

const ORG = 'org_outcomes';

/** The key the whole pipeline turns on, as one literal string. */
const EXPECTED_DEDUP_KEY = 'objects.propose_candidate:event-candidate|the-music-of-hey-arnold-live|2026-11-01|higher-ground';

const config = candidateExtractorConfigSchema.parse({
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only public events.',
});

const dryConfig = candidateExtractorConfigSchema.parse({
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only public events.',
  dryRun: true,
});

const document = {
  externalId: 'https://highergroundmusic.com/events',
  content: 'The Music of Hey Arnold! Live, 1 November, Higher Ground.',
  title: 'Upcoming shows',
  uri: 'https://highergroundmusic.com/events',
};

function record(over: Record<string, unknown> = {}) {
  const { fields, ...rest } = over as { fields?: Record<string, unknown> };
  return {
    fields: {
      title: 'The Music of Hey Arnold! Live',
      startDate: '2026-11-01',
      venueName: 'Higher Ground',
      ...fields,
    },
    confidence: 0.86,
    issues: [] as string[],
    ...rest,
  };
}

function propose(records: ReturnType<typeof record>[], over: Partial<Parameters<typeof proposeRecords>[0]> = {}) {
  return proposeRecords({
    orgId: ORG,
    sourceSlug: 'higher-ground',
    config,
    records,
    document,
    documentId: 4242,
    objectSchema: null,
    learningIds: [],
    budget: createSyncBudget(),
    ...over,
  });
}

describe('candidate extractor outcomes', () => {
  beforeEach(async () => {
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
    await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
    forgetCachedObjectTypes();
    await db.insert(businessObjectTypeSchema).values({
      orgId: ORG,
      slug: 'event-candidate',
      label: 'Event candidate',
      schema: { type: 'object', properties: { title: { type: 'string' } } },
    });
  });

  it('creates, then refreshes, then stops once a person has decided', async () => {
    const first = await propose([record()]);

    expect(first.counts).toMatchObject({ proposed: 1 });

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(run?.dedupKey).toBe(EXPECTED_DEDUP_KEY);
    expect(run?.invokedBy).toBe('agent:event-ingestion-lead');
    expect(run?.proposal).toMatchObject({ confidence: 0.86, agentSlug: 'event-ingestion-lead' });

    // Tomorrow's sync reads the same page again.
    const second = await propose([record({ fields: { summary: 'Doors at 7.' } })]);

    expect(second.counts).toMatchObject({ refreshed: 1 });

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(runs).toHaveLength(1);

    // A moderator rejects it. That is what a decision leaves behind.
    await db.update(actionRunSchema)
      .set({ status: 'rejected', decidedAt: new Date() })
      .where(eq(actionRunSchema.id, run!.id));

    const third = await propose([record()]);

    expect(third.counts).toMatchObject({ already_decided: 1 });
    expect(third.counts.proposed).toBeUndefined();
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG))).toHaveLength(1);
  });

  it('recommends reject on a card the model called a duplicate, and nothing otherwise', async () => {
    await propose([
      record({ duplicateOf: 41, fields: { title: 'Open Mic Night', seriesMatch: 'possible duplicate of 41' } }),
      record(),
    ]);

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const byTitle = Object.fromEntries(runs.map(r => [(r.input as { title?: string }).title, r]));

    expect(byTitle['Open Mic Night']?.proposal).toMatchObject({ suggestedDecision: 'reject' });
    expect(byTitle['Open Mic Night']?.status).toBe('pending');
    expect((byTitle['The Music of Hey Arnold! Live']?.proposal as { suggestedDecision?: string }).suggestedDecision).toBeUndefined();
  });

  it('links the document to the candidate it created', async () => {
    await propose([record()]);

    const links = await db.select().from(objectDocumentLinkSchema);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      onyxDocumentId: document.externalId,
      sourceType: 'higher-ground',
      role: 'source',
    });

    const [object] = await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));

    expect(object?.provenance).toMatchObject({ rawExtractRef: 'knowledge_document:4242' });
  });

  it('writes nothing at all on a dry run', async () => {
    const out = await propose([record()], { config: dryConfig });

    expect(out.counts).toMatchObject({ dry_run: 1 });
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG))).toHaveLength(0);
    expect(await db.select().from(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG))).toHaveLength(0);
  });

  it('logs the fields and the exact dedup key the live run would have written', async () => {
    // The log line is the dry run's entire output, and the rollout step it
    // serves diffs a would-be card against the card a person actually got.
    // Title and identity alone cannot be diffed, and a key computed a second
    // way would only prove the dry run agrees with itself, so the line
    // carries the whole validated `fields` object and the action's own key.
    dryRunLines.mockClear();

    await propose([record()], { config: dryConfig });
    // The line is written through a deferred `import('@/libs/Logger')`, so it
    // lands a microtask after `proposeRecords` has already returned.
    await vi.waitFor(() => expect(dryRunLines).toHaveBeenCalledWith('candidate extractor dry run', expect.anything()));

    // `logger.info` is overloaded and `vi.mocked` resolves to the last
    // overload, the one-argument callback form, so the recorded calls are
    // narrowed back to the (message, properties) shape this one was made in.
    const calls = dryRunLines.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    const line = calls.find(call => call[0] === 'candidate extractor dry run')?.[1];

    expect(line).toMatchObject({
      dedupKey: EXPECTED_DEDUP_KEY,
      fields: {
        title: 'The Music of Hey Arnold! Live',
        startDate: '2026-11-01',
        venueName: 'Higher Ground',
      },
      title: 'The Music of Hey Arnold! Live',
      identity: ['The Music of Hey Arnold! Live', '2026-11-01', 'Higher Ground'],
    });
  });

  it('stores what the model recommended, and why, on the card it made', async () => {
    // The pair is the whole point of the field: a reviewer reads the reason
    // before deciding, and later the two can be compared against what they
    // actually did. A stored recommendation with no reason is a percentage
    // nobody can interpret.
    await propose([record({ suggestedDecision: 'snooze', suggestedDecisionReason: 'The venue has not confirmed the date.' })]);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(run?.proposal).toMatchObject({
      suggestedDecision: 'snooze',
      suggestedDecisionReason: 'The venue has not confirmed the date.',
    });
  });

  it('turns down a duplicate in our own words, whatever the model recommended', async () => {
    // The duplicate id is core's determination, not the model's read, so the
    // reason a reviewer sees has to be one we can stand behind — and a model
    // that both flagged the duplicate and recommended approving it must not
    // leave an "approve" on the card.
    await propose([record({
      duplicateOf: 412,
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'Looks like a solid listing.',
    })]);

    const [run] = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));

    expect(run?.proposal).toMatchObject({
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'Already waiting for review as action run #412.',
    });
  });

  it('stops proposing once the sync has spent its proposal budget', async () => {
    const budget = createSyncBudget({ limits: { maxProposalsPerSync: 1 } });

    const out = await propose([record(), record({ fields: { startDate: '2026-11-08' } })], { budget });

    expect(out.counts.proposed).toBe(1);
    expect(out.notes.join(' ')).toContain('proposal budget is spent');
  });
});
