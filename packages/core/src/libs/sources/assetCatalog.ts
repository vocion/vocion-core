/**
 * Asset catalog rows: a marketing team's list of what outreach may link
 * (case studies, blueprints, eBooks, tools, pages), kept as a spreadsheet,
 * read as one knowledge document per row with the fields in metadata.
 *
 * A `drive` source opts in with `catalog:` in its config. The sheet is the
 * marketing team's: columns are matched by their header text (Asset Title,
 * Asset Type, Funnel Stage, Page Link, ...), not by position, so a column
 * added or moved does not break the read. Rows written in config (`rows`)
 * join the sheet's, for links that live nowhere else (a tool's tracked link).
 *
 * The rules each row is held to, with the reason a row is skipped:
 *   - it needs a title and a link;
 *   - a gated asset links its landing page, never the file, because the
 *     page's form is what captures the download; a gated row with only a
 *     file link is skipped;
 *   - a second row with the same link is skipped as a duplicate.
 */

import type { IngestDoc } from '@/services/IngestionService';
import { createHash } from 'node:crypto';
import { z } from 'zod';

export const catalogUtmSchema = z.object({
  source: z.string().min(1),
  campaign: z.string().min(1),
  medium: z.string().min(1).optional(),
});

const configRowSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  url: z.string().url(),
  /** Other spellings of the same link (a short link and where it lands). */
  aliases: z.array(z.string().url()).optional(),
  funnelStage: z.string().optional(),
  topic: z.string().optional(),
  persona: z.string().optional(),
  industry: z.string().optional(),
  purpose: z.string().optional(),
  buyerQuestion: z.string().optional(),
  cta: z.string().optional(),
  gated: z.boolean().optional(),
});

export const assetCatalogConfigSchema = z.object({
  /** Spreadsheets to read, by Drive file id; `sheet` picks a tab (the first otherwise). */
  files: z.array(z.object({ fileId: z.string().min(1), sheet: z.string().optional() })).default([]),
  rows: z.array(configRowSchema).default([]),
  /** The UTM tags Enroll adds to a catalog link that carries none. */
  utm: catalogUtmSchema.optional(),
  /** Fetch every link at sync and mark the ones that do not answer. */
  checkLinks: z.boolean().default(true),
});
export type AssetCatalogConfig = z.infer<typeof assetCatalogConfigSchema>;

export type AssetRow = {
  kind: 'asset';
  title: string;
  type: string;
  url: string;
  aliases?: string[];
  funnelStage?: string;
  topic?: string;
  persona?: string;
  industry?: string;
  purpose?: string;
  buyerQuestion?: string;
  cta?: string;
  gated?: boolean;
  /** `sheet:<fileId>` or `config`. */
  origin: string;
  linkOk?: boolean;
  linkStatus?: number | string;
};

type Field = Exclude<keyof AssetRow, 'kind' | 'url' | 'aliases' | 'origin' | 'linkOk' | 'linkStatus' | 'gated'> | 'pageUrl' | 'fileUrl' | 'gated';

/** Header text → field. Matched case-insensitively, exact header first, then by prefix. */
const HEADERS: Array<[Field, string[]]> = [
  ['title', ['asset title', 'title', 'asset', 'name']],
  ['type', ['asset type', 'type', 'format']],
  ['funnelStage', ['funnel stage', 'stage', 'funnel']],
  ['topic', ['topic / theme', 'topic', 'theme']],
  ['persona', ['persona / role', 'persona', 'role']],
  ['industry', ['industry / vertical', 'industry', 'vertical']],
  ['gated', ['gated?', 'gated']],
  ['purpose', ['what it\'s for', 'what it’s for', 'purpose', 'description']],
  ['buyerQuestion', ['buyer question it answers', 'buyer question', 'question']],
  ['cta', ['suggested next step / cta', 'cta', 'next step']],
  ['pageUrl', ['page link', 'page url', 'web link', 'url', 'link']],
  ['fileUrl', ['file link', 'file url', 'pdf link', 'pdf']],
];

/**
 * Column index per field, from a header row; null when the row is not a header.
 * @param header
 */
function columnsOf(header: unknown[]): Partial<Record<Field, number>> | null {
  const cells = header.map(c => String(c ?? '').trim().toLowerCase());
  const cols: Partial<Record<Field, number>> = {};
  for (const [field, names] of HEADERS) {
    const exact = cells.findIndex(c => names.includes(c));
    if (exact >= 0 && !Object.values(cols).includes(exact)) {
      cols[field] = exact;
    }
  }
  return cols.title !== undefined && (cols.pageUrl !== undefined || cols.fileUrl !== undefined) ? cols : null;
}

