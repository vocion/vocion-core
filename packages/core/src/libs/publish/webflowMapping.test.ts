import type { PageFields } from './targets';
import type { WebflowCollection } from '@/libs/webflow/api';
import { describe, expect, it } from 'vitest';
import { FIXTURE_AUTHORS, FIXTURE_BLOG_COLLECTION, FIXTURE_BLOG_ID, FIXTURE_COLLECTIONS, FIXTURE_LIVE_POST, FIXTURE_SITE_ID } from '@/libs/fixtures/webflow';
import { publishTargetsOf, webflowPostUrl } from './targets';
import { blogCollectionOf, learnWebflowFields, referencedItem, webflowFieldData } from './webflowMapping';

const PAGE: PageFields = {
  title: 'How to Choose a Three-Season Tent',
  metaTitle: 'Three-Season Tents: What Matters',
  description: 'What matters in a three-season tent, what does not, and what it should cost.',
  slug: 'choose-a-three-season-tent',
  at: new Date('2026-10-29T12:00:00Z'),
  author: 'Jamie Rivera',
  authorSlug: 'jamie-rivera',
  category: 'Guides',
  excerpt: null,
  image: 'https://images.example/tent.jpg',
};

describe('learning a Webflow blog\'s field mapping', () => {
  it('maps each page value to the field the schema and a live post say holds it', () => {
    const learned = learnWebflowFields(FIXTURE_BLOG_COLLECTION, [FIXTURE_LIVE_POST]);

    expect(learned.fields).toEqual({
      body: 'post-body',
      excerpt: 'post-summary',
      metaTitle: 'seo-title',
      metaDescription: 'meta-description',
      author: 'author',
      date: 'publish-date',
      image: 'main-image',
      category: 'category',
    });
    // Two rich text fields and two image fields: each choice is said, for a person to check.
    expect(learned.notes.join(' ')).toContain('"Post Body"');
    expect(learned.notes.join(' ')).toContain('"Main Image"');
  });

  it('takes the rich text field a post holds the most in as the body, whatever it is called', () => {
    const renamed: WebflowCollection = { ...FIXTURE_BLOG_COLLECTION, fields: FIXTURE_BLOG_COLLECTION.fields.map(f => (f.slug === 'post-body' ? { ...f, slug: 'story', displayName: 'Story' } : f)) };
    const post = { ...FIXTURE_LIVE_POST, fieldData: { ...FIXTURE_LIVE_POST.fieldData, 'story': FIXTURE_LIVE_POST.fieldData['post-body'], 'post-body': undefined } };

    expect(learnWebflowFields(renamed, [post]).fields.body).toBe('story');
  });

  it('says a required field nothing fills, and a collection with no posts, instead of guessing', () => {
    const strict: WebflowCollection = { ...FIXTURE_BLOG_COLLECTION, fields: [...FIXTURE_BLOG_COLLECTION.fields, { id: 'f99', slug: 'reading-level', displayName: 'Reading level', type: 'Number', isRequired: true, isEditable: true }] };
    const learned = learnWebflowFields(strict, []);

    expect(learned.notes.some(n => n.includes('"Reading level" (reading-level, Number) is required'))).toBe(true);
    expect(learned.notes.some(n => n.includes('no posts yet'))).toBe(true);
  });

  it('finds the blog among a site\'s collections by name, and none when nothing looks like one', () => {
    expect(blogCollectionOf(FIXTURE_COLLECTIONS.collections)?.id).toBe(FIXTURE_BLOG_ID);
    expect(blogCollectionOf([{ id: 'x', displayName: 'Team', singularName: 'Member', slug: 'team' }])).toBeNull();
  });
});

