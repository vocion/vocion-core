/**
 * The knobs, one test each.
 *
 * Every rule here was written as a tenant rule first ("drop past events",
 * "categories from the enum", "never guess a price") and had to become a
 * domain-neutral configuration value, because a tenant cannot run code inside
 * core's processor. These tests are what says the translation is faithful.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { calendarDayOf } from '@/libs/time/relativeDay';
import { candidateExtractorConfigSchema } from './config';
import { calendarToday, validateRecords } from './validate';

const TODAY = '2026-11-10';

function configWith(over: Record<string, unknown> = {}) {
  return candidateExtractorConfigSchema.parse({
    objectType: 'event-candidate',
    agentSlug: 'event-ingestion-lead',
    dedupOn: ['title', 'startDate', 'venueName'],
    titleFrom: 'title',
    promptFragment: 'Only public events.',
    timezone: 'America/New_York',
    ...over,
  });
}

function record(over: Record<string, unknown> = {}) {
  const { fields, ...rest } = over as { fields?: Record<string, unknown> };
  return {
    fields: {
      title: 'Open Mic Night',
      startDate: '2026-11-12',
      venueName: 'Bellwater Hall',
      ...fields,
    },
    confidence: 0.9,
    // Required of every extracted record now, so the builder states it and a
    // test that cares overrides it.
    suggestedDecision: 'approve' as const,
    suggestedDecisionReason: 'Public listing with a date and a venue.',
    ...rest,
  };
}

function run(records: ReturnType<typeof record>[], config = configWith(), over: Record<string, unknown> = {}) {
  return validateRecords({
    records,
    config,
    pageText: 'Open Mic Night, Thursday 12 November, doors at 7. Tickets $12.',
    knownIds: new Set<number>(),
    today: TODAY,
    ...over,
  });
}

describe('candidate extractor validation', () => {
  const none = { title: undefined, startDate: undefined, venueName: undefined };

  it('blesses a link the document published as a path', () => {
    // A JSON feed states an entry's own page relatively. The connector resolves
    // it before declaring it, because the gate compares exactly, but the model
    // reads the raw entry and hands the path straight back.
    const out = run([record({ sourceUrl: '/events/unruly-allies' })], configWith(), {
      publishedUrls: ['https://www.vtciderlab.com/events/unruly-allies'],
      baseUrl: 'https://www.vtciderlab.com/events?format=json-pretty',
    });

    expect(out.records[0]?.sourceUrl).toBe('https://www.vtciderlab.com/events/unruly-allies');
  });

  it('still refuses a path the document never published', () => {
    const out = run([record({ sourceUrl: '/events/invented-by-the-model' })], configWith(), {
      publishedUrls: ['https://www.vtciderlab.com/events/unruly-allies'],
      baseUrl: 'https://www.vtciderlab.com/events?format=json-pretty',
    });

    expect(out.records[0]?.sourceUrl).toBeUndefined();
  });

  it('keeps refusing a path when the document gave no base to resolve against', () => {
    const out = run([record({ sourceUrl: '/events/unruly-allies' })], configWith(), {
      publishedUrls: ['https://www.vtciderlab.com/events/unruly-allies'],
    });

    expect(out.records[0]?.sourceUrl).toBeUndefined();
  });

  it('fills in the source defaults before it checks the identity', () => {
    const config = configWith({ defaults: { venueName: 'Bellwater Hall', venueCity: 'Riverton' } });

    const out = run([record({ fields: { venueName: '' } })], config);

    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.fields.venueName).toBe('Bellwater Hall');
    expect(out.records[0]?.fields.venueCity).toBe('Riverton');
  });

  it('drops a record the model was not sure enough about', () => {
    const out = run([record({ confidence: 0.3 })]);

    expect(out.records).toHaveLength(0);
    expect(out.counts['skipped.below_confidence']).toBe(1);
  });

  it('drops a record whose identity is incomplete', () => {
    const out = run([record({ fields: { startDate: '' } })]);

    expect(out.records).toHaveLength(0);
    expect(out.counts['skipped.incomplete']).toBe(1);
  });

  it('counts a record with no fields apart from one missing an identity value', () => {
    const out = run([
      record({ fields: none, suggestedDecision: 'snooze', suggestedDecisionReason: 'no time specified' }),
      record({ fields: { ...none, title: '  ' }, suggestedDecision: 'reject', suggestedDecisionReason: 'past' }),
      record({ fields: { startDate: undefined } }),
    ]);

    expect(out.records).toHaveLength(0);
    expect(out.counts['skipped.no_identity']).toBe(2);
    expect(out.counts['skipped.incomplete']).toBe(1);
  });

  it('counts a record with no fields even when a default would fill one of them', () => {
    const out = run([record({ fields: none })], configWith({ defaults: { venueName: 'Bellwater Hall' } }));

    expect(out.records).toHaveLength(0);
    expect(out.counts['skipped.no_identity']).toBe(1);
    expect(out.counts['skipped.incomplete']).toBeUndefined();
  });

  it('drops a past record by calendar day, and keeps a multi-day one still running', () => {
    const config = configWith({ dropIfPast: { field: 'startDate', keepIfField: 'end' } });

    const out = run([
      record({ fields: { startDate: '2026-11-01' } }),
      record({ fields: { title: 'Winter Market', startDate: '2026-11-01', end: '2026-11-30' } }),
    ], config);

    expect(out.counts['skipped.past']).toBe(1);
    expect(out.records.map(kept => kept.fields.title)).toEqual(['Winter Market']);
  });

  it('drops a series occurrence past the horizon, and keeps a one-off however far ahead', () => {
    const config = configWith({
      recurrenceHorizonDays: 60,
      seriesLabel: { sameOn: ['title', 'venueName'], differsOn: 'startDate', evidenceField: 'recurrence', flagField: 'seriesMatch' },
    });

    const out = run([
      record({ fields: { startDate: '2027-01-12', recurrence: 'every second Tuesday' } }),
      record({ fields: { title: 'New Year Gala', startDate: '2027-01-12' } }),
      record({ fields: { startDate: '2026-12-08', recurrence: 'every second Tuesday' } }),
    ], config);

    expect(out.counts['skipped.beyond_horizon']).toBe(1);
    expect(out.records.map(kept => `${kept.fields.title} ${kept.fields.startDate}`)).toEqual(['New Year Gala 2027-01-12', 'Open Mic Night 2026-12-08']);
  });

  it('keeps a series occurrence on the last day of the horizon and drops the day after', () => {
    const config = configWith({
      recurrenceHorizonDays: 60,
      seriesLabel: { sameOn: ['title', 'venueName'], differsOn: 'startDate', evidenceField: 'recurrence', flagField: 'seriesMatch' },
    });

    const out = run([
      record({ fields: { startDate: '2027-01-09', recurrence: 'every Saturday' } }),
      record({ fields: { startDate: '2027-01-10', recurrence: 'every Saturday' } }),
    ], config);

    expect(out.records.map(kept => kept.fields.startDate)).toEqual(['2027-01-09']);
  });

  it('keeps every series occurrence when no series evidence field is configured', () => {
    const out = run([record({ fields: { startDate: '2027-06-08', recurrence: 'every second Tuesday' } })]);

    expect(out.records).toHaveLength(1);
  });

  it('notes a quoted field the document does not print as written, and keeps the value', () => {
    const config = configWith({ quotedFields: ['price'] });

    const out = run([
      record({ fields: { price: '$10 to $12' } }),
      record({ fields: { title: 'Late Set', price: 'Tickets $12' } }),
    ], config);

    expect(out.records[0]?.fields.price).toBe('$10 to $12');
    expect(out.records[0]?.issues.join(' ')).toContain('price: "$10 to $12" is not written this way in the document');
    expect(out.records[1]?.issues).toEqual([]);
  });

  it('does not note a quoted value the operator supplied, or one the document only escaped', () => {
    const defaulted = run([record()], configWith({ quotedFields: ['price'], defaults: { price: 'Free' } }));

    expect(defaulted.records[0]?.issues).toEqual([]);

    const escaped = run(
      [record({ fields: { price: '$15, $20 at the door' } }), record({ fields: { title: 'Late Set', price: '"VIP" $30' } })],
      configWith({ quotedFields: ['price'] }),
      { pageText: `DESCRIPTION:Tickets $15\\, $20 at the door\n${JSON.stringify({ tier: '"VIP" $30' })}` },
    );

    expect(escaped.records.map(kept => kept.issues)).toEqual([[], []]);
  });

  it('undoes line-break escapes in one pass, so a price printed across lines still matches', () => {
    const out = run(
      [record({ fields: { price: 'Adults $20 Kids $10' } })],
      configWith({ quotedFields: ['price'] }),
      { pageText: JSON.stringify({ tiers: 'Adults $20\r\nKids $10', path: 'C:\\new' }) },
    );

    expect(out.records[0]?.issues).toEqual([]);
  });

  it('drops an out-of-enum value and keeps the card, noting what went', () => {
    const config = configWith({ allowedValues: { categories: ['Music', 'Comedy'] } });

    const out = run([record({ fields: { categories: ['Music', 'Interpretive Dance'] } })], config);

    expect(out.records[0]?.fields.categories).toEqual(['Music']);
    expect(out.records[0]?.issues.join(' ')).toContain('categories');
    expect(out.counts['skipped.bad_category']).toBe(1);
  });

  it('drops the whole record instead when the config says so', () => {
    const config = configWith({ allowedValues: { categories: ['Music'] }, onViolation: 'dropRecord' });

    const out = run([record({ fields: { categories: ['Interpretive Dance'] } })], config);

    expect(out.records).toHaveLength(0);
    expect(out.counts['skipped.bad_category']).toBe(1);
  });

  it('drops a URL the page never published, and keeps the record', () => {
    const out = run([record({ sourceUrl: 'https://evil.example/pwn', imageUrl: 'https://cdn.example/poster.jpg' })], configWith(), {
      links: [{ url: 'https://cdn.example/poster.jpg', text: 'poster' }],
    });

    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.sourceUrl).toBeUndefined();
    expect(out.records[0]?.imageUrl).toBe('https://cdn.example/poster.jpg');
  });

  it('accepts a URL the page published only inside its JSON-LD', () => {
    const out = run([record({ sourceUrl: 'https://bellwaterhall.example/e/open-mic' })], configWith(), {
      jsonLd: [{ '@type': 'Event', 'url': 'https://bellwaterhall.example/e/open-mic' }],
    });

    expect(out.records[0]?.sourceUrl).toBe('https://bellwaterhall.example/e/open-mic');
  });

  it('accepts the URLs a feed entry declared, having no links or JSON-LD of its own', () => {
    // A calendar entry is not HTML, so it parses to no links and no JSON-LD.
    // Without the declared list every URL it really carries fails the gate, and
    // the card reaches a reviewer with no link back and no image.
    const out = run([record({ sourceUrl: 'https://venue.test/e/poster-night', imageUrl: 'https://cdn.venue.test/poster.png' })], configWith(), {
      publishedUrls: ['https://venue.test/e/poster-night', 'https://cdn.venue.test/poster.png'],
    });

    expect(out.records[0]?.sourceUrl).toBe('https://venue.test/e/poster-night');
    expect(out.records[0]?.imageUrl).toBe('https://cdn.venue.test/poster.png');
  });

  it('accepts a folded URL however the model rejoined it, and stores the document\'s spelling', () => {
    // The connector declares the URL joined back up, and a document stored
    // before it joined folds for the model still shows them. Comparing
    // literally would drop exactly the long URLs a fold exists for, so both
    // sides lose whitespace.
    // What is kept is the declared string, never the model's: the stored value
    // becomes the href on a reviewer's card, and a newline in it is a dead
    // link that passed the gate.
    const declared = 'https://venue.test/e/a-title-long-enough-that-the-feed-folded-it';

    for (const asModelReturnedIt of [
      declared,
      'https://venue.test/e/a-title-long-enough-that -the-feed-folded-it',
      'https://venue.test/e/a-title-long-enough-that\n -the-feed-folded-it',
    ]) {
      const out = run([record({ sourceUrl: asModelReturnedIt })], configWith(), { publishedUrls: [declared] });

      expect(out.records[0]?.sourceUrl).toBe(declared);
    }
  });

  it('rewrites an image URL to the document\'s spelling too', () => {
    const declared = 'https://cdn.venue.test/posters/a-very-long-poster-name-that-folded.png';

    const out = run(
      [record({ sourceUrl: declared, imageUrl: `https://cdn.venue.test/posters/a-very-long-poster\n -name-that-folded.png` })],
      configWith(),
      { publishedUrls: [declared] },
    );

    expect(out.records[0]?.imageUrl).toBe(declared);
  });

  it('stores a URL without whitespace even when the document published it with some', () => {
    // RFC 3986 has no whitespace in a URL, so a space in a declared value is an
    // artifact of how the feed wrote the line down. Storing the document's
    // spelling verbatim would hand a reviewer an unclickable link, and letting
    // the last of two declarations that match win would pick which one by
    // accident of order.
    const out = run([record({ sourceUrl: 'https://venue.test/e/a-show' })], configWith(), {
      publishedUrls: ['https://venue.test/e/a-show', 'https://venue.test/e/a-sh ow'],
    });

    expect(out.records[0]?.sourceUrl).toBe('https://venue.test/e/a-show');
  });

  it('ignores a declared list that is not a list of strings', () => {
    // The column is jsonb and the processor casts rather than parses, so a row
    // holding a bare string would otherwise spread character by character into
    // the allowed set, and a number would throw and kill the document.
    for (const wrong of ['https://venue.test/e/one', 42, null, { url: 'x' }]) {
      const out = run([record({ sourceUrl: 'https://venue.test/e/one' })], configWith(), { publishedUrls: wrong });

      expect(out.records[0]?.sourceUrl).toBeUndefined();
    }
  });

  it('still drops a URL no feed entry declared', () => {
    const out = run([record({ sourceUrl: 'https://evil.example/pwn' })], configWith(), {
      publishedUrls: ['https://venue.test/e/poster-night'],
    });

    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.sourceUrl).toBeUndefined();
  });

  it('accepts the image the document published for itself, which is in no link list', () => {
    // A <meta> image is not an <a href>, so `collectLinks` never sees it and
    // the gate used to drop every one a model read off the document's own
    // text, the text `extractFromHtml` opens with that very URL.
    const out = run([record({ imageUrl: 'https://bellwaterhall.example/og-card.png' })], configWith(), {
      ogImage: 'https://bellwaterhall.example/og-card.png',
    });

    expect(out.records[0]?.imageUrl).toBe('https://bellwaterhall.example/og-card.png');
    expect(out.records[0]?.issues).toEqual([]);
  });

  it('fills a missing image from the document\'s own, when the document described one record', () => {
    const out = run([record()], configWith(), { ogImage: 'https://bellwaterhall.example/og-card.png' });

    expect(out.records[0]?.imageUrl).toBe('https://bellwaterhall.example/og-card.png');
    expect(out.records[0]?.issues.join(' ')).toContain('the document published for itself');
    expect(out.counts.image_from_document).toBe(1);
  });

  it('leaves a document that published no image of its own exactly as it was', () => {
    const out = run([record()]);

    expect(out.records[0]?.imageUrl).toBeUndefined();
    expect(out.records[0]?.issues).toEqual([]);
    expect(out.counts.image_from_document).toBeUndefined();
  });

  it('does not stamp the document\'s image on each record of a document that listed several', () => {
    // An og:image describes the DOCUMENT. Where the document lists many
    // records the image is the page's, and putting it on each one would state
    // on every card something the document never said about any of them.
    const out = run([record(), record({ fields: { title: 'Late Show' } })], configWith(), {
      ogImage: 'https://bellwaterhall.example/og-card.png',
    });

    expect(out.records.map(kept => kept.imageUrl)).toEqual([undefined, undefined]);
    expect(out.counts.image_from_document).toBeUndefined();
  });

  it('leaves an image the model read for the record rather than overwriting it', () => {
    const out = run([record({ imageUrl: 'https://cdn.bellwaterhall.example/open-mic.jpg' })], configWith(), {
      links: [{ url: 'https://cdn.bellwaterhall.example/open-mic.jpg', text: 'poster' }],
      ogImage: 'https://bellwaterhall.example/og-card.png',
    });

    expect(out.records[0]?.imageUrl).toBe('https://cdn.bellwaterhall.example/open-mic.jpg');
    expect(out.counts.image_from_document).toBeUndefined();
  });

  it('still drops an invented image, and fills the gap with the one the document published', () => {
    // The gate is not softened by having an og:image to fall back on: the
    // invented URL goes and is reported, and what lands is a value the
    // document itself stated.
    const out = run([record({ imageUrl: 'https://evil.example/pwn.png' })], configWith(), {
      ogImage: 'https://bellwaterhall.example/og-card.png',
    });

    expect(out.records[0]?.imageUrl).toBe('https://bellwaterhall.example/og-card.png');
    expect(out.records[0]?.issues.join(' ')).toContain('the image URL was not published by the document');
  });

  it('ignores a declared image that is not a string', () => {
    // Cast out of a jsonb column, so the type is a claim. A number here would
    // throw inside the gate and take the whole document with it.
    for (const wrong of [42, null, { url: 'x' }, ['https://bellwaterhall.example/og-card.png']]) {
      const out = run([record()], configWith(), { ogImage: wrong });

      expect(out.records[0]?.imageUrl).toBeUndefined();
    }
  });

  it('collapses two records the document listed twice', () => {
    const config = configWith({ collapseWithinDocument: true });

    const out = run([record(), record({ fields: { title: 'OPEN MIC NIGHT' } })], config);

    expect(out.records).toHaveLength(1);
    expect(out.counts.collapsed).toBe(1);
  });

  it('drops a run id the call never carried, notes it, and keeps the record', () => {
    const out = run([record({ seriesOf: 999, duplicateOf: 41 })], configWith(), { knownIds: new Set([41]) });

    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.seriesOf).toBeUndefined();
    expect(out.records[0]?.duplicateOf).toBe(41);
    expect(out.records[0]?.issues.join(' ')).toContain('#999');
    expect(out.counts['skipped.not_in_list']).toBe(1);
  });

  it('drops a series note the model sent without a series id', () => {
    // A note about a series says nothing on a card that claims no series.
    const out = run([record({ seriesNote: 'a Saturday for once' })]);

    expect(out.records).toHaveLength(1);
    expect(out.records[0]?.seriesNote).toBeUndefined();
  });

  it('drops the note when the series id was not in the list this call carried', () => {
    // The order matters: the hallucination guard can clear `seriesOf` itself,
    // so a note checked before it would survive its own id.
    const out = run([record({ seriesOf: 999, seriesNote: 'a Saturday for once' })], configWith(), { knownIds: new Set([41]) });

    expect(out.records[0]?.seriesOf).toBeUndefined();
    expect(out.records[0]?.seriesNote).toBeUndefined();
  });

  it('keeps a note that arrived with an id the call did carry', () => {
    const out = run([record({ seriesOf: 41, seriesNote: 'a Saturday for once' })], configWith(), { knownIds: new Set([41]) });

    expect(out.records[0]?.seriesNote).toBe('a Saturday for once');
  });

  it('reads today as a calendar day in the configured zone', () => {
    // 01:30 UTC on the 11th is still the 10th in New York, which is the whole
    // reason this is not `toISOString().slice(0, 10)`.
    const at = new Date('2026-11-11T01:30:00Z');

    expect(calendarToday('America/New_York', at)).toBe('2026-11-10');
    expect(calendarToday(undefined, at)).toBe('2026-11-11');
  });
});

describe('values the document has to print', () => {
  const priced = configWith({ mustAppearInDocument: ['price'] });

  it('drops a price whose digits the document never printed, naming it', () => {
    const out = run([
      record({ fields: { price: '$12' } }),
      record({ fields: { title: 'Late Show', price: '$45' } }),
    ], priced);

    expect(out.records[0]?.fields.price).toBe('$12');
    expect(out.records[1]?.fields.price).toBeUndefined();
    expect(out.records[1]?.issues).toEqual(['price: dropped "$45", its digits do not appear anywhere in the document']);
    expect(out.counts['dropped.not_in_document']).toBe(1);
  });

  it('drops a price in words the document never printed as a word, naming it', () => {
    const out = run([record({ fields: { price: 'Free' } })], priced, {
      pageText: 'Open Mic Night, 12 November. Poster art from freeform.',
    });

    expect(out.records[0]?.fields.price).toBeUndefined();
    expect(out.records[0]?.issues).toEqual(['price: dropped "Free", its words do not appear anywhere in the document']);
    expect(out.counts['dropped.not_in_document']).toBe(1);
  });

  it('reads a word the document printed with a plural "s" or "es", and no looser form', () => {
    const out = run([
      record({ fields: { price: 'Donation' } }),
      record({ fields: { title: 'Late Show', price: 'Day pass' } }),
      record({ fields: { title: 'Matinee', price: 'Donate' } }),
    ], priced, { pageText: 'Suggested donations at the door. Day passes sold here.' });

    expect(out.records.map(kept => kept.fields.price)).toEqual(['Donation', 'Day pass', undefined]);
    expect(out.records[2]?.issues).toEqual(['price: dropped "Donate", its words do not appear anywhere in the document']);
  });

  it('matches an accent whether the document stored it composed or decomposed', () => {
    const composed = 'Free for Caf\u00E9 members';
    const decomposed = 'Free for Cafe\u0301 members';

    const onDecomposed = run([record({ fields: { price: composed } })], priced, { pageText: decomposed });
    const onComposed = run([record({ fields: { price: decomposed } })], priced, { pageText: composed });

    expect(onDecomposed.records[0]?.fields.price).toBe(composed);
    expect(onComposed.records[0]?.fields.price).toBe(decomposed);
  });

  it('keeps a price in words the document printed, however it joined or quoted them', () => {
    const out = run([
      record({ fields: { price: 'Pay-What-You-Can' } }),
      record({ fields: { title: 'Late Show', price: 'Free with a Hub\u2019s card' } }),
    ], priced, { pageText: 'Pay-What-You-Can at the door. Late Show: free with a Hub\u2019s card.' });

    expect(out.records.map(kept => kept.fields.price)).toEqual(['Pay-What-You-Can', 'Free with a Hub\u2019s card']);
    expect(out.counts['dropped.not_in_document']).toBeUndefined();
  });

  it('does not hold a value the operator supplied to the document', () => {
    const out = run([record()], configWith({ mustAppearInDocument: ['price'], defaults: { price: 'Free' } }));

    expect(out.records[0]?.fields.price).toBe('Free');
    expect(out.records[0]?.issues).toEqual([]);
  });

  it('finds a price the page printed only in its structured data', () => {
    const out = run([record({ fields: { price: '$31' } })], priced, {
      jsonLd: [{ '@type': 'Event', 'offers': { price: '31.00' } }],
    });

    expect(out.records[0]?.fields.price).toBe('$31');
  });

  it('holds a list to its digits, as before', () => {
    const out = run([
      record({ fields: { price: ['Free', 'Members'] } }),
      record({ fields: { title: 'Late Show', price: ['$12', '$45'] } }),
    ], priced);

    expect(out.records[0]?.fields.price).toEqual(['Free', 'Members']);
    expect(out.records[1]?.fields.price).toBeUndefined();
    expect(out.records[1]?.issues.join(' ')).toContain('its digits do not appear');
  });
});

describe('images the page shows', () => {
  const PAGE_IMAGE = 'https://bellwaterhall.example/uploads/open-mic.jpg';

  it('accepts an image the page shows for the image fields, and for nothing else', () => {
    const config = configWith({ imageFrom: 'poster', linkFields: ['ticketUrl'] });

    const out = run([record({
      imageUrl: PAGE_IMAGE,
      sourceUrl: PAGE_IMAGE,
      fields: { poster: PAGE_IMAGE, ticketUrl: PAGE_IMAGE },
    })], config, { images: [PAGE_IMAGE] });

    expect(out.records[0]?.imageUrl).toBe(PAGE_IMAGE);
    expect(out.records[0]?.fields.poster).toBe(PAGE_IMAGE);
    expect(out.records[0]?.sourceUrl).toBeUndefined();
    expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
  });

  it('ignores a list that is not a list of strings', () => {
    for (const wrong of [PAGE_IMAGE, [42, null], { url: PAGE_IMAGE }]) {
      const out = run([record({ imageUrl: PAGE_IMAGE })], configWith(), { images: wrong });

      expect(out.records[0]?.imageUrl).toBeUndefined();
    }
  });

  it('still fills a missing image from the document\'s own when the page shows others', () => {
    const out = run([record()], configWith(), {
      ogImage: 'https://bellwaterhall.example/og-card.png',
      images: [PAGE_IMAGE],
    });

    expect(out.records[0]?.imageUrl).toBe('https://bellwaterhall.example/og-card.png');
    expect(out.counts.image_from_document).toBe(1);
  });
});

describe('scores and cited rules', () => {
  const RULES = [
    { id: 'event-extraction#ws-no-cure-claims', text: 'Listings may not promise medical outcomes.' },
    { id: 'event-extraction#rtestkey01', text: 'Reject records that only advertise a sale.' },
  ];

  it('keeps a configured score in range and drops the rest', () => {
    const scored = configWith({ scores: [{ name: 'fit', describe: 'How well it fits the audience.' }] });
    const out = run([record({ scores: { fit: 0.7, mood: 0.9 } }), record({ scores: { fit: 1.4 } })], scored);

    expect(out.records[0]?.scores).toEqual({ fit: 0.7 });
    expect(out.records[0]?.issues.join(' ')).toContain('mood dropped');
    expect(out.records[1]?.scores).toBeUndefined();
    expect(out.counts['skipped.score_invalid']).toBe(2);
  });

  it('drops every score when the config names none', () => {
    const out = run([record({ scores: { fit: 0.7 } })]);

    expect(out.records[0]?.scores).toBeUndefined();
  });

  it('resolves a cited rule however the model echoed its id, with the text the call carried', () => {
    const out = run([record({
      suggestedDecision: 'reject',
      matchedRules: [
        { id: 'event-extraction #ws-no-cure-claims', title: 'No cure claims', evidence: 'Doors at 7' },
        { id: '#rtestkey01' },
      ],
    })], configWith(), { rules: RULES });

    expect(out.records[0]?.matchedRules).toEqual([
      { id: 'event-extraction#ws-no-cure-claims', title: 'No cure claims', text: 'Listings may not promise medical outcomes.', evidence: 'Doors at 7' },
      { id: 'event-extraction#rtestkey01', text: 'Reject records that only advertise a sale.' },
    ]);
  });

  it('drops a rule the call never carried, and evidence the page does not contain', () => {
    const out = run([record({
      matchedRules: [
        { id: 'event-extraction#ws-invented' },
        { id: 'event-extraction#ws-no-cure-claims', evidence: 'guaranteed cure' },
      ],
    })], configWith(), { rules: RULES });

    expect(out.records[0]?.matchedRules).toEqual([{ id: 'event-extraction#ws-no-cure-claims', text: 'Listings may not promise medical outcomes.' }]);
    expect(out.counts['skipped.rule_not_in_list']).toBe(1);
    expect(out.counts['skipped.evidence_not_in_document']).toBe(1);
    expect(out.records[0]?.issues.join(' ')).toContain('not in the document');
  });

  it('finds evidence in the structured data the prompt showed', () => {
    const out = run([record({
      matchedRules: [{ id: 'event-extraction#ws-no-cure-claims', evidence: 'A guaranteed cure' }],
    })], configWith(), { rules: RULES, jsonLd: [{ '@type': 'Thing', 'description': 'A guaranteed cure, every Thursday.' }] });

    expect(out.records[0]?.matchedRules?.[0]?.evidence).toBe('A guaranteed cure');
  });

  it('cites a rule once, and records nothing when no citation survives', () => {
    const out = run([
      record({ matchedRules: [{ id: 'event-extraction #ws-no-cure-claims' }, { id: '#ws-no-cure-claims' }] }),
      record({ fields: { startDate: '2026-11-19' }, matchedRules: [{ id: 'event-extraction#ws-invented' }] }),
    ], configWith(), { rules: RULES });

    expect(out.records[0]?.matchedRules).toEqual([{ id: 'event-extraction#ws-no-cure-claims', text: 'Listings may not promise medical outcomes.' }]);
    expect(out.records[1]?.matchedRules).toBeUndefined();
  });

  it('keeps an empty list as checked, and an omitted one as not recorded', () => {
    const out = run([record({ matchedRules: [] }), record({ fields: { startDate: '2026-11-19' } })], configWith(), { rules: RULES });

    expect(out.records[0]?.matchedRules).toEqual([]);
    expect(out.records[1]?.matchedRules).toBeUndefined();
  });

  it('records no rules when the call carried none', () => {
    const out = run([record({ matchedRules: [{ id: 'event-extraction#ws-no-cure-claims' }] })]);

    expect(out.records[0]?.matchedRules).toBeUndefined();
  });
});

describe('link fields', () => {
  const config = configWith({ linkFields: ['ticketUrl'] });

  it('drops a link the document did not publish', () => {
    const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: 'https://evil.example/buy' } })], config);

    expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
    expect(out.records[0]?.issues.join(' ')).toContain('ticketUrl: dropped, the document did not publish that URL');
  });

  it('keeps a published link and stores a path resolved', () => {
    const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: '/tickets/42' } })], config, {
      publishedUrls: ['https://bellwaterhall.example/tickets/42'],
      baseUrl: 'https://bellwaterhall.example/feed.json',
    });

    expect(out.records[0]?.fields.ticketUrl).toBe('https://bellwaterhall.example/tickets/42');
    expect(out.records[0]?.issues).toEqual([]);
  });

  it('drops a link that is the document\'s own page, in any spelling', () => {
    for (const same of ['https://bellwaterhall.example/events/open-mic', 'https://bellwaterhall.example/events/open-mic/', 'https://bellwaterhall.example/events/open-mic#tickets']) {
      const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: same } })], config, {
        links: [{ url: same, text: 'Tickets' }],
        ownUrl: 'https://bellwaterhall.example/events/open-mic',
      });

      expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
      expect(out.records[0]?.issues.join(' ')).toContain('ticketUrl: dropped, it is the page itself');
    }
  });

  it('drops a link that is the record\'s own page', () => {
    const out = run([record({ sourceUrl: 'https://bellwaterhall.example/e/open-mic', fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: 'https://bellwaterhall.example/e/open-mic/' } })], config, {
      links: [{ url: 'https://bellwaterhall.example/e/open-mic', text: 'Open Mic Night' }, { url: 'https://bellwaterhall.example/e/open-mic/', text: 'Tickets' }],
    });

    expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
    expect(out.records[0]?.issues.join(' ')).toContain('ticketUrl: dropped, it is the page itself');
  });

  it('drops a link written as a path that resolves to the document\'s own page', () => {
    const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: '/events/open-mic' } })], config, {
      jsonLd: [{ '@type': 'Event', 'url': '/events/open-mic' }],
      ownUrl: 'https://bellwaterhall.example/events/open-mic',
    });

    expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
    expect(out.records[0]?.issues.join(' ')).toContain('ticketUrl: dropped, it is the page itself');
  });

  describe('on a feed entry', () => {
    const entryUrl = 'https://bellwaterhall.example/events/open-mic/';
    const ownUrl = 'https://bellwaterhall.example/feed.ics#open-mic@bellwaterhall.example';

    it('drops a link that is the entry\'s own page', () => {
      const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: entryUrl } })], config, {
        publishedUrls: [entryUrl],
        ownUrl,
        entryUrl,
      });

      expect(out.records[0]?.fields.ticketUrl).toBeUndefined();
      expect(out.records[0]?.issues).toEqual(['ticketUrl: dropped, it is the entry\'s own page']);
    });

    it('keeps a different published link', () => {
      const tickets = 'https://tickets.example/open-mic';
      const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: tickets } })], config, {
        publishedUrls: [entryUrl, tickets],
        ownUrl,
        entryUrl,
      });

      expect(out.records[0]?.fields.ticketUrl).toBe(tickets);
      expect(out.records[0]?.issues).toEqual([]);
    });

    it('changes nothing when no entry page is named', () => {
      const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: entryUrl } })], config, {
        publishedUrls: [entryUrl],
        ownUrl,
      });

      expect(out.records[0]?.fields.ticketUrl).toBe(entryUrl);
      expect(out.records[0]?.issues).toEqual([]);
    });
  });

  it('leaves a field alone when the config names no link fields', () => {
    const out = run([record({ fields: { title: 'Open Mic Night', venueName: 'Bellwater Hall', ticketUrl: 'https://evil.example/buy' } })]);

    expect(out.records[0]?.fields.ticketUrl).toBe('https://evil.example/buy');
  });
});

describe('occurrences written from a stated rule', () => {
  const knob = (over: Record<string, unknown> = {}) => configWith({ occurrenceFields: { day: 'startDate', start: 'start' }, ...over });
  const weekly = (over: Record<string, unknown> = {}) => record({ fields: { start: '2026-11-12T19:00' }, repeats: { rule: 'FREQ=WEEKLY', evidence: 'every Thursday' }, ...over });
  const page = { pageText: 'Open Mic Night, every Thursday from 2026-11-12, doors at 19:00. Tickets $12.' };

  it('holds the template to the document, and never the dates it computed', () => {
    const out = run([weekly()], knob({ mustAppearInDocument: ['startDate', 'start'], quotedFields: ['start'] }), page);

    expect(out.records.map(r => r.fields.startDate)).toEqual(['2026-11-12', '2026-11-19', '2026-11-26', '2026-12-03', '2026-12-10', '2026-12-17', '2026-12-24', '2026-12-31', '2027-01-07']);
    expect(out.records[1]?.fields.start).toBe('2026-11-19T19:00');
    expect(out.records[1]?.issues).toEqual(['date computed from the stated rule: every Thursday']);
    expect(out.records[0]?.issues.join(' ')).toContain('start: "2026-11-12T19:00" is not written this way in the document');
    expect(out.counts).not.toHaveProperty('dropped.not_in_document');
  });

  it('writes a time with an offset as local time, skips the days the document excepts, and reads a monthly rule', () => {
    const offset = run([weekly({ fields: { start: '2026-11-12T19:00:00-05:00' }, repeats: { rule: 'FREQ=WEEKLY', except: ['2026-11-26'], evidence: 'every Thursday' } })], knob(), page);
    const monthly = run([weekly({ repeats: { rule: 'FREQ=MONTHLY;BYDAY=2TH', evidence: 'every Thursday' } })], knob(), page);

    expect(offset.records.slice(0, 3).map(r => [r.fields.startDate, r.fields.start])).toEqual([['2026-11-12', '2026-11-12T19:00:00-05:00'], ['2026-11-19', '2026-11-19T19:00:00'], ['2026-12-03', '2026-12-03T19:00:00']]);
    expect(monthly.records.map(r => r.fields.start)).toEqual(['2026-11-12T19:00', '2026-12-10T19:00']);
    expect(monthly.nextUnwritten).toBe('2027-01-14');

    const spaced = run([weekly({ fields: { startDate: '2026-11-12 19:00', start: undefined } })], knob(), page);

    expect(spaced.records[1]?.fields.startDate).toBe('2026-11-19 19:00');
    expect(spaced.counts).toMatchObject({ expanded: 8 });
  });

  it('leaves a record single when its own date is one the document says the rule skips, or it duplicates a queued card', () => {
    const excepted = run([weekly({ repeats: { rule: 'FREQ=WEEKLY', except: ['2026-11-12'], evidence: 'every Thursday' } })], knob(), page);
    const duplicate = run([weekly({ duplicateOf: 41 })], knob(), { ...page, knownIds: new Set([41]) });

    expect(excepted.records).toHaveLength(1);
    expect(excepted.counts).toMatchObject({ 'expansion.anchor_not_in_rule': 1 });
    expect(excepted.records[0]?.issues).toContain('repeats: its date is one the document says the rule skips, so only this date was proposed');
    expect(duplicate.records).toHaveLength(1);
    expect(duplicate.counts).toMatchObject({ 'expansion.template_duplicate': 1 });
  });

  it('holds a date the model returned with an offset, so one occurrence is one record', () => {
    const out = run([
      weekly({ fields: { startDate: '2026-11-13T00:00:00Z', start: '2026-11-13T00:00:00Z' } }),
      record({ fields: { startDate: '2026-11-20T00:00:00Z', start: '2026-11-20T00:00:00Z' } }),
    ], knob(), page);

    expect(out.records.filter(r => calendarDayOf(r.fields.startDate, 'America/New_York') === '2026-11-19')).toHaveLength(1);
    expect(out.counts).toMatchObject({ 'expansion.held': 1 });
  });

  it('never reads a rule off a calendar entry, whatever the model wrote', () => {
    const out = run([weekly()], knob(), { ...page, calendarEntry: true });

    expect(out.records).toHaveLength(1);
    expect(out.counts).not.toHaveProperty('expanded');
  });

  it('puts the document\'s own image on every occurrence of the one record it described', () => {
    const out = run([weekly()], knob(), { ...page, ogImage: 'https://bellwaterhall.example/og.png' });

    expect(out.records.length).toBeGreaterThan(1);
    expect(out.records.every(r => r.imageUrl === 'https://bellwaterhall.example/og.png')).toBe(true);
  });

  it('still leaves the document\'s image off a document that described several records', () => {
    const out = run([weekly(), record({ fields: { title: 'Jazz Brunch' } })], knob(), { ...page, ogImage: 'https://bellwaterhall.example/og.png' });

    expect(out.records.some(r => r.imageUrl)).toBe(false);
  });

  it('writes nothing from a stated rule for a source that does not opt in', () => {
    const out = run([weekly()], configWith(), page);

    expect(out.records).toHaveLength(1);
    expect(out.records[0]).not.toHaveProperty('repeats');
  });
});

describe('a source that does not opt into occurrence fields', () => {
  it('validates exactly as it did before the knob existed', () => {
    const config = configWith({
      defaults: { venueName: 'Bellwater Hall' },
      dropIfPast: { field: 'startDate' },
      allowedValues: { categories: ['Music'] },
      mustAppearInDocument: ['price'],
      quotedFields: ['title'],
      linkFields: ['ticketUrl'],
      imageFrom: 'poster',
      collapseWithinDocument: true,
      seriesLabel: { sameOn: ['title', 'venueName'], differsOn: 'startDate', evidenceField: 'recurrence', flagField: 'seriesMatch' },
      scores: [{ name: 'fit', describe: 'Fit.' }],
    });
    const records = [
      record({ fields: { recurrence: 'every Thursday', price: '$12', categories: ['Music', 'Dance'] }, sourceUrl: 'https://bellwaterhall.example/e/open-mic', scores: { fit: 0.7, other: 2 } }),
      record({ fields: { startDate: '2026-11-19', recurrence: 'every Thursday', price: '$15' }, seriesOf: 41, seriesNote: 'a week later' }),
      record({ fields: { startDate: '2026-11-12' } }),
      record({ fields: { title: 'Last Week', startDate: '2026-11-01' } }),
      record({ fields: { title: 'Far Off', startDate: '2027-03-01', recurrence: 'monthly' } }),
      record({ fields: { title: 'Poster Show', ticketUrl: 'https://bellwaterhall.example/tickets', poster: 'https://bellwaterhall.example/p.jpg', venueName: '' }, imageUrl: 'https://invented.example/x.png' }),
      record({ fields: { title: 'Unsure' }, confidence: 0.2 }),
    ];
    const out = run(records, config, {
      links: [{ url: 'https://bellwaterhall.example/e/open-mic', text: 'Open Mic Night' }, { url: 'https://bellwaterhall.example/tickets', text: 'Tickets' }],
      images: ['https://bellwaterhall.example/p.jpg'],
      ogImage: 'https://bellwaterhall.example/og.png',
      ownUrl: 'https://bellwaterhall.example/events',
      knownIds: new Set([41]),
    });
    const single = run([record()], config, { ogImage: 'https://bellwaterhall.example/og.png' });

    expect(createHash('sha256').update(JSON.stringify([out, single])).digest('hex')).toBe('3f754016d187891c5ce213a5805e8a7dd93d96d670f27fed6f8ae4bd1d381fa2');
  });
});
