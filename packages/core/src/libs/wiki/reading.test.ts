import type { WikiReadingPage } from './reading';
import { describe, expect, it } from 'vitest';
import { filterWikiPages, orderWikiPages, rewriteWikiLink, wikiHome, wikiNeighbours, wikiSections } from './reading';

function page(id: number, slug: string, over: Partial<WikiReadingPage> = {}): WikiReadingPage {
  return { id, slug, title: slug.replace(/-/g, ' '), summary: `about ${slug}`, md: '', order: null, tags: [], version: 1, updatedAt: new Date('2026-09-20T00:00:00Z'), lastAuthorKind: 'agent', ...over };
}

const pages = [
  page(3, 'voice', { order: 20, tags: ['house'] }),
  page(1, 'index', { title: 'Home' }),
  page(5, 'glossary'),
  page(2, 'principles', { order: 10, tags: ['house'] }),
  page(4, 'decisions', { order: 30, tags: ['record'] }),
];

describe('a wiki read as pages, not rows', () => {
  it('puts the home first, then the seeded order, then the appendices by title', () => {
    expect(orderWikiPages(pages).map(p => p.slug)).toEqual(['index', 'principles', 'voice', 'decisions', 'glossary']);
    expect(wikiHome(pages)?.slug).toBe('index');
    expect(wikiHome(pages.filter(p => p.slug !== 'index'))).toBeNull();
  });

  it('groups a generated home by first tag, untagged first', () => {
    const sections = wikiSections(orderWikiPages(pages));

    expect(sections.map(s => [s.tag, s.pages.map(p => p.slug)])).toEqual([
      [null, ['glossary']],
      ['house', ['principles', 'voice']],
      ['record', ['decisions']],
    ]);
  });

  it('knows the page before and after', () => {
    const ordered = orderWikiPages(pages);

    expect(wikiNeighbours(ordered, 'voice')).toMatchObject({ prev: { slug: 'principles' }, next: { slug: 'decisions' } });
    expect(wikiNeighbours(ordered, 'index').prev).toBeNull();
    expect(wikiNeighbours(ordered, 'nope')).toEqual({ prev: null, next: null });
  });

  it('opens a link the agent wrote as a page, not as the artifact row', () => {
    const base = '/dashboard/p/wiki';

    expect(rewriteWikiLink('/wiki/voice.md', pages, base)).toBe(`${base}/voice`);
    expect(rewriteWikiLink('principles.md#tone', pages, base)).toBe(`${base}/principles#tone`);
    expect(rewriteWikiLink('/dashboard/artifacts/4', pages, base)).toBe(`${base}/decisions`);
    // Not a page: left alone, so a real link never breaks.
    expect(rewriteWikiLink('/wiki/missing.md', pages, base)).toBe('/wiki/missing.md');
    expect(rewriteWikiLink('/dashboard/artifacts/999', pages, base)).toBe('/dashboard/artifacts/999');
    expect(rewriteWikiLink('https://example.test/x.md', pages, base)).toBe('https://example.test/x.md');
  });

  it('filters the rail by every word typed, over title, summary and tags', () => {
    expect(filterWikiPages(pages, '').length).toBe(5);
    expect(filterWikiPages(pages, 'house').map(p => p.slug).sort()).toEqual(['principles', 'voice']);
    expect(filterWikiPages(pages, 'about voice').map(p => p.slug)).toEqual(['voice']);
    expect(filterWikiPages(pages, 'zzz')).toEqual([]);
  });
});
