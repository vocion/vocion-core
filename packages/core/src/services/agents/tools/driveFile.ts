/**
 * get_drive_file — the whole text of one synced Google Drive file.
 *
 * The drive connector exports Docs and Slides as text and stores each file as
 * one `knowledge_document` (externalId `drive:<fileId>`), chunked for search.
 * Search answers with a snippet of one chunk, which is too little to read a
 * deck's figures from. This tool reassembles every chunk of the synced copy
 * (zero API calls) and, when there is no usable copy or the agent asks for a
 * fresh one, exports the file live and UPSERTS it through the normal ingestion
 * path — same externalId and content format as the sync (`fetchDriveFileDoc`),
 * so the next scheduled sync sees an unchanged hash.
 *
 * Access boundary = the source gate: built only for agents whose
 * `connectorSources` include a drive source, and it reads only the drive
 * sources the agent holds — the same files `search_knowledge` already shows it.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { fetchDriveFileDoc } from '@/libs/sources/drive';
import { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema } from '@/models/Schema';
import { ensureSource, ingestDocument } from '@/services/IngestionService';
import { firstCredentialed, sourcesForConnector } from './zoomTranscript';

/** A source slug that belongs to the Google Drive connector family. */
const DRIVE_SLUG = /(?:^|-)drive(?:$|-)/;

/** Characters returned per call; a longer file is read in pages by `offset`. */
export const DRIVE_TEXT_PAGE_CHARS = 60_000;

export function hasDriveSource(ctx: RuntimeContext): boolean {
  return ctx.connectorSources.some(s => DRIVE_SLUG.test(s));
}

/**
 * Rejoin chunks without the 64-token overlap the chunker repeats at each
 * boundary, so a figure near a boundary is read once, not twice.
 * @param chunks
 */
export function joinWithoutOverlap(chunks: string[]): string {
  let out = '';
  for (const chunk of chunks) {
    if (!out) {
      out = chunk;
      continue;
    }
    let cut = 0;
    for (let k = Math.min(chunk.length, out.length, 2000); k >= 8; k--) {
      if (out.endsWith(chunk.slice(0, k))) {
        cut = k;
        break;
      }
    }
    out += cut > 0 ? chunk.slice(cut) : `\n${chunk}`;
  }
  return out;
}

/**
 * A Drive file id from what the agent has: a bare id, `drive:<id>`, or a
 * docs.google.com / drive.google.com link.
 * @param file
 */
export function driveFileIdFrom(file: string): string {
  const trimmed = file.trim();
  const link = trimmed.match(/\/d\/([\w-]{10,})/) ?? trimmed.match(/[?&]id=([\w-]{10,})/);
  if (link) {
    return link[1]!;
  }
  return trimmed.replace(/^drive:/, '');
}

