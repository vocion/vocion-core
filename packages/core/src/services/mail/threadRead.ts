/**
 * ONE GMAIL THREAD, READ THROUGH THE CACHE — the read behind the agent's
 * `get_gmail_thread` and the ask page's thread evidence
 * (`services/inbox/askEvidence.ts`), so both see the same copy.
 *
 * The cached copy is the `gmail-thread:<threadId>` document the read-through
 * files (`fetchGmailThreadDoc`). It answers while it is younger than the TTL,
 * or while it still ends at the message the caller knows is the thread's
 * last (`currentMessageId`, from the synced thread state): a thread that has
 * not grown needs no fetch. Otherwise it is fetched live and upserted through
 * ingestion. Without credentials, the last copy answers, marked stale.
 */
import type { SourceRow } from '@/services/agents/tools/zoomTranscript';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { fetchGmailThreadDoc } from '@/libs/sources/gmail';
import { knowledgeDocumentSchema } from '@/models/Schema';
import { firstCredentialed, reassembleDocument } from '@/services/agents/tools/zoomTranscript';
import { ensureSource, ingestDocument } from '@/services/IngestionService';

export type ThreadCopy = {
  title: string | null;
  fetchedAt: unknown;
  messageCount: unknown;
  content: string;
};

export type ThreadRead
  = | ({ source: 'cache'; stale?: true } & ThreadCopy)
    | ({ source: 'live'; upserted: string } & ThreadCopy)
    | { source: 'none'; reason: 'no_credentials' | 'not_found' };

/**
 * Read one thread: the cached copy when it is current, else Gmail.
 * @param opts - What to read.
 * @param opts.orgId - The workspace.
 * @param opts.sources - The workspace's gmail sources (the access boundary).
 * @param opts.threadId - The thread.
 * @param opts.maxAgeMinutes - Cache TTL (default 15).
 * @param opts.forceRefresh - Skip the cache.
 * @param opts.currentMessageId - The thread's last message as the caller knows it; a copy ending there is current at any age.
 * @param opts.credentialed - Credentials the caller already looked up.
 * @param opts.read - How a cached copy's text is read back (default: its chunks, joined).
 */
export async function readGmailThread(opts: {
  orgId: string;
  sources: SourceRow[];
  threadId: string;
  maxAgeMinutes?: number;
  forceRefresh?: boolean;
  currentMessageId?: string | null;
  credentialed?: Awaited<ReturnType<typeof firstCredentialed>>;
  read?: (orgId: string, documentId: number) => Promise<string>;
}): Promise<ThreadRead> {
  const read = opts.read ?? reassembleDocument;
  const [cached] = await db
    .select({
      id: knowledgeDocumentSchema.id,
      title: knowledgeDocumentSchema.title,
      metadata: knowledgeDocumentSchema.metadata,
    })
    .from(knowledgeDocumentSchema)
    .where(and(
      eq(knowledgeDocumentSchema.orgId, opts.orgId),
      inArray(knowledgeDocumentSchema.sourceId, opts.sources.map(s => s.id)),
      eq(knowledgeDocumentSchema.externalId, `gmail-thread:${opts.threadId}`),
    ))
    .limit(1);

  const ttlMs = (opts.maxAgeMinutes ?? 15) * 60_000;
  const fetchedAt = typeof cached?.metadata?.fetchedAt === 'string'
    ? Date.parse(cached.metadata.fetchedAt)
    : Number.NaN;
  const fresh = (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < ttlMs)
    || (Boolean(opts.currentMessageId) && cached?.metadata?.latestMessageId === opts.currentMessageId);
  const copy = async (): Promise<ThreadCopy> => ({
    title: cached!.title,
    fetchedAt: cached!.metadata?.fetchedAt ?? null,
    messageCount: cached!.metadata?.messageCount ?? null,
    content: await read(opts.orgId, cached!.id),
  });

  if (cached && fresh && !opts.forceRefresh) {
    return { source: 'cache', ...await copy() };
  }

  const credentialed = opts.credentialed ?? await firstCredentialed(opts.orgId, opts.sources);
  if (!credentialed) {
    return cached ? { source: 'cache', stale: true, ...await copy() } : { source: 'none', reason: 'no_credentials' };
  }

  const doc = await fetchGmailThreadDoc({ orgId: opts.orgId, credentials: credentialed.credentials, threadId: opts.threadId });
  if (!doc) {
    return { source: 'none', reason: 'not_found' };
  }
  const ref = await ensureSource({ orgId: opts.orgId, slug: credentialed.source.slug });
  const result = await ingestDocument(ref, doc);
  const meta = doc.metadata as Record<string, unknown>;
  return { source: 'live', upserted: result.status, title: doc.title ?? null, fetchedAt: meta.fetchedAt, messageCount: meta.messageCount, content: doc.content };
}
