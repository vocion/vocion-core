/**
 * site_inventory — every page of a client's site with its basics, filed as a
 * dated artifact on the client's project.
 *
 * Onboarding used to read about ten pages of a forty-page site through
 * `crawl_site` and nothing about how they are built. This reads the site's
 * own sitemap (nested indexes followed), then robots.txt's `Sitemap:` lines,
 * and only then crawls; reads each page once for status, title, meta
 * description, H1, canonical, noindex, word count and schema.org types
 * (`libs/tools/site/inventory.ts`, over `extractPageFacts`), a few at a time,
 * up to a cap it states when hit; and files the table with every row linked
 * plus a short list of what needs fixing. The project records the artifact
 * (`siteInventory`), so its bundle links it.
 *
 * Granted by name (`harness.grantTools: [site_inventory]`). Reads only public
 * addresses, through the same guard as SERP research.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { RuntimeContext } from '../types';
import type { InventoryFetchers, SiteInventory } from '@/libs/tools/site/inventory';
import type { RoomMeta } from '@/services/DataRoomService';
import { Buffer } from 'node:buffer';
import { gunzipSync } from 'node:zlib';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { fetchPublic, PublicFetchError, readCapped } from '@/libs/net/publicFetch';
import { USER_AGENT } from '@/libs/sources/web';
import { bfsCrawl } from '@/libs/tools/browse/crawl';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { DEFAULT_INVENTORY_CAP, inventoryIssues, readInventory, renderInventory, siteOrigin } from '@/libs/tools/site/inventory';
import { ProviderNotConfiguredError, ToolProviderKeyUnavailableError } from '@/libs/tools/types';
import { toPayload, updateArtifact } from '@/services/ArtifactService';
import { fileToDataRoom, getDataRoom, projectHref, updateDataRoom } from '@/services/DataRoomService';
import { authorOf, renderMarkdownArtifact } from './renderArtifacts';

export const SITE_INVENTORY = 'site_inventory';

/** The artifact folder inventories file into. */
export const SITE_INVENTORY_FOLDER = 'site-inventory';

/** The most of one sitemap read off the wire. */
const MAX_SITEMAP_BYTES = 20 * 1024 * 1024;

/**
 * A text file from a public address, gunzipped when it is a `.gz` sitemap;
 * null when the site has none (any HTTP error).
 * @param url - The file.
 */
