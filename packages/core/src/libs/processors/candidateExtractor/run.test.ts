/**
 * One document, end to end, with the model stubbed: what the processor
 * returns to `SourceSyncService` and what it left in the database.
 *
 * The fixture is a hand-cut miniature in the test file, which is this repo's
 * convention for connector and extraction tests, a real captured page earns
 * its place only where the capture itself is the thing under test.
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
const { forgetCachedObjectTypes } = await import('@/libs/actions/objects-propose-candidate');
const { candidateExtractorConfigSchema } = await import('./config');
const { run } = await import('./run');
const { eq } = await import('drizzle-orm');

const ORG = 'org_run';

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
  defaults: { venueName: 'Bellwater Hall', venueCity: 'Riverton' },
  knownCandidates: { keyedBy: 'venueName', dateField: 'startDate' },
  dropIfPast: { field: 'startDate', keepIfField: 'end' },
  allowedValues: { categories: ['Music', 'Comedy'] },
  mustAppearInDocument: ['price'],
  collapseWithinDocument: true,
  relatedProposals: [{
    objectType: 'venue-candidate',
    fromFields: { name: 'venueName', city: 'venueCity' },
    dedupOn: ['name', 'city'],
    writeRunIdTo: 'venueCandidateRun',
  }],
  seriesLabel: {
    sameOn: ['title', 'venueName'],
    differsOn: 'startDate',
    evidenceField: 'recurrence',
    flagField: 'seriesMatch',
    keyField: 'seriesKey',
  },
});

/**
 * An earlier occurrence already in the queue, so the sibling rule has an
 * anchor to point at and the labelling stage has something to do.
 * @param offset - Days from today, inside the known-cards horizon.
 */
async function seedAnchor(offset: number): Promise<number> {
  const [row] = await db.insert(actionRunSchema).values({
    orgId: ORG,
    actionId: 'objects.propose_candidate',
    status: 'pending',
    dedupKey: `objects.propose_candidate:event-candidate|open-mic-night|${day(offset)}|bellwater-hall`,
    input: {
      objectType: 'event-candidate',
      title: 'Open Mic Night',
      fields: { title: 'Open Mic Night', startDate: day(offset), venueName: 'Bellwater Hall', recurrence: 'every Thursday' },
    },
  }).returning({ id: actionRunSchema.id });
  return row!.id;
}

/** A trimmed listing page, the shape `extractFromHtml` hands the processor. */
const document = {
  externalId: 'https://bellwaterhall.example/events',
  uri: 'https://bellwaterhall.example/events',
  title: 'Upcoming shows',
  content: [
    'Upcoming shows at Bellwater Hall, Riverton',
    'Open Mic Night, every Thursday, 8pm. Free.',
    'The Music of Moonrise Live, 8pm. Tickets $28.',
    'Last Month\'s Benefit, already happened.',
  ].join('\n'),
  metadata: {
    jsonLd: [{ '@type': 'Event', 'name': 'Open Mic Night', 'url': 'https://bellwaterhall.example/e/open-mic' }],
    links: [{ url: 'https://bellwaterhall.example/e/open-mic', text: 'Open Mic Night' }],
  },
};

/** What the stubbed model returns for this document. */
function answer() {
  return {
    content: JSON.stringify({
      records: [
        {
          fields: { title: 'Open Mic Night', startDate: day(7), venueName: 'Bellwater Hall', categories: ['Music'], recurrence: 'every Thursday', price: 'Free' },
          confidence: 0.9,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'Fits the operator rules and nothing like it is already queued.',
          sourceUrl: 'https://bellwaterhall.example/e/open-mic',
        },
        {
          fields: { title: 'The Music of Moonrise Live', startDate: day(21), venueName: 'Bellwater Hall', categories: ['Music', 'Interpretive Dance'], price: '$28' },
          confidence: 0.8,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'Fits the operator rules and nothing like it is already queued.',
        },
        // Duplicated by a "featured" block at the top of the same page.
        {
          fields: { title: 'Open Mic Night', startDate: day(7), venueName: 'Bellwater Hall', categories: ['Music'] },
          confidence: 0.7,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'Fits the operator rules and nothing like it is already queued.',
        },
        // Already happened.
        { fields: { title: 'Last Month\'s Benefit', startDate: day(-30), venueName: 'Bellwater Hall' }, confidence: 0.9, suggestedDecision: 'reject', suggestedDecisionReason: 'The date has already passed.' },
        // The model was not sure.
        { fields: { title: 'Rumoured Show', startDate: day(14), venueName: 'Bellwater Hall' }, confidence: 0.2, suggestedDecision: 'snooze', suggestedDecisionReason: 'Only a rumour on the page; worth another look closer to the date.' },
      ],
    }),
    usage_metadata: { input_tokens: 3200, output_tokens: 420 },
  };
}

