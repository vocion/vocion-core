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
DTSTAMP:20261015T120000Z
SUMMARY:Opening Night
DTSTART;TZID=America/New_York:20261101T193000
RRULE:FREQ=WEEKLY;COUNT=4
LAST-MODIFIED:20261012T084500Z
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

const ALARM_FIRST_ICS = `BEGIN:VCALENDAR
BEGIN:VEVENT
BEGIN:VALARM
ACTION:EMAIL
UID:alarm-uid-should-not-win
SUMMARY:Alarm email subject
END:VALARM
UID:evt-12@venue.test
SUMMARY:The Real Show
END:VEVENT
END:VCALENDAR`;

// The over-long value goes FIRST on purpose. Written last it would sit past the
// count cap and be dropped by it whatever the length cap did, so the test would
// pass with no length rule at all.
const CAPPED_ATTACH_ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT',
  'UID:evt-11@venue.test',
  'SUMMARY:Sixty attachments',
  `ATTACH;FMTTYPE=image/png:https://cdn.venue.test/${'x'.repeat(2100)}.png`,
  ...Array.from({ length: 60 }, (_, i) => `ATTACH;FMTTYPE=image/png:https://cdn.venue.test/p${i}.png`),
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
 * Make a response look like the one fetch returns after following a redirect.
 * @param res - the response the redirect landed on.
 * @param landedUrl - where the redirect landed.
 */
