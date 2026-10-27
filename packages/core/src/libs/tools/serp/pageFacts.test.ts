import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPageFacts } from './pageFacts';

const HTML = readFileSync(join(__dirname, 'fixtures', 'ranking-page.html'), 'utf8');
const URL_ = 'https://northwind-outfitters.example/guides/wide-hiking-boots';

describe('extractPageFacts', () => {
  const facts = extractPageFacts(HTML, URL_);

  it('reads the title and meta description', () => {
    expect(facts.title).toBe('Best Wide Hiking Boots, Tested on 200 Miles of Trail | Northwind Outfitters');
    expect(facts.metaDescription).toMatch(/^We tested twelve wide-fit/);
  });

  it('outlines H1 to H3 in order, leaving out the menu and the footer', () => {
    expect(facts.outline).toEqual([
      { level: 1, text: 'Best Wide Hiking Boots, Tested' },
      { level: 2, text: 'How we tested' },
      { level: 3, text: 'Fit' },
      { level: 2, text: 'The best wide boots' },
      { level: 2, text: 'FAQ' },
    ]);
  });

  it('declares schema.org types from a JSON-LD graph', () => {
    expect(facts.schemaTypes).toEqual(['Article', 'BreadcrumbList', 'FAQPage', 'Question']);
    expect(facts.faq).toEqual({ present: true, via: 'schema' });
  });

  it('counts the content, not the scripts or the chrome', () => {
    expect(facts.wordCount).toBeGreaterThan(30);
    expect(facts.wordCount).toBeLessThan(80);
    expect(facts.imagesCount).toBe(2);
    expect(facts.links).toEqual({ internal: 1, external: 1 });
  });

  it('takes the dates the page states', () => {
    expect(facts.published).toBe('2026-07-19');
    expect(facts.updated).toBe('2026-09-02T10:00:00Z');
  });

  it('finds an FAQ by its heading when no schema says so, and states no date it was not given', () => {
    const bare = extractPageFacts('<html><body><h2>Frequently asked questions</h2><p>One two three.</p></body></html>', URL_);

    expect(bare.faq).toEqual({ present: true, via: 'heading' });
    expect(bare.published).toBeNull();
    expect(bare.updated).toBeNull();
    expect(bare.wordCount).toBe(6);
  });
});
