import type { ComparedPage } from './brief';
import type { SerpResult } from './types';
import { describe, expect, it } from 'vitest';
import { recurringHeadings, renderSerpBrief, renderSynthesis, serpBriefMeta, SYNTHESIS_START, termTable, withSynthesis } from './brief';

const SERP: SerpResult = {
  query: 'wide hiking boots',
  provider: 'serper',
  isGoogleRanking: true,
  location: 'Denver, Colorado, United States',
  language: 'en',
  device: 'desktop',
  organic: [],
  peopleAlsoAsk: [{ question: 'Should hiking boots be a size bigger?' }],
  relatedSearches: ['wide hiking boots women'],
  adsCount: null,
  retrievedAt: '2026-10-27T14:05:12.000Z',
  billedUnits: 1,
};

function page(position: number, domain: string, h2s: string[], extra: Partial<ComparedPage> = {}): ComparedPage {
  return {
    position,
    url: `https://${domain}/wide-boots`,
    domain,
    serpTitle: `${domain} boots`,
    facts: {
      url: `https://${domain}/wide-boots`,
      title: `Wide boots | ${domain}`,
      metaDescription: 'Wide boots.',
      outline: [{ level: 1, text: 'Wide boots' }, ...h2s.map(text => ({ level: 2 as const, text }))],
      wordCount: 1200 * position,
      text: `Wide boots page ${position}.`,
      schemaTypes: ['Article'],
      faq: { present: position === 1, via: position === 1 ? 'schema' : null },
      imagesCount: 3,
      links: { internal: 4, external: 2 },
      published: '2026-07-19T00:00:00Z',
      updated: null,
    },
    ...extra,
  };
}

const PAGES = [
  page(1, 'northwind-outfitters.example', ['How we tested', '1. Sizing tips']),
  page(2, 'contoso-supply.example', ['How We Tested!', 'Sizing tips']),
  { position: 3, url: 'https://acme-trail-journal.example/fit', domain: 'acme-trail-journal.example', serpTitle: 'Fit guide', serpDate: '3 days ago', facts: null, error: 'HTTP 403 from acme-trail-journal.example.' },
];

describe('the SERP brief', () => {
  const md = renderSerpBrief(SERP, PAGES);

  it('says what was read, where from, when and through whom', () => {
    expect(md).toContain('Top 3 for **wide hiking boots** · Denver, Colorado, United States · language en · desktop · read 2026-10-27 14:05 UTC from Google\'s results page, read through serper.');
  });

  it('links every row and dates it, and says which page could not be read', () => {
    expect(md).toContain('| 1 | [Wide boots \\| northwind-outfitters.example](https://northwind-outfitters.example/wide-boots) · northwind-outfitters.example | 1,200 | 2026-07-19 (published) |');
    expect(md).toContain('| 3 | [Fit guide](https://acme-trail-journal.example/fit) · acme-trail-journal.example | could not read: HTTP 403 from acme-trail-journal.example. | 3 days ago |');
  });

  // 2026-10-29: a ten-column table ran off the artifact pane.
  it('keeps the page table to four columns and lists the rest under each page', () => {
    const header = md.split('\n').find(l => l.startsWith('| # | Page'))!;

    expect(header).toBe('| # | Page | Words | Dated |');
    expect(md).toContain('## Each page');
    expect(md).toContain('**Words** 1,200 · **H2s** 2 · **Schema** Article · **FAQ** yes (schema) · **Images** 3 · **Links in / out** 4 / 2 · **Published** 2026-07-19 · **Updated** not stated');
  });

  it('lists headings two pages share, matched loosely, each citing its pages', () => {
    expect(recurringHeadings(PAGES).map(r => [r.heading, r.positions])).toEqual([['How we tested', [1, 2]], ['Sizing tips', [1, 2]]]);
    expect(md).toContain('- How we tested (also “How We Tested!”) · 2 pages: [#1](https://northwind-outfitters.example/wide-boots) [#2](https://contoso-supply.example/wide-boots)');
  });

  it('carries what it was read for, so a page can check it before using it', () => {
    expect(serpBriefMeta(md)).toEqual({ query: 'wide hiking boots', location: 'Denver, Colorado, United States', google: true, provider: 'serper' });
    expect(serpBriefMeta('# SERP brief: an older one')).toBeNull();
    expect(serpBriefMeta(renderSerpBrief({ ...SERP, query: 'boots -- sale' }, PAGES))!.query).toBe('boots -- sale');
  });

  it('labels a fallback as not Google', () => {
    const fallback = renderSerpBrief({ ...SERP, provider: 'web_search:brave', isGoogleRanking: false, note: 'Brave results, not Google\'s ranking.' }, PAGES);

    expect(fallback).toContain('from brave web search (not Google).');
    expect(fallback).toContain('> Brave results, not Google\'s ranking.');
  });

  it('takes the synthesis between its markers, every point cited', () => {
    const synthesis = renderSynthesis({ intent: 'Comparing wide boots before buying.', commonSubtopics: [{ point: 'How the boots were tested', sources: [1, 2] }], gaps: [{ point: 'Nobody covers half sizes', sources: [] }] }, PAGES);
    const next = withSynthesis(md, synthesis)!;

    expect(next).toContain('**Search intent.** Comparing wide boots before buying.');
    expect(next).toContain('- How the boots were tested · [#1](https://northwind-outfitters.example/wide-boots) [#2](https://contoso-supply.example/wide-boots)');
    expect(next).toContain('- Nobody covers half sizes · (no page cited)');
    expect(next).not.toContain('_Not written yet._');
    expect(next.startsWith(md.slice(0, md.indexOf(SYNTHESIS_START)))).toBe(true);
    expect(withSynthesis('# edited away', synthesis)).toBeNull();
  });
});

