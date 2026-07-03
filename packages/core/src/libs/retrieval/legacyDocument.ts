/**
 * Legacy-document-shape adapter for callsites that expect a flat
 * `{ document_id, semantic_identifier, link, source_type, blurb, score }`
 * object. Wraps the native first-party `RetrievalService.search` (pgvector
 * + FTS hybrid + reciprocal rank fusion, optional LLM rerank).
 *
 * This is purely a shape adapter — there is no third-party retrieval engine
 * here. The chat surface, the agent's search tool, the MCP search tool, and
 * the dashboard search page consume documents in the flat shape (matching
 * the existing `IndexedDocument` type at `features/dashboard/chat/types.ts`);
 * RetrievalService returns `SearchHit[]` with chunk-aware fields. Map once,
 * here, instead of N times at every callsite.
 *
 * New callsites should use `RetrievalService.search` directly. This adapter
 * stays for the four existing callsites that consume the flat shape.
 */

import { search as nativeSearch } from '@/services/RetrievalService';

export type LegacyDocumentShape = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
  content?: string;
  score: number;
  updated_at?: string;
  last_modified?: string;
  doc_updated_at?: string;
  metadata?: Record<string, unknown>;
};

export type LegacySearchArgs = {
  query: string;
  search_filters?: {
    source_type?: string[];
    time_cutoff?: string;
  };
  metadata_filters?: Record<string, string>;
  /**
   * Caller-supplied orgId. When omitted, resolved from the active server
   * session (request context). Non-interactive callers (evals, batch jobs)
   * must pass orgId explicitly.
   */
  orgId?: string;
  /** Per-user connection ACL — forwarded to retrieval as an intersection. */
  allowedSourceSlugs?: string[];
};

export async function searchLegacyShape(args: LegacySearchArgs): Promise<{ top_documents: LegacyDocumentShape[]; results?: LegacyDocumentShape[] }> {
  let orgId = args.orgId;
  if (!orgId) {
    try {
      const { auth } = await import('@/libs/Auth');
      const session = await auth();
      // Phase 1.5 alias: projectId substitutes for the legacy orgId scope.
      orgId = session?.user?.projectId ?? undefined;
    } catch {
      /* not in a Next.js request context — caller must pass orgId */
    }
  }
  if (!orgId) {
    return { top_documents: [] };
  }

  const hits = await nativeSearch(args.query, {
    orgId,
    sourceSlugs: args.search_filters?.source_type,
    allowedSourceSlugs: args.allowedSourceSlugs,
    mode: 'hybrid',
    k: 15,
  });

  let docs: LegacyDocumentShape[] = hits.map(h => ({
    document_id: String(h.documentId),
    semantic_identifier: h.title ?? `chunk-${h.chunkIdx}`,
    link: h.uri ?? '',
    source_type: h.sourceSlug,
    blurb: h.content.slice(0, 500),
    content: h.content,
    score: h.score,
    metadata: { chunkIdx: h.chunkIdx },
  }));

  // Apply post-filters since pgvector doesn't push these down yet.
  if (args.metadata_filters) {
    const entries = Object.entries(args.metadata_filters);
    docs = docs.filter(d =>
      entries.every(([k, v]) => String((d.metadata ?? {})[k] ?? '') === String(v)),
    );
  }
  if (args.search_filters?.time_cutoff) {
    const cutoff = new Date(args.search_filters.time_cutoff).getTime();
    docs = docs.filter((d) => {
      const ts = d.updated_at ?? d.last_modified ?? d.doc_updated_at;
      return !ts || new Date(ts).getTime() >= cutoff;
    });
  }

  return { top_documents: docs };
}
