/**
 * Squarespace connector — a client's Squarespace site, read for its content
 * and written to by publishing a blog post (`site.publish_page`).
 *
 * Squarespace has NO public content API: its developer API key reads the
 * site's identity (`/1.0/authorization/website`) and Commerce, and every
 * content path (pages, blog, collections) answers a generic 500. Its OAuth is
 * for Commerce partners and opens no content either. So this connector does
 * three things, each through the one door Squarespace leaves open for it:
 *
 * - **Which site.** The developer API key, when given, names the site it was
 *   made on (title and URL), and Test connection checks it is this one.
 * - **What is on it.** Pages and blog posts are read through the public
 *   `?format=json` twin every Squarespace page has: the sync is the web
 *   connector's own smallest-source read (`web.ts` already recognises a
 *   Squarespace page and reads its JSON listing), seeded at the site and its
 *   blog, so the inventory and its internal links land like any web source.
 * - **Publishing.** The editor login (email and password, kept in the vault as
 *   secrets) is used only by the publish browser run, which signs in to the
 *   site's editor and saves a draft; the model never reads the password.
 *
 * One login serves every site it is a contributor on, so one credential per
 * workspace covers an agency's clients (`one-live`, shareable).
 */

import type { SourceConnector, SourceContext } from './types';
import type { IngestDoc } from '@/services/IngestionService';
import { z } from 'zod';
import { InspectInputError } from './inspect';
import { USER_AGENT, webConnector, withFormatJson } from './web';

const SQUARESPACE_API = 'https://api.squarespace.com/1.0';
const TIMEOUT_MS = 10_000;

const squarespaceConfigSchema = z.object({
  /** The site's public address, e.g. https://example-site.squarespace.com or its own domain. */
  siteUrl: z.string().url(),
  /** The blog's path on the site, e.g. /blog; pages are read either way. */
  blogPath: z.string().regex(/^\/[\w\-/]*$/).optional(),
  /** Pages read per sync, the blog listing included. */
  maxPages: z.number().int().min(1).max(200).default(50),
});

/** A site as Squarespace names it. */
export type SquarespaceSite = { title: string | null; url: string | null; id: string | null };

/** One blog post, as the public JSON lists it. */
export type SquarespacePost = { title: string; url: string; slug: string | null; publishedAt: string | null; excerpt: string | null };

/**
 * The site's address with no trailing slash, and the blog under it.
 * @param siteUrl - The site.
 * @param blogPath - The blog's path.
 */
export function blogUrlOf(siteUrl: string, blogPath?: string | null): string {
  return `${siteUrl.replace(/\/+$/, '')}${blogPath ?? '/blog'}`;
}

/**
 * The public JSON twin of a Squarespace page, or why it could not be read.
 * Only public addresses are fetched: the site URL is typed by a person.
 * @param url - The page.
 */
