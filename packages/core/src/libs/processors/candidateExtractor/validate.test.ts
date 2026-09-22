/**
 * The knobs, one test each.
 *
 * Every rule here was written as a tenant rule first ("drop past events",
 * "categories from the enum", "never guess a price") and had to become a
 * domain-neutral configuration value, because a tenant cannot run code inside
 * core's processor. These tests are what says the translation is faithful.
 */
import { describe, expect, it } from 'vitest';
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

  it('drops a past record by calendar day, and keeps a multi-day one still running', () => {
    const config = configWith({ dropIfPast: { field: 'startDate', keepIfField: 'end' } });

    const out = run([
      record({ fields: { startDate: '2026-11-01' } }),
      record({ fields: { title: 'Winter Market', startDate: '2026-11-01', end: '2026-11-30' } }),
    ], config);

    expect(out.counts['skipped.past']).toBe(1);
    expect(out.records.map(kept => kept.fields.title)).toEqual(['Winter Market']);
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

  it('drops a price whose digits the document never printed', () => {
    const config = configWith({ mustAppearInDocument: ['price'] });

    const out = run([
      record({ fields: { price: '$12' } }),
      record({ fields: { title: 'Late Show', price: '$45' } }),
    ], config);

    expect(out.records[0]?.fields.price).toBe('$12');
    expect(out.records[1]?.fields.price).toBeUndefined();
    expect(out.records[1]?.issues.join(' ')).toContain('digits');
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
    // The connector declares the URL joined back up, but the model is shown the
    // document as written, folds and all. Comparing literally would drop
    // exactly the long URLs a fold exists for, so both sides lose whitespace.
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
