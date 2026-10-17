/**
 * The asset catalog: the case studies, blueprints, eBooks, tools and pages an
 * outreach email may link, read as rows.
 *
 * Rows arrive through a `drive` source whose config names catalog files (a
 * spreadsheet, native or .xlsx) and extra rows written in config (see
 * `libs/sources/assetCatalog.ts`). Each row is a knowledge document with
 * `metadata.kind = 'asset'`; this module reads them back as structured rows
 * for three jobs:
 *
 *   - `find_assets`, the drafting agent's lookup;
 *   - the link check at the two doors a draft passes (save, Enroll's
 *     precheck): every URL in an agent's send must be a catalog URL, so a
 *     made-up or mistyped link is refused with the URL named;
 *   - the UTM rewrite at Enroll, so tagging is the platform's job and never
 *     the model's.
 *
 * Rows the last sync did not see (removed from the sheet) are not current:
 * only documents seen in the catalog's latest pass are read.
 */

import type { AssetRow } from '@/libs/sources/assetCatalog';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { catalogUtmSchema, normalizeAssetUrl } from '@/libs/sources/assetCatalog';
import { knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';

export type CatalogAsset = AssetRow & { id: number };

/** A pass touches every row within seconds; anything older than this before the latest is gone from the sheet. */
const PASS_SLACK_MS = 30 * 60_000;

/**
 * Every current catalog row for the org.
 * @param orgId
 */
export async function catalogAssets(orgId: string): Promise<CatalogAsset[]> {
  const rows = await db
    .select({ id: knowledgeDocumentSchema.id, metadata: knowledgeDocumentSchema.metadata, lastSeenAt: knowledgeDocumentSchema.lastSeenAt })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      sql`${knowledgeDocumentSchema.metadata}->>'kind' = 'asset'`,
    ));
  if (rows.length === 0) {
    return [];
  }
  const latest = Math.max(...rows.map(r => r.lastSeenAt.getTime()));
  return rows
    .filter(r => r.lastSeenAt.getTime() >= latest - PASS_SLACK_MS)
    .map(r => ({ ...(r.metadata as unknown as AssetRow), id: r.id }));
}

/**
 * The UTM settings the catalog's source carries, if any.
 * @param orgId
 */
async function catalogUtm(orgId: string) {
  const sources = await db
    .select({ configJson: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(and(eq(knowledgeSourceSchema.orgId, orgId), sql`${knowledgeSourceSchema.configJson}->>'_connector' = 'drive'`));
  for (const s of sources) {
    const utm = (s.configJson as { catalog?: { utm?: unknown } } | null)?.catalog?.utm;
    const parsed = catalogUtmSchema.safeParse(utm);
    if (utm && parsed.success) {
      return parsed.data;
    }
  }
  return null;
}

export type AssetQuery = {
  industry?: string;
  funnelStage?: string;
  type?: string;
  persona?: string;
  topic?: string;
  text?: string;
};

/**
 * Catalog rows ranked for a lead: a row naming the lead's industry first,
 * then rows for all industries, each narrowed by the other filters. Only
 * rows whose link answered when last checked.
 * @param assets
 * @param q
 */
export function rankAssets(assets: CatalogAsset[], q: AssetQuery): Array<CatalogAsset & { match: string[] }> {
  const has = (field: string | undefined, want: string | undefined) => !want || (field ?? '').toLowerCase().includes(want.toLowerCase());
  const words = (q.text ?? '').toLowerCase().split(/\W+/).filter(w => w.length > 2);
  return assets
    .filter(a => a.linkOk !== false)
    .filter(a => has(a.funnelStage, q.funnelStage) && has(a.type, q.type))
    .map((a) => {
      const match: string[] = [];
      let score = 0;
      const industry = (a.industry ?? '').toLowerCase();
      if (q.industry && industry && (industry.includes(q.industry.toLowerCase()) || q.industry.toLowerCase().includes(industry))) {
        score += 10;
        match.push('industry');
      } else if (!industry || industry.includes('all industries')) {
        score += 2;
        match.push('all industries');
      } else if (q.industry) {
        return null;
      }
      if (q.persona && has(a.persona, q.persona)) {
        score += 3;
        match.push('persona');
      }
      if (q.topic && has(`${a.topic ?? ''} ${a.title}`, q.topic)) {
        score += 3;
        match.push('topic');
      }
      const hay = `${a.title} ${a.purpose ?? ''} ${a.buyerQuestion ?? ''} ${a.topic ?? ''}`.toLowerCase();
      const hits = words.filter(w => hay.includes(w)).length;
      score += hits;
      if (hits > 0) {
        match.push(`${hits} word(s)`);
      }
      return { a, score, match };
    })
    .filter((x): x is { a: CatalogAsset; score: number; match: string[] } => x !== null)
    .sort((x, y) => y.score - x.score || x.a.title.localeCompare(y.a.title))
    .map(x => ({ ...x.a, match: x.match }));
}

/** Any http(s) URL in a send, as written or inside an href. */
const URL_IN_TEXT = /https?:\/\/[^\s<>"']*[^\s<>"'.,;:!?)\]]/g;

/**
 * The URLs in sends that are not in the catalog. Empty when every link is a
 * catalog link, or when the org has no catalog at all (nothing to check against).
 * @param orgId
 * @param bodies - The sends' bodies, prose or HTML.
 */
export async function linksOutsideCatalog(orgId: string, bodies: string[]): Promise<string[]> {
  const urls = [...new Set(bodies.flatMap(b => [...b.replaceAll('&amp;', '&').matchAll(URL_IN_TEXT)].map(m => m[0])))];
  if (urls.length === 0) {
    return [];
  }
  const assets = await catalogAssets(orgId);
  if (assets.length === 0) {
    return [];
  }
  const known = new Set(assets.flatMap(a => [a.url, ...(a.aliases ?? [])].map(normalizeAssetUrl)));
  return urls.filter(u => !known.has(normalizeAssetUrl(u)));
}

/**
 * The href rewrite Enroll applies: a catalog link gains the catalog's UTMs
 * and `utm_content` = the asset's title; a link that already carries UTMs
 * (the tools' tracked links) is left as written. Undefined when the org has
 * no catalog UTM settings.
 * @param orgId
 */
export async function linkRewriterFor(orgId: string): Promise<((href: string) => string) | undefined> {
  const utm = await catalogUtm(orgId);
  if (!utm) {
    return undefined;
  }
  const assets = await catalogAssets(orgId);
  const byUrl = new Map(assets.flatMap(a => [a.url, ...(a.aliases ?? [])].map(u => [normalizeAssetUrl(u), a] as const)));
  return (href: string) => {
    const asset = byUrl.get(normalizeAssetUrl(href));
    if (!asset || /[?&]utm_/i.test(href)) {
      return href;
    }
    try {
      const url = new URL(href);
      url.searchParams.set('utm_source', utm.source);
      url.searchParams.set('utm_medium', utm.medium ?? '');
      if (!utm.medium) {
        url.searchParams.delete('utm_medium');
      }
      url.searchParams.set('utm_campaign', utm.campaign);
      url.searchParams.set('utm_content', asset.title);
      return url.toString();
    } catch {
      return href;
    }
  };
}