export async function readSquarespaceJson(url: string): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; why: string }> {
  const { resolvesPublicly } = await import('@/libs/net/publicUrl');
  const verdict = await resolvesPublicly(url);
  if (!verdict.ok) {
    return { ok: false, why: `${url} is not a public address (${verdict.reason})` };
  }
  try {
    const res = await fetch(withFormatJson(url), { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      return { ok: false, why: `${url} answered ${res.status}` };
    }
    const text = await res.text();
    try {
      const json = JSON.parse(text) as unknown;
      return json && typeof json === 'object' && !Array.isArray(json) ? { ok: true, json: json as Record<string, unknown> } : { ok: false, why: `${url} did not answer with a Squarespace page model` };
    } catch {
      return { ok: false, why: `${url} answered with a page, not JSON: it is not a Squarespace site, or the page is password-protected` };
    }
  } catch (error) {
    return { ok: false, why: `${url} could not be reached (${(error as Error).message})` };
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The site's name and address from any page's public JSON.
 * @param json - A page's `?format=json`.
 */
export function siteFromJson(json: Record<string, unknown>): SquarespaceSite {
  const website = (json.website ?? {}) as Record<string, unknown>;
  const domain = str(website.primaryDomain);
  return {
    title: str(website.siteTitle),
    url: str(website.authenticUrl) ?? str(website.baseUrl) ?? (domain ? `https://${domain}` : null),
    id: str(website.id),
  };
}

/**
 * The posts a blog's public JSON lists, each with its address on the site.
 * Drafts are never in it: only what a visitor can read.
 * @param json - The blog's `?format=json`.
 * @param siteUrl - The site, which relative post addresses resolve against.
 */
export function postsFromJson(json: Record<string, unknown>, siteUrl: string): SquarespacePost[] {
  const items = Array.isArray(json.items) ? json.items : [];
  return items.flatMap((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const title = str(item.title);
    const path = str(item.fullUrl);
    if (!title || !path) {
      return [];
    }
    let url: string;
    try {
      url = new URL(path, `${siteUrl.replace(/\/+$/, '')}/`).toString();
    } catch {
      return [];
    }
    const publishOn = typeof item.publishOn === 'number' ? new Date(item.publishOn).toISOString() : null;
    return [{ title, url, slug: str(item.urlId) ?? path.split('/').filter(Boolean).pop() ?? null, publishedAt: publishOn, excerpt: str(item.excerpt)?.replace(/<[^>]+>/g, '').trim() ?? null }];
  });
}

/**
 * Whether the blog is one, by what Squarespace says the collection is.
 * @param json - The blog's `?format=json`.
 */
export function isBlogCollection(json: Record<string, unknown>): boolean {
  const collection = (json.collection ?? {}) as Record<string, unknown>;
  // Squarespace's collection type 1 is a blog; `typeName` says so in words,
  // with the layout after it on 7.1 (`blog-side-by-side`, `blog-basic-grid`…).
  return (typeof collection.typeName === 'string' && /^blog(?:-|$)/.test(collection.typeName)) || collection.type === 1;
}

/**
 * A published post on the blog, by its URL slug alone: how a publish run is
 * read back once it is live. A title can be shared or changed, so it never
 * identifies a post. Null when no post at that slug is public (yet).
 * @param siteUrl - The site.
 * @param blogPath - The blog's path.
 * @param want - What to look for.
 * @param want.slug - The post's URL slug.
 */
export async function findPublishedPost(siteUrl: string, blogPath: string | null | undefined, want: { slug: string }): Promise<{ post: SquarespacePost | null; why?: string }> {
  const read = await readSquarespaceJson(blogUrlOf(siteUrl, blogPath));
  if (!read.ok) {
    return { post: null, why: read.why };
  }
  return { post: postsFromJson(read.json, siteUrl).find(p => p.slug === want.slug) ?? null };
}

/**
 * The site the developer API key was made on, or why it was refused.
 * @param apiKey - The key.
 */
export async function siteOfApiKey(apiKey: string): Promise<{ ok: true; site: SquarespaceSite } | { ok: false; status: number; why: string }> {
  try {
    const res = await fetch(`${SQUARESPACE_API}/authorization/website`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, status: res.status, why: str(body.message) ?? `Squarespace refused the key (${res.status})` };
    }
    return { ok: true, site: { title: str(body.title), url: str(body.url), id: str(body.id) ?? str(body.siteId) } };
  } catch (error) {
    return { ok: false, status: 0, why: `Squarespace could not be reached (${(error as Error).message})` };
  }
}

function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '').toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Whether two addresses are the same site: same host, or one is the site's
 * `.squarespace.com` address and the key names the other.
 * @param a - One address.
 * @param b - The other.
 */
function sameSite(a: string | null, b: string | null): boolean {
  const x = hostOf(a);
  const y = hostOf(b);
  return Boolean(x && y && x === y);
}

export const squarespaceConnector: SourceConnector<typeof squarespaceConfigSchema> = {
  slug: 'squarespace',
  name: 'Squarespace',
  brand: 'squarespace',
  description: 'A Squarespace site: its pages and blog posts read for what is already there, and new posts saved as drafts in its editor for you to publish.',
  icon: 'Globe',
  category: 'sales-marketing',
  authKind: 'apikey',
  configSchema: squarespaceConfigSchema,
  inspectNote: 'Reads the site\'s public page list and, with an API key, which site the key belongs to. Nothing is saved, and the editor login is not tried here: the first publish signs in with it.',
  recordNoun: () => ({ one: 'page', other: 'pages' }),

  async inspect({ config, credentials }) {
    const parsed = squarespaceConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InspectInputError('Give the site\'s address, e.g. https://example-site.squarespace.com.');
    }
    const { siteUrl, blogPath } = parsed.data;
    const checks: Array<{ key: string; label: string; ok: boolean; detail: string | null }> = [];

    const home = await readSquarespaceJson(siteUrl);
    const site = home.ok ? siteFromJson(home.json) : null;
    checks.push({ key: 'site', label: 'The site answers as a Squarespace site', ok: home.ok, detail: home.ok ? [site?.title, site?.url].filter(Boolean).join(' · ') || 'yes' : home.why });

    const blog = await readSquarespaceJson(blogUrlOf(siteUrl, blogPath));
    const posts = blog.ok ? postsFromJson(blog.json, siteUrl) : [];
    const blogOk = blog.ok && isBlogCollection(blog.json);
    checks.push({ key: 'blog', label: `The blog at ${blogPath ?? '/blog'}`, ok: blogOk, detail: blog.ok ? (blogOk ? `${posts.length} published post${posts.length === 1 ? '' : 's'} on the first page` : 'that page is not a blog: set the blog\'s path') : blog.why });

    const apiKey = str(credentials.apiKey);
    if (apiKey) {
      const keyed = await siteOfApiKey(apiKey);
      const matches = keyed.ok && (sameSite(keyed.site.url, siteUrl) || sameSite(keyed.site.url, site?.url ?? null));
      checks.push({
        key: 'apiKey',
        label: 'The API key belongs to this site',
        ok: matches,
        detail: keyed.ok ? `${keyed.site.title ?? 'a site'} · ${keyed.site.url ?? 'no address'}${matches ? '' : ` is not ${siteUrl}`}` : keyed.why,
      });
    }
    const hasLogin = Boolean(str(credentials.email) && str(credentials.password));
    checks.push({ key: 'login', label: 'An editor login is stored for publishing', ok: hasLogin, detail: hasLogin ? `${String(credentials.email)} (signed in only when a page is published)` : 'Add the email and password of a Squarespace account that can edit this site' });

    const failed = checks.filter(c => !c.ok);
    return {
      reachable: home.ok,
      authorized: !checks.some(c => c.key === 'apiKey' && !c.ok),
      checks,
      note: 'Squarespace has no API for posts, so Vocion publishes by signing in to your site\'s editor. It saves a draft first and asks before it goes live.',
      error: failed.length > 0 ? `${failed.map(c => c.label).join('; ')}: not yet.` : null,
    };
  },

  async* sync(ctx: SourceContext): AsyncIterable<IngestDoc> {
    const cfg = squarespaceConfigSchema.parse(ctx.config);
    const site = cfg.siteUrl.replace(/\/+$/, '');
    // The web connector's own read: it recognises a Squarespace page and
    // takes its `?format=json` listing, so the blog's posts arrive one
    // document each and the rest of the site through a capped crawl.
    yield* webConnector.sync({
      ...ctx,
      config: {
        urls: [...new Set([site, ...(cfg.blogPath ? [blogUrlOf(site, cfg.blogPath)] : [])])],
        crawl: { startUrl: site, maxDepth: 1, maxPages: cfg.maxPages, exclude: ['/config', '/cart', '/account', '/checkout'] },
      },
    });
  },
};
