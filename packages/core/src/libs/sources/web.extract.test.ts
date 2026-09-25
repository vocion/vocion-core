/**
 * extractFromHtml: the parts of a page an event card actually needs, which
 * the old regex stripper deleted. JSON-LD went out with every other
 * <script>, og:image was never read, and a listing page lost the links to
 * its own detail pages.
 *
 * The two fixtures are hand-cut miniatures of two real Bellwater Hall pages,
 * a show detail page and the shows listing, small enough to read but
 * faithful where it counts: unquoted hrefs, data: URI lazy-load placeholders
 * with the real file in data-src, the price in a <span class="price">, share
 * widgets and cookie bars keyed only by class name, and the street address
 * present nowhere but the footer. The one liberty taken is the detail page's
 * Event block: the real one carries name, startDate, location.name and
 * offers.url, and the fixture adds location.address.streetAddress and
 * offers.price, which schema.org allows and other venues do publish, so the
 * test can prove nested values survive the round trip.
 */
import { describe, expect, it } from 'vitest';
import { JSON_LD_BLOCK_CAP, LINK_CAP, LINK_TEXT_CAP, pageMetadata } from './pageMetadata';
import { extractFromHtml } from './web';

const JSON_LD_HEADING = 'Structured data (JSON-LD):';
const DETAIL_URL = 'https://bellwaterhall.example/events/the-music-of-moonrise-live/';
const LISTING_URL = 'https://bellwaterhall.example/shows-at-bellwater-hall/';

const DETAIL_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>The Music of Moonrise Live | Bellwater Hall</title>
  <meta property="og:title" content="The Music of Moonrise Live">
  <meta property="og:image" content="https://bellwaterhall.example/?og_img=1&#038;pid=40405">
  <meta property="og:image:width" content="1200">
  <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"Event","name":"The Music of Moonrise Live",
     "startDate":"2026-11-01T00:00:00+00:00",
     "location":{"@type":"Place","name":"Bellwater Hall","address":{"@type":"PostalAddress","streetAddress":"88 Mill Street","addressLocality":"Riverton","addressRegion":"VT"}},
     "image":"https://images.tickethub.example/moonrise.jpg",
     "offers":{"@type":"Offer","price":"31.00-36.00","url":"https://wl.tickethub.example/event/moonrise/702172"}}
  </script>
  <style>.price { font-weight: 700 }</style>
</head>
<body>
<div class="cookie-banner">We use cookies. <a href="/privacy/">Privacy policy</a></div>
<header class="wp-block-template-part">
  <nav aria-label="Header Menu"><ul><li><a href="/shows-at-bellwater-hall/">Shows</a></li><li><a href="/venue-info/">Venue Info</a></li></ul></nav>
</header>
<main>
  <h1>The Music of Moonrise Live</h1>
  <div class="event-info-block">
    <p class="fs-18 bold mt-1r event-date"><time datetime="2026-11-01T19:30:00-05:00">Sun Nov 1</time></p>
    <p class="fs-12 venue">at Bellwater Hall</p>
    <p class="fs-12 doortime-showtime">Doors at <span class="see-doortime">7:30PM</span></p>
    <p class="fs-12"><span class="price">$31.00-$36.00</span></p>
  </div>
  <div class="event-images">
    <a href=/events/the-music-of-moonrise-live/ ><img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" data-src="https://images.tickethub.example/moonrise.jpg"></a>
    <img src="/wp-content/uploads/moonrise-hero.jpg" alt="Owen Rask on stage">
    <img src="https://analytics.example.com/px.gif" width="1" height="1" alt="">
  </div>
  <p>Tickets: <a href="/tickets/702172">Buy now</a> or at the door.<br>Doors 7:30PM, show 8:00PM.</p>
  <p>Same link again: <a href="/tickets/702172">Buy now</a></p>
  <div class="buy-and-share-block"><a href="https://www.facebook.com/sharer.php?u=moonrise">Share Event</a></div>
