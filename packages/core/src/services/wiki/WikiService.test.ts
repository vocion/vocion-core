import type { WikiPage } from './WikiService';
import { describe, expect, it } from 'vitest';
import { firstParagraph, planWikiMount, renderWikiIndex, wikiSlug } from './WikiService';

// The pure half of the wiki: slugs, the index, the mount plan. No database.

function page(over: Partial<WikiPage> & { slug: string }): WikiPage {
  return {
    id: 1,
    title: over.slug,
    md: 'Body.',
    summary: '',
    tags: [],
    version: 1,
    updatedAt: new Date('2026-09-18T12:00:00Z'),
    createdAt: new Date('2026-09-01T00:00:00Z'),
    lastAuthorKind: 'agent',
    href: '/dashboard/artifacts/1',
    ...over,
  };
}

describe('wikiSlug', () => {
  it('normalises a title into a stable slug', () => {
    expect(wikiSlug('Founder voice')).toBe('founder-voice');
    expect(wikiSlug('  Who   is_who? ')).toBe('who-is-who');
    expect(wikiSlug('Décisions 2026')).toBe('decisions-2026');
  });

  it('never yields a slug starting with a digit, and empty for nothing usable', () => {
    expect(wikiSlug('2026 plan')).toBe('p-2026-plan');
    expect(wikiSlug('???')).toBe('');
  });
});

describe('firstParagraph', () => {
  it('skips headings and front-matter rules and flattens whitespace', () => {
    expect(firstParagraph('# Title\n\n---\n\nThe first\nreal line.\n\nMore.')).toBe('The first real line.');
    expect(firstParagraph('# Only a heading')).toBe('');
    expect(firstParagraph('| a | b |\n|---|---|\n\n- a list\n\nProse at last.')).toBe('Prose at last.');
  });
});

describe('renderWikiIndex', () => {
  it('names every page with summary, version, freshness and author kind, newest first as given', () => {
    const now = new Date('2026-09-20T12:00:00Z');
    const out = renderWikiIndex([
      page({ slug: 'voice', title: 'Voice', summary: 'How we sound.', version: 3, updatedAt: new Date('2026-09-20T09:00:00Z') }),
      page({ slug: 'decisions', title: 'Decisions', version: 1, lastAuthorKind: 'human', updatedAt: new Date('2026-09-18T12:00:00Z'), md: 'Dated sections.' }),
    ], now);

    expect(out).toContain('- **Voice** (`voice`, v3, today, agent) — How we sound.');
    expect(out).toContain('- **Decisions** (`decisions`, v1, 2 days ago, human) — Dated sections.');
    expect(out).toContain('write_wiki_page');
  });

  it('says so when the wiki is empty', () => {
    expect(renderWikiIndex([])).toContain('No pages yet');
  });
});

describe('planWikiMount', () => {
  it('mounts the index and only the pages tagged always, names the rest as on demand, and holds the budget', () => {
    const big = 'x'.repeat(900);
    const pages = [
      page({ slug: 'a', title: 'A', md: big, tags: ['always'] }),
      page({ slug: 'b', title: 'B', md: big, tags: ['always'] }),
      page({ slug: 'c', title: 'C', md: big, tags: ['always'] }),
      page({ slug: 'd', title: 'D', md: big }),
    ];
    // Room for the index and two whole pages, not three; d is never mounted whole.
    const files = planWikiMount(pages, renderWikiIndex(pages).length + 2 * `# A\n\n${big}`.length + 10);

    expect(Object.keys(files)).toEqual(['/wiki/index.md', '/wiki/a.md', '/wiki/b.md']);
    expect(files['/wiki/a.md']).toBe(`# A\n\n${big}`);
    expect(files['/wiki/index.md']).toContain('Tagged always but over the mount budget (read with read_wiki_page): c');
    expect(files['/wiki/index.md']).toContain('Read on demand with read_wiki_page when the turn is about them: d');
  });

  it('mounts only the index for an empty wiki', () => {
    expect(Object.keys(planWikiMount([]))).toEqual(['/wiki/index.md']);
  });

  it('a page nobody tagged always is one line in the index, not a body in every turn', () => {
    const files = planWikiMount([page({ slug: 'plan', title: 'The plan', md: 'x'.repeat(4000) })]);

    expect(Object.keys(files)).toEqual(['/wiki/index.md']);
    expect(files['/wiki/index.md']).toContain('- **The plan** (`plan`');
    expect(files['/wiki/index.md']).toContain('Read on demand with read_wiki_page when the turn is about them: plan');
  });

  it('a seeded `index` page leads the mounted index, the rendered listing follows, and it is not mounted twice', () => {
    const files = planWikiMount([
      page({ slug: 'index', title: 'Start here', md: 'Read Voice first.' }),
      page({ slug: 'voice', title: 'Voice', summary: 'How we sound.', tags: ['always'] }),
    ]);

    expect(Object.keys(files)).toEqual(['/wiki/index.md', '/wiki/voice.md']);
    expect(files['/wiki/index.md']!.startsWith('# Start here\n\nRead Voice first.\n\n---\n\n# Workspace wiki')).toBe(true);
    expect(files['/wiki/index.md']).toContain('- **Voice** (`voice`');
    expect(files['/wiki/index.md']).not.toContain('- **Start here**');
  });
});
