/**
 * Webflow's Data API (v2) answers, recorded in shape and made fictional: what
 * the token check, the site list, a site's collections, the blog collection's
 * schema, its items, and an item created, updated and published return,
 * trimmed to the fields Vocion reads. Every name, id and address is invented
 * (Northwind Outfitters, on `northwind-outfitters.webflow.io` and
 * `www.northwind-outfitters.example`), so the login, the mapping and
 * publishing are tested with no network.
 *
 * `webflowFetch` answers like the API: it keeps the collection's items in
 * memory, so a create is found by slug on the next call, and it records every
 * call it was made, for tests that check what was sent.
 */

import type { WebflowCollection, WebflowItem, WebflowSite } from '@/libs/webflow/api';

export const FIXTURE_WEBFLOW_TOKEN = 'wf-fixture-token';
export const FIXTURE_SITE_ID = '64f0c0ffee00000000000a01';
export const FIXTURE_WORKSPACE_ID = '64f0c0ffee00000000000w01';
export const FIXTURE_BLOG_ID = '64f0c0ffee00000000000b01';
export const FIXTURE_AUTHORS_ID = '64f0c0ffee00000000000b02';
export const FIXTURE_CATEGORIES_ID = '64f0c0ffee00000000000b03';

/** `GET /v2/token/introspect` for a login that picked one site. */
export const FIXTURE_INTROSPECT = {
  authorization: {
    id: '64f0c0ffee00000000000t01',
    createdOn: '2026-10-01T16:00:00.000Z',
    grantType: 'authorization_code',
    lastUsed: '2026-10-28T09:00:00.000Z',
    rateLimit: 60,
    scope: 'cms:read,cms:write,sites:read',
    authorizedTo: { siteIds: [FIXTURE_SITE_ID], workspaceIds: [FIXTURE_WORKSPACE_ID], userIds: [] },
  },
  application: { id: '64f0c0ffee00000000000p01', description: 'Vocion', homepage: 'https://vocion.example', displayName: 'Vocion' },
};

/** `GET /v2/sites`. */
export const FIXTURE_SITES: { sites: WebflowSite[] } = {
  sites: [{
    id: FIXTURE_SITE_ID,
    workspaceId: FIXTURE_WORKSPACE_ID,
    displayName: 'Northwind Outfitters',
    shortName: 'northwind-outfitters',
    previewUrl: 'https://screenshots.webflow.example/northwind.png',
    lastPublished: '2026-10-20T15:00:00.000Z',
    customDomains: [{ id: '64f0c0ffee00000000000d01', url: 'www.northwind-outfitters.example' }],
  }],
};

/** `GET /v2/sites/:id/collections`. */
export const FIXTURE_COLLECTIONS = {
  collections: [
    { id: FIXTURE_AUTHORS_ID, displayName: 'Authors', singularName: 'Author', slug: 'authors', lastUpdated: '2026-09-01T00:00:00.000Z' },
    { id: FIXTURE_BLOG_ID, displayName: 'Blog Posts', singularName: 'Blog Post', slug: 'blog', lastUpdated: '2026-10-20T15:00:00.000Z' },
    { id: FIXTURE_CATEGORIES_ID, displayName: 'Categories', singularName: 'Category', slug: 'categories', lastUpdated: '2026-09-01T00:00:00.000Z' },
  ],
};