function context(over: Record<string, unknown> = {}) {
  return {
    orgId: ORG,
    sourceId: 1,
    sourceSlug: 'bellwater-hall',
    document,
    outcome: { status: 'created' as const, documentId: 4242, chunks: 3, contentHash: 'fixture-hash' },
    config,
    budget: createSyncBudget(),
    syncContext: { cache: new Map<string, unknown>() },
    signal: new AbortController().signal,
    onProgress: vi.fn(),
    ...over,
  };
}

describe('candidate extractor, one document end to end', () => {
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

  it('sends the structured data on its own when the page text does not carry it whole', async () => {
    invoke.mockResolvedValue(answer());

    await run(context());

    const human = String((invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>)[1]?.content);

    expect(human).toContain('<jsonld>');
  });

  it('does not send the structured data twice when the page text already carries it whole', async () => {
    invoke.mockResolvedValue(answer());

    await run(context({ document: { ...document, metadata: { ...document.metadata, jsonLdInText: true } } }));

    const human = String((invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>)[1]?.content);

    expect(human).not.toContain('<jsonld>');
    expect(human).toContain('Open Mic Night, every Thursday');
  });

  it('returns a counts shape the run report can add up', async () => {
    invoke.mockResolvedValue(answer());

    const result = await run(context());

    expect(result.counts).toMatchObject({
      'found': 5,
      'model_calls': 1,
      'proposed': 2,
      'skipped.past': 1,
      'skipped.below_confidence': 1,
      'skipped.bad_category': 1,
      'collapsed': 1,
      'venues.proposed': 1,
    });

    // Found is every outcome, and nothing else: the assertion the run report
    // rests on.
    const outcomes = (result.counts!.proposed ?? 0)
      + (result.counts!.refreshed ?? 0)
      + (result.counts!.already_decided ?? 0)
      + (result.counts!['skipped.past'] ?? 0)
      + (result.counts!['skipped.below_confidence'] ?? 0)
      + (result.counts!.collapsed ?? 0);

    expect(outcomes).toBe(result.counts!.found);
    expect(result.produced).toBe(2);
  });

  it('applies the knobs to what it stored', async () => {
    invoke.mockResolvedValue(answer());
    const anchor = await seedAnchor(3);

    await run(context());

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const events = runs.filter(row => (row.input as { objectType?: string }).objectType === 'event-candidate');
    const arnold = events.find(row => (row.input as { title?: string }).title?.includes('Moonrise'));
    const fields = (arnold?.input as { fields: Record<string, unknown> }).fields;
    const openMic = events.find(row => row.id !== anchor && (row.input as { title?: string }).title === 'Open Mic Night');
    const openMicFields = (openMic?.input as { fields: Record<string, unknown> }).fields;

    // The later occurrence points at the queued one, and carries the group it
    // belongs to: the anchor's own id, because the anchor is the root.
    expect(openMicFields.seriesMatch).toBe(`part of series ${anchor}`);
    expect(openMicFields.seriesKey).toBe(String(anchor));

    // The out-of-enum category went; the card stayed.
    expect(fields.categories).toEqual(['Music']);
    // The price's digits are on the page, so it survived.
    expect(fields.price).toBe('$28');
    // The source default filled the city the page never repeated.
    expect(fields.venueCity).toBe('Riverton');
    // And the venue was proposed once and threaded onto the record.
    expect(typeof fields.venueCandidateRun).toBe('number');
    expect(runs.filter(row => (row.input as { objectType?: string }).objectType === 'venue-candidate')).toHaveLength(1);
  });

  it('declares the fields it labelled on the proposal', async () => {
    // Names only, and only the ones this run actually wrote: the decision
    // reads them back to say what the reviewer did with each, and a field
    // nobody wrote would score as cleared on every approve.
    invoke.mockResolvedValue(answer());
    const anchor = await seedAnchor(3);

    await run(context());

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const events = runs.filter(row => (row.input as { objectType?: string }).objectType === 'event-candidate');
    const openMic = events.find(row => row.id !== anchor && (row.input as { title?: string }).title === 'Open Mic Night');
    const arnold = events.find(row => (row.input as { title?: string }).title?.includes('Moonrise'));

    expect(openMic?.proposal?.labels).toEqual(['seriesMatch', 'seriesKey']);
    // Nothing labelled this one, so it declares nothing at all.
    expect(arnold?.proposal).not.toHaveProperty('labels');
  });

  it('carries the model\'s own verdict on the venue onto the venue card', async () => {
    // The card a reviewer opens has to argue for itself in the words of
    // something that actually looked at the page. Core writing "approve" here
    // scored in the agreement rate as though the model had recommended it.
    const judged = JSON.parse(answer().content);
    for (const record of judged.records) {
      record.referencedObjects = [{
        objectType: 'venue-candidate',
        suggestedDecision: 'reject',
        suggestedDecisionReason: 'The page prints the promoter here, not the room the show is in.',
      }];
    }
    invoke.mockResolvedValue({ ...answer(), content: JSON.stringify(judged) });

    await run(context());

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const venue = runs.find(row => (row.input as { objectType?: string }).objectType === 'venue-candidate');

    expect(venue?.proposal?.suggestedDecision).toBe('reject');
    expect(venue?.proposal?.suggestedDecisionReason).toBe('The page prints the promoter here, not the room the show is in.');
  });

  it('leaves the venue card with no recommendation when the model judged only the records', async () => {
    // Silence is the honest answer, and it stays out of the agreement rate.
    // The alternative — core inventing an approve — is what this replaced.
    invoke.mockResolvedValue(answer());

    await run(context());

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const venue = runs.find(row => (row.input as { objectType?: string }).objectType === 'venue-candidate');

    expect(venue).toBeDefined();
    expect(venue?.proposal).not.toHaveProperty('suggestedDecision');
    expect(venue?.proposal).not.toHaveProperty('suggestedDecisionReason');
  });

  it('keeps the URLs a feed entry declared, having no links or JSON-LD to check against', async () => {
    // The join this file exists to cover: the connector writes the URLs onto
    // the document, the processor has to hand them to the gate. Tested in the
    // two halves separately, a dropped hand-off here is silent, and the whole
    // defect this fixes was one missing hand-off.
    const entry = {
      externalId: 'https://venue.test/events.ics#evt-1',
      uri: 'https://venue.test/events.ics#evt-1',
      title: 'Poster Night',
      content: 'BEGIN:VEVENT\nSUMMARY:Poster Night\nURL:https://venue.test/e/poster-night\nEND:VEVENT',
      // What a calendar entry has: no parsed links, no JSON-LD, its own list.
      metadata: {
        contentType: 'text/calendar',
        feedUrl: 'https://venue.test/events.ics',
        publishedUrls: ['https://venue.test/e/poster-night', 'https://cdn.venue.test/poster.png'],
      },
    };
    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{
          fields: { title: 'Poster Night', startDate: day(7), venueName: 'Bellwater Hall', categories: ['Music'] },
          confidence: 0.9,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'A public listing with its own date and venue.',
          sourceUrl: 'https://venue.test/e/poster-night',
          imageUrl: 'https://cdn.venue.test/poster.png',
        }],
      }),
      usage_metadata: { input_tokens: 900, output_tokens: 120 },
    });

    await run(context({ document: entry }));

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const card = runs.find(row => (row.input as { title?: string }).title === 'Poster Night');
    const input = card?.input as { sourceUrl?: string; imageUrl?: string };

    expect(input.sourceUrl).toBe('https://venue.test/e/poster-night');
    expect(input.imageUrl).toBe('https://cdn.venue.test/poster.png');
  });

  it('hands the feed URL to the gate, so a link returned as a path still lands', async () => {
    // The third hand-off: the connector resolved its declaration, the model
    // reads the raw entry and answers with the path. Without `baseUrl` on the
    // options the two spellings never meet and the link is dropped silently.
    const entry = {
      externalId: 'https://venue.test/events.json#evt-1',
      uri: 'https://venue.test/events.json#evt-1',
      title: 'Poster Night',
      content: '{"fullUrl":"/e/poster-night","title":"Poster Night"}',
      metadata: {
        contentType: 'application/json',
        feedUrl: 'https://venue.test/events.json',
        publishedUrls: ['https://venue.test/e/poster-night'],
      },
    };
    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{
          fields: { title: 'Poster Night', startDate: day(7), venueName: 'Bellwater Hall' },
          confidence: 0.9,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'A public listing with its own date and venue.',
          sourceUrl: '/e/poster-night',
        }],
      }),
      usage_metadata: { input_tokens: 900, output_tokens: 120 },
    });

    await run(context({ document: entry }));

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const card = runs.find(row => (row.input as { title?: string }).title === 'Poster Night');

    expect((card?.input as { sourceUrl?: string }).sourceUrl).toBe('https://venue.test/e/poster-night');
  });

  it('puts the image the document published for itself on the one card it produced', async () => {
    // The other hand-off this file exists to cover. The connector has kept the
    // og:image since `pageMetadata.ts` was written and nothing downstream read
    // it, so the gate dropped every one a model returned and a document that
    // stated no image per record produced a card with no picture at all.
    const page = {
      externalId: 'https://bellwaterhall.example/e/open-mic',
      uri: 'https://bellwaterhall.example/e/open-mic',
      title: 'Open Mic Night',
      // The shape `extractFromHtml` returns: the document's own image is the
      // first line of the text, which is why the model is not sent it twice.
      content: [
        'Image: https://bellwaterhall.example/og-card.png',
        'Open Mic Night at Bellwater Hall, Riverton. Every Thursday, 8pm.',
      ].join('\n\n'),
      metadata: { ogImage: 'https://bellwaterhall.example/og-card.png' },
    };
    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{
          fields: { title: 'Open Mic Night', startDate: day(7), venueName: 'Bellwater Hall', categories: ['Music'] },
          confidence: 0.9,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'A public listing with its own date and venue.',
        }],
      }),
      usage_metadata: { input_tokens: 700, output_tokens: 90 },
    });

    await run(context({ document: page }));

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const card = runs.find(row => (row.input as { title?: string }).title === 'Open Mic Night');
    const input = card?.input as { imageUrl?: string; extractionNotes?: string };

    expect(input.imageUrl).toBe('https://bellwaterhall.example/og-card.png');
    // Said on the card, so a reviewer can see the picture is the document's
    // own rather than one stated for this record.
    expect(input.extractionNotes).toContain('the document published for itself');
  });

  it('reports a skip instead of throwing when the model never answers', async () => {
    invoke.mockResolvedValue({ content: 'I could not read that page.' });

    const result = await run(context());

    expect(result).toMatchObject({ produced: 0, skipped: 1 });
    expect(result.counts).toMatchObject({ model_invalid: 1, model_calls: 2 });
    expect(result.retry).toBeUndefined();
    expect(await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG))).toHaveLength(0);
  });

  it('stops before the model call when the proposal budget is already spent, and asks to be run again', async () => {
    invoke.mockResolvedValue(answer());

    const result = await run(context({ budget: createSyncBudget({ limits: { maxProposalsPerSync: 0 } }) }));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.retry).toEqual({ reason: expect.stringContaining('proposal budget'), countsAsTry: false });
  });

  it('asks to be run again when the provider refused the call, without using a try', async () => {
    const refused = Object.assign(new Error('Too many tokens per day, please wait before trying again.'), {
      $metadata: { httpStatusCode: 429 },
    });
    invoke.mockRejectedValue(refused);

    const result = await run(context());

    expect(result).toMatchObject({ produced: 0, skipped: 1 });
    expect(result.retry).toEqual({ reason: expect.stringContaining('model_throttled'), countsAsTry: false });
    expect(result.counts).toMatchObject({ model_throttled: 1 });
  });

  it('spends one model call per document, whatever the document holds', async () => {
    invoke.mockResolvedValue(answer());

    await run(context());

    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