describe('a page as a Webflow item', () => {
  const fields = learnWebflowFields(FIXTURE_BLOG_COLLECTION, [FIXTURE_LIVE_POST]).fields;

  it('fills each mapped field in the shape its type takes: rich text, ISO date, image by URL, a reference by item id', () => {
    const out = webflowFieldData({ fields, collection: FIXTURE_BLOG_COLLECTION, page: PAGE, bodyHtml: '<p>Body.</p>', refs: { author: '64f0c0ffee00000000000a11', category: '64f0c0ffee00000000000c11' } });

    expect(out.problems).toEqual([]);
    expect(out.fieldData).toEqual({
      'name': 'How to Choose a Three-Season Tent',
      'slug': 'choose-a-three-season-tent',
      'post-body': '<p>Body.</p>',
      'post-summary': PAGE.description,
      'seo-title': 'Three-Season Tents: What Matters',
      'meta-description': PAGE.description,
      'author': '64f0c0ffee00000000000a11',
      'publish-date': '2026-10-29T12:00:00.000Z',
      'main-image': { url: 'https://images.example/tent.jpg', alt: 'How to Choose a Three-Season Tent' },
      'category': '64f0c0ffee00000000000c11',
    });
  });

  it('leaves a reference empty and says so when no item in its collection is the page\'s author', () => {
    const out = webflowFieldData({ fields, collection: FIXTURE_BLOG_COLLECTION, page: { ...PAGE, author: 'Riley Chen' }, bodyHtml: '<p>Body.</p>', refs: { author: null } });

    expect(out.fieldData.author).toBeUndefined();
    expect(out.notes.join(' ')).toContain('"Riley Chen"');
  });

  it('refuses before sending when Webflow requires a field nothing fills, or a mapped field is gone', () => {
    const strict: WebflowCollection = { ...FIXTURE_BLOG_COLLECTION, fields: FIXTURE_BLOG_COLLECTION.fields.map(f => (f.slug === 'main-image' ? { ...f, isRequired: true } : f)) };
    const noImage = webflowFieldData({ fields, collection: strict, page: { ...PAGE, image: null }, bodyHtml: '<p>Body.</p>' });

    expect(noImage.problems).toEqual(['Webflow requires "Main Image", and this page has no main image.']);

    const gone = webflowFieldData({ fields: { ...fields, body: 'old-body' }, collection: FIXTURE_BLOG_COLLECTION, page: PAGE, bodyHtml: '<p>Body.</p>' });

    expect(gone.problems[0]).toContain('"old-body", which Blog Posts no longer has');
  });

  it('matches a referenced author by name, else by the project\'s slug for them', () => {
    expect(referencedItem(FIXTURE_AUTHORS, 'jamie rivera')).toBe('64f0c0ffee00000000000a11');
    expect(referencedItem(FIXTURE_AUTHORS, 'S. Okafor', 'sam-okafor')).toBe('64f0c0ffee00000000000a12');
    expect(referencedItem(FIXTURE_AUTHORS, 'Nobody')).toBeNull();
  });
});

describe('a Webflow publish target', () => {
  it('holds with the site alone (learning fills the rest), and names the post\'s live address once it knows the blog', () => {
    const { targets, problems } = publishTargetsOf([
      { id: 'site', kind: 'webflow', config: { siteUrl: 'https://www.northwind-outfitters.example' } },
      { id: 'blog', kind: 'webflow', config: { siteId: FIXTURE_SITE_ID, siteUrl: 'https://www.northwind-outfitters.example', collectionId: FIXTURE_BLOG_ID, collectionPath: '/blog', fields: { body: 'post-body' } } },
      { id: 'bad', kind: 'webflow', config: { fields: { body: 'post-body', colour: 'x' } } },
    ]);

    expect(targets.map(t => t.id)).toEqual(['site', 'blog']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^bad: /);
    expect(webflowPostUrl(targets[1] as Extract<typeof targets[number], { kind: 'webflow' }>, 'a-post')).toBe('https://www.northwind-outfitters.example/blog/a-post');
    expect(webflowPostUrl(targets[0] as Extract<typeof targets[number], { kind: 'webflow' }>, 'a-post')).toBeNull();
  });
});
