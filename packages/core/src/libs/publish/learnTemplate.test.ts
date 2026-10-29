import { describe, expect, it } from 'vitest';
import { dateFormatOfValue, folderOf, pathPatternOf, samplePaths, templateFrom } from './learnTemplate';

/** Three posts from a fictional Astro site (Northwind Home Services). */
const POSTS = [
  { path: 'src/content/blog/heat-pump-basics.mdx', text: '---\nlayout: ../../layouts/Post.astro\ntitle: "Heat pump basics"\ndescription: "What a heat pump does in winter."\npubDate: "July 8, 2026"\nauthor: dana-r\ncategory: HVAC\ntags: [heat pumps, efficiency]\ndraft: false\nheroImage: /images/default-hero.jpg\n---\n\nBody one.' },
  { path: 'src/content/blog/water-heater-signs.mdx', text: '---\nlayout: ../../layouts/Post.astro\ntitle: "Five signs your water heater is failing"\ndescription: "Rust, noise and lukewarm showers."\npubDate: "August 12, 2026"\nauthor: sam-o\ncategory: Plumbing\ntags: [water heaters]\ndraft: false\nheroImage: /images/default-hero.jpg\n---\n\nBody two.' },
  { path: 'src/content/blog/drain-care.mdx', text: '---\nlayout: ../../layouts/Post.astro\ntitle: "Drain care between visits"\ndescription: "Keep drains clear without chemicals."\npubDate: "September 3, 2026"\nauthor: dana-r\ncategory: Plumbing\ntags: [drains]\ndraft: false\nheroImage: /images/default-hero.jpg\n---\n\nBody three.' },
];

describe('the frontmatter template a site\'s own posts teach (SEO walk 2)', () => {
  it('keeps the same keys, maps what varies to placeholders and keeps what is constant', () => {
    const learned = templateFrom(POSTS, { authorSlugs: ['dana-r', 'sam-o'] })!;

    expect(learned.frontmatter).toEqual({
      layout: '../../layouts/Post.astro',
      title: '{title}',
      description: '{description}',
      pubDate: '{date:MMMM D, YYYY}',
      author: '{authorSlug}',
      category: '{category}',
      tags: '{tags}',
      draft: false,
      heroImage: '/images/default-hero.jpg',
    });
    expect(learned.path).toBe('src/content/blog/{slug}.mdx');
    expect(learned.read).toHaveLength(3);
  });

  it('reads the date formats a site writes', () => {
    expect(dateFormatOfValue('2026-07-08')).toBe('{date:YYYY-MM-DD}');
    expect(dateFormatOfValue('2026-07-08T09:00:00Z')).toBe('{datetime}');
    expect(dateFormatOfValue('Jul 8, 2026')).toBe('{date:MMM D, YYYY}');
    expect(dateFormatOfValue('soon')).toBeNull();
  });

  it('finds the posts and the path pattern', () => {
    expect(samplePaths(['src/content/blog/a.mdx', 'src/content/blog/README.md', 'src/content/blog/b/index.mdx', 'src/pages/x.astro'], 'src/content/blog')).toEqual(['src/content/blog/a.mdx', 'src/content/blog/b/index.mdx']);
    expect(pathPatternOf(['posts/2026-07-08-a.md', 'posts/2026-08-01-b.md'])).toBe('posts/{date:YYYY-MM-DD}-{slug}.md');
    expect(folderOf('src/content/blog/{slug}.mdx')).toBe('src/content/blog');
  });

  it('notes what a person should check, and learns nothing from files with no frontmatter', () => {
    expect(templateFrom([POSTS[0]!])!.notes.join(' ')).toMatch(/Only one post was read/);
    expect(templateFrom([{ path: 'a.md', text: 'No frontmatter.' }])).toBeNull();
  });
});

describe('a post\'s date style is copied exactly', () => {
  it('maps a date to the page\'s date in the posts\' own format, even from one post', () => {
    const one = templateFrom([{ path: 'src/content/blog/a.mdx', text: '---\ndate: 2026-10-28\nlastUpdatedDate: "October 28, 2026"\n---\n\nBody.' }])!;

    expect(one.frontmatter).toEqual({ date: '{date:YYYY-MM-DD}', lastUpdatedDate: '{date:MMMM D, YYYY}' });
  });
});
