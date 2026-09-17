/**
 * Feeds: the content types the connector will read, the scheme rewrite that
 * keeps a calendar URL from failing the run, the silent discovery probes, and
 * the per-event split.
 *
 * The split is a TEXT split and the tests hold it to that: components come out
 * on `BEGIN:VEVENT` … `END:VEVENT`, every property read as a value is unfolded,
 * and nothing expands an RRULE or does TZID arithmetic. Ids are the feed's own
 * keys, never the item's position in the feed, because one reorder or one
 * removal mid-feed would then rewrite every id after it and cost a re-embed and
 * a model call per document.
 *
 * A malformed feed is held to a second rule, which the two readings of a block
 * exist for: a broken line may cost the value on that line, never the split. A
 * lost UID abandons the split for the whole file, so the key is read wherever
 * it appears, while a URL, a claim about what the document published, is
 * taken only when the event itself wrote it and the line parsed without a guess.
 */
import type { SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webConnector } from './web';

type Progress = { kind: string; uri?: string; message?: string };

const ICS_URL = 'https://venue.test/events.ics';
const LISTING_URL = 'https://venue.test/shows/';
const CALENDAR_URL = 'https://venue.test/calendar/';

const TWO_EVENT_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Venue//EN
BEGIN:VEVENT
UID:evt-1@venue.test
SUMMARY:Opening Night
DTSTART;TZID=America/New_York:20261101T193000
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT
BEGIN:VEVENT
UID:evt-1@venue.test
RECURRENCE-ID;TZID=America/New_York:20261108T193000
SUMMARY:Opening Night, moved
END:VEVENT
END:VCALENDAR`;

const FOLDED_UID_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-with-a-very-long-identifier-tha
 t-the-feed-folded
SUMMARY:Folded
END:VEVENT
END:VCALENDAR`;

const NO_UID_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:Nothing to key on
DTSTART:20261101T193000Z
END:VEVENT
BEGIN:VEVENT
SUMMARY:Nor here
END:VEVENT
END:VCALENDAR`;

const PUBLISHED_URLS_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-2@venue.test
SUMMARY:Poster Night
URL:https://venue.test/event/poster-night-with-a-title-long-enough-that
 -the-feed-folded-the-line
ATTACH;ENCODING=BASE64;VALUE=BINARY:R0lGODlhAQABAIAAAAAAAP
ATTACH;FMTTYPE=image/png:https://cdn.venue.test/poster
 .png
ATTACH;FMTTYPE=application/pdf:https://cdn.venue.test/flyer.pdf
ATTACH;FILENAME="a:b";FMTTYPE=image/png:https://cdn.venue.test/quoted.png
END:VEVENT
BEGIN:VEVENT
UID:evt-3@venue.test
SUMMARY:Publishes nothing fetchable
ATTACH;ENCODING=BASE64;VALUE=BINARY:R0lGODlhAQABAIAAAAAAAP
URL:https:not a url at all
END:VEVENT
END:VCALENDAR`;

const NESTED_ALARM_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-4@venue.test
SUMMARY:Show with a rem
 inder
ATTACH;FMTTYPE=image/png:https://cdn.venue.test/show.png
BEGIN:VALARM
ACTION:AUDIO
ATTACH;FMTTYPE=audio/basic:https://cdn.venue.test/chime.wav
END:VALARM
END:VEVENT
END:VCALENDAR`;

const QUOTED_TRAP_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-5@venue.test
SUMMARY:Quoted trap
ATTACH;FILENAME="x:https://cdn.venue.test/wrong.png";FMTTYPE=image/png:https://cdn.venue.test/right.png
END:VEVENT
END:VCALENDAR`;

const UNBALANCED_QUOTE_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID;X-NOTE="never closed:evt-6@venue.test
SUMMARY:Broken but keyed
END:VEVENT
END:VCALENDAR`;

const STRAY_END_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
END:VTIMEZONE
UID:evt-7@venue.test
SUMMARY:Stray end before the key
END:VEVENT
BEGIN:VEVENT
UID:evt-8@venue.test
SUMMARY:Second
END:VEVENT
END:VCALENDAR`;

