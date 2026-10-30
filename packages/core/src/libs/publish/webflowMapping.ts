/**
 * A Webflow target's FIELD MAPPING: which of the blog collection's fields
 * each of the page's values goes in. Pure.
 *
 * - **Learned** (`learnWebflowFields`) from the collection's schema and one
 *   or two of its recent posts, the way `learnTemplate.ts` learns a GitHub
 *   site's frontmatter: a field's type, its name and what a real post holds
 *   in it say what it is. What comes out is a suggestion a person applies on
 *   the project, never a target written on their behalf.
 * - **Filled** (`webflowFieldData`) for one page: each mapped field gets the
 *   page's value in the shape its type takes (rich text HTML, an ISO date, an
 *   image by URL, a reference by the referenced item's id), and every field
 *   Webflow requires that nothing fills is a problem, said before anything is
 *   sent.
 */

import type { PageFields, WebflowPageField } from './targets';
import type { WebflowCollection, WebflowCollectionSummary, WebflowField, WebflowItem } from '@/libs/webflow/api';

export type WebflowFieldMap = Partial<Record<WebflowPageField, string>>;

/** The page's values, by what a person calls them. */
export const WEBFLOW_FIELD_LABEL: Record<WebflowPageField, string> = {
  body: 'body',
  excerpt: 'summary',
  metaTitle: 'SEO title',
  metaDescription: 'SEO description',
  author: 'author',
  date: 'date',
  image: 'main image',
  category: 'category',
  tags: 'tags',
};

/** The fields every Webflow item has and Vocion always fills: the title and the slug. */
const BUILT_IN = new Set(['name', 'slug']);

/** The field types each page value can go in, in order of preference. */
const TYPES: Record<WebflowPageField, readonly string[]> = {
  body: ['RichText'],
  excerpt: ['PlainText', 'RichText'],
  metaTitle: ['PlainText'],
  metaDescription: ['PlainText'],
  author: ['Reference', 'PlainText', 'Option'],
  date: ['DateTime'],
  image: ['Image'],
  category: ['Reference', 'Option', 'PlainText'],
  tags: ['MultiReference', 'PlainText'],
};

/** What a field's slug or name says it is. */
const NAMES: Record<WebflowPageField, RegExp> = {
  body: /body|content|article|post|text|copy/,
  excerpt: /summary|excerpt|intro|teaser|blurb|subtitle|lede|preview|snippet|^description$|post-description|short/,
  metaTitle: /(?:meta|seo|og)[\w-]*title|title[\w-]*(?:meta|seo)|page-title|title-tag/,
  metaDescription: /(?:meta|seo|og)[\w-]*desc|desc[\w-]*(?:meta|seo)/,
  author: /author|writer|byline|written/,
  date: /publish|date|posted|written-on/,
  image: /main|hero|featured|cover|thumbnail|header|image|photo|picture/,
  category: /categor|topic|section/,
  tags: /tag|keyword/,
};

/** Names that rule a field out for a value even when its type fits. */
const NOT: Partial<Record<WebflowPageField, RegExp>> = {
  excerpt: /meta|seo|og-/,
  body: /summary|excerpt|intro|meta|seo/,
  date: /update|modified|edit/,
};

/** An image field's name, best first: the post's own picture before a list thumbnail. */
const IMAGE_RANK = [/main|featured|hero|cover/, /header|image|photo|picture/, /thumbnail/];

/**
 * How much of a value a post holds, for telling the body from a summary.
 * @param value - A field's value in one post.
 */
function sizeOf(value: unknown): number {
  return typeof value === 'string' ? value.replace(/<[^>]+>/g, '').length : 0;
}

/**
 * The key a field is compared by: its slug and its name, lower case.
 * @param f - The field.
 */
const keyOf = (f: WebflowField) => `${f.slug} ${f.displayName}`.toLowerCase().replace(/\s+/g, '-');

/** What the collection and its posts taught: the mapping, and anything a person should check. */
export type LearnedWebflowFields = { fields: WebflowFieldMap; notes: string[] };

/**
 * The mapping a collection's schema and a recent post or two teach.
 * @param collection - The blog collection, with its fields.
 * @param items - Recent posts in it (one is enough; none still maps by name and type).
 */
