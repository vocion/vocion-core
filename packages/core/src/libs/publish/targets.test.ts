import type { GithubTarget } from './targets';
import { describe, expect, it } from 'vitest';
import { renderPageFile } from './pageFile';
import { emptyPlaceholders, escapeForMdx, fillTemplate, formatDate, formatOf, publishTargetLine, publishTargetSchema, publishTargetsOf, readTimeOf, resolvePublishTarget, slugify, squarespaceBlogUrl, stripBylineBlock, stripMetaBlock, wordCount } from './targets';

const github = {
  id: 'site',
  kind: 'github',
  label: 'Northwind site',
  config: {
    repo: 'example-org/northwind-site',
    baseBranch: 'main',
    path: 'src/content/blog/{slug}.mdx',
    frontmatter: { title: '{title}', description: '{description}', pubDate: '{date}', draft: false, tags: ['camping', '{keyword}'] },
  },
};
const squarespace = { id: 'blog', kind: 'squarespace', config: { siteUrl: 'https://example-site.squarespace.com', blogPath: '/journal' } };

const page = { title: 'How to Choose a Three-Season Tent', description: 'What matters, what does not, and what to spend.', slug: 'choose-a-three-season-tent', keyword: 'three season tent', at: new Date('2026-10-27T15:04:00Z') };

describe('a project\'s publish targets', () => {
  it('reads the targets that hold and names the ones that do not', () => {
    const out = publishTargetsOf([
      github,
      squarespace,
      { id: 'bad', kind: 'github', config: { repo: 'example-org/northwind-site', path: 'blog/post.md' } },
      { id: 'site', kind: 'squarespace', config: { siteUrl: 'https://example-site.squarespace.com' } },
      { id: 'wp', kind: 'wordpress', config: { siteUrl: 'https://northwind-outfitters.example' } },
    ]);

    expect(out.targets.map(t => t.id)).toEqual(['site', 'blog', 'wp']);
    expect(out.problems).toHaveLength(2);
    expect(out.problems[0]).toMatch(/^bad: config\.path the path names the page with \{slug\}/);
    expect(out.problems[1]).toMatch(/^site: a second target with this id/);
  });

  it('refuses a template that names a value a page cannot fill', () => {
    const out = publishTargetsOf([{ ...github, config: { ...github.config, frontmatter: { editor: '{editor}', on: '{datetime:MMMM}', at: '{date:Q}' } } }]);

    expect(out.targets).toEqual([]);
    expect(out.problems[0]).toMatch(/uses \{editor\}, \{datetime:MMMM\}, \{date:Q\}, which a page cannot fill/);
  });

  it('resolves the target a page names, or the only one, and says why otherwise', () => {
    expect(resolvePublishTarget([github, squarespace], 'blog')).toMatchObject({ ok: true, target: { id: 'blog' } });
    expect(resolvePublishTarget([github])).toMatchObject({ ok: true, target: { id: 'site' } });
    expect(resolvePublishTarget([github, squarespace])).toEqual({ ok: false, why: 'The project publishes to site, blog: name the target this page goes to.' });
    expect(resolvePublishTarget(undefined)).toMatchObject({ ok: false, why: expect.stringMatching(/says nowhere to publish/) });
    expect(resolvePublishTarget([github], 'nope')).toMatchObject({ ok: false, why: expect.stringMatching(/no publish target "nope"; it has site/) });
  });

  it('gives a Squarespace blog its address', () => {
    const { targets } = publishTargetsOf([squarespace]);

    expect(squarespaceBlogUrl(targets[0] as never)).toBe('https://example-site.squarespace.com/journal');
  });
});