/**
 * A link compared by what it points at: scheme and host lowercased, `www.`,
 * query, fragment and trailing slash dropped.
 * @param url
 */
export function normalizeAssetUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/**
 * @param v
 */
function firstUrl(v: unknown): string | undefined {
  const m = /https?:\/\/\S+/.exec(String(v ?? ''));
  return m?.[0];
}

/**
 * @param v
 */
function text(v: unknown): string | undefined {
  const s = String(v ?? '').trim();
  return s && s.toUpperCase() !== 'N/A' ? s : undefined;
}

export type ParsedCatalog = { rows: AssetRow[]; skipped: Array<{ title: string; why: string }> };

/**
 * A sheet's rows (arrays of cells, header somewhere near the top) → catalog
 * rows. Pure.
 * @param grid - Rows of cells, as a spreadsheet reader returns them.
 * @param origin - Where they came from, recorded on each row.
 */
export function parseCatalogGrid(grid: unknown[][], origin: string): ParsedCatalog {
  const headerAt = grid.slice(0, 10).findIndex(r => columnsOf(r) !== null);
  if (headerAt < 0) {
    return { rows: [], skipped: [{ title: origin, why: 'no header row with a title column and a link column in the first ten rows' }] };
  }
  const cols = columnsOf(grid[headerAt]!)!;
  const at = (row: unknown[], f: Field) => (cols[f] === undefined ? undefined : row[cols[f]!]);
  const rows: AssetRow[] = [];
  const skipped: ParsedCatalog['skipped'] = [];
  for (const row of grid.slice(headerAt + 1)) {
    const title = text(at(row, 'title'));
    if (!title) {
      continue;
    }
    const gated = /^(?:y(?:es)?|true)$/i.test(String(at(row, 'gated') ?? '').trim());
    const page = firstUrl(at(row, 'pageUrl'));
    const file = firstUrl(at(row, 'fileUrl'));
    const url = page ?? (gated ? undefined : file);
    if (!url) {
      skipped.push({ title, why: gated && file ? 'gated, and only a file link: link the landing page so the form captures the download' : 'no link' });
      continue;
    }
    rows.push({
      kind: 'asset',
      title,
      type: text(at(row, 'type')) ?? 'Asset',
      url,
      funnelStage: text(at(row, 'funnelStage')),
      topic: text(at(row, 'topic')),
      persona: text(at(row, 'persona')),
      industry: text(at(row, 'industry')),
      purpose: text(at(row, 'purpose')),
      buyerQuestion: text(at(row, 'buyerQuestion')),
      cta: text(at(row, 'cta')),
      gated,
      origin,
    });
  }
  return { rows, skipped };
}

/**
 * Config rows → catalog rows.
 * @param rows
 */
export function configCatalogRows(rows: AssetCatalogConfig['rows']): AssetRow[] {
  return rows.map(r => ({ kind: 'asset' as const, ...r, origin: 'config' }));
}

/**
 * One row per link, the first wins; later rows with the same link are skipped.
 * @param rows
 */
export function dedupeByUrl(rows: AssetRow[]): ParsedCatalog {
  const seen = new Map<string, string>();
  const out: AssetRow[] = [];
  const skipped: ParsedCatalog['skipped'] = [];
  for (const r of rows) {
    const key = normalizeAssetUrl(r.url);
    const first = seen.get(key);
    if (first) {
      skipped.push({ title: r.title, why: `same link as "${first}"` });
      continue;
    }
    seen.set(key, r.title);
    out.push(r);
  }
  return { rows: out, skipped };
}

/**
 * The row as a knowledge document: searchable text, fields in metadata.
 * @param row
 */
export function assetDoc(row: AssetRow): IngestDoc {
  const lines = [
    `${row.title} (${row.type}${row.funnelStage ? `, ${row.funnelStage}` : ''})`,
    row.industry ? `Industry: ${row.industry}` : '',
    row.persona ? `For: ${row.persona}` : '',
    row.purpose ?? '',
    row.buyerQuestion ? `Answers: ${row.buyerQuestion}` : '',
  ].filter(Boolean);
  return {
    externalId: `asset:${createHash('sha1').update(normalizeAssetUrl(row.url)).digest('hex').slice(0, 16)}`,
    title: row.title,
    uri: row.url,
    content: lines.join('\n'),
    metadata: { ...row },
  };
}

/**
 * Whether a link answers: the final status after redirects, GET because some
 * sites refuse HEAD.
 * @param url
 * @param fetchImpl
 */
export async function checkLink(url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: boolean; status: number | string }> {
  try {
    const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'Mozilla/5.0 (compatible; VocionLinkCheck/1.0)' } });
    await res.body?.cancel().catch(() => undefined);
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, status: error instanceof Error ? error.name : 'error' };
  }
}
