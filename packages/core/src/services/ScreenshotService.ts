/**
 * Finding the pictures a workspace already has.
 *
 * "Any screenshots to go with this?" is a question a workspace can usually
 * answer yes to and rarely does, because the images are scattered: some were
 * generated into artifacts, some are on the release post the announcement
 * links to, some sit in a fixture library somebody registered. Nothing looked
 * in all three, so the agent said no.
 *
 * Three lookups, each degrading to nothing rather than to an error:
 *
 *   1. **Artifacts** — `artifact` rows whose spec carries an image. These live
 *      behind the authenticated artifact route, so they are marked not
 *      publicly fetchable: Slack cannot render them in an image block, and the
 *      caller has to upload the bytes instead (`files:write`).
 *   2. **The workspace's public site** — pages ingested from a `web` knowledge
 *      source keep their `og:image` and the URLs they published
 *      (`libs/sources/pageMetadata.ts`). A release post's hero screenshot is
 *      therefore already in the database, on a public URL, which is exactly
 *      what an image block needs.
 *   3. **A registered fixture library** — `VOCION_SCREENSHOT_LIBRARY`, a JSON
 *      manifest of `{ url, caption, shows }`. Absent by default; a deployment
 *      that has a screenshot set points at it.
 *
 * This finds what EXISTS. Rendering a new screenshot on demand — driving a
 * headless browser over a fixture workspace route and saving the frame as an
 * artifact — is a separate capability and deliberately not here.
 */

import type { FileSpec, LinkSpec } from '@/libs/cards/specs';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { artifactSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

/** One picture the workspace can show, and enough about it to choose. */
export type Screenshot = {
  url: string;
  /** The line written beside it. */
  caption: string;
  /** What it depicts, when the source said — a page title, a folder, a manifest note. */
  shows?: string;
  /** Where it came from. */
  source: 'artifact' | 'site' | 'library';
  /**
   * Whether an outside service (Slack) can fetch the URL itself. False for
   * anything behind Vocion's authentication — the caller must upload the bytes
   * rather than hand over a link that renders as a grey box.
   */
  publiclyFetchable: boolean;
};

const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i;

/**
 * True for a URL an outside service can fetch without a Vocion session.
 * @param url
 */
export function publiclyFetchable(url: string): boolean {
  return /^https:\/\//i.test(url) && !url.includes('/api/artifacts/');
}

/**
 * Does the text answer the query? Word-ish contains, because a caption is short.
 * @param query
 * @param haystack
 */
function matches(query: string, ...haystack: (string | null | undefined)[]): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (terms.length === 0) {
    return true;
  }
  const hay = haystack.filter(Boolean).join(' ').toLowerCase();
  return terms.some(t => hay.includes(t));
}

/**
 * Images already saved as artifacts in this workspace.
 * @param orgId - Tenant.
 * @param query - Free text; empty matches everything.
 * @param limit - Cap.
 */
export async function screenshotsFromArtifacts(orgId: string, query: string, limit: number): Promise<Screenshot[]> {
  const rows = await db.select({ kind: artifactSchema.kind, title: artifactSchema.title, spec: artifactSchema.spec, folder: artifactSchema.folder, url: artifactSchema.url })
    .from(artifactSchema)
    .where(and(eq(artifactSchema.orgId, orgId), inArray(artifactSchema.kind, ['file', 'link'])))
    .orderBy(desc(artifactSchema.updatedAt))
    .limit(200);
  const out: Screenshot[] = [];
  for (const row of rows) {
    const spec = row.spec as Partial<FileSpec> & Partial<LinkSpec>;
    const isImageFile = row.kind === 'file' && typeof spec.contentType === 'string' && spec.contentType.startsWith('image/');
    const url = (row.kind === 'file' ? spec.url : spec.href) ?? row.url ?? '';
    if (!url || (!isImageFile && !IMAGE_EXT.test(url))) {
      continue;
    }
    if (!matches(query, row.title, row.folder, spec.description)) {
      continue;
    }
    out.push({
      url,
      caption: row.title,
      ...(row.folder ? { shows: row.folder } : {}),
      source: 'artifact',
      publiclyFetchable: publiclyFetchable(url),
    });
    if (out.length >= limit) {
      break;
    }
  }
  return out;
}

/**
 * Images published by the workspace's own site, as ingested by a `web`
 * knowledge source — the release post's hero screenshot, and any image the
 * page linked.
 * @param orgId - Tenant.
 * @param query - Free text; empty matches everything.
 * @param limit - Cap.
 */
