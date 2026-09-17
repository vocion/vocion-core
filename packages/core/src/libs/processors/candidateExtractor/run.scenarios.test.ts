/**
 * One ingestion, walked through every shape a venue can arrive in.
 *
 * The rule this file exists for: EVERY card a sync files says what a reviewer
 * should do with it and why, in the words of whatever actually judged it — and
 * when nothing judged it, the card says nothing rather than carrying wording
 * core invented. The event cards get that from the model's per-record verdict;
 * the venue cards get it from the model's `referencedObjects` verdict, made in
 * the same call.
 *
 * The model is stubbed, as everywhere else in this directory: choosing the
 * verdict is the model's job, carrying it intact to a reviewer is the
 * framework's, and only the second half can be asserted here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSyncBudget } from '../budget';

const invoke = vi.fn();

vi.mock('@/libs/DB');

vi.mock('@/libs/llm/langchain', () => ({
  buildChatModelForOrg: vi.fn(async () => ({ invoke, bindTools: vi.fn() })),
  resolvedModelId: () => 'us.anthropic.claude-sonnet-4-6',
}));

vi.mock('@/services/BudgetService', () => ({
  preflightCheck: async () => ({ ok: true }),
  chargeUsage: async () => {},
}));

const { db } = await import('@/libs/DB');
const { actionRunSchema, businessObjectSchema, businessObjectTypeSchema } = await import('@/models/Schema');
const { forgetCachedObjectTypes, CANDIDATE_STATUS } = await import('@/libs/actions/objects-propose-candidate');
const { candidateExtractorConfigSchema } = await import('./config');
const { run } = await import('./run');
const { eq } = await import('drizzle-orm');

const ORG = 'org_scenarios';

/**
 * A calendar day relative to today, so the fixture does not rot.
 * @param offset - Days from today.
 */
function day(offset: number): string {
  const at = new Date();
  at.setUTCDate(at.getUTCDate() + offset);
  return at.toISOString().slice(0, 10);
}

const config = candidateExtractorConfigSchema.parse({
  objectType: 'event-candidate',
  agentSlug: 'event-ingestion-lead',
  dedupOn: ['title', 'startDate', 'venueName'],
  titleFrom: 'title',
  promptFragment: 'Only events open to the public.',
  timezone: 'America/New_York',
  resolveAgainst: [{
    objectType: 'venue-candidate',
    matchFields: { venueName: 'name', venueCity: 'city' },
  }],
  relatedProposals: [{
    objectType: 'venue-candidate',
    fromFields: { name: 'venueName', city: 'venueCity' },
    dedupOn: ['name', 'city'],
    writeRunIdTo: 'venueCandidateRun',
    oncePerRun: true,
    skipIfResolved: true,
  }],
});

const document = {
  externalId: 'https://listings.example.org/riverton',
  uri: 'https://listings.example.org/riverton',
  title: 'This week in Riverton',
  content: [
    'Open Mic Night at The Ember Room, Riverton. Thursday, 8pm. Free.',
    'Trivia at The Ember Room, Riverton. Next Tuesday, 7pm. Free.',
  ].join('\n'),
  metadata: {},
};

/**
 * One extracted event at The Ember Room, with whatever the model said about the
 * venue it names.
 * @param over - Fields to override on the record.
 */
function eventRecord(over: Record<string, unknown> = {}) {
  return {
    fields: { title: 'Open Mic Night', startDate: day(7), venueName: 'The Ember Room', venueCity: 'Riverton' },
    confidence: 0.9,
    suggestedDecision: 'approve',
    suggestedDecisionReason: 'Public listing with its own date line and a venue.',
    ...over,
  };
}

/**
 * The stubbed model's answer for one document.
 * @param records - The records it returns.
 */
function answer(records: Array<Record<string, unknown>>) {
  return {
    content: JSON.stringify({ records }),
    usage_metadata: { input_tokens: 1200, output_tokens: 240 },
  };
}

function context() {
  return {
    orgId: ORG,
    sourceId: 1,
    sourceSlug: 'riverton-listings',
    document,
    outcome: { status: 'created' as const, documentId: 909, chunks: 2 },
    config,
    budget: createSyncBudget(),
    syncContext: { cache: new Map<string, unknown>() },
    signal: new AbortController().signal,
    onProgress: vi.fn(),
  };
}

/** Every card this org has, split by what kind of thing it proposes. */
async function cards() {
  const rows = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
  const kindOf = (row: typeof rows[number]) => (row.input as { objectType?: string }).objectType;
  return {
    events: rows.filter(row => kindOf(row) === 'event-candidate'),
    venues: rows.filter(row => kindOf(row) === 'venue-candidate'),
  };
}

/**
 * Approve a venue in the workspace, the way a moderator's decision leaves it.
 * @param name - The venue's canonical name.
 * @param city - Its canonical town.
 */
async function approveVenue(name: string, city: string) {
  const [type] = await db.select().from(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.slug, 'venue-candidate'));
  await db.insert(businessObjectSchema).values({
    orgId: ORG,
    typeId: type!.id,
    title: name,
    status: CANDIDATE_STATUS.approved,
    metadata: { name, city },
  });
}