function redirectedTo(res: Response, landedUrl: string): Response {
  Object.defineProperties(res, { url: { value: landedUrl }, redirected: { value: true } });
  return res;
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

  it('keeps each component as written but for the export stamp, and expands nothing', async () => {
    stubFetch(() => typed(TWO_EVENT_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).toContain('RRULE:FREQ=WEEKLY;COUNT=4');
    expect(docs[0]?.content).toContain('DTSTART;TZID=America/New_York:20261101T193000');
    expect(docs[0]?.content).toContain('LAST-MODIFIED:20261012T084500Z');
    expect(docs[0]?.content).not.toContain('DTSTAMP');
    expect(docs[0]?.content.startsWith('BEGIN:VEVENT')).toBe(true);
    expect(docs[0]?.content.endsWith('END:VEVENT')).toBe(true);
    expect(docs[0]?.content).not.toContain('BEGIN:VCALENDAR');
  });

  it('reads two exports that differ only in their stamp as one unchanged document', async () => {
    const withStamp = (stamp: string, params = ''): string => `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-9@venue.test
SUMMARY:Second Sunday
dtstamp${params}:${stamp}
DTSTART:20261206T150000Z
END:VEVENT
END:VCALENDAR`;

    stubFetch(() => typed(withStamp('20261015T120000Z'), 'text/calendar'));
    const first = await run({ urls: [ICS_URL] });
    stubFetch(() => typed(withStamp('20261016T235959Z', ';X-VENDOR=1'), 'text/calendar'));
    const second = await run({ urls: [ICS_URL] });

    expect(first.docs[0]?.content).toBe(second.docs[0]?.content);
    expect(first.docs[0]?.content).toContain('DTSTART:20261206T150000Z');
    expect(first.docs[0]?.content.toUpperCase()).not.toContain('DTSTAMP');
  });

  it('drops a stamp that was folded across lines, continuations and all', async () => {
    const folded = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-10@venue.test
SUMMARY:Folded Stamp
DTSTAMP;X-SOURCE="an exporter annotation long enough to wrap":2026101
 5T120000Z
DTSTART:20261206T150000Z
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(folded, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).not.toContain('DTSTAMP');
    expect(docs[0]?.content).not.toContain('5T120000Z');
    expect(docs[0]?.content).toContain('SUMMARY:Folded Stamp');
    expect(docs[0]?.content).toContain('DTSTART:20261206T150000Z');
  });

  it('still drops a stamp whose quotes never closed, because the name is read before the parameters', async () => {
    const guessed = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-12@venue.test
SUMMARY:Guessed Split
DTSTAMP;X-NOTE="unclosed:20261015T120000Z
DTSTART:20261206T150000Z
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(guessed, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).not.toContain('DTSTAMP');
    expect(docs[0]?.content).toContain('SUMMARY:Guessed Split');
    expect(docs[0]?.content).toContain('DTSTART:20261206T150000Z');
  });

  it('leaves a line alone when it cannot tell the property name from the value', async () => {
    const ambiguous = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-11@venue.test
SUMMARY:Unclosed Quote
DTSTAMP;X-SOURCE="an annotation whose quote never closes
DTSTART:20261206T150000Z
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(ambiguous, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.content).toContain('quote never closes');
    expect(docs[0]?.content).toContain('DTSTART:20261206T150000Z');
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

  it('keys and titles from the event, not from an alarm written above it', async () => {
    stubFetch(() => typed(ALARM_FIRST_ICS, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    // RFC 9074 gives a VALARM its own UID, and an ACTION:EMAIL alarm carries a
    // SUMMARY that is the mail subject. Property order inside a component is
    // free, so a feed may write the alarm first, and reading the first match at
    // any depth would key and title the document from it.
    expect(docs.map(d => d.externalId)).toEqual([`${ICS_URL}#evt-12@venue.test`]);
    expect(docs[0]?.title).toBe('The Real Show');
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
    // continuation line, so the row a hostile feed can write has a ceiling on
    // both axes. The over-long value is written first, so with no length rule
    // it would be the entry at index 0 rather than absent.
    const published = docs[0]?.metadata?.publishedUrls as string[];

    expect(published).toHaveLength(50);
    expect(published.every(u => u.length <= 2048)).toBe(true);
    expect(published[0]).toBe('https://cdn.venue.test/p0.png');
    expect(published[0]).toBe('https://cdn.venue.test/p0.png');
  });

  it('resolves a relative attachment on an event the feed\'s own host wrote', async () => {
    const native = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-20@venue.test
SUMMARY:Gallery Talk
URL:https://venue.test/event/gallery-talk/
ATTACH;FMTTYPE=image/jpeg:/wp-content/uploads/2026/05/talk.jpg
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(native, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/event/gallery-talk/',
      'https://venue.test/wp-content/uploads/2026/05/talk.jpg',
    ]);
  });

  it('drops a relative attachment on an event syndicated from another host', async () => {
    const syndicated = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-21@elsewhere.test
SUMMARY:Touring Show
URL:https://elsewhere.test/shows/touring-show/
ATTACH;FMTTYPE=image/jpeg:/images/touring.jpg
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(syndicated, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://elsewhere.test/shows/touring-show/']);
  });

  it('drops a relative attachment when the event names no page of its own', async () => {
    const anonymous = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-22@venue.test
SUMMARY:No Page
ATTACH;FMTTYPE=image/jpeg:/images/no-page.jpg
ATTACH:None
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(anonymous, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toBeUndefined();
  });

  it('never resolves a bare word, even on a native event', async () => {
    const bare = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-23@venue.test
SUMMARY:Bare Word
URL:https://venue.test/event/bare-word/
ATTACH:None
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(bare, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://venue.test/event/bare-word/']);
  });

  it('declares an image an exporter writes under its own X- property, unfolded', async () => {
    const vendor = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-30@venue.test
SUMMARY:Late Show
URL:https://venue.test/event/late-show/
X-TKF-FEATURED-IMAGE:https://cdn.venue.test/images/640905eda89115
 4039f2bc6c/late-show.jpg
X-WP-IMAGES-URL:https://cdn.venue.test/uploads/late-show-poster.png
X-COST:12
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(vendor, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/event/late-show/',
      'https://cdn.venue.test/images/640905eda891154039f2bc6c/late-show.jpg',
      'https://cdn.venue.test/uploads/late-show-poster.png',
    ]);
  });

  it('never reads an X- property that is not about an image as a published URL', async () => {
    const other = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-31@venue.test
SUMMARY:Other Props
X-ORIGINAL-URL:https://aggregator.test/elsewhere/
X-COST:https://not-a-link.test/cost
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(other, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toBeUndefined();
  });

  it('declares the RFC 7986 IMAGE property, and drops an inline one', async () => {
    const image = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-32@venue.test
SUMMARY:Standard Image
IMAGE;VALUE=URI;DISPLAY=BADGE:https://cdn.venue.test/std.png
IMAGE;VALUE=BINARY;ENCODING=BASE64:R0lGODlhAQABAIAAAAAAAP
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(image, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://cdn.venue.test/std.png']);
  });

  it('reads a vendor image only when the event wrote it, once, and not a credit or alt text', async () => {
    const mixed = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:evt-33@venue.test
SUMMARY:Mixed
ATTACH;FMTTYPE=image/jpeg:https://cdn.venue.test/same.jpg
X-TKF-FEATURED-IMAGE:https://cdn.venue.test/same.jpg
X-IMAGE-CREDIT-URL:https://photographer.test/portfolio
X-IMAGE-ALT-TEXT:https://alt.test/a
BEGIN:VALARM
ACTION:DISPLAY
X-WP-IMAGES-URL:https://cdn.venue.test/alarm.png
END:VALARM
END:VEVENT
END:VCALENDAR`;
    stubFetch(() => typed(mixed, 'text/calendar'));

    const { docs } = await run({ urls: [ICS_URL] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual(['https://cdn.venue.test/same.jpg']);
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
  it('reads an enveloped entry\'s links from inside the envelope', async () => {
    const items = { events: [{ event: {
      id: 1,
      title: 'Random Chats About Statistics',
      url: 'None',
      localist_url: 'https://events.test/event/random-chats',
      photo_url: 'https://images.test/photos/1.jpg',
    } }] };
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://events.test/api/2/events'] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://events.test/event/random-chats',
      'https://images.test/photos/1.jpg',
    ]);
  });

  it('keys an enveloped entry on its occurrence, so an edit or a view updates it rather than filing another', async () => {
    const entry = (views: number, title: string, occurrence: number, day: string) => ({ event: {
      id: 7,
      title,
      detail_views: views,
      localist_url: `https://events.test/event/yoga-${day}`,
      event_instances: [{ event_instance: { id: occurrence, start: `2026-10-${day}T10:00:00-04:00`, num_attending: views % 5 } }],
    } });
    const url = 'https://events.test/api/2/events';

    stubFetch(() => Response.json({ events: [entry(10, 'Weekly Yoga', 501, '01'), entry(3, 'Weekly Yoga', 502, '08')] }));
    const first = await run({ urls: [url] });
    stubFetch(() => Response.json({ events: [entry(95, 'Weekly Yoga', 501, '01'), entry(40, 'Weekly Yoga, moved', 502, '08')] }));
    const second = await run({ urls: [url] });

    expect(first.docs.map(d => d.externalId)).toEqual([`${url}#7~501`, `${url}#7~502`]);
    expect(second.docs.map(d => d.externalId)).toEqual(first.docs.map(d => d.externalId));
    expect(second.docs[0]?.content).toBe(first.docs[0]?.content);
    expect(second.docs[0]?.content).not.toContain('detail_views');
    expect(second.docs[1]?.content).not.toBe(first.docs[1]?.content);
  });

  it('keeps the content key for enveloped entries that repeat an id with no occurrence to tell them apart', async () => {
    // A collision abandons the split for the whole file, so a repeat without an
    // occurrence falls back to the entry's content rather than its inner id.
    const items = { events: [
      { event: { id: 7, title: 'Weekly Yoga', localist_url: 'https://events.test/event/yoga-1' } },
      { event: { id: 7, title: 'Weekly Yoga', localist_url: 'https://events.test/event/yoga-2' } },
      { event: { id: 9, title: 'Open Studio', localist_url: 'https://events.test/event/studio' } },
    ] };
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://events.test/api/2/events'] });

    expect(docs).toHaveLength(3);
    expect(docs[0]?.externalId).not.toEqual(docs[1]?.externalId);
    expect(docs[2]?.externalId).toBe('https://events.test/api/2/events#9');
  });

  it('leaves a nested object alone when it is not an entry envelope', async () => {
    // One key holding a record is not enough: `image` is the publisher's shape,
    // and reading it would declare a nested value as the entry's own.
    const items = [
      { image: { url: 'https://cdn.test/a.jpg', id: 'img-1' } },
      { image: { url: 'https://cdn.test/b.jpg', id: 'img-2' } },
    ];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://events.test/api/2/events'] });

    expect(docs[0]?.metadata?.publishedUrls).toBeUndefined();
  });

  it('declares a link an entry published as a bare relative path', async () => {
    const items = [{ id: 'a1', fullUrl: 'events/opening-night', image: 'photos/a.jpg' }];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs[0]?.metadata?.publishedUrls).toEqual([
      'https://venue.test/events/opening-night',
      'https://venue.test/photos/a.jpg',
    ]);
  });

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

  it('stores what an entry\'s markup says, not the markup, and keys it as written', async () => {
    const item = {
      id: 'evt-1',
      title: 'Opening Night',
      body: '<div class="sqs-block" data-block-css="https://cdn.test/a1b2c3/styles.css">'
        + '<p>Doors at 7pm.</p><p>Riverton Hall.</p><br><script>track()</script></div>',
    };
    stubFetch(() => Response.json([item]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    const stored = JSON.parse(docs[0]!.content) as { body: string };

    expect(stored.body).toBe('Doors at 7pm.\n\nRiverton Hall.');
    expect(docs[0]?.content).not.toContain('sqs-block');
    expect(docs[0]?.content).not.toContain('track()');
    expect(docs[0]?.externalId).toBe('https://venue.test/events.json#evt-1');
  });

  it('reads two exports that differ only inside markup attributes as one unchanged document', async () => {
    const withAsset = (version: string) => [{
      id: 'evt-1',
      title: 'Opening Night',
      body: `<div data-block-css="https://cdn.test/${version}/styles.css"><p>Doors at 7pm.</p></div>`,
    }];

    stubFetch(() => Response.json(withAsset('a1b2c3')));
    const first = await run({ urls: ['https://venue.test/events.json'] });
    stubFetch(() => Response.json(withAsset('d4e5f6')));
    const second = await run({ urls: ['https://venue.test/events.json'] });

    expect(first.docs[0]?.content).toBe(second.docs[0]?.content);
  });

  it('keys a keyless entry on the entry as written, so the readable form never moves it', async () => {
    const items = [{ when: '2026-11-01', body: '<p>Doors at 7pm.</p>' }];
    stubFetch(() => Response.json(items));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    expect(docs[0]?.externalId).toBe(`https://venue.test/events.json#${hashKey(items[0])}`);
  });

  it('writes a millisecond timestamp as the instant it names, and leaves other numbers alone', async () => {
    const item = {
      id: 'evt-2',
      title: 'Second Sunday',
      startDate: 1_790_118_000_000,
      updated_on: 1_790_204_400_000,
      season: 1_790_118_000_000,
      price: 1_500,
      capacity: 1_790_118_000_000_000,
    };
    stubFetch(() => Response.json([item]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    const stored = JSON.parse(docs[0]!.content) as Record<string, unknown>;

    expect(stored.startDate).toBe('2026-09-22T23:00:00.000Z');
    expect(stored.updated_on).toBe('2026-09-23T23:00:00.000Z');
    expect(stored.season).toBe(1_790_118_000_000);
    expect(stored.price).toBe(1_500);
    expect(stored.capacity).toBe(1_790_118_000_000_000);
  });

  it('reads markup out of a nested value and out of a title', async () => {
    const item = {
      id: 'evt-3',
      summary: '<p>Late Set</p>',
      location: { name: '<span>Riverton Hall</span>', capacity: 200 },
    };
    stubFetch(() => Response.json([item]));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    const stored = JSON.parse(docs[0]!.content) as { location: { name: string; capacity: number } };

    expect(docs[0]?.title).toBe('Late Set');
    expect(stored.location.name).toBe('Riverton Hall');
    expect(stored.location.capacity).toBe(200);
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

  it('splits the entries around a hole rather than losing the whole source to it', async () => {
    stubFetch(() => Response.json({ upcoming: [{ id: 'x1', title: 'One' }, null, { id: 'x2', title: 'Two' }] }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // One null is a hole in an otherwise good list. Demanding that every entry
    // be an object would answer it by abandoning the split, which puts the
    // source back on one whole-file document, and only its first characters
    // ever reach the model.
    expect(docs.map(d => d.title)).toEqual(['One', 'Two']);
  });

  it('treats a stray label among the entries as a hole too, not as a veto', async () => {
    stubFetch(() => Response.json({ items: [{ id: 'y1', title: 'One' }, 'Home', { id: 'y2', title: 'Two' }] }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // A string is dropped the same way a null is. What decides the array is
    // whether anything survives, which is why a list of nothing but strings is
    // still a navigation menu and no feed at all.
    expect(docs.map(d => d.title)).toEqual(['One', 'Two']);
  });

  it('keeps looking when a known key holds something that is not entries', async () => {
    stubFetch(() => Response.json({ items: ['Home', 'About'], events: [{ id: 'e1', title: 'Real' }] }));

    const { docs } = await run({ urls: ['https://venue.test/events.json'] });

    // `items` is a known name holding a navigation menu. Letting the name alone
    // settle it would stop the search there and leave the real entries unsplit.
    expect(docs.map(d => d.title)).toEqual(['Real']);
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

describe('feed discovery on a listing that redirected', () => {
  it('reads a feed the listing advertises on the www host it landed on', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return redirectedTo(
          listing('<link rel="alternate" type="application/rss+xml" href="https://www.venue.test/shows/feed/">'),
          'https://www.venue.test/shows/',
        );
      }
      return url === 'https://www.venue.test/shows/feed/' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message === 'source: discovered rss feed, 1 document')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual(['https://www.venue.test/shows/feed/']);
  });

  it('keys a calendar the body links relatively on the requested host', async () => {
    stubFetch((url) => {
      if (url === LISTING_URL) {
        return redirectedTo(listing('', '<p><a href="/events.ics">Add to calendar</a></p>'), 'https://www.venue.test/shows/');
      }
      return url === ICS_URL ? typed(TWO_EVENT_ICS, 'text/calendar') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: LISTING_URL } });

    expect(events.some(e => e.message === 'source: discovered ics feed, 2 documents')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual([
      `${ICS_URL}#evt-1@venue.test`,
      `${ICS_URL}#evt-1@venue.test#20261108T193000`,
    ]);
  });

  it('keeps a Squarespace JSON feed keyed on the requested listing', async () => {
    const seedUrl = 'https://venue.test/events';
    const jsonUrl = `${seedUrl}?format=json`;
    stubFetch((url) => {
      if (url === seedUrl) {
        return redirectedTo(
          listing('', '<p>Events.</p><img src="https://static1.squarespace.com/x.jpg" alt="x">'),
          'https://www.venue.test/events',
        );
      }
      return url === jsonUrl
        ? redirectedTo(Response.json({ items: [{ title: 'Opening Night' }] }), 'https://www.venue.test/events?format=json')
        : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: seedUrl } });

    expect(events.some(e => e.message?.startsWith('source: discovered json feed'))).toBe(true);
    expect(docs).toHaveLength(1);
    expect(docs[0]?.externalId.startsWith(`${jsonUrl}#`)).toBe(true);
  });

  it('still drops a site-wide feed on either host', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL
      ? redirectedTo(
          listing(
            '<link rel="alternate" type="application/rss+xml" href="/feed/">'
            + '<link rel="alternate" type="application/rss+xml" href="https://www.venue.test/feed/">',
            '<p>Tonight: Opening Night.</p>',
          ),
          'https://www.venue.test/calendar/',
        )
      : undefined);

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 0 } });

    expect(events.filter(e => e.message?.includes('outside the listing path')).map(e => e.message)).toEqual([
      'source: skipped rss feed outside the listing path https://venue.test/feed/',
      'source: skipped rss feed outside the listing path https://www.venue.test/feed/',
    ]);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL]);
  });

  it('does not widen the feed scope when the listing redirects to the site root', async () => {
    const fetchFn = stubFetch(url => url === CALENDAR_URL
      ? redirectedTo(
          listing(
            '<link rel="alternate" type="application/rss+xml" href="https://www.venue.test/feed/">',
            '<p>Tonight: Opening Night.</p>',
          ),
          'https://www.venue.test/',
        )
      : undefined);

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL, maxDepth: 0 } });

    expect(events.some(e => e.message === 'source: skipped rss feed outside the listing path https://www.venue.test/feed/')).toBe(true);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([CALENDAR_URL]);
    expect(docs.map(d => d.externalId)).toEqual([CALENDAR_URL]);
  });

  it('still reads a feed under the requested listing path when the listing lands on its site root', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return redirectedTo(
          listing('<link rel="alternate" type="application/rss+xml" href="https://www.venue.test/calendar/feed/">'),
          'https://www.venue.test/',
        );
      }
      return url === 'https://www.venue.test/calendar/feed/' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { docs, events } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(events.some(e => e.message === 'source: discovered rss feed, 1 document')).toBe(true);
    expect(docs.map(d => d.externalId)).toEqual(['https://www.venue.test/calendar/feed/']);
  });

  it('reads a feed under the path a listing moved to', async () => {
    stubFetch((url) => {
      if (url === CALENDAR_URL) {
        return redirectedTo(
          listing('<link rel="alternate" type="application/rss+xml" href="https://venue.test/whats-on/feed/">'),
          'https://venue.test/whats-on/',
        );
      }
      return url === 'https://venue.test/whats-on/feed/' ? typed(RSS, 'application/rss+xml') : undefined;
    });

    const { docs } = await run({ crawl: { startUrl: CALENDAR_URL } });

    expect(docs.map(d => d.externalId)).toEqual(['https://venue.test/whats-on/feed/']);
  });

  it('still drops a feed on the host of a redirect to another site', async () => {
    const fetchFn = stubFetch(url => url === LISTING_URL
      ? redirectedTo(
          listing('<link rel="alternate" type="application/rss+xml" href="https://tickets.example/venue/feed/">'),
          'https://tickets.example/venue/',
        )
      : undefined);

    const { events } = await run({ crawl: { startUrl: LISTING_URL, maxDepth: 0 } });

    expect(events.some(e => e.message === 'source: skipped rss feed outside the listing path https://tickets.example/venue/feed/')).toBe(true);
    expect(fetchFn.mock.calls.map(c => String(c[0]))).toEqual([LISTING_URL]);
  });
});