export async function screenshotsFromSite(orgId: string, query: string, limit: number): Promise<Screenshot[]> {
  const sources = await db.select({ id: knowledgeSourceSchema.id })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), eq(knowledgeSourceSchema.kind, 'web')));
  if (sources.length === 0) {
    return [];
  }
  const docs = await db.select({ title: knowledgeDocumentSchema.title, uri: knowledgeDocumentSchema.uri, metadata: knowledgeDocumentSchema.metadata })
    .from(knowledgeDocumentSchema)
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id))))
    .orderBy(desc(knowledgeDocumentSchema.lastModifiedAt))
    .limit(300);
  const out: Screenshot[] = [];
  const seen = new Set<string>();
  for (const doc of docs) {
    if (!matches(query, doc.title, doc.uri)) {
      continue;
    }
    const meta = doc.metadata as { ogImage?: unknown; links?: unknown };
    const urls: string[] = [];
    if (typeof meta.ogImage === 'string') {
      urls.push(meta.ogImage);
    }
    if (Array.isArray(meta.links)) {
      for (const link of meta.links) {
        const u = (link as { url?: unknown }).url;
        if (typeof u === 'string' && IMAGE_EXT.test(u)) {
          urls.push(u);
        }
      }
    }
    for (const url of urls) {
      if (seen.has(url) || !publiclyFetchable(url)) {
        continue;
      }
      seen.add(url);
      out.push({
        url,
        caption: doc.title ?? 'screenshot',
        ...(doc.uri ? { shows: doc.uri } : {}),
        source: 'site',
        publiclyFetchable: true,
      });
      if (out.length >= limit) {
        return out;
      }
    }
  }
  return out;
}

/**
 * A registered fixture screenshot library: `VOCION_SCREENSHOT_LIBRARY` points
 * at a JSON file holding `[{ url, caption, shows? }]`. Unset — the default —
 * contributes nothing and reports nothing, rather than pretending a library
 * exists.
 * @param query - Free text; empty matches everything.
 * @param limit - Cap.
 * @param read - Injectable reader, for tests.
 */
export async function screenshotsFromLibrary(query: string, limit: number, read: (p: string) => Promise<string> = p => readFile(p, 'utf8')): Promise<Screenshot[]> {
  const path = process.env.VOCION_SCREENSHOT_LIBRARY?.trim();
  if (!path) {
    return [];
  }
  try {
    const parsed = JSON.parse(await read(path)) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(e => e as { url?: unknown; caption?: unknown; shows?: unknown })
      .filter(e => typeof e.url === 'string' && e.url)
      .map(e => ({
        url: String(e.url),
        caption: typeof e.caption === 'string' ? e.caption : 'screenshot',
        ...(typeof e.shows === 'string' ? { shows: e.shows } : {}),
        source: 'library' as const,
        publiclyFetchable: publiclyFetchable(String(e.url)),
      }))
      .filter(s => matches(query, s.caption, s.shows))
      .slice(0, limit);
  } catch (error) {
    console.error('[ScreenshotService] could not read VOCION_SCREENSHOT_LIBRARY', error);
    return [];
  }
}

export type ScreenshotSearch = {
  screenshots: Screenshot[];
  /** Which of the three places were actually searched — an empty result from a place that does not exist is not "none found". */
  searched: ('artifact' | 'site' | 'library')[];
};

/**
 * All three lookups, best-first: the workspace's own site (public URLs, which
 * every surface can render), then artifacts, then the fixture library.
 * @param opts - Tenant, query and cap.
 * @param opts.orgId
 * @param opts.query
 * @param opts.limit
 */
export async function findScreenshots(opts: { orgId: string; query: string; limit?: number }): Promise<ScreenshotSearch> {
  const limit = Math.min(opts.limit ?? 6, 20);
  const query = opts.query.trim();
  const [site, artifacts, library] = await Promise.all([
    screenshotsFromSite(opts.orgId, query, limit).catch(() => []),
    screenshotsFromArtifacts(opts.orgId, query, limit).catch(() => []),
    screenshotsFromLibrary(query, limit).catch(() => []),
  ]);
  const searched: ScreenshotSearch['searched'] = ['site', 'artifact'];
  if (process.env.VOCION_SCREENSHOT_LIBRARY?.trim()) {
    searched.push('library');
  }
  return { screenshots: [...site, ...artifacts, ...library].slice(0, limit), searched };
}
