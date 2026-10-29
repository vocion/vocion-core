/**
 * What a ranking page is made of, read off its HTML: the facts an SEO brief
 * compares across Google's top results. Pure — the fetch happens elsewhere
 * (`BrowseProvider.fetchHtml`) — so every rule here is tested on fixtures.
 *
 * Each fact is read, never inferred: a date is the one the page states (its
 * schema.org, its article meta, a `<time>`), and a page that states none has
 * none. The model writes the synthesis on top of these; it does not get to
 * invent them.
 */

import type { CheerioAPI } from 'cheerio';
import { load } from 'cheerio';

export type OutlineHeading = { level: 1 | 2 | 3; text: string };

export type PageFacts = {
  url: string;
  title: string | null;
  metaDescription: string | null;
  /**
   * The canonical URL the page declares (`<link rel="canonical">`), absolute;
   * null when it declares none. Optional only for facts built by hand.
   */
  canonical?: string | null;
  /** The page asks not to be indexed (`<meta name="robots">` or `googlebot` with `noindex`). */
  noindex?: boolean;
  /** H1–H3 in document order, capped. */
  outline: OutlineHeading[];
  /** Words in the main content (scripts, navigation, header and footer left out). */
  wordCount: number;
  /**
   * The main content as plain text, the same text the words were counted on,
   * capped at `TEXT_CAP` characters. What the page actually says, so gaps
   * are judged from the body and not from headings alone.
   */
  text: string;
  /** schema.org types the page declares (JSON-LD and microdata), de-duplicated. */
  schemaTypes: string[];
  /** An FAQ section: `schema` when FAQPage is declared, `heading` when only a heading says so. */
  faq: { present: boolean; via: 'schema' | 'heading' | null };
  imagesCount: number;
  links: { internal: number; external: number };
  /** Dates the page states, as it states them (ISO when it gives ISO). */
  published: string | null;
  updated: string | null;
};

/** Headings kept per page: the outline is evidence, not the page. */
const OUTLINE_CAP = 80;

/** Characters of main text kept per page: enough for every term a page uses, never the whole site. */
export const TEXT_CAP = 40_000;

/** Everything that is chrome rather than content. */
const CHROME = 'script, style, noscript, template, svg, nav, header, footer, aside, form, iframe, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]';

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function meta($: CheerioAPI, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = $(`meta[name="${key}"]`).attr('content') ?? $(`meta[property="${key}"]`).attr('content') ?? $(`meta[itemprop="${key}"]`).attr('content');
    if (value && clean(value)) {
      return clean(value);
    }
  }
  return null;
}

/**
 * Every JSON-LD node on the page, `@graph` flattened.
 * @param $ - The parsed page.
 */
export function jsonLdNodes($: CheerioAPI): Array<Record<string, unknown>> {
  const nodes: Array<Record<string, unknown>> = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === 'object') {
      const node = value as Record<string, unknown>;
      nodes.push(node);
      if (node['@graph']) {
        visit(node['@graph']);
      }
      if (node.mainEntity && typeof node.mainEntity === 'object') {
        visit(node.mainEntity);
      }
    }
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // A malformed block is the page's problem; the rest still count.
    }
  });
  return nodes;
}

export function typesOf(node: Record<string, unknown>): string[] {
  const raw = node['@type'];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((t): t is string => typeof t === 'string').map(t => t.replace(/^https?:\/\/schema\.org\//, ''));
}

function firstString(nodes: Array<Record<string, unknown>>, key: string): string | null {
  for (const node of nodes) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Read a page's facts from its HTML.
 * @param html - The page as served.
 * @param url - Where it was read from: resolves links, decides internal vs external.
 */
export function extractPageFacts(html: string, url: string): PageFacts {
  const $ = load(html);
  const nodes = jsonLdNodes($);
  const schemaTypes = new Set<string>(nodes.flatMap(typesOf));
  $('[itemtype]').each((_, el) => {
    for (const t of ($(el).attr('itemtype') ?? '').split(/\s+/)) {
      const name = t.replace(/^https?:\/\/schema\.org\//, '');
      if (name) {
        schemaTypes.add(name);
      }
    }
  });

  const outline: OutlineHeading[] = [];
  // Headings in the site's chrome (a footer's "Newsletter", a menu's
  // "Shop") are not the page's outline; a header's H1 is, so header stays.
  $('h1, h2, h3').each((_, el) => {
    if (outline.length >= OUTLINE_CAP || $(el).closest('footer, nav, aside, [role="contentinfo"], [role="navigation"]').length > 0) {
      return;
    }
    const text = clean($(el).text());
    if (text) {
      outline.push({ level: Number(el.tagName.slice(1)) as 1 | 2 | 3, text });
    }
  });

  const title = clean($('title').first().text()) || null;
  const metaDescription = meta($, 'description', 'og:description');
  const canonicalHref = $('link[rel~="canonical"]').first().attr('href')?.trim();
  let canonical: string | null = null;
  if (canonicalHref) {
    try {
      canonical = new URL(canonicalHref, url).toString();
    } catch {
      canonical = canonicalHref;
    }
  }
  const noindex = $('meta[name="robots" i], meta[name="googlebot" i]').toArray().some(el => /\bnoindex\b/i.test($(el).attr('content') ?? ''));

  const faqByHeading = outline.some(h => /\bfaqs?\b|frequently asked/i.test(h.text));
  const faq = schemaTypes.has('FAQPage')
    ? { present: true, via: 'schema' as const }
    : faqByHeading ? { present: true, via: 'heading' as const } : { present: false, via: null };

  const published = firstString(nodes, 'datePublished')
    ?? meta($, 'article:published_time', 'datePublished', 'date', 'pubdate')
    ?? ($('time[datetime]').first().attr('datetime')?.trim() || null);
  const updated = firstString(nodes, 'dateModified')
    ?? meta($, 'article:modified_time', 'og:updated_time', 'dateModified', 'last-modified');

  // Content: the main element when there is one, else the body; chrome out.
  $(CHROME).remove();
  const main = $('main').length ? $('main') : $('article').length ? $('article') : $('body');
  // Blocks end words: "Questions</h2><p>One" is two words, not one.
  main.find('p, div, li, h1, h2, h3, h4, h5, h6, td, th, br, section, blockquote, dt, dd, figcaption, pre').each((_, el) => {
    $(el).append(' ');
  });
  const mainText = clean(main.text());
  const words = mainText.split(' ').filter(w => /\w/.test(w));

  const own = hostOf(url);
  let internal = 0;
  let external = 0;
  main.find('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (/^(?:#|mailto:|tel:|javascript:)/i.test(href)) {
      return;
    }
    let target: URL;
    try {
      target = new URL(href, url);
    } catch {
      return;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return;
    }
    if (hostOf(target.toString()) === own) {
      internal++;
    } else {
      external++;
    }
  });

  return {
    url,
    title,
    metaDescription,
    canonical,
    noindex,
    outline,
    wordCount: words.length,
    text: mainText.slice(0, TEXT_CAP),
    schemaTypes: [...schemaTypes].sort(),
    faq,
    imagesCount: main.find('img').length,
    links: { internal, external },
    published,
    updated,
  };
}