describe('an ingestion run, venue by venue', () => {
  beforeEach(async () => {
    invoke.mockReset();
    await db.delete(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    await db.delete(businessObjectSchema).where(eq(businessObjectSchema.orgId, ORG));
    await db.delete(businessObjectTypeSchema).where(eq(businessObjectTypeSchema.orgId, ORG));
    forgetCachedObjectTypes();
    for (const slug of ['event-candidate', 'venue-candidate']) {
      await db.insert(businessObjectTypeSchema).values({ orgId: ORG, slug, label: slug, schema: {} });
    }
  });

  it('files both cards with a recommendation and a reason when the model judged both', async () => {
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{
        objectType: 'venue-candidate',
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'The page prints it with a street address, so it reads as a real room.',
      }],
    })]));

    await run(context());
    const { events, venues } = await cards();

    expect(events).toHaveLength(1);
    expect(events[0]!.proposal).toMatchObject({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'Public listing with its own date line and a venue.',
    });
    expect(venues).toHaveLength(1);
    expect(venues[0]!.proposal).toMatchObject({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The page prints it with a street address, so it reads as a real room.',
    });
    // And the event names the venue run, so a reviewer can see what waits on it.
    expect((events[0]!.input as { fields: Record<string, unknown> }).fields.venueCandidateRun).toBe(venues[0]!.id);
  });

  it('carries a reject on the venue while the event it came from still recommends approving', async () => {
    // The two verdicts are independent: the listing can be a real event whose
    // venue line is the promoter. A reviewer has to see both, or they approve
    // a venue that is not a place.
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{
        objectType: 'venue-candidate',
        suggestedDecision: 'reject',
        suggestedDecisionReason: 'This is the promoter\'s name; the page prints the room separately.',
      }],
    })]));

    await run(context());
    const { events, venues } = await cards();

    expect(events[0]!.proposal).toMatchObject({ suggestedDecision: 'approve' });
    expect(venues[0]!.proposal).toMatchObject({
      suggestedDecision: 'reject',
      suggestedDecisionReason: 'This is the promoter\'s name; the page prints the room separately.',
    });
  });

  it('carries a snooze on the venue when the document says too little to settle it', async () => {
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{
        objectType: 'venue-candidate',
        suggestedDecision: 'snooze',
        suggestedDecisionReason: 'Named, but with no town or address anywhere on the page.',
      }],
    })]));

    await run(context());
    const { venues } = await cards();

    expect(venues[0]!.proposal).toMatchObject({ suggestedDecision: 'snooze' });
  });

  it('files the venue with no recommendation when the model judged the event and not the venue', async () => {
    invoke.mockResolvedValue(answer([eventRecord()]));

    await run(context());
    const { events, venues } = await cards();

    expect(events[0]!.proposal).toMatchObject({ suggestedDecision: 'approve' });
    expect(venues).toHaveLength(1);
    expect(venues[0]!.proposal).not.toHaveProperty('suggestedDecision');
    expect(venues[0]!.proposal).not.toHaveProperty('suggestedDecisionReason');
  });

  it('ignores a verdict for an object type the config never asked about', async () => {
    // A model naming a type nothing files would otherwise put a stranger's
    // verdict on the venue card.
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{
        objectType: 'promoter-candidate',
        suggestedDecision: 'reject',
        suggestedDecisionReason: 'Not a venue at all.',
      }],
    })]));

    await run(context());
    const { venues } = await cards();

    expect(venues[0]!.proposal).not.toHaveProperty('suggestedDecision');
  });

  it('files no venue card at all once the venue is approved, and keeps the event card', async () => {
    await approveVenue('The Ember Room', 'Riverton');
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{
        objectType: 'venue-candidate',
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'Reads as a real room.',
      }],
    })]));

    await run(context());
    const { events, venues } = await cards();

    expect(venues).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.proposal).toMatchObject({ suggestedDecision: 'approve' });
  });

  it('proposes one venue card for two events at the same venue, not one each', async () => {
    invoke.mockResolvedValue(answer([
      eventRecord({
        referencedObjects: [{ objectType: 'venue-candidate', suggestedDecision: 'approve', suggestedDecisionReason: 'Reads as a real room.' }],
      }),
      eventRecord({
        fields: { title: 'Trivia', startDate: day(12), venueName: 'The Ember Room', venueCity: 'Riverton' },
        referencedObjects: [{ objectType: 'venue-candidate', suggestedDecision: 'approve', suggestedDecisionReason: 'Reads as a real room.' }],
      }),
    ]));

    await run(context());
    const { events, venues } = await cards();

    expect(events).toHaveLength(2);
    expect(venues).toHaveLength(1);

    // Both events point at the one venue card.
    const runIds = events.map(row => (row.input as { fields: Record<string, unknown> }).fields.venueCandidateRun);

    expect(new Set(runIds)).toEqual(new Set([venues[0]!.id]));
  });

  it('re-syncing while the venue is still pending refreshes that card instead of filing a second', async () => {
    const first = answer([eventRecord({
      referencedObjects: [{ objectType: 'venue-candidate', suggestedDecision: 'snooze', suggestedDecisionReason: 'No town printed anywhere.' }],
    })]);
    invoke.mockResolvedValue(first);
    await run(context());

    // The page now prints the address, and the model changes its mind.
    invoke.mockResolvedValue(answer([eventRecord({
      referencedObjects: [{ objectType: 'venue-candidate', suggestedDecision: 'approve', suggestedDecisionReason: 'The address is printed now, so it reads as a real room.' }],
    })]));
    await run(context());

    const { venues } = await cards();

    expect(venues).toHaveLength(1);
    expect(venues[0]!.proposal).toMatchObject({
      suggestedDecision: 'approve',
      suggestedDecisionReason: 'The address is printed now, so it reads as a real room.',
    });
  });
});