export function learnWebflowFields(collection: WebflowCollection, items: readonly WebflowItem[] = []): LearnedWebflowFields {
  const usable = collection.fields.filter(f => !BUILT_IN.has(f.slug) && f.isEditable !== false);
  const taken = new Set<string>();
  const fields: WebflowFieldMap = {};
  const notes: string[] = [];
  const filled = (f: WebflowField) => items.reduce((n, it) => n + sizeOf(it.fieldData?.[f.slug]), 0);
  const pick = (value: WebflowPageField, candidates: WebflowField[]) => {
    const [first] = candidates;
    if (first) {
      fields[value] = first.slug;
      taken.add(first.slug);
    }
  };
  const named = (value: WebflowPageField) => usable.filter(f => !taken.has(f.slug) && TYPES[value].includes(f.type) && NAMES[value].test(keyOf(f)) && !NOT[value]?.test(keyOf(f)))
    .sort((a, b) => TYPES[value].indexOf(a.type) - TYPES[value].indexOf(b.type));

  // The body first: the rich text field a post holds the most in.
  const rich = usable.filter(f => f.type === 'RichText');
  const bodyOrder = [...rich].sort((a, b) => filled(b) - filled(a) || Number(NAMES.body.test(keyOf(b))) - Number(NAMES.body.test(keyOf(a))));
  if (rich.length > 1 && items.length === 0) {
    bodyOrder.sort((a, b) => Number(NAMES.body.test(keyOf(b)) && !NOT.body!.test(keyOf(b))) - Number(NAMES.body.test(keyOf(a)) && !NOT.body!.test(keyOf(a))));
  }
  pick('body', bodyOrder);
  if (!fields.body) {
    notes.push(`${collection.displayName} has no rich text field, so there is nowhere for the post's body: is it the blog?`);
  } else if (rich.length > 1) {
    notes.push(`The body goes in "${collection.fields.find(f => f.slug === fields.body)!.displayName}", the rich text field ${items.length > 0 ? 'the latest post holds the most in' : 'named like a body'}; check it.`);
  }

  pick('metaTitle', named('metaTitle'));
  pick('metaDescription', named('metaDescription'));
  // A summary: by name; failing that, a short plain text field the posts fill.
  pick('excerpt', named('excerpt'));
  pick('author', named('author'));
  const dates = usable.filter(f => f.type === 'DateTime' && !taken.has(f.slug) && !NOT.date!.test(keyOf(f)));
  pick('date', named('date').length > 0 ? named('date') : dates.length === 1 ? dates : []);
  const images = usable.filter(f => f.type === 'Image' && !taken.has(f.slug));
  const imageRank = (f: WebflowField) => {
    const r = IMAGE_RANK.findIndex(re => re.test(keyOf(f)));
    return r < 0 ? IMAGE_RANK.length : r;
  };
  pick('image', [...images].sort((a, b) => imageRank(a) - imageRank(b)));
  if (images.length > 1 && fields.image) {
    notes.push(`The main image goes in "${collection.fields.find(f => f.slug === fields.image)!.displayName}" (the collection has ${images.length} image fields); check it.`);
  }
  pick('category', named('category'));
  pick('tags', named('tags'));

  for (const f of usable) {
    if (f.isRequired && !taken.has(f.slug)) {
      notes.push(`"${f.displayName}" (${f.slug}, ${f.type}) is required and no page value fills it: a post cannot be saved until it is mapped or made optional in Webflow.`);
    }
  }
  if (items.length === 0) {
    notes.push('The collection has no posts yet, so the mapping is read from field names and types alone: check it.');
  }
  return { fields, notes };
}

/**
 * The collection among a site's that is its blog: one named like a blog with
 * a rich text field, by name first. Null when none looks like one.
 * @param collections - The site's collections.
 */
export function blogCollectionOf(collections: readonly WebflowCollectionSummary[]): WebflowCollectionSummary | null {
  const rank = (c: WebflowCollectionSummary) => {
    const k = `${c.slug} ${c.displayName}`.toLowerCase();
    return /blog/.test(k) ? 0 : /post|article|news|journal|insight|resource/.test(k) ? 1 : 9;
  };
  const sorted = [...collections].sort((a, b) => rank(a) - rank(b));
  return sorted[0] && rank(sorted[0]) < 9 ? sorted[0] : null;
}

/** The referenced items a page's author, category and tags resolved to, by field slug. */
export type ResolvedRefs = Record<string, string | string[] | null>;

/** One page's item, ready to send, and what stands in its way. */
export type WebflowFieldData = { fieldData: Record<string, unknown>; problems: string[]; notes: string[] };

/**
 * The page's text value for one mapped field, before its type shapes it.
 * @param value - Which page value.
 * @param page - The page.
 * @param bodyHtml - The body as Webflow rich text.
 */