describe('the page file a GitHub target writes', () => {
  it('fills the site\'s own frontmatter, key for key, and drops the H1 the title already carries', () => {
    const { targets } = publishTargetsOf([github]);
    const file = renderPageFile(targets[0] as never, page, { markdown: '# How to Choose a Three-Season Tent\n\nPick the {right} one.\n\n## Weight\n\nUnder 2 kg.' });

    expect(file.path).toBe('src/content/blog/choose-a-three-season-tent.mdx');
    expect(file.format).toBe('mdx');
    expect(file.content).toBe([
      '---',
      'title: "How to Choose a Three-Season Tent"',
      'description: "What matters, what does not, and what to spend."',
      'pubDate: "2026-10-27"',
      'draft: false',
      'tags:',
      '  - "camping"',
      '  - "three season tent"',
      '---',
      '',
      'Pick the \\{right\\} one.',
      '',
      '## Weight',
      '',
      'Under 2 kg.',
      '',
    ].join('\n'));
  });

  it('writes an html target from the rendered body, and a plain md one as written', () => {
    const { targets } = publishTargetsOf([{ id: 'h', kind: 'github', config: { repo: 'example-org/northwind-site', path: '_posts/{date}-{slug}.html', frontmatter: { layout: 'post', title: '{title}' } } }]);
    const html = renderPageFile(targets[0] as never, page, { markdown: '# T\n\nBody', html: '<p>Body</p>' });

    expect(formatOf(targets[0] as never)).toBe('html');
    expect(html.path).toBe('_posts/2026-10-27-choose-a-three-season-tent.html');
    expect(html.content).toBe('---\nlayout: "post"\ntitle: "How to Choose a Three-Season Tent"\n---\n\n<p>Body</p>\n');

    const md = publishTargetsOf([{ id: 'm', kind: 'github', config: { repo: 'example-org/northwind-site', path: 'posts/{slug}.md' } }]).targets[0];

    expect(renderPageFile(md as never, page, { markdown: '# Kept\n\nA {brace}.' }).content).toBe('# Kept\n\nA {brace}.\n');
  });

  it('leaves code and tags alone when it escapes for MDX', () => {
    expect(escapeForMdx('a {b} < c `{d}` <Tip/>\n```\n{e}\n```')).toBe('a \\{b\\} &lt; c `{d}` <Tip/>\n```\n{e}\n```');
  });

  it('makes slugs and fills templates', () => {
    expect(slugify('Café & Crème: 3-Season Tents!')).toBe('cafe-and-creme-3-season-tents');
    expect(fillTemplate('{datetime}|{keyword}|{unknown}', page)).toBe('2026-10-27T15:04:00.000Z|three season tent|{unknown}');
  });

  it('keeps a writer\'s trailing meta block off the page', () => {
    expect(stripMetaBlock('Body.\n\n## Meta\n\n**Meta title:** T\nMeta description: D\nSlug: s\n')).toBe('Body.');
    expect(stripMetaBlock('Body.\n\n---\nURL slug: s')).toBe('Body.');
    expect(stripMetaBlock('Body.\n\n## Meta-analysis\n\nIt holds.')).toBe('Body.\n\n## Meta-analysis\n\nIt holds.');
    expect(fillTemplate('{metaTitle}|{title}', { ...page, metaTitle: 'Short' })).toBe('Short|How to Choose a Three-Season Tent');
    expect(fillTemplate('{metaTitle}', page)).toBe('How to Choose a Three-Season Tent');
  });
});

describe('a real site\'s post schema', () => {
  // An Astro-like content collection, as a fictional client's site declares it.
  const astro = {
    id: 'blog',
    kind: 'github',
    label: 'Northwind Home Services blog',
    config: {
      repo: 'example-org/northwind-site',
      baseBranch: 'main',
      path: 'src/content/blog/{date:YYYY-MM-DD}-{slug}.mdx',
      frontmatter: {
        layout: '../../layouts/BlogPost.astro',
        title: '{title}',
        excerpt: '{excerpt}',
        publishDate: '{date:MMMM D, YYYY}',
        isoDate: '{date:ISO}',
        author: '{author}',
        authorSlug: '{authorSlug}',
        category: '{category}',
        tags: '{tags}',
        readTime: '{readTime}',
        draft: false,
        image: { src: '/images/blog/default.jpg', alt: '{title}' },
      },
    },
  };
  const post = {
    title: 'When to Replace a Water Heater',
    description: 'The signs a water heater is done, and what a replacement costs.',
    slug: 'when-to-replace-a-water-heater',
    at: new Date('2026-07-08T16:00:00Z'),
    author: 'Dana Whitfield',
    authorSlug: 'dana-w',
    category: 'Plumbing',
    tags: ['water heaters', 'maintenance'],
    words: 1040,
  };

  it('fills every field, keeps dates as strings, writes tags as a list and keeps the byline out of the body', () => {
    const { targets, problems } = publishTargetsOf([astro]);

    expect(problems).toEqual([]);

    const file = renderPageFile(targets[0] as never, post, { markdown: '# When to Replace a Water Heater\n\n**Author:** Dana Whitfield\n**Category:** Plumbing\n\nMost tanks last ten years.' });

    expect(file.path).toBe('src/content/blog/2026-07-08-when-to-replace-a-water-heater.mdx');
    expect(file.content).toBe([
      '---',
      'layout: "../../layouts/BlogPost.astro"',
      'title: "When to Replace a Water Heater"',
      'excerpt: "The signs a water heater is done, and what a replacement costs."',
      'publishDate: "July 8, 2026"',
      'isoDate: "2026-07-08T16:00:00.000Z"',
      'author: "Dana Whitfield"',
      'authorSlug: "dana-w"',
      'category: "Plumbing"',
      'tags:',
      '  - "water heaters"',
      '  - "maintenance"',
      'readTime: "5 min read"',
      'draft: false',
      'image:',
      '  src: "/images/blog/default.jpg"',
      '  alt: "When to Replace a Water Heater"',
      '---',
      '',
      'Most tanks last ten years.',
      '',
    ].join('\n'));
  });

  it('formats dates three ways and reads time from the word count', () => {
    const at = new Date('2026-07-08T16:00:00Z');

    expect(formatDate(at, 'MMMM D, YYYY')).toBe('July 8, 2026');
    expect(formatDate(at, 'YYYY-MM-DD')).toBe('2026-07-08');
    expect(formatDate(at, 'MMM D, YYYY')).toBe('Jul 8, 2026');
    expect(formatDate(at, 'ISO')).toBe('2026-07-08T16:00:00.000Z');
    expect(readTimeOf(90)).toBe('1 min read');
    expect(wordCount('# Title\n\nOne two, three. [four](https://example.com) `five`')).toBe(6);
  });

  it('slugs the author from the name when the project names no slug, and joins tags inside a string', () => {
    expect(fillTemplate('{authorSlug}|{tags}|{excerpt}', { ...post, authorSlug: null, excerpt: 'Short.' })).toBe('dana-whitfield|water heaters, maintenance|Short.');
  });

  it('names the fields a page has no value for, so nothing ships empty', () => {
    const { targets } = publishTargetsOf([astro]);

    expect(emptyPlaceholders(targets[0] as never, { ...post, author: null, authorSlug: null, category: '' })).toEqual(['author', 'authorSlug', 'category']);
    expect(emptyPlaceholders(targets[0] as never, post)).toEqual([]);
  });
});