const UNCLOSED_ALARM_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
BEGIN:VALARM
ACTION:DISPLAY
UID:evt-9@venue.test
SUMMARY:Alarm opened and never closed
END:VEVENT
END:VCALENDAR`;

const FORGED_ATTACH_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-10@venue.test
SUMMARY:Forged attachment
ATTACH;FILENAME="never closed:https://elsewhere.example/forged.png
END:VEVENT
END:VCALENDAR`;

const CAPPED_ATTACH_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:evt-11@venue.test',
  'SUMMARY:Sixty attachments',
  ...Array.from({ length: 60 }, (_, i) => `ATTACH;FMTTYPE=image/png:https://cdn.venue.test/p${i}.png`),
  `ATTACH;FMTTYPE=image/png:https://cdn.venue.test/${'x'.repeat(2100)}.png`,
  'END:VEVENT',
  'END:VCALENDAR',
].join('\n');

const WRAPPED_JSON = {
  website: { identifier: 'venue' },
  collection: { title: 'Events' },
  upcoming: [
    { id: 'a1', title: 'Opening Night', fullUrl: '/events/opening-night', assetUrl: 'https://cdn.venue.test/opening.jpg' },
    { id: 'a2', title: 'Second Night', fullUrl: '/events/second-night' },
  ],
  past: [{ id: 'a1', title: 'Opening Night' }],
};

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>Shows</title>
<item><title>Opening Night</title><link>https://venue.test/shows/opening</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Shows</title>
<entry><title>Opening Night</title></entry></feed>`;

/**
 * Answer every fetch from one handler, and remember the calls.
 * @param handler - returns the response for a URL, or undefined to fail the call.
 */
function stubFetch(handler: (url: string) => Response | undefined): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const res = handler(url);
    if (!res) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    return res;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/**
 * A response with an explicit content type.
 * @param body - the body text.
 * @param contentType - the Content-Type header to answer with.
 */
function typed(body: string, contentType: string): Response {
  return new Response(body, { headers: { 'content-type': contentType } });
}

/**
 * A listing page.
 * @param head - extra markup for the head, usually a feed alternate.
 * @param body - extra markup for the body.
 */
function listing(head = '', body = '<p>Our shows.</p>'): Response {
  return typed(
    `<!doctype html><html><head><title>Shows</title>${head}</head><body><main>${body}</main></body></html>`,
    'text/html; charset=utf-8',
  );
}

/**
 * Run one sync to completion.
 * @param config - the connector config under test.
 */
async function run(config: Record<string, unknown>): Promise<{ docs: IngestDoc[]; events: Progress[] }> {
  const events: Progress[] = [];
  const ctx: SourceContext = {
    sourceId: 1,
    orgId: 'org_test',
    config,
    onProgress: (e) => {
      events.push(e);
    },
  };
  const docs: IngestDoc[] = [];
  for await (const doc of webConnector.sync(ctx)) {
    docs.push(doc);
  }
  return { docs, events };
}

/**
 * The connector-scope errors a run reported.
 * @param events - every progress event from the run.
 */
function errors(events: Progress[]): Progress[] {
  return events.filter(e => e.kind === 'error');
}

/**
 * The id a keyless JSON item gets.
 * @param item - the item, as it will be serialised into the document.
 */
function hashKey(item: unknown): string {
  return createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0, 16);
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('content types the connector will read', () => {
  it('reads an RSS feed instead of skipping it as unsupported', async () => {
    stubFetch(() => typed(RSS, 'application/rss+xml'));

    const { docs, events } = await run({ urls: ['https://venue.test/feed.xml'] });

    expect(docs).toHaveLength(1);
    expect(docs[0]?.content).toContain('<rss');
    expect(events.some(e => e.message?.includes('unsupported content-type'))).toBe(false);
  });

  it('reads an Atom feed too', async () => {
    stubFetch(() => typed(ATOM, 'application/atom+xml'));

    const { docs, events } = await run({ urls: ['https://venue.test/atom.xml'] });

    expect(docs).toHaveLength(1);
    expect(errors(events)).toEqual([]);
  });

  it('still refuses a type it cannot read', async () => {
    stubFetch(() => typed('%PDF-1.7', 'application/pdf'));

    const { docs, events } = await run({ urls: ['https://venue.test/flyer.pdf'] });

    expect(docs).toEqual([]);
    expect(events.some(e => e.kind === 'skipped' && e.message?.includes('unsupported content-type'))).toBe(true);
  });
});

describe('webcal://', () => {
  it('is rewritten to https before the fetch, and the document carries the rewritten URL', async () => {
    const fetchFn = stubFetch(url => url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined);

    const { docs, events } = await run({ urls: ['webcal://venue.test/events.ics'] });

    expect(String(fetchFn.mock.calls[0]?.[0])).toBe(ICS_URL);
    expect(docs[0]?.externalId.startsWith(ICS_URL)).toBe(true);
    expect(errors(events)).toEqual([]);
  });
});

describe('the ICS per-event split', () => {
  it('yields one document per VEVENT, keyed by UID and RECURRENCE-ID', async () => {
    stubFetch(() => typed(TWO_EVENT_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-1@venue.test`,
      `${ICS_URL}#evt-1@venue.test#20261108T193000`,
    ]);
    expect(docs.map(d => d.title)).toEqual(['Opening Night', 'Opening Night, moved']);
  });

  it('keeps each component verbatim and expands nothing', async () => {
    stubFetch(() => typed(TWO_EVENT_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(docs[0]?.content).toContain('DTSTART;TZID=America/New_York:20261101T193000');
    expect(docs[0]?.content.startsWith('BEGIN:VEVENT')).toBe(true);
    expect(docs[0]?.content.endsWith('END:VEVENT')).toBe(true);
    expect(docs[0]?.content).not.toContain('BEGIN:VCALENDAR');
  });

  it('unfolds a folded UID', async () => {
    stubFetch(() => typed(FOLDED_UID_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-with-a-very-long-identifier-that-the-feed-folded`,
    ]);
  });

  it('falls back to the whole file when a component has no UID, never to an index', async () => {
    stubFetch(() => typed(NO_UID_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs.map(d => d.externalId)).toEqual([ICS_URL]);
    expect(docs[0]?.content).toContain('BEGIN:VCALENDAR');
  });

  it('declares every URL the component published, unfolding the folded ones', async () => {
    stubFetch(() => typed(PUBLISHED_URLS_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // Three things at once, and each of them silently lost a real URL before:
    // a folded value has to arrive whole, or it stops at "…long-enough-that";
    // ATTACH repeats per RFC 5545, so reading only the first would keep the
    // base64 bytes and drop the poster and the flyer behind them; and the
    // base64 attachment is not a link, so it is skipped rather than stored.
    // The last one also carries a quoted parameter holding a colon, which is
    // legal and which a naive split on the first colon would cut in half.
    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/event/poster-night-with-a-title-long-enough-that-the-feed-folded-the-line',
      'https://cdn.venue.test/poster.png',
      'https://cdn.venue.test/flyer.pdf',
      'https://cdn.venue.test/quoted.png',
    ]);
  });

  it('omits the key when a component publishes nothing fetchable', async () => {
    stubFetch(() => typed(PUBLISHED_URLS_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // Base64 bytes are not a link, and `https:not a url at all` clears the
    // protocol test while being unfetchable, so the shape test has to reject
    // it. Writing an empty array instead of omitting the key would rewrite the
    // metadata of every such document once and report a refresh for it.
    expect(docs[1]?.metadata).not.toHaveProperty('publishedUrls');
  });

  it('leaves a nested alarm attachment out of what the event published', async () => {
    stubFetch(() => typed(NESTED_ALARM_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // The alarm's sound is the alarm's, not the event's. Declaring it would let
    // the extractor's gate accept a chime as the event's image.
    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://cdn.venue.test/show.png']);
  });

  it('unfolds a folded SUMMARY into a whole title', async () => {
    stubFetch(() => typed(NESTED_ALARM_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // RFC 5545 makes a fold an artifact of how the line was written down, not
    // part of the value, so a title read without unfolding is just truncated.
    // This read `Show with a rem` until the one-scanner change.
    expect(docs[0]?.title).toBe('Show with a reminder');
  });

  it('keeps the split when a component quote never closes, rather than losing the feed', async () => {
    stubFetch(() => typed(UNBALANCED_QUOTE_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // A malformed line is not a reason to abandon the per-event split: with no
    // UID the whole feed collapses back to one document, which re-embeds
    // everything and tombstones every per-event document.
    expect(docs.map(d => d.externalId)).toEqual([`${ICS_URL}#evt-6@venue.test`]);
  });

  it('keeps the split when a stray END: appears before the key', async () => {
    stubFetch(() => typed(STRAY_END_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // Nesting is tracked by name, so an END: that closes nothing that is open
    // is ignored. Counting instead would leave the depth permanently off by
    // one, and every property after it, UID included, would read as some
    // other component's, collapsing the whole feed into one document.
    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-7@venue.test`,
      `${ICS_URL}#evt-8@venue.test`,
    ]);
  });

  it('still finds the key when an alarm is opened and never closed', async () => {
    stubFetch(() => typed(UNCLOSED_ALARM_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // The key is read wherever it was written. Scoping it to the event's own
    // nesting level would lose it here, and a lost UID costs every document of
    // the source, which is never worth the tidier reading.
    expect(docs.map(d => d.externalId)).toEqual([`${ICS_URL}#evt-9@venue.test`]);
  });

  it('refuses to declare a URL it had to guess the value of', async () => {
    stubFetch(() => typed(FORGED_ATTACH_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // The line's quotes never close, so splitting it is guesswork, and the
    // guess happens to produce something shaped exactly like a published URL.
    // The event keeps its document; it just publishes nothing.
    expect(docs.map(d => d.externalId)).toEqual([`${ICS_URL}#evt-10@venue.test`]);
    expect(docs[0]?.metadata?.publishedUrls).toBeUndefined();
  });

  it('bounds what one entry may declare, by count and by length', async () => {
    stubFetch(() => typed(CAPPED_ATTACH_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // ATTACH repeats without limit and an unfolded value concatenates every
    // continuation line, so the row a hostile feed can write has a ceiling.
    const published = docs[0]?.metadata?.publishedUrls as string[];

    expect(published).toHaveLength(50);
    expect(published.every(u => u.length <= 2048)).toBe(true);
    expect(published[0]).toBe('https://cdn.venue.test/p0.png');
  });

  it('reads past a quoted parameter that would otherwise forge a URL', async () => {
    stubFetch(() => typed(QUOTED_TRAP_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // Splitting on the first colon would end the value inside the quotes and
    // yield `https://cdn.venue.test/wrong.png"`, which still passes for a URL.
    // That is worse than dropping it: the gate would bless the wrong link.
    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://cdn.venue.test/right.png']);
  });
});

describe('the JSON per-event split', () => {
  it('keys each item by @id, id or slug', async () => {
    const items = [
      { '@id': 'https://venue.test/e/1', 'name': 'One' },
      { id: 7, title: 'Two' },
      { slug: 'three', summary: 'Three' },
    ];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual([
      'https://venue.test/events.json#https://venue.test/e/1',
      'https://venue.test/events.json#7',
      'https://venue.test/events.json#three',
    ]);
    expect(docs.map(d => d.title)).toEqual(['One', 'Two', 'Three']);
  });

  it('declares the item\'s own top-level URLs, and leaves nested ones alone', async () => {
    const items = [{
      slug: 'one',
      url: 'https://venue.test/e/one',
      // The same link under a second key, which a CMS export routinely does.
      link: 'https://venue.test/e/one',
      image: 'https://cdn.venue.test/one.jpg',
      thumbnail: 'https://cdn.venue.test/one-thumb.jpg',
      offers: { url: 'https://tickethub.example/one' },
    }];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // `offers.url` is nested, so it is the publisher's shape to choose and
    // walking it would make this a parser. The repeated link is stored once.
    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/e/one',
      'https://cdn.venue.test/one.jpg',
      'https://cdn.venue.test/one-thumb.jpg',
    ]);
  });

  it('splits a feed that wraps its entries in an object, and ignores the sibling array', async () => {
    stubFetch(() => Response.json(WRAPPED_JSON));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // Both `upcoming` and `past` are entry-shaped, so shape alone cannot
    // separate them and the tie-break decides. It has to: `past` repeats an id,
    // and one repeated id abandons the split for the whole file.
    expect(docs.map(d => d.title)).toEqual(['Opening Night', 'Second Night']);
    expect(docs.map(d => d.externalId)).toEqual([
      'https://venue.test/events.json#a1',
      'https://venue.test/events.json#a2',
    ]);
  });

  it('resolves an entry\'s relative page link against the feed it came from', async () => {
    stubFetch(() => Response.json(WRAPPED_JSON));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // The gate compares exactly, so a path left as a path can never match what
    // the model read off the entry and the link would be dropped.
    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/events/opening-night',
      'https://cdn.venue.test/opening.jpg',
    ]);
  });

  it('hashes the item when it publishes no key, and never uses its index', async () => {
    const items = [{ when: '2026-11-01' }, { when: '2026-11-08' }];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual([
      `https://venue.test/events.json#${hashKey(items[0])}`,
      `https://venue.test/events.json#${hashKey(items[1])}`,
    ]);
    expect(docs.some(d => d.externalId.endsWith('#0') || d.externalId.endsWith('#1'))).toBe(false);
  });

  it('keeps an empty array as one whole-file document', async () => {
    stubFetch(() => Response.json([]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/events.json']);
  });

  it('picks the entries over a sibling list of plain strings', async () => {
    stubFetch(() => Response.json({
      urls: ['https://venue.test/a', 'https://venue.test/b'],
      events: [{ id: 'e1', title: 'Real One' }, { id: 'e2', title: 'Real Two' }],
    }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // Entries are objects. A list of bare strings is a link registry or a
    // navigation menu, and splitting on it would key two documents by hash,
    // embed them and spend a model call each proving there is no event in
    // `"https://venue.test/a"`.
    expect(docs.map(d => d.title)).toEqual(['Real One', 'Real Two']);
  });

  it('breaks a tie between two entry-shaped keys by the known names', async () => {
    stubFetch(() => Response.json({
      items: [{ id: 'i1', title: 'Archived' }],
      upcoming: [{ id: 'u1', title: 'Tonight' }],
    }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // Both qualify on shape and `items` is written first, so insertion order
    // would pick the wrong one. The named list exists for exactly this.
    expect(docs.map(d => d.title)).toEqual(['Tonight']);
  });

  it('reads an empty known key as "nothing today" rather than falling through to the archive', async () => {
    stubFetch(() => Response.json({
      upcoming: [],
      past: [{ id: 'p1', title: 'Last Month' }, { id: 'p2', title: 'Last Year' }],
    }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // Otherwise the day the last event passes, every document of the source is
    // tombstoned and replaced by its archive, then replaced back when the next
    // event is posted, and each stale entry costs a model call, because a past
    // date is only recognised after the model has read it.
    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/events.json']);
  });

  it('splits on an unknown key when the body names none of the known ones', async () => {
    stubFetch(() => Response.json({ shows: [{ id: 's1', title: 'House Band' }] }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // Shape is what identifies entries; the known names only settle which of
    // several candidates a publisher meant.
    expect(docs.map(d => d.title)).toEqual(['House Band']);
  });

  it('leaves a body whose only array is plain strings as one document', async () => {
    stubFetch(() => Response.json({ items: ['Home', 'About', 'Contact'] }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/events.json']);
  });

  it('declares an entry\'s image published under the extractor\'s own field name', async () => {
    stubFetch(() => Response.json([
      { id: 'b1', title: 'Poster Night', imageUrl: 'https://cdn.venue.test/poster.jpg' },
    ]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // `imageUrl` is what the pipeline reads the value back out of, so an entry
    // publishing it under that exact name losing it would be the whole defect
    // this list exists to fix, reproduced.
    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://cdn.venue.test/poster.jpg']);
  });
});

describe('feed discovery', () => {
  it('reads the calendar the listing advertises, and says which source it used', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      return url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-1@venue.test`,
      `${ICS_URL}#evt-1@venue.test#20261108T193000`,
    ]);
    expect(events.some(e => e.message?.startsWith('source: discovered ics feed'))).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('prefers the calendar over an RSS alternate declared first', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        // Under the listing path, so the scope rule keeps it and the only
        // thing deciding between the two is KIND_ORDER.
        return listing(
          '<link rel="alternate" type="application/rss+xml" href="/shows/feed.xml">'
          + '<link rel="alternate" type="text/calendar" href="/events.ics">',
        );
      }
      if (url === ICS_URL) {
        return typed(TWO_EVENT_ICS, 'text/calendar');
      }
      return url === 'https://venue.test/shows/feed.xml' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(events.some(e => e.message?.includes('rss'))).toBe(false);
  });

  it('finds an .ics linked from the body, entities and all', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('', '<p><a href="/events.ics?src=cal">Add to calendar</a></p>');
      }
      return url === 'https://venue.test/events.ics?src=cal' ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(docs).toHaveLength(2);
  });

  it('probes silently: a feed that 404s reports no error and falls back to the crawl', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing(
          '<link rel="alternate" type="text/calendar" href="/events.ics">',
          '<p><a href="/shows/opening">Opening Night</a></p>',
        );
      }
      if (url === ICS_URL) {
        return new Response('not here', { status: 404 });
      }
      return url === 'https://venue.test/shows/opening' ? listing('', '<p>Opening Night, 7:30pm.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 1 } });

    expect(errors(events)).toEqual([]);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL, 'https://venue.test/shows/opening']);
    expect(events.some(e => e.kind === 'skipped' && e.uri === ICS_URL && e.message === 'HTTP 404')).toBe(true);
    expect(events.some(e => e.message?.startsWith('source: listing + depth-1 crawl'))).toBe(true);
  });

  it('refuses a 200 that is not the feed it claimed to be', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      // The site's own soft-404 page, served with a 200.
      return url === ICS_URL ? listing('', '<p>Page not found.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(errors(events)).toEqual([]);
    expect(events.some(e => e.message === 'not a ics feed')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual([LISTING_URL]);
  });

  it('asks a Squarespace listing for its JSON', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return listing('', '<p>Shows.</p><img src="https://static1.squarespace.com/x.jpg" alt="x">');
      }
      return url === `${LISTING_URL}?format=json` ? Response.json({ items: [{ title: 'Opening Night' }] }) : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message?.startsWith('source: discovered json feed'))).toBe(true);
    // One document per entry, not one for the page model. Discovery already
    // accepted this body; refusing to split it left the site's settings as the
    // only thing the extractor ever read.
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe('Opening Night');
    expect(docs[0]?.externalId.startsWith(`${LISTING_URL}?format=json#`)).toBe(true);
  });

  it('skips discovery entirely when the config names a feed', async () => {
    const fetchFn = stubFetch(url => url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined);

    const { docs, events } = await run({ feedUrl: 'webcal://venue.test/events.ics', crawl: { startUrl: LISTING_URL } });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(2);
    expect(events.some(e => e.message === 'source: configured feed')).toBe(true);
  });
});

/**
 * A feed declared in the head of every page on a site describes the site, not
 * the listing. Bellwater Hall's `/calendar/` declares the WordPress blog feed
 * at `/feed/`, and taking it replaced 60-odd shows with 1,460 characters of
 * blog posts. A calendar is exempt: it cannot be about anything but events.
 */
describe('feed discovery is scoped to the listing path', () => {
  it('a site-wide rss feed is not a candidate for a listing under /calendar/', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL
      ? listing('<link rel="alternate" type="application/rss+xml" href="/feed/">', '<p>Tonight: Opening Night.</p>')
      : undefined);

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 0 } });

    expect(events.some(e => e.message === 'source: skipped rss feed outside the listing path https://venue.test/feed/')).toBe(true);
    // Not even probed: the rule is decided on the URL, before any fetch.
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL]);
  });

  it('an rss feed under the listing path is a candidate', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing('<link rel="alternate" type="application/rss+xml" href="/calendar/feed/">');
      }
      return url === 'https://venue.test/calendar/feed/' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(events.some(e => e.message === 'source: discovered rss feed, 1 document')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/calendar/feed/']);
  });

  it('an ics feed anywhere on the origin is a candidate', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing('<link rel="alternate" type="text/calendar" href="/events.ics">');
      }
      return url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(events.some(e => e.message?.includes('outside the listing path'))).toBe(false);
    expect(docs).toHaveLength(2);
  });

  it('with no eligible feed the listing falls back to listing plus crawl', async () => {
    const fetchFn = stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return listing(
          '<link rel="alternate" type="application/rss+xml" href="/feed/">'
          + '<link rel="alternate" type="application/rss+xml" href="/comments/feed/">',
          '<p><a href="/calendar/opening">Opening Night</a></p>',
        );
      }
      return url === 'https://venue.test/calendar/opening' ? listing('', '<p>Opening Night, 7:30pm.</p>') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 1 } });

    expect(errors(events)).toEqual([]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL, 'https://venue.test/calendar/opening']);
    expect(events.some(e => e.message?.startsWith('source: listing + depth-1 crawl'))).toBe(true);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL, 'https://venue.test/calendar/opening']);
  });
});
