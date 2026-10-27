import type { ComparedPage } from './brief';
import type { SerpResult } from './types';
import { describe, expect, it } from 'vitest';
import { recurringHeadings, renderSerpBrief, renderSynthesis, SYNTHESIS_START, withSynthesis } from './brief';

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
    expect(md).toContain('| 1 | [Wide boots \\| northwind-outfitters.example](https://northwind-outfitters.example/wide-boots) · northwind-outfitters.example | 1,200 | 2 | Article | yes (schema) | 3 | 4 / 2 | 2026-07-19 | not stated |');
    expect(md).toContain('| 3 | [Fit guide](https://acme-trail-journal.example/fit) · acme-trail-journal.example | could not read: HTTP 403 from acme-trail-journal.example. | | | | | | 3 days ago | |');
  });

  it('lists headings two pages share, each citing its pages', () => {
    expect(recurringHeadings(PAGES).map(r => [r.heading, r.positions])).toEqual([['How we tested', [1, 2]], ['Sizing tips', [1, 2]]]);
    expect(md).toContain('- How we tested · 2 pages: [#1](https://northwind-outfitters.example/wide-boots) [#2](https://contoso-supply.example/wide-boots)');
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
