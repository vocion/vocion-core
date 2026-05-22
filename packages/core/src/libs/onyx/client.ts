/**
 * Deprecated Onyx client shim. The Onyx stack was removed in L.6; this
 * module exists only so the four remaining legacy callsites
 * (`AgentService.runAgent`, `SkillService`, the MCP `search` tool,
 * `AskChat`) keep compiling while they're migrated to
 * `RetrievalService.search` directly.
 *
 * The shape mirrors the old Onyx `/document-index/search` response so
 * callers see no behavioural change. Filtering by `source_type` maps
 * to `sourceSlugs`; `time_cutoff` and `metadata_filters` are accepted
 * but applied client-side because the new schema doesn't yet push
 * them down (M.1 will).
 *
 * **Do not add new callers.** Use `RetrievalService.search` directly.
 * This file will be deleted once the legacy callsites are ported.
 */

import { search as nativeSearch } from '@/services/RetrievalService';

export type LegacyDoc = {
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
  /** Caller-supplied orgId. Legacy `search()` pulled this from a
   *  global config; we require it explicitly now (we'll fall back to
   *  the first listed org for callers that haven't been updated). */
  orgId?: string;
};

export async function search(args: LegacySearchArgs): Promise<{ top_documents: LegacyDoc[]; results?: LegacyDoc[] }> {
  // The original Onyx client implicitly scoped by API key. The shim
  // requires an orgId at the call site — but legacy callers don't
  // pass one. Resolve via `auth()` server context when available.
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
    mode: 'hybrid',
    k: 15,
  });

  let docs: LegacyDoc[] = hits.map(h => ({
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