function valueOf(value: WebflowPageField, page: PageFields & { imageAlt?: string | null }, bodyHtml: string): string | string[] | null {
  switch (value) {
    case 'body': return bodyHtml;
    case 'excerpt': return page.excerpt?.trim() || page.description;
    case 'metaTitle': return page.metaTitle || page.title;
    case 'metaDescription': return page.description;
    case 'author': return page.author?.trim() || null;
    case 'date': return page.at.toISOString();
    case 'image': return page.image?.trim() || null;
    case 'category': return page.category?.trim() || null;
    case 'tags': return page.tags && page.tags.length > 0 ? [...page.tags] : null;
    default: return null;
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A page's item for the collection: the title and slug, then each mapped
 * field in the shape its type takes. A reference (an author, a category, tags
 * in another collection) is filled only when `refs` resolved it to an item.
 * @param input - What goes in.
 * @param input.fields - The target's mapping.
 * @param input.collection - The collection's schema, read now.
 * @param input.page - The page.
 * @param input.bodyHtml - The body as Webflow rich text.
 * @param input.refs - Referenced items resolved by field slug.
 */
export function webflowFieldData(input: { fields: WebflowFieldMap; collection: WebflowCollection; page: PageFields; bodyHtml: string; refs?: ResolvedRefs }): WebflowFieldData {
  const { fields, collection, page, bodyHtml, refs = {} } = input;
  const bySlug = new Map(collection.fields.map(f => [f.slug, f]));
  const fieldData: Record<string, unknown> = { name: page.title, slug: page.slug };
  const problems: string[] = [];
  const notes: string[] = [];
  for (const [value, slug] of Object.entries(fields) as Array<[WebflowPageField, string | undefined]>) {
    if (!slug) {
      continue;
    }
    const field = bySlug.get(slug);
    const label = WEBFLOW_FIELD_LABEL[value];
    if (!field) {
      problems.push(`The ${label} is mapped to "${slug}", which ${collection.displayName} no longer has: learn the mapping again.`);
      continue;
    }
    const v = valueOf(value, page, bodyHtml);
    if (v === null || v === '') {
      continue;
    }
    switch (field.type) {
      case 'RichText':
        fieldData[slug] = value === 'body' ? v : `<p>${escapeHtml(String(v))}</p>`;
        break;
      case 'PlainText':
        fieldData[slug] = Array.isArray(v) ? v.join(', ') : v;
        break;
      case 'DateTime':
        fieldData[slug] = v;
        break;
      case 'Image':
        fieldData[slug] = { url: v, alt: page.title };
        break;
      case 'Option': {
        const option = field.validations?.options?.find(o => o.name.toLowerCase() === String(v).toLowerCase());
        if (option) {
          fieldData[slug] = option.id;
        } else {
          notes.push(`The ${label} "${String(v)}" is not one of ${field.displayName}'s options, so it is left empty.`);
        }
        break;
      }
      case 'Reference':
      case 'MultiReference': {
        const ref = refs[slug];
        if (ref && (!Array.isArray(ref) || ref.length > 0)) {
          fieldData[slug] = field.type === 'MultiReference' ? (Array.isArray(ref) ? ref : [ref]) : (Array.isArray(ref) ? ref[0] : ref);
        } else {
          notes.push(`No item in ${field.displayName}'s collection is "${Array.isArray(v) ? v.join(', ') : v}", so the ${label} is left empty: add it in Webflow, or set it on the post.`);
        }
        break;
      }
      default:
        notes.push(`The ${label} is mapped to "${field.displayName}", a ${field.type} field Vocion does not fill; it is left empty.`);
    }
  }
  for (const f of collection.fields) {
    if (f.isRequired && !BUILT_IN.has(f.slug) && (fieldData[f.slug] === undefined || fieldData[f.slug] === '')) {
      const mapped = (Object.entries(fields) as Array<[WebflowPageField, string]>).find(([, s]) => s === f.slug)?.[0];
      problems.push(mapped
        ? `Webflow requires "${f.displayName}", and this page has no ${WEBFLOW_FIELD_LABEL[mapped]}.`
        : `Webflow requires "${f.displayName}" (${f.slug}) and the mapping fills nothing into it: map it under Publishing, or make it optional in Webflow.`);
    }
  }
  return { fieldData, problems, notes };
}

/**
 * The referenced item a value names among a collection's items: by name, else by slug.
 * @param items - The referenced collection's items.
 * @param value - The page's author, category or a tag.
 * @param slug - Its slug, when the page knows one (the author's).
 */
export function referencedItem(items: readonly WebflowItem[], value: string, slug?: string | null): string | null {
  const plain = (s: unknown) => (typeof s === 'string' ? s.normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '') : '');
  const want = plain(value);
  return items.find(i => want && plain(i.fieldData?.name) === want)?.id
    ?? items.find(i => slug && i.fieldData?.slug === slug)?.id
    ?? null;
}