</main>
<footer class="wp-block-template-part">
  <p>88 Mill Street, Riverton, VT 05999 | Ph (802) 555-0142</p>
</footer>
<noscript>Enable JavaScript to buy tickets.</noscript>
<script>window.dataLayer = [{ event: 'page_view' }];</script>
</body>
</html>`;

const LISTING_HTML = `<!doctype html>
<html lang="en">
<head>
  <title>Shows at Bellwater Hall</title>
  <meta name="og:image" content="/wp-content/uploads/2026/05/LAP-20241004-9175.jpg">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebPage","name":"Bellwater Hall","url":"https://bellwaterhall.example/shows-at-bellwater-hall/"}</script>
</head>
<body>
<nav aria-label="Header Menu"><a href="/shows-at-bellwater-hall/">Shows</a> <a href="/venue-info/">Venue Info</a></nav>
<div id="upcoming" class="tickethub-list-events">
  <div class="mdc-card tickethub-list-event-container">
    <div class="tickethub-list-view-event-image-container"><a href=https://bellwaterhall.example/events/velvet-antler/ ><img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" data-src="https://images.tickethub.example/velvet-antler.jpg"></a></div>
    <div class="tickethub-list-event-content-container">
      <p class="fs-18 bold mb-12 event-title"><a href=https://bellwaterhall.example/events/velvet-antler/ >Velvet Antler</a></p>
      <p class="fs-18 bold mt-1r event-date">Thu Sep 10</p>
      <p class="fs-12 venue">at Bellwater Hall</p>
      <p class="fs-12"><span class="price">$20.00</span></p>
    </div>
    <div class="buy-and-share-block"><p>Share Event</p><a href="https://www.facebook.com/sharer.php?u=velvet-antler">Facebook</a></div>
  </div>
  <div class="mdc-card tickethub-list-event-container">
    <div class="tickethub-list-view-event-image-container"><a href=/events/nina-calder/ ><img src="/wp-content/uploads/nina-calder.jpg" alt="Nina Calder"></a></div>
    <div class="tickethub-list-event-content-container">
      <p class="fs-18 bold mb-12 event-title"><a href=/events/nina-calder/ >Nina Calder</a></p>
      <p class="fs-18 bold mt-1r event-date">Fri Sep 11</p>
      <p class="fs-12"><span class="price">$17.00-$25.00</span></p>
    </div>
  </div>