/** `GET /v2/collections/:blog` — the blog's schema, as a template blog ships it, plus SEO fields. */
export const FIXTURE_BLOG_COLLECTION: WebflowCollection = {
  id: FIXTURE_BLOG_ID,
  displayName: 'Blog Posts',
  singularName: 'Blog Post',
  slug: 'blog',
  fields: [
    { id: 'f01', slug: 'name', displayName: 'Name', type: 'PlainText', isRequired: true, isEditable: true },
    { id: 'f02', slug: 'slug', displayName: 'Slug', type: 'PlainText', isRequired: true, isEditable: true },
    { id: 'f03', slug: 'post-body', displayName: 'Post Body', type: 'RichText', isRequired: false, isEditable: true },
    { id: 'f04', slug: 'post-summary', displayName: 'Post Summary', type: 'PlainText', isRequired: false, isEditable: true },
    { id: 'f05', slug: 'main-image', displayName: 'Main Image', type: 'Image', isRequired: false, isEditable: true },
    { id: 'f06', slug: 'thumbnail-image', displayName: 'Thumbnail image', type: 'Image', isRequired: false, isEditable: true },
    { id: 'f07', slug: 'featured', displayName: 'Featured?', type: 'Switch', isRequired: false, isEditable: true },
    { id: 'f08', slug: 'author', displayName: 'Author', type: 'Reference', isRequired: false, isEditable: true, validations: { collectionId: FIXTURE_AUTHORS_ID } },
    { id: 'f09', slug: 'category', displayName: 'Category', type: 'Reference', isRequired: false, isEditable: true, validations: { collectionId: FIXTURE_CATEGORIES_ID } },
    { id: 'f10', slug: 'publish-date', displayName: 'Publish date', type: 'DateTime', isRequired: false, isEditable: true },
    { id: 'f11', slug: 'seo-title', displayName: 'SEO title', type: 'PlainText', isRequired: false, isEditable: true },
    { id: 'f12', slug: 'meta-description', displayName: 'Meta description', type: 'PlainText', isRequired: false, isEditable: true },
    { id: 'f13', slug: 'pull-quote', displayName: 'Pull quote', type: 'RichText', isRequired: false, isEditable: true },
  ],
};

/** A post already on the blog: what the mapping is learned from. */
export const FIXTURE_LIVE_POST: WebflowItem = {
  id: '64f0c0ffee00000000000i01',
  isDraft: false,
  isArchived: false,
  lastPublished: '2026-10-20T15:00:00.000Z',
  lastUpdated: '2026-10-20T14:58:00.000Z',
  createdOn: '2026-10-18T10:00:00.000Z',
  fieldData: {
    'name': 'Layering for Shoulder Season',
    'slug': 'layering-for-shoulder-season',
    'post-body': '<p>Three layers, and when to shed each one. A base layer that wicks, a mid layer that traps warmth, and a shell that stops wind and rain.</p><h2>The base layer</h2><p>Merino or a synthetic blend, never cotton.</p>',
    'post-summary': 'Three layers, and when to shed each one.',
    'main-image': { fileId: '64f0c0ffee00000000000m01', url: 'https://uploads.webflow.example/layering.jpg', alt: 'Layers on a trail' },
    'thumbnail-image': { fileId: '64f0c0ffee00000000000m02', url: 'https://uploads.webflow.example/layering-thumb.jpg', alt: null },
    'featured': false,
    'author': '64f0c0ffee00000000000a11',
    'category': '64f0c0ffee00000000000c11',
    'publish-date': '2026-10-20T00:00:00.000Z',
    'seo-title': 'Layering for Shoulder Season | Northwind Outfitters',
    'meta-description': 'How to layer for spring and fall hikes: a base that wicks, a mid layer that warms, a shell that blocks wind.',
    'pull-quote': '<p>Never cotton.</p>',
  },
};

/** `GET /v2/collections/:authors/items`. */
export const FIXTURE_AUTHORS: WebflowItem[] = [
  { id: '64f0c0ffee00000000000a11', fieldData: { name: 'Jamie Rivera', slug: 'jamie-rivera' } },
  { id: '64f0c0ffee00000000000a12', fieldData: { name: 'Sam Okafor', slug: 'sam-okafor' } },
];

/** `GET /v2/collections/:categories/items`. */
export const FIXTURE_CATEGORIES: WebflowItem[] = [
  { id: '64f0c0ffee00000000000c11', fieldData: { name: 'Guides', slug: 'guides' } },
  { id: '64f0c0ffee00000000000c12', fieldData: { name: 'Gear', slug: 'gear' } },
];

/** One call the fake was made. */
export type WebflowCall = { method: string; path: string; body: unknown };

/**
 * A fetch that answers like Webflow's v2 API for the fixture site, with the
 * blog's items kept in memory, and the calls it was made.
 * @param opts - How it should behave.
 * @param opts.items - The blog's items to start with (the live post by default).
 * @param opts.publishError - An answer to give the publish call instead of publishing.
 * @param opts.publishError.status - Its status.
 * @param opts.publishError.body - Its body.
 */
