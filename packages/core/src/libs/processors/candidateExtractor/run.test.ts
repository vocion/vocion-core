/**
 * One document, end to end, with the model stubbed: what the processor
 * returns to `SourceSyncService` and what it left in the database.
 *
 * The fixture is a hand-cut miniature in the test file, which is this repo's
 * convention for connector and extraction tests, a real captured page earns
 * its place only where the capture itself is the thing under test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarDayOf } from '@/libs/time/relativeDay';
import { dayPlus, instantInZone, isoInZone, startOfDay } from '@/libs/time/zone';
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
const { calendarToday } = await import('./validate');
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

  it('tells the model which day is today', async () => {
    invoke.mockResolvedValue(answer());
    await run(context());

    const system = String((invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>)[0]?.content);
    const today = calendarToday(config.timezone);
    const weekday = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

    expect(system).toContain(`Today is ${today}, a ${weekday}.`);
  });

  it('does not call the model for a one-off entry that ended two days ago or more', async () => {
    invoke.mockResolvedValue(answer());

    const result = await run(context({ document: { ...document, metadata: { ...document.metadata, endsOn: day(-3) } } }));

    expect(invoke).not.toHaveBeenCalled();
    expect(result.counts?.['skipped.past_before_call']).toBe(1);
    expect(result.retry).toBeUndefined();
  });

  it('reads an entry whose end day is not a calendar day', async () => {
    invoke.mockResolvedValue(answer());

    await run(context({ document: { ...document, metadata: { ...document.metadata, endsOn: '1999' } } }));

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('still reads an entry that ended yesterday', async () => {
    invoke.mockResolvedValue(answer());

    await run(context({ document: { ...document, metadata: { ...document.metadata, endsOn: day(-1) } } }));

    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('reads a long-past entry for a source that keeps past records', async () => {
    invoke.mockResolvedValue(answer());
    const { dropIfPast: _, ...keepsPast } = config;

    await run(context({ config: keepsPast, document: { ...document, metadata: { ...document.metadata, endsOn: day(-30) } } }));

    expect(invoke).toHaveBeenCalledTimes(1);
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

  it('accepts an image the page\'s text shows, which is in no link list', async () => {
    const poster = 'https://bellwaterhall.example/uploads/open-mic.jpg';
    invoke.mockResolvedValue({
      content: JSON.stringify({
        records: [{
          fields: { title: 'Open Mic Night', startDate: day(7), venueName: 'Bellwater Hall' },
          imageUrl: poster,
          confidence: 0.9,
          suggestedDecision: 'approve',
          suggestedDecisionReason: 'A public listing with its own date and venue.',
        }],
      }),
      usage_metadata: { input_tokens: 700, output_tokens: 90 },
    });

    await run(context({ document: { ...document, metadata: { ...document.metadata, images: [poster] } } }));

    const runs = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const card = runs.find(row => (row.input as { title?: string }).title === 'Open Mic Night');

    expect((card?.input as { imageUrl?: string }).imageUrl).toBe(poster);
  });

  it('drops a link field that points at the page it was read from', async () => {
    const linked = candidateExtractorConfigSchema.parse({ ...config, linkFields: ['ticketUrl'] });
    const own = `${document.uri}#tickets`;
    invoke.mockResolvedValue({
      content: JSON.stringify({ records: [{ fields: { title: 'Open Mic Night', startDate: day(3), venueName: 'Bellwater Hall', ticketUrl: own }, confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: 'listed' }] }),
      usage_metadata: { input_tokens: 900, output_tokens: 120 },
    });

    const result = await run(context({ config: linked, document: { ...document, metadata: { ...document.metadata, links: [...document.metadata.links, { url: own, text: 'Tickets' }] } } }));

    expect(result.produced).toBe(1);

    const rows = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const event = rows.find(row => (row.input as { objectType?: string }).objectType === 'event-candidate');

    expect((event?.input as { fields?: Record<string, unknown> })?.fields?.ticketUrl).toBeUndefined();
    expect(String((event?.input as { extractionNotes?: string })?.extractionNotes)).toContain('ticketUrl: dropped, it is the page itself');
  });

  it('drops a link field that is a split entry\'s own page', async () => {
    const linked = candidateExtractorConfigSchema.parse({ ...config, linkFields: ['ticketUrl'] });
    const page = 'https://venue.test/events/opening/';
    const entry = {
      externalId: 'https://venue.test/events.ics#evt-31@venue.test',
      uri: 'https://venue.test/events.ics#evt-31@venue.test',
      title: 'Opening Night',
      content: `BEGIN:VEVENT\nSUMMARY:Opening Night\nURL:${page}\nEND:VEVENT`,
      metadata: { contentType: 'text/calendar', feedUrl: 'https://venue.test/events.ics', publishedUrls: [page], entryUrl: page },
    };
    invoke.mockResolvedValue({
      content: JSON.stringify({ records: [{ fields: { title: 'Opening Night', startDate: day(3), venueName: 'Bellwater Hall', ticketUrl: page }, confidence: 0.9, suggestedDecision: 'approve', suggestedDecisionReason: 'listed' }] }),
      usage_metadata: { input_tokens: 900, output_tokens: 120 },
    });

    const result = await run(context({ config: linked, document: entry }));

    expect(result.produced).toBe(1);

    const rows = await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG));
    const event = rows.find(row => (row.input as { objectType?: string }).objectType === 'event-candidate');

    expect((event?.input as { fields?: Record<string, unknown> })?.fields?.ticketUrl).toBeUndefined();
    expect(String((event?.input as { extractionNotes?: string })?.extractionNotes)).toContain('ticketUrl: dropped, it is the entry\'s own page');
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

  describe('a repeating calendar entry', () => {
    const feedUrl = 'https://bellwaterhall.example/feed.ics';
    const compact = (d: string) => d.replaceAll('-', '');
    const entry = (lines: string[], metadata: Record<string, unknown> = {}) => ({
      ...document,
      externalId: `${feedUrl}#weekly@bellwaterhall.example`,
      uri: `${feedUrl}#weekly@bellwaterhall.example`,
      content: ['BEGIN:VEVENT', 'UID:weekly@bellwaterhall.example', 'SUMMARY:Open Mic Night', ...lines, 'END:VEVENT'].join('\n'),
      metadata: { contentType: 'text/calendar; charset=utf-8', feedUrl, calendarZone: 'America/New_York', ...metadata },
    });
    const weeklyAt23 = [`DTSTART:${compact(day(-7))}T230000Z`, 'RRULE:FREQ=WEEKLY'];
    const at23 = (offset: number, zone = 'America/New_York') => isoInZone(new Date(`${day(offset)}T23:00:00Z`), zone);
    const human = () => String((invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>)[1]?.content);
    const block = () => human().slice(human().indexOf('<occurrences>\n') + 14, human().indexOf('\n</occurrences>')).split('\n');

    it('gets an occurrences block of its dates inside the horizon, none before today', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry(weeklyAt23) }));

      expect(human()).toContain('<occurrences>');
      expect(human()).toContain(at23(0));
      expect(human()).not.toContain(`${day(-7)}T`);
    });

    it('leaves out an instance the feed writes as a component of its own', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry(weeklyAt23, { overridden: [`${compact(day(7))}T230000Z`] }) }));

      expect(block()).toContain(at23(0));
      expect(block()).not.toContain(at23(7));
      expect(block()).toContain(at23(14));
    });

    it('leaves out an instance overridden in the local form a zoned series writes', async () => {
      invoke.mockResolvedValue(answer());
      const at19 = (offset: number) => isoInZone(instantInZone(`${day(offset)}T19:00:00`, 'America/New_York'), 'America/New_York');

      await run(context({ document: entry([`DTSTART;TZID=America/New_York:${compact(day(-7))}T190000`, 'RRULE:FREQ=WEEKLY'], { overridden: [`${compact(day(7))}T190000`] }) }));

      expect(block()).toContain(at19(0));
      expect(block()).not.toContain(at19(7));
      expect(block()).toContain(at19(14));
    });

    it('leaves out an instance overridden as a date on an all-day series', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry([`DTSTART;VALUE=DATE:${compact(day(-7))}`, 'RRULE:FREQ=WEEKLY'], { overridden: [compact(day(7))] }) }));

      expect(block()).toContain(day(0));
      expect(block()).not.toContain(day(7));
      expect(block()).toContain(day(14));
    });

    it('reads the dates when the stored overrides are not a list', async () => {
      invoke.mockResolvedValue(answer());

      await expect(run(context({ document: entry(weeklyAt23, { overridden: `${compact(day(7))}T230000Z` }) }))).resolves.toBeDefined();

      expect(block()).toContain(at23(7));
    });

    it('writes an all-day entry\'s dates as calendar days', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry([`DTSTART;VALUE=DATE:${compact(day(-7))}`, 'RRULE:FREQ=WEEKLY']) }));

      expect(block()).toContain(day(0));
      expect(block().every(line => /^\d{4}-\d{2}-\d{2}$/.test(line))).toBe(true);
    });

    it('gets the dates of a monthly rule on a placed weekday', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry([`DTSTART;TZID=America/New_York:${compact(day(-40))}T190000`, 'RRULE:FREQ=MONTHLY;BYDAY=1TU']) }));
      const days = block().map(line => line.slice(0, 10));

      expect(days.length).toBeGreaterThan(0);
      expect(days.every(d => Number(d.slice(8)) <= 7 && new Date(`${d}T00:00:00Z`).getUTCDay() === 2)).toBe(true);
    });

    it('falls back to the configured zone when the stored calendar zone is not one', async () => {
      invoke.mockResolvedValue(answer());

      await run(context({ document: entry(weeklyAt23, { calendarZone: 'Nowhere/Special' }) }));

      expect(block()).toContain(at23(0, 'America/New_York'));
    });

    describe('says when its reading goes stale', () => {
      const NY = 'America/New_York';
      const onDay = (offset: number) => dayPlus(calendarToday(config.timezone), offset);
      const at19 = (offset: number) => `DTSTART;TZID=America/New_York:${compact(onDay(offset))}T190000`;
      const dayStart = (offset: number) => startOfDay(onDay(offset), NY);

      it('half a horizon on, for a weekly entry that keeps coming inside it', async () => {
        invoke.mockResolvedValue(answer());

        const result = await run(context({ document: entry([at19(-7), 'RRULE:FREQ=WEEKLY']) }));

        expect(result.revisitAt).toEqual(dayStart(30));
      });

      it('on the day its next date past the horizon comes inside it, when that is later', async () => {
        invoke.mockResolvedValue(answer());

        const result = await run(context({ document: entry([at19(0), 'RRULE:FREQ=WEEKLY;INTERVAL=13']) }));

        expect(result.revisitAt).toEqual(dayStart(91 - 60));
      });

      it('for a series whose first date is past the horizon', async () => {
        invoke.mockResolvedValue(answer());

        const result = await run(context({ document: entry([at19(100), 'RRULE:FREQ=WEEKLY']) }));

        expect(result.revisitAt).toEqual(dayStart(40));
      });

      it('skipping a date the feed writes as a component of its own', async () => {
        invoke.mockResolvedValue(answer());

        const result = await run(context({ document: entry([at19(0), 'RRULE:FREQ=WEEKLY;INTERVAL=13'], { overridden: [`${compact(onDay(91))}T190000`] }) }));

        expect(result.revisitAt).toEqual(dayStart(182 - 60));
      });

      it('never, for a series with nothing left past the horizon', async () => {
        invoke.mockResolvedValue(answer());

        for (const rule of [`RRULE:FREQ=WEEKLY;UNTIL=${compact(onDay(-1))}`, 'RRULE:FREQ=WEEKLY;COUNT=5', `RRULE:FREQ=WEEKLY;UNTIL=${compact(onDay(20))}`]) {
          const result = await run(context({ document: entry([at19(-70), rule]) }));

          expect(result).not.toHaveProperty('revisitAt');
        }
      });

      it('never, for a one-off entry or a page that is not a calendar entry', async () => {
        invoke.mockResolvedValue(answer());

        const oneOff = await run(context({ document: entry([at19(3)]) }));
        const page = await run(context());

        expect(oneOff).not.toHaveProperty('revisitAt');
        expect(page).not.toHaveProperty('revisitAt');
      });

      it('on the calendar\'s day, from the start of the run\'s own day, when the calendar\'s zone is ahead', async () => {
        invoke.mockResolvedValue(answer());
        const inAuckland = [`DTSTART;TZID=Pacific/Auckland:${compact(onDay(0))}T090000`, 'RRULE:FREQ=WEEKLY;INTERVAL=13'];

        const result = await run(context({ document: entry(inAuckland, { calendarZone: 'Pacific/Auckland' }) }));

        expect(result.revisitAt).toEqual(dayStart(91 - 60));
      });

      it('ten years on, for an interval longer than the search that has no end', async () => {
        invoke.mockResolvedValue(answer());

        const result = await run(context({ document: entry([at19(0), 'RRULE:FREQ=WEEKLY;INTERVAL=1000']) }));

        expect(result.revisitAt).toEqual(dayStart(3653));
      });

      it('a day on at the soonest, when the horizon is a single day', async () => {
        invoke.mockResolvedValue(answer());
        const short = candidateExtractorConfigSchema.parse({ ...config, recurrenceHorizonDays: 1 });

        const weekly = await run(context({ config: short, document: entry([at19(-7), 'RRULE:FREQ=WEEKLY']) }));
        const monthly = await run(context({ config: short, document: entry([at19(-7), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15']) }));

        expect(weekly.revisitAt).toEqual(dayStart(7 - 1));
        expect(monthly.revisitAt).toEqual(dayStart(1));
      });

      it('half a horizon on, for a rule the expander does not read, until it has plainly ended', async () => {
        invoke.mockResolvedValue(answer());
        const revisitFor = async (lines: string[]) => (await run(context({ document: entry(lines) }))).revisitAt;

        expect(await revisitFor([at19(-40), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15'])).toEqual(dayStart(30));
        expect(await revisitFor([at19(-40), 'RRULE:FREQ=YEARLY'])).toEqual(dayStart(30));
        expect(await revisitFor([at19(-40), `RRULE:FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=${compact(onDay(20))}`])).toEqual(dayStart(30));
        expect(await revisitFor([at19(-40), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3'])).toEqual(dayStart(30));
        expect(await revisitFor([at19(-40), `RRULE:FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=${compact(onDay(-1))}`])).toBeUndefined();
        expect(await revisitFor([at19(-400), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3'])).toBeUndefined();
      });

      it('reads a floating UNTIL, which the expander refuses, by its day', async () => {
        invoke.mockResolvedValue(answer());
        const revisitFor = async (until: string) => (await run(context({ document: entry([at19(-40), `RRULE:FREQ=WEEKLY;UNTIL=${until}`]) }))).revisitAt;

        expect(await revisitFor(`${compact(onDay(400))}T235959`)).toEqual(dayStart(30));
        expect(await revisitFor(`${compact(onDay(-1))}T235959`)).toBeUndefined();
      });

      it('half a horizon on, for an entry with a rule of its own that the reader gives up on', async () => {
        invoke.mockResolvedValue(answer());

        const excluded = await run(context({ document: entry([at19(-7), 'RRULE:FREQ=WEEKLY', 'EXRULE:FREQ=WEEKLY;INTERVAL=2']) }));
        const twice = await run(context({ document: entry([at19(-7), 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'RRULE:FREQ=WEEKLY;BYDAY=TH']) }));
        const ended = await run(context({ document: entry([at19(-70), `RRULE:FREQ=WEEKLY;UNTIL=${compact(onDay(-2))}`, 'EXRULE:FREQ=WEEKLY;INTERVAL=2']) }));

        expect(excluded.revisitAt).toEqual(dayStart(30));
        expect(twice.revisitAt).toEqual(dayStart(30));
        expect(ended).not.toHaveProperty('revisitAt');
      });

      it('even when the model answer is unusable, which still counts as finished', async () => {
        invoke.mockResolvedValue({ content: 'I could not read that page.' });

        const result = await run(context({ document: entry([at19(-7), 'RRULE:FREQ=WEEKLY']) }));

        expect(result.counts).toMatchObject({ model_invalid: 1 });
        expect(result.retry).toBeUndefined();
        expect(result.revisitAt).toEqual(dayStart(30));
      });
    });

    it('gets no block unless it is a split calendar component', async () => {
      invoke.mockResolvedValue(answer());
      const whole = entry(weeklyAt23);
      whole.content = `BEGIN:VCALENDAR\n${whole.content}\nEND:VCALENDAR`;
      const page = entry(weeklyAt23);
      delete (page.metadata as { feedUrl?: string }).feedUrl;

      await run(context({ document: whole }));
      await run(context({ document: page }));

      for (const call of invoke.mock.calls) {
        expect(String((call[0] as Array<{ content: unknown }>)[1]?.content)).not.toContain('<occurrences>');
      }

      expect(invoke).toHaveBeenCalledTimes(2);
    });
  });

  describe('a series written from its rule, under occurrenceFields', () => {
    const NY = 'America/New_York';
    const knob = candidateExtractorConfigSchema.parse({ ...config, occurrenceFields: { day: 'startDate', start: 'start', end: 'end' } });
    const onDay = (offset: number) => dayPlus(calendarToday(config.timezone), offset);
    const compact = (d: string) => d.replaceAll('-', '');
    const human = () => String((invoke.mock.calls[0]?.[0] as Array<{ content: unknown }>)[1]?.content);
    const weekly = { rule: 'FREQ=WEEKLY', evidence: 'every Thursday' };
    const reply = (records: Array<Record<string, unknown>>) => ({ content: JSON.stringify({ records }), usage_metadata: { input_tokens: 900, output_tokens: 120 } });
    const openMic = (offset: number, over: Record<string, unknown> = {}) => {
      const { fields, ...rest } = over as { fields?: Record<string, unknown> };
      return {
        fields: { title: 'Open Mic Night', startDate: onDay(offset), start: `${onDay(offset)}T20:00`, end: `${onDay(offset)}T22:00`, venueName: 'Bellwater Hall', recurrence: 'every Thursday', price: 'Free', ...fields },
        confidence: 0.9,
        suggestedDecision: 'approve',
        suggestedDecisionReason: 'A public weekly listing.',
        ...rest,
      };
    };
    const events = async () => (await db.select().from(actionRunSchema).where(eq(actionRunSchema.orgId, ORG)))
      .map(row => row.input as { objectType?: string; fields: Record<string, unknown>; extractionNotes?: string })
      .filter(input => input.objectType === 'event-candidate')
      .sort((a, b) => String(a.fields.startDate).localeCompare(String(b.fields.startDate)));
    const onDays = (...offsets: number[]) => offsets.map(onDay);
    const feedUrl = 'https://bellwaterhall.example/feed.ics';
    const entry = (lines: string[], metadata: Record<string, unknown> = {}) => ({
      ...document,
      externalId: `${feedUrl}#weekly@bellwaterhall.example`,
      uri: `${feedUrl}#weekly@bellwaterhall.example`,
      content: ['BEGIN:VEVENT', 'UID:weekly@bellwaterhall.example', 'SUMMARY:Open Mic Night', ...lines, 'END:VEVENT'].join('\n'),
      metadata: { contentType: 'text/calendar; charset=utf-8', feedUrl, calendarZone: NY, ...metadata },
    });
    const at19 = (offset: number) => `DTSTART;TZID=America/New_York:${compact(onDay(offset))}T190000`;
    const feedRecord = (offset: number) => openMic(offset, { fields: { start: `${onDay(offset)}T19:00:00`, end: `${onDay(offset)}T20:00:00`, price: undefined } });

    it('writes one record per occurrence inside the horizon from a rule the page states, in the template\'s own shape', async () => {
      invoke.mockResolvedValue(reply([openMic(2, { repeats: weekly })]));

      const result = await run(context({ config: knob }));
      const cards = await events();

      expect(cards.map(card => card.fields.startDate)).toEqual(onDays(2, 9, 16, 23, 30, 37, 44, 51, 58));
      expect(cards[1]!.fields).toMatchObject({ start: `${onDay(9)}T20:00`, end: `${onDay(9)}T22:00`, price: 'Free', recurrence: 'every Thursday' });
      expect(cards[1]!.extractionNotes).toContain('date computed from the stated rule: every Thursday');
      expect(cards[0]!.extractionNotes ?? '').not.toContain('date computed');
      expect(result.counts).toMatchObject({ found: 9, expanded: 8, proposed: 9 });
      expect(result.produced).toBe(9);
      expect(result.skipped).toBe(0);
    });

    it('leaves a record single, and says why, when a guard refuses its rule', async () => {
      const weekdayOf = (day: string) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'][new Date(`${day}T00:00:00Z`).getUTCDay()];
      invoke.mockResolvedValue(reply([
        openMic(2, { fields: { title: 'Quiz Night' }, repeats: { rule: 'FREQ=WEEKLY', evidence: 'every second Sunday' } }),
        openMic(2, { fields: { title: 'Story Hour' }, repeats: { rule: 'FREQ=YEARLY', evidence: 'every Thursday' } }),
        openMic(2, { fields: { title: 'Craft Club' }, repeats: { rule: 'FREQ=WEEKLY;COUNT=4', evidence: 'every Thursday' } }),
        openMic(2, { fields: { title: 'Chess Club' }, repeats: { rule: `FREQ=WEEKLY;BYDAY=${weekdayOf(onDay(3))}`, evidence: 'every Thursday' } }),
      ]));

      const result = await run(context({ config: knob }));
      const cards = await events();

      expect(cards.map(card => card.fields.title).sort()).toEqual(['Chess Club', 'Craft Club', 'Quiz Night', 'Story Hour']);
      expect(result.counts).toMatchObject({ 'expansion.evidence_not_in_document': 1, 'expansion.rule_unread': 1, 'expansion.rule_counts': 1, 'expansion.anchor_not_in_rule': 1 });
      expect(result.counts).not.toHaveProperty('expanded');
      expect(cards.every(card => card.extractionNotes?.includes('only this date was proposed'))).toBe(true);
    });

    it('keeps one card for an occurrence the model returned with an offset', async () => {
      const utc = (offset: number) => instantInZone(`${onDay(offset)}T21:00:00`, NY).toISOString();
      invoke.mockResolvedValue(reply([
        openMic(2, { fields: { startDate: utc(2), start: utc(2), end: undefined }, repeats: weekly }),
        openMic(9, { fields: { startDate: utc(9), start: utc(9), end: undefined } }),
      ]));

      const result = await run(context({ config: knob }));
      const ninth = (await events()).filter(card => calendarDayOf(card.fields.startDate, NY) === onDay(9));

      expect(ninth).toHaveLength(1);
      expect(result.counts).toMatchObject({ 'expansion.held': 1 });
    });

    it('keeps the model\'s own record for a date it already returned, even with collapsing off', async () => {
      const loose = candidateExtractorConfigSchema.parse({ ...knob, collapseWithinDocument: false });
      invoke.mockResolvedValue(reply([openMic(2, { repeats: weekly }), openMic(9, { fields: { start: `${onDay(9)}T19:30` } })]));

      const result = await run(context({ config: loose }));
      const cards = await events();

      expect(cards.map(card => card.fields.startDate)).toEqual(onDays(2, 9, 16, 23, 30, 37, 44, 51, 58));
      expect(cards[1]!.fields.start).toBe(`${onDay(9)}T19:30`);
      expect(cards[1]!.extractionNotes ?? '').not.toContain('date computed');
      expect(result.counts).toMatchObject({ 'expansion.held': 1, 'expanded': 7, 'found': 9 });
    });

    it('trims what it wrote, rather than refusing the answer, at the document\'s record limit', async () => {
      const small = candidateExtractorConfigSchema.parse({ ...knob, maxRecordsPerDocument: 3 });
      invoke.mockResolvedValue(reply([openMic(2, { repeats: weekly })]));

      const result = await run(context({ config: small }));

      expect((await events()).map(card => card.fields.startDate)).toEqual(onDays(2, 9, 16));
      expect(result.counts).toMatchObject({ 'expanded': 2, 'expansion.trimmed': 6 });
      expect(result.notes?.join(' ')).toContain('6 occurrence(s) past the document\'s limit of 3 records were left out');
    });

    it('reads the page again soon when it left occurrences out at the limit', async () => {
      const small = candidateExtractorConfigSchema.parse({ ...knob, maxRecordsPerDocument: 3 });
      invoke.mockResolvedValue(reply([openMic(2, { repeats: { rule: `FREQ=WEEKLY;UNTIL=${compact(onDay(40))}`, evidence: 'every Thursday' } })]));

      const result = await run(context({ config: small }));

      expect(result.counts).toMatchObject({ 'expansion.trimmed': 3 });
      expect(result.revisitAt).toEqual(startOfDay(onDay(30), NY));
    });

    it('says when a page that states a rule goes stale', async () => {
      const dayStart = (offset: number) => startOfDay(onDay(offset), NY);
      const revisitFor = async (rule: string) => {
        invoke.mockResolvedValue(reply([openMic(2, { repeats: { rule, evidence: 'every Thursday' } })]));
        return (await run(context({ config: knob }))).revisitAt;
      };

      expect(await revisitFor('FREQ=WEEKLY')).toEqual(dayStart(30));
      expect(await revisitFor('FREQ=WEEKLY;INTERVAL=13')).toEqual(dayStart(93 - 60));
      expect(await revisitFor(`FREQ=WEEKLY;UNTIL=${compact(onDay(40))}`)).toBeUndefined();
      expect(await revisitFor('FREQ=YEARLY')).toBeUndefined();
    });

    describe('on a split calendar entry', () => {
      it('writes the feed\'s own dates and times, and drops a record on a day the rule does not produce', async () => {
        invoke.mockResolvedValue(reply([feedRecord(0), feedRecord(3), feedRecord(7)]));

        const result = await run(context({ config: knob, document: entry([at19(-7), `DTEND;TZID=America/New_York:${compact(onDay(-7))}T210000`, 'RRULE:FREQ=WEEKLY']) }));
        const cards = await events();

        expect(cards.map(card => card.fields.startDate)).toEqual(onDays(0, 7, 14, 21, 28, 35, 42, 49, 56));
        expect(cards[2]!.fields).toMatchObject({ start: `${onDay(14)}T19:00:00`, end: `${onDay(14)}T21:00:00` });
        expect(cards.every(card => card.extractionNotes?.includes('date computed from the rule of the calendar entry: RRULE:FREQ=WEEKLY'))).toBe(true);
        expect(result.counts).toMatchObject({ 'skipped.not_in_rule': 1, 'expansion.replaced': 2, 'expanded': 9, 'found': 10 });
        expect(result.produced).toBe(9);
        expect(result.skipped).toBe(1);
      });

      it('replaces the list of dates with one line naming the next, after the shared opening', async () => {
        invoke.mockResolvedValue(reply([feedRecord(0)]));

        await run(context({ config: knob, document: entry([at19(-7), 'RRULE:FREQ=WEEKLY']) }));

        expect(human()).not.toContain('<occurrences>');
        expect(human()).toContain(`This entry repeats; its next date is ${isoInZone(instantInZone(`${onDay(0)}T19:00:00`, NY), NY)}.`);
        expect(human().indexOf('This entry repeats')).toBeGreaterThan(human().indexOf('<<<DOCUMENT>>>'));
      });

      it('leaves out an instance the feed writes as a component of its own', async () => {
        invoke.mockResolvedValue(reply([feedRecord(0), feedRecord(7)]));

        const result = await run(context({ config: knob, document: entry([at19(-7), 'RRULE:FREQ=WEEKLY'], { overridden: [`${compact(onDay(7))}T190000`] }) }));

        expect((await events()).map(card => card.fields.startDate)).toEqual(onDays(0, 14, 21, 28, 35, 42, 49, 56));
        expect(result.counts).toMatchObject({ 'skipped.not_in_rule': 1, 'expansion.replaced': 1 });
      });

      it('ends each occurrence by the entry\'s DURATION', async () => {
        invoke.mockResolvedValue(reply([feedRecord(0)]));

        await run(context({ config: knob, document: entry([at19(-7), 'DURATION:PT90M', 'RRULE:FREQ=WEEKLY']) }));

        expect((await events())[1]!.fields).toMatchObject({ start: `${onDay(7)}T19:00:00`, end: `${onDay(7)}T20:30:00` });
      });

      it('leaves a rule it does not read to the model, with no hint and nothing dropped', async () => {
        invoke.mockResolvedValue(reply([feedRecord(3), feedRecord(10)]));

        const result = await run(context({ config: knob, document: entry([at19(-40), 'RRULE:FREQ=MONTHLY;BYMONTHDAY=15']) }));

        expect((await events()).map(card => card.fields.startDate)).toEqual(onDays(3, 10));
        expect(human()).not.toContain('This entry repeats');
        expect(human()).not.toContain('<occurrences>');
        expect(result.counts).not.toHaveProperty('skipped.not_in_rule');
        expect(result.counts).toMatchObject({ 'expansion.feed_rule_unread': 1 });
      });

      it('leaves an entry whose exceptions it cannot read to the model, never to a rule the model stated', async () => {
        invoke.mockResolvedValue(reply([openMic(0, { fields: { start: `${onDay(0)}T19:00:00`, price: undefined }, repeats: { rule: 'FREQ=WEEKLY', evidence: 'RRULE:FREQ=WEEKLY' } }), feedRecord(14)]));

        const result = await run(context({ config: knob, document: entry([at19(-7), 'RRULE:FREQ=WEEKLY', `EXDATE;VALUE=DATE:${compact(onDay(7))}`]) }));

        expect((await events()).map(card => card.fields.startDate)).toEqual(onDays(0, 14));
        expect(result.counts).toMatchObject({ 'expansion.feed_rule_unread': 1 });
        expect(result.counts).not.toHaveProperty('expanded');
        expect(human()).not.toContain('This entry repeats');
      });

      it('writes floating times in the configured zone, whatever zone the calendar declares', async () => {
        invoke.mockResolvedValue(reply([openMic(0, { fields: { start: `${onDay(0)}T21:00:00`, end: `${onDay(0)}T23:00:00`, price: undefined } })]));
        const at21 = `DTSTART;TZID=America/New_York:${compact(onDay(-7))}T210000`;

        const result = await run(context({ config: knob, document: entry([at21, 'RRULE:FREQ=WEEKLY'], { calendarZone: 'UTC' }) }));
        const cards = await events();

        expect(cards.map(card => card.fields.startDate)).toEqual(onDays(0, 7, 14, 21, 28, 35, 42, 49, 56));
        expect(cards[1]!.fields).toMatchObject({ start: `${onDay(7)}T21:00:00`, end: `${onDay(7)}T23:00:00` });
        expect(result.counts).toMatchObject({ 'expansion.replaced': 1 });
        expect(result.counts).not.toHaveProperty('skipped.not_in_rule');
        expect(human()).toContain(`This entry repeats; its next date is ${isoInZone(instantInZone(`${onDay(0)}T21:00:00`, NY), NY)}.`);
      });

      it('keeps the list of dates, and no hint, for a source that does not opt in', async () => {
        invoke.mockResolvedValue(reply([feedRecord(0)]));

        await run(context({ document: entry([at19(-7), 'RRULE:FREQ=WEEKLY']) }));

        expect(human()).toContain('<occurrences>');
        expect(human()).not.toContain('This entry repeats');
      });
    });
  });
});