</div>
<footer><p>88 Mill Street, Riverton, VT 05999</p></footer>
</body>
</html>`;

/**
 * The JSON-LD lines, as they sit in the tail section.
 * @param content - extracted content to read the tail out of
 */
function structuredLines(content: string): string[] {
  const tail = content.split(`${JSON_LD_HEADING}\n`)[1] ?? '';
  return tail.split('\n').filter(line => line.length > 0);
}

/**
 * How many times a string appears, for the "rendered once" rules.
 * @param haystack - text to search
 * @param needle - string to count
 */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('extractFromHtml on a show detail page', () => {
  it('keeps the Event JSON-LD, compact and still parseable', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    const lines = structuredLines(content);

    expect(content).toContain(JSON_LD_HEADING);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('  ');

    const event = JSON.parse(lines[0]!) as {
      '@type': string;
      'startDate': string;
      'location': { address: { streetAddress: string } };
      'offers': { price: string; url: string };
    };

    expect(event['@type']).toBe('Event');
    expect(event.startDate).toBe('2026-11-01T00:00:00+00:00');
    expect(event.location.address.streetAddress).toBe('88 Mill Street');
    expect(event.offers.price).toBe('31.00-36.00');
    expect(event.offers.url).toBe('https://wl.tickethub.example/event/moonrise/702172');
  });

  it('carries the street address and the price in the content itself', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(content).toContain('88 Mill Street');
    expect(content).toContain('$31.00-$36.00');
  });

  it('declares the og:image as an absolute URL, entities decoded, and keeps it out of the text', () => {
    const { content, structure } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(structure?.ogImage).toBe('https://bellwaterhall.example/?og_img=1&pid=40405');
    expect(structure?.ogImage).not.toContain('og_img=1&#038;');
    expect(content).not.toContain('og_img=1');
  });

  it('renders a <time> as its label plus the machine-readable stamp', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(content).toContain('Sun Nov 1 (2026-11-01T19:30:00-05:00)');
  });

  it('makes hrefs absolute, unquoted ones included, and renders each URL once', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(content).toContain('Buy now (https://bellwaterhall.example/tickets/702172)');
    expect(occurrences(content, 'https://bellwaterhall.example/tickets/702172')).toBe(1);
    expect(content).toContain('Same link again: Buy now');
    expect(content).toContain(DETAIL_URL);
  });

  it('keeps a real image and skips placeholders, tracking pixels and repeats', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(content).toContain('[image: Owen Rask on stage](https://bellwaterhall.example/wp-content/uploads/moonrise-hero.jpg)');
    expect(content).not.toContain('data:image');
    expect(content).not.toContain('px.gif');
  });

  it('drops the nav, footer, noscript, scripts and class-flagged chrome', () => {
    const { content } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(content).not.toContain('Venue Info');
    expect(content).not.toContain('652-0777');
    expect(content).not.toContain('Enable JavaScript');
    expect(content).not.toContain('dataLayer');
    expect(content).not.toContain('Share Event');
    expect(content).not.toContain('Privacy policy');
    expect(content).not.toContain('font-weight');
  });

  it('reads the title from <title>', () => {
    const { title } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(title).toBe('The Music of Moonrise Live | Bellwater Hall');
  });
});

describe('extractFromHtml on a listing page', () => {
  it('keeps one link per detail page, absolute either way it was written', () => {
    const { content } = extractFromHtml(LISTING_HTML, LISTING_URL);

    expect(content).toContain('https://bellwaterhall.example/events/velvet-antler/');
    expect(occurrences(content, 'https://bellwaterhall.example/events/velvet-antler/')).toBe(1);
    expect(content).toContain('https://bellwaterhall.example/events/nina-calder/');
    expect(occurrences(content, 'https://bellwaterhall.example/events/nina-calder/')).toBe(1);
  });

  it('resolves a relative og:image and a relative card image', () => {
    const { content, structure } = extractFromHtml(LISTING_HTML, LISTING_URL);

    expect(structure?.ogImage).toBe('https://bellwaterhall.example/wp-content/uploads/2026/05/LAP-20241004-9175.jpg');
    expect(content).toContain('[image: Nina Calder](https://bellwaterhall.example/wp-content/uploads/nina-calder.jpg)');
    expect(content).not.toContain('data:image');
  });

  it('keeps a non-Event @type, because the engine is not events-only', () => {
    const { content } = extractFromHtml(LISTING_HTML, LISTING_URL);

    const lines = structuredLines(content);

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ '@type': 'WebPage', 'name': 'Bellwater Hall' });
  });

  it('still drops the nav, the footer and the share widgets', () => {
    const { content } = extractFromHtml(LISTING_HTML, LISTING_URL);

    expect(content).toContain('Velvet Antler');
    expect(content).toContain('$20.00');
    expect(content).not.toContain('Venue Info');
    expect(content).not.toContain('Share Event');
    expect(content).not.toContain('Facebook');
    expect(content).not.toContain('88 Mill Street');
  });

  it('leaves relative URLs alone when no base URL is given', () => {
    const { content, structure } = extractFromHtml(LISTING_HTML);

    expect(structure?.ogImage).toBe('/wp-content/uploads/2026/05/LAP-20241004-9175.jpg');
    expect(content).toContain('(/events/nina-calder/)');
    expect(content).toContain('[image: Nina Calder](/wp-content/uploads/nina-calder.jpg)');
    expect(content).not.toContain('https://bellwaterhall.example/events/nina-calder/');
  });
});

describe('extractFromHtml edge cases', () => {
  it('reads a plain page as paragraphs, minus the boilerplate, with no extra sections', () => {
    const html = `<html><head><title>About</title></head><body>
      <div id="skip-link"><a href="#main">Skip to content</a></div>
      <h1>About us</h1>
      <p>We book shows.   Two rooms,   one bar.</p>
      <p>Since 1998.<br>Still going.</p>
      <ul><li>Ballroom</li><li>Showcase Lounge</li></ul>
    </body></html>`;

    const { title, content } = extractFromHtml(html, 'https://example.com/about');

    expect(title).toBe('About');
    expect(content).toBe('About us\n\nWe book shows. Two rooms, one bar.\n\nSince 1998.\nStill going.\n\nBallroom\n\nShowcase Lounge');
    expect(content).not.toContain('Image:');
    expect(content).not.toContain(JSON_LD_HEADING);
  });

  it('keeps a <main> whose id reads like boilerplate, which is how WordPress names it', () => {
    const html = `<html><body>
      <div class="menu-main-container"><a href="/shows/">Shows</a></div>
      <main id="wp--skip-link--target"><h1>The Music of Moonrise Live</h1><p>Doors at 7:30PM.</p></main>
    </body></html>`;

    const { content } = extractFromHtml(html, 'https://bellwaterhall.example/events/moonrise/');

    expect(content).toContain('The Music of Moonrise Live');
    expect(content).toContain('Doors at 7:30PM.');
    expect(content).not.toContain('/shows/');
  });

  it('caps an oversized JSON-LD block and says so', () => {
    const filler = 'x'.repeat(30_000);
    const html = `<html><body><p>Every show, ever.</p>
      <script type="application/ld+json">{"@type":"ItemList","note":"${filler}"}</script>
    </body></html>`;

    const { content } = extractFromHtml(html, 'https://example.com/all');
    const tail = content.split(`${JSON_LD_HEADING}\n`)[1] ?? '';

    expect(content).toContain('[structured data truncated]');
    expect(tail.startsWith('{"@type":"ItemList"')).toBe(true);
    expect(tail.length).toBeLessThan(20_100);
  });

  it('skips a JSON-LD block that does not parse, and keeps the one that does', () => {
    const html = `<html><body><p>Two blocks.</p>
      <script type="application/ld+json">{ this is not json }</script>
      <script type="application/ld+json">{"@type":"Event","name":"Real one"}</script>
    </body></html>`;

    const { content } = extractFromHtml(html, 'https://example.com/e');

    expect(structuredLines(content)).toEqual(['{"@type":"Event","name":"Real one"}']);
  });

  it('falls back to og:title, then to the first h1', () => {
    const ogOnly = '<html><head><meta property="og:title" content="From og"></head><body><h1>From h1</h1></body></html>';
    const h1Only = '<html><body><header><h1>From h1</h1></header><p>Body copy.</p></body></html>';
    const neither = '<html><body><p>Body copy.</p></body></html>';

    expect(extractFromHtml(ogOnly).title).toBe('From og');
    expect(extractFromHtml(h1Only).title).toBe('From h1');
    expect(extractFromHtml(neither).title).toBeUndefined();
  });

  it('reports no content when a page has an image and nothing else, so callers still skip it', () => {
    const html = '<html><head><meta property="og:image" content="/hero.jpg"></head><body><nav>Menu</nav></body></html>';

    const { content } = extractFromHtml(html, 'https://example.com/');

    expect(content).toBe('');
  });
});

describe('extractFromHtml, lazy-loaded images', () => {
  it('takes the real file from data-src when src holds a placeholder', () => {
    const html = `<html><body><article>
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
           data-src="/wp-content/uploads/moonrise.jpg" alt="Moonrise poster">
    </article></body></html>`;
    const { content } = extractFromHtml(html, 'https://bellwaterhall.example/events/the-music-of-moonrise-live/');

    expect(content).toContain('[image: Moonrise poster](https://bellwaterhall.example/wp-content/uploads/moonrise.jpg)');
    expect(content).not.toContain('data:image/gif');
  });

  it('prefers src when src is a real URL, and ignores data-src then', () => {
    const html = `<html><body><article>
      <img src="/real.jpg" data-src="/placeholder.jpg" alt="Poster">
    </article></body></html>`;
    const { content } = extractFromHtml(html, 'https://example.org/e/');

    expect(content).toContain('[image: Poster](https://example.org/real.jpg)');
    expect(content).not.toContain('placeholder.jpg');
  });

  it('drops an image whose every candidate is a data: URI', () => {
    const html = `<html><body><article>
      <img src="data:image/gif;base64,AAAA" data-src="data:image/gif;base64,BBBB" alt="Nothing">
      <p>Real text.</p>
    </article></body></html>`;
    const { content } = extractFromHtml(html, 'https://example.org/e/');

    expect(content).not.toContain('[image');
    expect(content).toContain('Real text.');
  });
});

/**
 * A miniature whose whole output is small enough to assert byte for byte.
 * `extractFromHtml` gained a third return field, and the browse tool
 * (`libs/tools/browse/builtin.ts`) reads the same `content` the connector
 * ingests, so this is the guard that says the text did not move.
 */
const SMALL_URL = 'https://ex.test/e';
const SMALL_HTML = `<!doctype html><html><head><title>T</title>
<meta property="og:image" content="/i.jpg">
<script type="application/ld+json">{"@type":"Event","name":"N"}</script></head>
<body><nav><a href="/nav">Nav</a></nav>
<main><p>Hello <a href="/t">buy</a>.</p></main></body></html>`;

const SMALL_CONTENT = [
  'Hello buy (https://ex.test/t).',
  '',
  'Structured data (JSON-LD):',
  '{"@type":"Event","name":"N"}',
].join('\n');

describe('extractFromHtml, the content contract', () => {
  it('returns exactly the text the ingest hashes', () => {
    const { content } = extractFromHtml(SMALL_HTML, SMALL_URL);

    expect(content).toBe(SMALL_CONTENT);
  });

  it('is unchanged by the structure it also returns', () => {
    const { content, structure } = extractFromHtml(SMALL_HTML, SMALL_URL);

    expect(content).toBe(SMALL_CONTENT);
    expect(structure?.jsonLd).toBeDefined();
    expect(structure?.ogImage).toBe('https://ex.test/i.jpg');
  });

  it('reads two fetches that differ only in the og:image URL as the same text', () => {
    const dated = (day: string): string => SMALL_HTML.replace('content="/i.jpg"', `content="/i.jpg?v=${day}"`);

    const first = extractFromHtml(dated('20260921'), SMALL_URL);
    const second = extractFromHtml(dated('20260922'), SMALL_URL);

    expect(first.content).toBe(second.content);
    expect(first.structure?.ogImage).not.toBe(second.structure?.ogImage);
  });

  it('is empty for a page whose only content was its image', () => {
    const imageOnly = '<!doctype html><html><head><meta property="og:image" content="/i.jpg"></head><body></body></html>';

    const { content, structure } = extractFromHtml(imageOnly, SMALL_URL);

    expect(content).toBe('');
    expect(structure?.ogImage).toBe('https://ex.test/i.jpg');
  });
});

describe('extractFromHtml, the structure it returns', () => {
  it('returns the JSON-LD parsed, not re-stringified into the text', () => {
    const { structure } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(structure?.jsonLd).toHaveLength(1);
    expect(structure?.jsonLd?.[0]).toMatchObject({
      '@type': 'Event',
      'startDate': '2026-11-01T00:00:00+00:00',
      'offers': { price: '31.00-36.00', url: 'https://wl.tickethub.example/event/moonrise/702172' },
    });
  });

  it('returns the og:image absolute, entities decoded', () => {
    const { structure } = extractFromHtml(DETAIL_HTML, DETAIL_URL);

    expect(structure?.ogImage).toBe('https://bellwaterhall.example/?og_img=1&pid=40405');
  });

  it('returns every URL the page published, chrome included, though the text drops the chrome', () => {
    const { content, structure } = extractFromHtml(DETAIL_HTML, DETAIL_URL);
    const urls = structure?.links?.map(link => link.url) ?? [];

    expect(urls).toContain('https://bellwaterhall.example/venue-info/');
    expect(urls).toContain('https://bellwaterhall.example/tickets/702172');
    expect(content).not.toContain('Venue Info');
  });

  it('returns each URL once, with its link text', () => {
    const { structure } = extractFromHtml(DETAIL_HTML, DETAIL_URL);
    const urls = structure?.links?.map(link => link.url) ?? [];

    expect(occurrences(urls.join('\n'), 'https://bellwaterhall.example/tickets/702172')).toBe(1);
    expect(structure?.links?.find(link => link.url.endsWith('/tickets/702172'))?.text).toBe('Buy now');
  });

  it('leaves out the fields the page has nothing for', () => {
    const { structure } = extractFromHtml('<html><body><p>Just words.</p></body></html>');

    expect(structure).toEqual({});
  });

  it('says when every JSON-LD block is also in the text, whole', () => {
    const { structure } = extractFromHtml(SMALL_HTML, SMALL_URL);

    expect(structure?.jsonLdInText).toBe(true);
  });

  it('does not claim the text carries the JSON-LD once the text section had to cut it', () => {
    const block = `<script type="application/ld+json">{"@type":"Event","name":"Long","description":"${'z'.repeat(25_000)}"}</script>`;
    const { content, structure } = extractFromHtml(`<html><head>${block}</head><body><main><p>Hello.</p></main></body></html>`, SMALL_URL);

    expect(content).toContain('[structured data truncated]');
    expect(structure?.jsonLd).toHaveLength(1);
    expect(structure).not.toHaveProperty('jsonLdInText');
  });
});

describe('pageMetadata, the blob that reaches the document row', () => {
  it('omits empty parts, so a plain page still writes nothing extra', () => {
    expect(pageMetadata(undefined)).toEqual({});
    expect(pageMetadata({})).toEqual({});
  });

  it('caps the JSON-LD at whole blocks and says it truncated', () => {
    const big = { padding: 'x'.repeat(30_000) };
    const alsoBig = { padding: 'y'.repeat(30_000) };
    const meta = pageMetadata({ jsonLd: [{ keep: 1 }, big, alsoBig] });

    expect(meta.jsonLd).toEqual([{ keep: 1 }, big]);
    expect(meta.truncated).toBe(true);
  });

  it('carries the in-text flag only alongside JSON-LD it kept', () => {
    expect(pageMetadata({ jsonLd: [{ '@type': 'Event' }], jsonLdInText: true }).jsonLdInText).toBe(true);
    expect(pageMetadata({ jsonLdInText: true })).toEqual({});
  });

  it('caps the block count too', () => {
    const blocks = Array.from({ length: JSON_LD_BLOCK_CAP + 3 }, (_v, i) => ({ i }));
    const meta = pageMetadata({ jsonLd: blocks });

    expect(meta.jsonLd).toHaveLength(JSON_LD_BLOCK_CAP);
    expect(meta.truncated).toBe(true);
  });

  it('caps the link list and slices link text', () => {
    const links = Array.from({ length: LINK_CAP + 2 }, (_v, i) => ({
      url: `https://ex.test/${i}`,
      text: 'y'.repeat(LINK_TEXT_CAP + 50),
    }));
    const meta = pageMetadata({ links });

    expect(meta.links).toHaveLength(LINK_CAP);
    expect((meta.links as Array<{ text: string }>)[0]?.text).toHaveLength(LINK_TEXT_CAP);
    expect(meta.truncated).toBe(true);
  });
});
