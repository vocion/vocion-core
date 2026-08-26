/**
 * get_zoom_transcript — read-through cache over the synced Zoom mirror.
 *
 * Zoom cloud-recording transcripts are immutable once processed, so the
 * synced `knowledge_document` (externalId `zoom:<uuid>`) IS the cache: a doc
 * with `metadata.hasTranscript = true` is terminal — reassemble its chunks
 * and answer with zero API calls. Anything else (no doc, or a doc ingested
 * while Zoom was still processing) falls through to a targeted live fetch,
 * which is UPSERTED back through the normal ingestion path (same externalId,
 * byte-identical content format via `recordingToDoc`) so search and future
 * cache hits benefit and the next scheduled sync sees an unchanged hash.
 *
 * Access boundary = the source gate: built only for agents whose
 * `connectorSources` include a zoom source — the same boundary that already
 * exposes these transcripts through `search_knowledge`.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { fetchZoomMeetingTranscript } from '@/libs/sources/zoom';
import {
  knowledgeChunkSchema,
  knowledgeDocumentSchema,
  knowledgeSourceSchema,
} from '@/models/Schema';
import { ensureSource, ingestDocument } from '@/services/IngestionService';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/** A source slug that belongs to the Zoom connector family. */
const ZOOM_SLUG = /^zoom(?:$|-)/;

export function hasZoomSource(ctx: RuntimeContext): boolean {
  return ctx.connectorSources.some(s => ZOOM_SLUG.test(s));
}

type SourceRow = { id: number; slug: string };

/**
 * Every source in the org built on the given connector family.
 * @param orgId
 * @param connector
 */
export async function sourcesForConnector(orgId: string, connector: string): Promise<SourceRow[]> {
  return db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      or(
        eq(knowledgeSourceSchema.slug, connector),
        sql`${knowledgeSourceSchema.configJson} ->> '_connector' = ${connector}`,
      ),
    ));
}

/**
 * First source in the list that has live credentials in the vault.
 * @param orgId
 * @param sources
 */
export async function firstCredentialed(
  orgId: string,
  sources: SourceRow[],
): Promise<{ source: SourceRow; credentials: Record<string, unknown> } | undefined> {
  for (const source of sources) {
    const credentials = await getCredentialsForSource(orgId, source.slug);
    if (credentials) {
      return { source, credentials };
    }
  }
  return undefined;
}

/**
 * The full document body from its chunks (documents store no content column).
 * Chunks carry a 64-token overlap, so boundaries repeat slightly — accepted
 * everywhere chunks are rejoined (see DiscoveryDetectionService).
 * @param orgId
 * @param documentId
 */
export async function reassembleDocument(orgId: string, documentId: number): Promise<string> {
  const chunks = await db
    .select({ content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(
      eq(knowledgeChunkSchema.orgId, orgId),
      eq(knowledgeChunkSchema.documentId, documentId),
    ))
    .orderBy(knowledgeChunkSchema.chunkIdx);
  return chunks.map(c => c.content).join('\n');
}

export function zoomTools(ctx: RuntimeContext) {
  if (!hasZoomSource(ctx)) {
    return [];
  }

  const getZoomTranscript = tool(
    async (args) => {
      const { meeting, force_refresh } = args as { meeting: string; force_refresh?: boolean };
      const sources = await sourcesForConnector(ctx.orgId, 'zoom');
      if (sources.length === 0) {
        return 'No zoom source is connected for this workspace.';
      }

      const [cached] = await db
        .select({
          id: knowledgeDocumentSchema.id,
          title: knowledgeDocumentSchema.title,
          metadata: knowledgeDocumentSchema.metadata,
        })
        .from(knowledgeDocumentSchema)
        .where(and(
          eq(knowledgeDocumentSchema.orgId, ctx.orgId),
          inArray(knowledgeDocumentSchema.sourceId, sources.map(s => s.id)),
          or(
            eq(knowledgeDocumentSchema.externalId, `zoom:${meeting}`),
            sql`${knowledgeDocumentSchema.metadata} ->> 'meetingId' = ${meeting}`,
          ),
        ))
        .limit(1);

      if (cached && cached.metadata?.hasTranscript === true && !force_refresh) {
        const transcript = await reassembleDocument(ctx.orgId, cached.id);
        return JSON.stringify({
          source: 'cache',
          title: cached.title,
          shareUrl: cached.metadata?.shareUrl ?? null,
          transcript,
        }, null, 2);
      }

      const credentialed = await firstCredentialed(ctx.orgId, sources);
      if (!credentialed) {
        return cached
          ? 'The synced copy has no transcript yet and the zoom source has no credentials to fetch live — flag that the transcript is unavailable.'
          : 'No zoom credentials are stored for this workspace, and no synced copy of that meeting exists.';
      }

      const fetched = await fetchZoomMeetingTranscript({
        credentials: credentialed.credentials,
        meetingId: meeting,
      });
      if (!fetched) {
        return `Zoom has no cloud recording for meeting "${meeting}" — check the meeting UUID or numeric id.`;
      }
      if (!fetched.hasTranscript) {
        return `Recording "${fetched.doc.title}" exists but its transcript is not ready yet (Zoom may still be processing) — try again later.`;
      }

      const ref = await ensureSource({ orgId: ctx.orgId, slug: credentialed.source.slug });
      const result = await ingestDocument(ref, fetched.doc);
      return JSON.stringify({
        source: 'live',
        upserted: result.status,
        title: fetched.doc.title,
        shareUrl: (fetched.doc.metadata as Record<string, unknown> | undefined)?.shareUrl ?? null,
        transcript: fetched.doc.content,
      }, null, 2);
    },
    {
      name: 'get_zoom_transcript',
      description: 'Get the VERBATIM transcript of one Zoom cloud-recorded meeting by meeting UUID or numeric id. Read-through cache: answers from the synced mirror when the transcript is already ingested (source: "cache"), otherwise fetches live from Zoom and upserts it into the index (source: "live", with the upsert status) so search reflects it too. Use when you need the full text of a specific call rather than search snippets.',
      schema: z.object({
        meeting: z.string().describe('Zoom meeting UUID (preferred, from the recording/share link or the synced doc id "zoom:<uuid>") or numeric meeting id.'),
        force_refresh: z.boolean().optional().describe('Skip the cache and re-fetch from Zoom even when a synced transcript exists.'),
      }),
    },
  );

  return [getZoomTranscript];
}
