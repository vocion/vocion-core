import { describe, expect, it } from 'vitest';
import { escapeForMdx, fillTemplate, formatOf, publishTargetsOf, renderPageFile, resolvePublishTarget, slugify, squarespaceBlogUrl, stripMetaBlock } from './targets';

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
    const out = publishTargetsOf([{ ...github, config: { ...github.config, frontmatter: { author: '{author}' } } }]);

    expect(out.targets).toEqual([]);
    expect(out.problems[0]).toMatch(/uses \{author\}, which a page cannot fill/);
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
      'title: How to Choose a Three-Season Tent',
      'description: What matters, what does not, and what to spend.',
      'pubDate: 2026-10-27',
      'draft: false',
      'tags:',
      '  - camping',
      '  - three season tent',
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
    expect(html.content).toBe('---\nlayout: post\ntitle: How to Choose a Three-Season Tent\n---\n\n<p>Body</p>\n');

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
