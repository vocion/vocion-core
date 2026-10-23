// Shared by every grader. Copied beside the graders as .eval-grader/helpers.mjs, so a grader
// never depends on a file the engineer may have changed.
import { handle } from '../src/api.mjs';
import { createStore } from '../src/store.mjs';

export { createStore, handle };

const NAMED = { nbsp: ' ', quot: '"', apos: '\'', lt: '<', gt: '>', mdash: '\u2014', ndash: '\u2013', middot: '\u00B7', hellip: '\u2026', bull: '\u2022', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201C', rdquo: '\u201D', times: '\u00D7', larr: '\u2190', rarr: '\u2192', copy: '\u00A9' };

/** The visible text of an HTML string: tags removed, common entities decoded, spaces collapsed. */
export function text(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m)
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The HTML of each element carrying data-testid="<id>", in document order (non-nested tags). */
export function byTestId(html, id) {
  const out = [];
  const re = new RegExp(`<(\\w+)[^>]*data-testid="${id}"[^>]*>`, 'g');
  let m = re.exec(html);
  while (m) {
    const tag = m[1];
    let depth = 1;
    let i = m.index + m[0].length;
    const open = new RegExp(`<${tag}[\\s>]|</${tag}>`, 'g');
    open.lastIndex = i;
    let n = open.exec(html);
    while (n && depth > 0) {
      depth += n[0].startsWith('</') ? -1 : 1;
      i = n.index + n[0].length;
      n = depth > 0 ? open.exec(html) : null;
    }
    out.push(depth === 0 ? html.slice(m.index, i) : m[0]);
    m = re.exec(html);
  }
  return out;
}

/** The library rows of a page, keyed by document id. */
export function rowsById(html) {
  return Object.fromEntries(byTestId(html, 'doc-row').map(r => [(r.match(/data-id="([^"]+)"/) || [])[1], r]));
}

/** Document ids of the library rows, in order. */
export function rowIds(html) {
  return byTestId(html, 'doc-row').map(r => (r.match(/data-id="([^"]+)"/) || [])[1]);
}

/** A store on the seed data with the clock set to `now` (ISO). */
export function storeAt(now) {
  const store = createStore();
  if (now) {
    store.db.now = now;
  }
  return store;
}

export function api(store, req) {
  return handle(store, req);
}