describe('a local results page', () => {
  const LOCAL: SerpResult = {
    ...SERP,
    query: 'water heater repair fairview',
    location: 'Fairview, Oregon, United States',
    localPack: [
      { position: 1, name: 'Northwind Home Services', rating: 4.8, reviews: 212, category: 'Plumber', website: 'https://www.northwind-home.example/', domain: 'northwind-home.example', address: '120 Example St, Fairview' },
      { position: 2, name: 'Fairview Rooter & Drain', category: 'Plumber' },
    ],
  };
  const body = (extra: string) => `Northwind Home Services repairs tankless water heaters and replaces the anode rod. ${extra}`;
  function local(position: number, domain: string, h2s: string[], text: string, directory = false): ComparedPage {
    const p = page(position, domain, h2s);
    return { ...p, ...(directory ? { directory: true } : {}), facts: { ...p.facts!, text, wordCount: 500 * position } };
  }
  const pages = [
    local(1, 'yelp.com', ['Top 10 water heater repair', 'Frequently asked questions'], body('Read reviews.'), true),
    local(2, 'northwind-home.example', ['Our process', 'Service area'], body('We serve Fairview and Lakeside.')),
    local(3, 'angi.com', ['Frequently asked questions', 'Our process'], body('Compare pros.'), true),
    local(4, 'lakeside-plumbing.example', ['Our repair process', 'Service areas'], body('Same-day visits.')),
    local(5, 'contoso-supply.example', ['How it works'], body('Parts in stock.')),
  ];
  const md = renderSerpBrief(LOCAL, pages);

  it('lists directories in the table, flagged, and says they are left out', () => {
    expect(md).toContain('| 1 | [Wide boots \\| yelp.com](https://yelp.com/wide-boots) · yelp.com · directory |');
    expect(md).toContain('2 of the top 5 are directories, marketplaces or social sites ([#1](https://yelp.com/wide-boots) [#3](https://angi.com/wide-boots))');
  });

  it('leaves directories out of the median and the shared headings', () => {
    // 1,000, 2,000 and 2,500 words on the three business pages: the median is 2,000, not 1,500 with the directories in.
    expect(md).toContain('Median length 2,000 words across the 3 pages read');

    const headings = recurringHeadings(pages);

    expect(headings.map(h => [h.heading, h.positions])).toEqual([['Our process', [2, 4]], ['Service area', [2, 4]]]);
    expect(headings.flatMap(h => h.positions)).not.toContain(1);
    expect(headings.find(h => h.heading === 'Frequently asked questions')).toBeUndefined();
  });

  it('shows the local pack with ratings, reviews, category, website and address', () => {
    expect(md).toContain('## Local pack');
    expect(md).toContain('| 1 | Northwind Home Services | 4.8 | 212 | Plumber | [northwind-home.example](https://www.northwind-home.example/) | 120 Example St, Fairview |');
    expect(md).toContain('| 2 | Fairview Rooter & Drain |  |  | Plumber | none listed |  |');
  });

  it('tables the terms three or more business pages use, with the pages, never counting a directory', () => {
    const terms = termTable(pages, LOCAL.query);
    const anode = terms.find(t => t.term === 'anode rod');

    expect(anode?.positions).toEqual([2, 4, 5]);
    expect(md).toContain('## Terms the top pages use');
    expect(md).toMatch(/\| anode rod \| 3 \| \[#2\]\(https:\/\/northwind-home\.example\/wide-boots\) \[#4\]/);
    expect(terms.find(t => t.term.includes('reviews'))).toBeUndefined();
  });
});