describe('the byline is the page\'s, not the body\'s', () => {
  it('strips a byline block under the H1 or at the top, and a rule under it', () => {
    expect(stripBylineBlock('# Title\n\n**Author:** Dana Whitfield\n**Category:** Plumbing\n\n---\n\nBody.')).toBe('# Title\n\nBody.');
    expect(stripBylineBlock('**By:** Dana Whitfield | **Category:** Plumbing\n\nBody.')).toBe('Body.');
    expect(stripBylineBlock('- Author: Dana\n- Tags: a, b\n\n# Title\n\nBody.')).toBe('# Title\n\nBody.');
  });

  it('leaves a body that opens with prose alone', () => {
    expect(stripBylineBlock('# Title\n\nThe author of this guide: a plumber.\n\nCategory: one of many.')).toBe('# Title\n\nThe author of this guide: a plumber.\n\nCategory: one of many.');
  });
});

describe('a target in a line', () => {
  it('says the label once', () => {
    expect(publishTargetLine({ id: 'blog', kind: 'github', label: 'Northwind blog', config: { repo: 'example-org/northwind-site' } })).toBe('Northwind blog — GitHub example-org/northwind-site');
    expect(publishTargetLine({ id: 'blog', kind: 'github', config: { repo: 'example-org/northwind-site' } })).toBe('GitHub example-org/northwind-site');
  });
});

describe('a date reaches the site as a string (first real publish, 2026-10-28: an Astro build refused a bare YAML date)', () => {
  it('quotes every date, in the target\'s format, so a YAML 1.1 reader keeps it a string', async () => {
    const { parse } = await import('yaml');
    const target = publishTargetSchema.parse({ id: 'site', kind: 'github', config: { repo: 'example-org/northwind-site', path: 'src/content/blog/{slug}.mdx', frontmatter: { title: '{title}', date: '{date:MMMM D, YYYY}', lastUpdatedDate: '{date}', author: '{authorSlug}', category: '{category}' } } }) as GithubTarget;
    const file = renderPageFile(target, { title: 'Drain care', description: 'Keep drains clear.', slug: 'drain-care', at: new Date('2026-10-28T12:00:00Z'), author: 'Dana Reyes', authorSlug: 'dana-r', category: 'Plumbing' }, { markdown: 'Body.' });

    expect(file.content).toContain('date: "October 28, 2026"');
    expect(file.content).toContain('lastUpdatedDate: "2026-10-28"');

    const fm = parse(file.content.split('---')[1]!, { schema: 'yaml-1.1' }) as Record<string, unknown>;

    expect(typeof fm.date).toBe('string');
    expect(typeof fm.lastUpdatedDate).toBe('string');
    expect(Number.isNaN(Date.parse(fm.date as string))).toBe(false);
    expect(fm.author).toBe('dana-r');
  });
});