export async function fetchText(url: string): Promise<string | null> {
  try {
    const { res } = await fetchPublic(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/xml,text/xml,text/plain,*/*' } });
    const bytes = await readCapped(res, MAX_SITEMAP_BYTES);
    return (bytes[0] === 0x1F && bytes[1] === 0x8B ? gunzipSync(bytes) : Buffer.from(bytes)).toString('utf8');
  } catch (err) {
    if (err instanceof PublicFetchError && (err.code === 'http' || err.code === 'network')) {
      return null;
    }
    throw err;
  }
}

/**
 * The network half of an inventory, for one workspace.
 * @param ctx - The turn.
 */
export function inventoryFetchers(ctx: RuntimeContext): InventoryFetchers {
  const provider = getBrowseProvider();
  return {
    fetchText,
    fetchHtml: url => provider.fetchHtml(url, { orgId: ctx.orgId }),
    crawl: async (start, maxPages) => (await bfsCrawl(provider, start, { maxDepth: 3, maxPages, orgId: ctx.orgId })).map(p => p.url),
  };
}

/** What one inventory run filed, or why it could not. */
export type ProjectInventory = { ok: true; inv: SiteInventory; artifactId: number; title: string } | { ok: false; message: string };

/**
 * Read a project's whole site and file it on the project: the dated artifact
 * (one per site; a second read is a new version), filed as a source and
 * recorded as the project's inventory. The site inventory tool and the SEO
 * audit both run it.
 * @param ctx - The turn.
 * @param room - The project.
 * @param room.id
 * @param room.meta
 * @param opts - The site (default the project's first domain) and the cap.
 * @param opts.url
 * @param opts.cap
 * @param opts.onProgress
 */
export async function inventoryProject(ctx: RuntimeContext, room: { id: number; meta: RoomMeta }, opts: { url?: string; cap?: number; onProgress?: NonNullable<Parameters<typeof readInventory>[2]>['onProgress'] } = {}): Promise<ProjectInventory> {
  const site = opts.url ?? room.meta.domains?.[0];
  if (!site) {
    return { ok: false, message: `Project #${room.id} has no domain. Pass the site's url.` };
  }
  let origin: string;
  try {
    origin = siteOrigin(site);
  } catch {
    return { ok: false, message: `"${site}" is not a site address.` };
  }
  const cap = opts.cap ?? DEFAULT_INVENTORY_CAP;
  let inv: SiteInventory;
  try {
    inv = await readInventory(origin, inventoryFetchers(ctx), { cap, onProgress: opts.onProgress });
  } catch (err) {
    if (err instanceof ToolProviderKeyUnavailableError) {
      return { ok: false, message: `${err.message}. A workspace admin can re-enter it under API credentials.` };
    }
    if (err instanceof ProviderNotConfiguredError) {
      return { ok: false, message: `Browse is not configured (${err.message}).` };
    }
    return { ok: false, message: `Could not read ${origin}: ${(err as Error).message ?? 'unknown error'}. Say the inventory could not be made; do not list pages from memory.` };
  }
  if (inv.rows.length === 0) {
    return { ok: false, message: `${origin} listed no pages: no sitemap, nothing in robots.txt, and a crawl from the home page read nothing. Say so; do not list pages from memory.` };
  }
  const md = renderInventory(inv);
  const title = `Site inventory · ${inv.site}`;
  // One inventory per site: a second read is a new version of the same
  // artifact (its history keeps the last), never a second artifact.
  const held = room.meta.siteInventory?.site === inv.site ? room.meta.siteInventory.artifactId : null;
  let artifactId: number | null = null;
  if (held) {
    const updated = await updateArtifact({ orgId: ctx.orgId, id: held, contentMarkdown: md, author: authorOf(ctx), changeSummary: `Read again ${inv.readAt.slice(0, 10)}`, runId: ctx.traceId ?? null }).catch(() => null);
    if (updated) {
      artifactId = held;
      ctx.emit({ type: 'artifact', artifact: toPayload(updated.artifact) });
    }
  }
  if (artifactId === null) {
    const made = await renderMarkdownArtifact(ctx, title, md, SITE_INVENTORY_FOLDER);
    if (made.artifactId === null) {
      return { ok: false, message: `The inventory of ${inv.site} was read (${inv.rows.length} pages) but could not be filed: ${made.receipt}` };
    }
    artifactId = made.artifactId;
  }
  // Filed as one of the project's sources (it lands on the project, and
  // the writer can open it by id), and recorded as its inventory.
  await fileToDataRoom(ctx.orgId, room.id, { artifactId, title, kind: 'note', rating: 2, channel: 'site_inventory', date: inv.readAt.slice(0, 10), note: `${inv.rows.length} pages from the ${inv.from}`, author: authorOf(ctx) });
  await updateDataRoom(ctx.orgId, room.id, {
    siteInventory: {
      artifactId,
      site: inv.site,
      readAt: inv.readAt,
      pages: inv.rows.length,
      from: inv.from,
      ...(inv.cappedAt ? { cappedAt: inv.cappedAt, listed: inv.listed } : {}),
    },
  });
  return { ok: true, inv, artifactId, title };
}

function siteInventoryTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const room = await getDataRoom(ctx.orgId, args.project_id);
      if (!room) {
        return `No project #${args.project_id} in this workspace.`;
      }
      const run = await inventoryProject(ctx, room, { url: args.url, cap: args.max_pages });
      if (!run.ok) {
        return run.message;
      }
      const { inv, artifactId, title } = run;
      const issues = inventoryIssues(inv.rows);
      return JSON.stringify({
        inventory: { artifactId, href: `/dashboard/artifacts/${artifactId}`, title },
        project: { id: room.id, href: projectHref(room.id) },
        from: inv.from,
        sitemaps: inv.sitemaps,
        listed: inv.listed,
        read: inv.rows.length,
        ...(inv.cappedAt ? { capped: `The site lists ${inv.listed} pages; the first ${inv.cappedAt} were read. Say so, and offer to run it again with max_pages ${inv.listed}.` } : {}),
        ...(inv.from === 'crawl' ? { note: 'No sitemap: the list comes from a crawl, so pages nothing links to are missing. Say so.' } : {}),
        needsFixing: {
          didNotLoad: issues.notRead.length,
          noTitle: issues.noTitle.length,
          noMetaDescription: issues.noMeta.length,
          noH1: issues.noH1.length,
          moreThanOneH1: issues.manyH1.length,
          duplicateTitles: issues.duplicateTitles.length,
          duplicateMetaDescriptions: issues.duplicateMeta.length,
          noindex: issues.noindex.length,
          canonicalElsewhere: issues.canonicalElsewhere.length,
        },
        pages: inv.rows.map(r => ({ url: r.url, status: r.status, title: r.title, h1: r.h1, words: r.wordCount })),
        next: 'The inventory is filed on the project as a source and linked from its bundle. It is the content inventory, blog posts included, whether or not the site\'s repository is connected: build the notes\' content inventory from these pages (by topic, with URLs), and name what needs fixing in a line or two; the artifact holds the full table.',
      });
    },
    {
      name: SITE_INVENTORY,
      description: 'Inventory a client\'s whole site onto their project: reads the site\'s sitemap (nested indexes followed), then robots.txt\'s Sitemap lines, else crawls; then every page once for HTTP status, title, meta description, H1, canonical, noindex, word count and schema.org types. Files a dated artifact on the project — every page in a table, each row linked, and what needs fixing (missing titles, meta descriptions or H1s, duplicates, noindex, pages that did not load) — and records it on the project. Reads up to max_pages (default 300) and says when the site has more.',
      schema: z.object({
        project_id: z.number().int().positive().describe('The client\'s project; the inventory is filed on it.'),
        url: z.string().max(300).optional().describe('The site, as a domain or URL. Defaults to the project\'s first domain.'),
        max_pages: z.number().int().min(1).max(5000).optional().describe(`Pages read at most (default ${DEFAULT_INVENTORY_CAP}).`),
      }),
    },
  );
}

/**
 * The tool, for an agent granted it by name.
 * @param ctx - The turn.
 */
export function siteInventoryTools(ctx: RuntimeContext): StructuredToolInterface[] {
  return (ctx.harnessConfig.grantTools ?? []).includes(SITE_INVENTORY) ? [siteInventoryTool(ctx)] : [];
}