export function driveTools(ctx: RuntimeContext) {
  if (!hasDriveSource(ctx)) {
    return [];
  }

  const getDriveFile = tool(
    async (args) => {
      const { file, title, offset, force_refresh } = args as {
        file?: string;
        title?: string;
        offset?: number;
        force_refresh?: boolean;
      };
      if (!file && !title) {
        return 'Pass file (a Drive file id, "drive:<id>", a Drive link, or the document id from search results) or title.';
      }
      const sources = (await sourcesForConnector(ctx.orgId, 'drive'))
        .filter(s => ctx.connectorSources.includes(s.slug));
      if (sources.length === 0) {
        return 'No Google Drive source is connected for this agent.';
      }
      const sourceIds = sources.map(s => s.id);

      const columns = {
        id: knowledgeDocumentSchema.id,
        sourceId: knowledgeDocumentSchema.sourceId,
        externalId: knowledgeDocumentSchema.externalId,
        title: knowledgeDocumentSchema.title,
        metadata: knowledgeDocumentSchema.metadata,
        lastModifiedAt: knowledgeDocumentSchema.lastModifiedAt,
        lastSeenAt: knowledgeDocumentSchema.lastSeenAt,
      };
      const scope = and(
        eq(knowledgeDocumentSchema.orgId, ctx.orgId),
        inArray(knowledgeDocumentSchema.sourceId, sourceIds),
      );

      async function findById(ref: string) {
        const docId = /^\d{1,12}$/.test(ref) ? Number.parseInt(ref, 10) : null;
        const [row] = await db
          .select(columns)
          .from(knowledgeDocumentSchema)
          .where(and(scope, docId !== null
            ? or(eq(knowledgeDocumentSchema.id, docId), eq(knowledgeDocumentSchema.externalId, `drive:${ref}`))
            : eq(knowledgeDocumentSchema.externalId, `drive:${driveFileIdFrom(ref)}`)))
          .limit(1);
        return row;
      }

      let others: string[] = [];
      let cached: Awaited<ReturnType<typeof findById>>;
      if (file) {
        cached = await findById(file);
      } else {
        const rows = await db
          .select(columns)
          .from(knowledgeDocumentSchema)
          .where(and(scope, ilike(knowledgeDocumentSchema.title, `%${title!.replace(/[%_\\]/g, m => `\\${m}`)}%`)))
          .orderBy(desc(knowledgeDocumentSchema.lastModifiedAt))
          .limit(6);
        const exact = rows.find(r => (r.title ?? '').toLowerCase() === title!.toLowerCase());
        cached = exact ?? rows[0];
        others = rows.filter(r => r !== cached).map(r => `${r.title} (file ${r.externalId.replace(/^drive:/, '')})`);
        if (!cached) {
          return `No synced Drive file has a title containing "${title}". Search with search_knowledge, or pass the file id or link.`;
        }
      }

      const page = (text: string) => {
        const start = Math.max(0, offset ?? 0);
        const slice = text.slice(start, start + DRIVE_TEXT_PAGE_CHARS);
        const next = start + slice.length < text.length ? start + slice.length : null;
        return {
          totalChars: text.length,
          offset: start,
          ...(next !== null ? { nextOffset: next, note: `Truncated: call again with offset ${next} for the rest.` } : {}),
          text: slice,
        };
      };

      if (cached && !force_refresh) {
        const text = joinWithoutOverlap(await chunkList(ctx.orgId, cached.id));
        if (text.trim()) {
          return JSON.stringify({
            source: 'cache',
            title: cached.title,
            fileId: cached.externalId.replace(/^drive:/, ''),
            mimeType: cached.metadata?.mimeType ?? null,
            modifiedAt: cached.lastModifiedAt?.toISOString() ?? null,
            syncedAt: cached.lastSeenAt?.toISOString() ?? null,
            ...(others.length > 0 ? { otherMatches: others } : {}),
            ...page(text),
          }, null, 2);
        }
      }

      const fileId = cached ? cached.externalId.replace(/^drive:/, '') : driveFileIdFrom(file!);
      const ordered = cached
        ? [...sources.filter(s => s.id === cached!.sourceId), ...sources.filter(s => s.id !== cached!.sourceId)]
        : sources;
      const credentialed = await firstCredentialed(ctx.orgId, ordered);
      if (!credentialed) {
        return cached
          ? 'The synced copy of this file has no text and the Drive source has no credentials to export it live. Say the file could not be read.'
          : 'No Drive credentials are stored for this workspace, and no synced copy of that file exists.';
      }
      const [sourceRow] = await db
        .select({ configJson: knowledgeSourceSchema.configJson })
        .from(knowledgeSourceSchema)
        .where(eq(knowledgeSourceSchema.id, credentialed.source.id))
        .limit(1);
      const baseUrl = typeof sourceRow?.configJson?.baseUrl === 'string' ? sourceRow.configJson.baseUrl : undefined;

      let doc: Awaited<ReturnType<typeof fetchDriveFileDoc>>;
      try {
        doc = await fetchDriveFileDoc({ credentials: credentialed.credentials, orgId: ctx.orgId, fileId, baseUrl });
      } catch (err) {
        return `Drive export failed: ${(err as Error).message}. Say the file could not be read; do not guess its contents.`;
      }
      if (!doc) {
        return `Drive has no file "${fileId}" the connected account can open. Check the id, or that the file is shared with the connected account.`;
      }
      if (!doc.content.trim()) {
        return `"${doc.title}" has no text Drive can export (it is not a Doc, Slides, Sheet or text file).`;
      }
      const ref = await ensureSource({ orgId: ctx.orgId, slug: credentialed.source.slug });
      const result = await ingestDocument(ref, doc);
      return JSON.stringify({
        source: 'live',
        upserted: result.status,
        title: doc.title,
        fileId,
        mimeType: (doc.metadata as Record<string, unknown> | undefined)?.mimeType ?? null,
        modifiedAt: doc.lastModifiedAt?.toISOString() ?? null,
        ...(others.length > 0 ? { otherMatches: others } : {}),
        ...page(doc.content),
      }, null, 2);
    },
    {
      name: 'get_drive_file',
      description: 'Read the WHOLE text of one Google Drive file (a Slides deck, Doc, Sheet or text file) — search results only show a snippet. Pass the file id, a Drive link, "drive:<id>", the document id from search results, or part of its title. Answers from the synced copy (source: "cache", with when it was last synced); pass force_refresh to export it live from Drive, which also refreshes the copy search reads. Long files come back in pages: call again with nextOffset.',
      schema: z.object({
        file: z.string().optional().describe('Drive file id, a docs.google.com / drive.google.com link, "drive:<id>", or the numeric document id from search results.'),
        title: z.string().optional().describe('The file\'s title or part of it, when you have no id (e.g. "Q4 2026 Board Meeting").'),
        offset: z.number().int().optional().describe('Character offset to read from, for the next page of a long file (from nextOffset).'),
        force_refresh: z.boolean().optional().describe('Skip the synced copy and export the file live from Drive.'),
      }),
    },
  );

  return [getDriveFile];
}

/**
 * The document's chunks in order, as a list (for the overlap-aware rejoin).
 * @param orgId
 * @param documentId
 */
async function chunkList(orgId: string, documentId: number): Promise<string[]> {
  const rows = await db
    .select({ content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), eq(knowledgeChunkSchema.documentId, documentId)))
    .orderBy(knowledgeChunkSchema.chunkIdx);
  return rows.map(r => r.content);
}