export function webflowFetch(opts: { items?: WebflowItem[]; publishError?: { status: number; body: unknown } } = {}) {
  const items = new Map<string, WebflowItem>((opts.items ?? [FIXTURE_LIVE_POST]).map(i => [i.id, structuredClone(i)]));
  const calls: WebflowCall[] = [];
  let next = 1;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined;
    const path = url.pathname.replace(/^\/v2/, '');
    calls.push({ method, path: `${path}${url.search}`, body });
    if (url.hostname !== 'api.webflow.com') {
      return new Response('not found', { status: 404 });
    }
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${FIXTURE_WEBFLOW_TOKEN}`) {
      return json({ message: 'Request not authorized', code: 'not_authorized' }, 401);
    }
    if (path === '/token/introspect') {
      return json(FIXTURE_INTROSPECT);
    }
    if (path === '/sites') {
      return json(FIXTURE_SITES);
    }
    if (path === `/sites/${FIXTURE_SITE_ID}`) {
      return json(FIXTURE_SITES.sites[0]);
    }
    if (path === `/sites/${FIXTURE_SITE_ID}/collections`) {
      return json(FIXTURE_COLLECTIONS);
    }
    if (path === `/collections/${FIXTURE_BLOG_ID}`) {
      return json(FIXTURE_BLOG_COLLECTION);
    }
    if (path === `/collections/${FIXTURE_AUTHORS_ID}/items`) {
      return json({ items: FIXTURE_AUTHORS, pagination: { limit: 100, offset: 0, total: FIXTURE_AUTHORS.length } });
    }
    if (path === `/collections/${FIXTURE_CATEGORIES_ID}/items`) {
      return json({ items: FIXTURE_CATEGORIES, pagination: { limit: 100, offset: 0, total: FIXTURE_CATEGORIES.length } });
    }
    const blog = `/collections/${FIXTURE_BLOG_ID}/items`;
    if (path === blog && method === 'GET') {
      const slug = url.searchParams.get('slug');
      const list = [...items.values()].filter(i => !slug || i.fieldData.slug === slug);
      return json({ items: list, pagination: { limit: 100, offset: 0, total: list.length } });
    }
    if (path === blog && method === 'POST') {
      const b = body as { isDraft?: boolean; fieldData: Record<string, unknown> };
      if ([...items.values()].some(i => i.fieldData.slug === b.fieldData.slug)) {
        return json({ message: 'Validation Error', code: 'validation_error', details: [{ param: 'slug', description: 'Unique value is already in database' }] }, 400);
      }
      const id = `64f0c0ffee0000000000n${String(next++).padStart(3, '0')}`;
      const item: WebflowItem = { id, isDraft: b.isDraft ?? false, isArchived: false, lastPublished: null, lastUpdated: '2026-10-29T12:00:00.000Z', createdOn: '2026-10-29T12:00:00.000Z', fieldData: b.fieldData as WebflowItem['fieldData'] };
      items.set(id, item);
      return json(item, 202);
    }
    if (path === `${blog}/publish` && method === 'POST') {
      if (opts.publishError) {
        return json(opts.publishError.body, opts.publishError.status);
      }
      const ids = ((body as { itemIds?: string[] }).itemIds ?? []).filter(id => items.has(id) && !items.get(id)!.isDraft);
      for (const id of ids) {
        items.get(id)!.lastPublished = '2026-10-29T12:05:00.000Z';
      }
      return json({ publishedItemIds: ids, errors: [] }, 202);
    }
    const one = new RegExp(`^${blog}/([^/]+)$`).exec(path);
    if (one) {
      const item = items.get(one[1]!);
      if (!item) {
        return json({ message: 'Requested resource not found', code: 'resource_not_found' }, 404);
      }
      if (method === 'PATCH') {
        const b = body as { isDraft?: boolean; fieldData?: Record<string, unknown> };
        item.fieldData = { ...item.fieldData, ...b.fieldData };
        if (b.isDraft !== undefined) {
          item.isDraft = b.isDraft;
        }
        return json(item);
      }
      if (method === 'DELETE') {
        items.delete(item.id);
        return new Response(null, { status: 204 });
      }
      return json(item);
    }
    return json({ message: 'Route not found', code: 'route_not_found' }, 404);
  };
  return { fetch, calls, items };
}
