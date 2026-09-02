/**
 * get_gmail_thread — read-through cache over the synced Gmail mirror.
 *
 * The gmail connector syncs metadata-only snippets (`gmail:<messageId>`);
 * full thread bodies are fetched on demand and cached as their own docs
 * (`gmail-thread:<threadId>`) with a `fetchedAt` watermark. Mail threads
 * grow, so freshness is a TTL (`max_age_minutes`, default 15): within it the
 * cached doc answers with zero API calls, past it the thread is re-fetched
 * and UPSERTED through the normal ingestion path (hash-unchanged threads are
 * a no-op; grown threads re-embed).
 *
 * The `gmail-thread:` namespace is never yielded by the sync connector, so
 * incremental crons never touch these docs; a full sync tombstones them —
 * that is cache eviction, and the read-through refills on the next ask.
 *
 * Access boundary = the source gate, same as `search_knowledge` over the
 * gmail source. Requires gmail.readonly scope on the stored credentials.
 */
import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { fetchGmailThreadDoc, resolveThreadIdForMessage } from '@/libs/sources/gmail';
import { knowledgeDocumentSchema } from '@/models/Schema';
import { ensureSource, ingestDocument } from '@/services/IngestionService';
import { firstCredentialed, reassembleDocument, sourcesForConnector } from './zoomTranscript';

/** A source slug that belongs to the Gmail connector family. */
const GMAIL_SLUG = /^gmail(?:$|-)/;

export function hasGmailSource(ctx: RuntimeContext): boolean {
  return ctx.connectorSources.some(s => GMAIL_SLUG.test(s));
}

export function gmailTools(ctx: RuntimeContext) {
  if (!hasGmailSource(ctx)) {
    return [];
  }

  const getGmailThread = tool(
    async (args) => {
      const { thread_id, message_id, max_age_minutes, force_refresh } = args as {
        thread_id?: string;
        message_id?: string;
        max_age_minutes?: number;
        force_refresh?: boolean;
      };
      if (!thread_id && !message_id) {
        return 'Pass thread_id or message_id — one of the two is required.';
      }
      const sources = await sourcesForConnector(ctx.orgId, 'gmail');
      if (sources.length === 0) {
        return 'No gmail source is connected for this workspace.';
      }
      const sourceIds = sources.map(s => s.id);

      // Resolve message → thread from the synced message doc when possible;
      // only fall back to a live lookup when the mirror doesn't know it.
      let threadId = thread_id;
      let credentialed: Awaited<ReturnType<typeof firstCredentialed>>;
      if (!threadId && message_id) {
        const [msgDoc] = await db
          .select({ metadata: knowledgeDocumentSchema.metadata })
          .from(knowledgeDocumentSchema)
          .where(and(
            eq(knowledgeDocumentSchema.orgId, ctx.orgId),
            inArray(knowledgeDocumentSchema.sourceId, sourceIds),
            eq(knowledgeDocumentSchema.externalId, `gmail:${message_id}`),
          ))
          .limit(1);
        const cachedThreadId = msgDoc?.metadata?.threadId;
        if (typeof cachedThreadId === 'string' && cachedThreadId !== '') {
          threadId = cachedThreadId;
        } else {
          credentialed = await firstCredentialed(ctx.orgId, sources);
          if (!credentialed) {
            return 'No gmail credentials are stored for this workspace, and the synced mirror does not know that message\'s thread.';
          }
          const resolved = await resolveThreadIdForMessage({
            credentials: credentialed.credentials,
            messageId: message_id,
          });
          if (!resolved) {
            return `Gmail has no message with id "${message_id}".`;
          }
          threadId = resolved;
        }
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
          inArray(knowledgeDocumentSchema.sourceId, sourceIds),
          eq(knowledgeDocumentSchema.externalId, `gmail-thread:${threadId}`),
        ))
        .limit(1);

      const ttlMs = (max_age_minutes ?? 15) * 60_000;
      const fetchedAt = typeof cached?.metadata?.fetchedAt === 'string'
        ? Date.parse(cached.metadata.fetchedAt)
        : Number.NaN;
      const fresh = Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs;

      if (cached && fresh && !force_refresh) {
        const content = await reassembleDocument(ctx.orgId, cached.id);
        return JSON.stringify({
          source: 'cache',
          title: cached.title,
          fetchedAt: cached.metadata?.fetchedAt ?? null,
          messageCount: cached.metadata?.messageCount ?? null,
          content,
        }, null, 2);
      }

      credentialed = credentialed ?? await firstCredentialed(ctx.orgId, sources);
      if (!credentialed) {
        if (cached) {
          const content = await reassembleDocument(ctx.orgId, cached.id);
          return JSON.stringify({
            source: 'cache',
            stale: true,
            note: 'No gmail credentials to refresh — this is the last synced copy and newer replies may be missing.',
            title: cached.title,
            fetchedAt: cached.metadata?.fetchedAt ?? null,
            messageCount: cached.metadata?.messageCount ?? null,
            content,
          }, null, 2);
        }
        return 'No gmail credentials are stored for this workspace, and no synced copy of that thread exists.';
      }

      const doc = await fetchGmailThreadDoc({
        credentials: credentialed.credentials,
        threadId: threadId!,
      });
      if (!doc) {
        return `Gmail has no thread with id "${threadId}".`;
      }

      const ref = await ensureSource({ orgId: ctx.orgId, slug: credentialed.source.slug });
      const result = await ingestDocument(ref, doc);
      const meta = doc.metadata as Record<string, unknown>;
      return JSON.stringify({
        source: 'live',
        upserted: result.status,
        title: doc.title,
        fetchedAt: meta.fetchedAt,
        messageCount: meta.messageCount,
        content: doc.content,
      }, null, 2);
    },
    {
      name: 'get_gmail_thread',
      description: 'Get the FULL text of one Gmail thread (every message: headers + body) by thread id or any message id in it. Read-through cache: answers from the synced mirror when a copy was fetched within max_age_minutes (source: "cache"), otherwise fetches live from Gmail and upserts it into the index (source: "live", with the upsert status). Use when you need the verbatim conversation rather than search snippets or the metadata-only synced snippets.',
      schema: z.object({
        thread_id: z.string().optional().describe('Gmail thread id (preferred).'),
        message_id: z.string().optional().describe('Any Gmail message id in the thread — resolved to its thread.'),
        max_age_minutes: z.number().int().positive().optional().describe('Cache TTL — a copy fetched within this window answers without an API call (default 15).'),
        force_refresh: z.boolean().optional().describe('Skip the cache and re-fetch from Gmail regardless of age.'),
      }),
    },
  );

  return [getGmailThread];
}
