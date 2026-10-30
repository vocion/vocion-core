/**
 * The wiki's evidence graph in the database (ADR 0012): edges kept in
 * `memory_edge`, built from saved wiki pages and from the documents' own
 * words, and loaded into the pure `EvidenceGraph` an agent walks and the
 * Wiki evidence page reads.
 *
 * Scope is the wiki's: workspace-wide documents only. A document scoped to
 * one client or team is never an edge's end, so the graph cannot carry one
 * client's material into another's answer. A person's source access holds:
 * a document from a source they cannot search is not in their graph.
 *
 * No model call here. Written only while the `wiki-evidence` plugin is on.
 */
import type { EvidenceEdge, SourceDoc } from '@/libs/memory/evidence';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { docIdsIn, EvidenceGraph, parsePassageRef, sourceEdges, WIKI_EVIDENCE_PLUGIN, wikiEdges } from '@/libs/memory/evidence';
import { knowledgeChunkSchema, knowledgeDocumentSchema, knowledgeSourceSchema, memoryEdgeSchema } from '@/models/Schema';
import { pluginEnabled } from '@/services/PluginService';
import { listWikiPages } from '@/services/wiki/WikiService';

/** How many documents one source rebuild reads, most recently ingested first. */
export const SOURCE_REBUILD_MAX_DOCS = 5000;
/** Documents read per batch in a source rebuild. */
const BATCH = 200;
/** The most edges one graph load reads. */
const MAX_EDGES = 20_000;
/** The internal source the wiki itself is indexed under: its pages are nodes, not documents. */
const WIKI_SOURCE_SLUG = 'wiki';

/**
 * Whether the graph is on for a workspace: the plugin and the wiki under it.
 * @param orgId - The workspace.
 */
export async function evidenceEnabled(orgId: string): Promise<boolean> {
  return (await pluginEnabled(orgId, WIKI_EVIDENCE_PLUGIN)) && (await pluginEnabled(orgId, 'wiki'));
}

type DocRow = { id: number; title: string | null; uri: string | null; sourceId: number; sourceSlug: string };

/**
 * Workspace-wide documents by id, outside the wiki's own source, optionally only from the sources a person may search.
 * @param orgId - The workspace.
 * @param ids - The documents.
 * @param allowedSourceSlugs - The sources a person may search; undefined for every source.
 */
async function scopedDocs(orgId: string, ids: number[], allowedSourceSlugs?: readonly string[]): Promise<DocRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, uri: knowledgeDocumentSchema.uri, sourceId: knowledgeDocumentSchema.sourceId, sourceSlug: knowledgeSourceSchema.slug })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
    .where(and(
      eq(knowledgeDocumentSchema.orgId, orgId),
      inArray(knowledgeDocumentSchema.id, ids),
      isNull(knowledgeDocumentSchema.clientId),
      isNull(knowledgeDocumentSchema.teamId),
    ));
  const allowed = allowedSourceSlugs ? new Set(allowedSourceSlugs) : null;
  return rows.filter(r => r.sourceSlug !== WIKI_SOURCE_SLUG && (!allowed || allowed.has(r.sourceSlug)));
}

/**
 * The passages of some documents now, in order.
 * @param orgId - The workspace.
 * @param ids - The documents.
 */
async function passagesOf(orgId: string, ids: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (ids.length === 0) {
    return out;
  }
  const rows = await db
    .select({ documentId: knowledgeChunkSchema.documentId, content: knowledgeChunkSchema.content })
    .from(knowledgeChunkSchema)
    .where(and(eq(knowledgeChunkSchema.orgId, orgId), inArray(knowledgeChunkSchema.documentId, ids)))
    .orderBy(asc(knowledgeChunkSchema.documentId), asc(knowledgeChunkSchema.chunkIdx));
  for (const r of rows) {
    out.set(r.documentId, [...(out.get(r.documentId) ?? []), r.content]);
  }
  return out;
}

function toRow(orgId: string, e: EvidenceEdge, pageSlug: string | null) {
  return { orgId, fromRef: e.from, edge: e.edge, toRef: e.to, toHash: e.toHash ?? null, claim: e.claim ?? null, excerpt: e.excerpt ?? null, origin: e.origin, pageSlug };
}

/**
 * Replace one wiki page's edges with what it says now. A citation to a
 * passage that does not exist, or to a document outside the wiki's scope, is
 * dropped and returned.
 * @param orgId - The workspace.
 * @param page - The page as saved.
 * @param page.slug - Its slug.
 * @param page.md - Its body.
 */
export async function rebuildPageEdges(orgId: string, page: { slug: string; md: string }): Promise<{ edges: number; claims: number; dropped: string[] }> {
  const cited = [...new Set([...page.md.matchAll(/\[src:(\d+)/g)].map(m => Number(m[1])))];
  const inScope = new Set((await scopedDocs(orgId, cited)).map(d => d.id));
  const passages = await passagesOf(orgId, [...inScope]);
  const { edges, claims, dropped } = wikiEdges(page, (docId, idx) => {
    const ps = inScope.has(docId) ? passages.get(docId) : undefined;
    if (!ps) {
      return null;
    }
    return idx === null ? ps.join('\n') : ps[idx] ?? null;
  });
  await db.transaction(async (tx) => {
    await tx.delete(memoryEdgeSchema).where(and(eq(memoryEdgeSchema.orgId, orgId), eq(memoryEdgeSchema.origin, 'wiki'), eq(memoryEdgeSchema.pageSlug, page.slug)));
    if (edges.length > 0) {
      await tx.insert(memoryEdgeSchema).values(edges.map(e => toRow(orgId, e, page.slug))).onConflictDoNothing();
    }
  });
  return { edges: edges.length, claims: claims.length, dropped };
}

/**
 * Rebuild the edges between documents from their own words: supersedes,
 * amends, refers to. Reads the most recently ingested workspace-wide
 * documents in batches; every title in scope can be referred to.
 * @param orgId - The workspace.
 * @param opts - `maxDocs`: how many documents to read.
 * @param opts.maxDocs - How many documents to read.
 */
export async function rebuildSourceEdges(orgId: string, opts: { maxDocs?: number } = {}): Promise<{ docs: number; edges: number }> {
  const catalog = await db
    .select({ id: knowledgeDocumentSchema.id, title: knowledgeDocumentSchema.title, uri: knowledgeDocumentSchema.uri })
    .from(knowledgeDocumentSchema)
    .innerJoin(knowledgeSourceSchema, eq(knowledgeDocumentSchema.sourceId, knowledgeSourceSchema.id))
    .where(and(eq(knowledgeDocumentSchema.orgId, orgId), isNull(knowledgeDocumentSchema.clientId), isNull(knowledgeDocumentSchema.teamId), sql`${knowledgeSourceSchema.slug} <> ${WIKI_SOURCE_SLUG}`))
    .orderBy(sql`${knowledgeDocumentSchema.ingestedAt} desc`)
    .limit(opts.maxDocs ?? SOURCE_REBUILD_MAX_DOCS);
  const edges: EvidenceEdge[] = [];
  for (let i = 0; i < catalog.length; i += BATCH) {
    const batch = catalog.slice(i, i + BATCH);
    const passages = await passagesOf(orgId, batch.map(d => d.id));
    const docs: SourceDoc[] = batch.map(d => ({ ...d, passages: passages.get(d.id) ?? [] }));
    edges.push(...sourceEdges(docs, catalog));
  }
  await db.transaction(async (tx) => {
    await tx.delete(memoryEdgeSchema).where(and(eq(memoryEdgeSchema.orgId, orgId), eq(memoryEdgeSchema.origin, 'source')));
    for (let i = 0; i < edges.length; i += 1000) {
      await tx.insert(memoryEdgeSchema).values(edges.slice(i, i + 1000).map(e => toRow(orgId, e, null))).onConflictDoNothing();
    }
  });
  return { docs: catalog.length, edges: edges.length };
}

/**
 * Rebuild the whole graph: every wiki page, then the sources.
 * @param orgId - The workspace.
 */
export async function rebuildEvidenceGraph(orgId: string): Promise<{ pages: number; claims: number; dropped: number; docs: number; edges: number }> {
  const pages = await listWikiPages(orgId);
  let claims = 0;
  let dropped = 0;
  let edges = 0;
  for (const p of pages) {
    const r = await rebuildPageEdges(orgId, { slug: p.slug, md: p.md });
    claims += r.claims;
    dropped += r.dropped.length;
    edges += r.edges;
  }
  // Pages that no longer exist leave no edges behind.
  const slugs = pages.map(p => p.slug);
  await db.delete(memoryEdgeSchema).where(and(
    eq(memoryEdgeSchema.orgId, orgId),
    eq(memoryEdgeSchema.origin, 'wiki'),
    slugs.length ? sql`${memoryEdgeSchema.pageSlug} NOT IN (${sql.join(slugs.map(s => sql`${s}`), sql`, `)})` : sql`true`,
  ));
  const src = await rebuildSourceEdges(orgId);
  return { pages: pages.length, claims, dropped, docs: src.docs, edges: edges + src.edges };
}

/**
 * Build the graph once for a workspace that has the plugin on and no edges yet. Never throws.
 * @param orgId - The workspace.
 */
export async function ensureEvidenceGraph(orgId: string): Promise<void> {
  try {
    const [row] = await db.select({ n: count() }).from(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, orgId));
    if (Number(row?.n ?? 0) === 0) {
      await rebuildEvidenceGraph(orgId);
    }
  } catch (error) {
    console.warn('wiki evidence: the graph was not built', { orgId, message: (error as Error).message });
  }
}

/**
 * The graph a turn or the Wiki evidence page walks: the stored edges among
 * the pages that exist and the documents this person may read, with
 * passages read on demand.
 *
 * A document that exists but is outside the wiki's scope or this person's
 * sources takes every edge touching it out of the graph, so nothing about
 * it is shown. A document that is gone keeps its `cites` edges, so the
 * claims resting on it read as "gone".
 * @param orgId - The workspace.
 * @param opts - `allowedSourceSlugs`: the sources the person may search.
 * @param opts.allowedSourceSlugs - The sources the person may search.
 */
export async function loadEvidenceGraph(orgId: string, opts: { allowedSourceSlugs?: readonly string[] } = {}): Promise<EvidenceGraph> {
  await ensureEvidenceGraph(orgId);
  const [rows, pages] = await Promise.all([
    db.select().from(memoryEdgeSchema).where(eq(memoryEdgeSchema.orgId, orgId)).limit(MAX_EDGES),
    listWikiPages(orgId),
  ]);
  const slugs = new Set(pages.map(p => p.slug));
  const all: EvidenceEdge[] = rows.map(r => ({ from: r.fromRef, edge: r.edge as EvidenceEdge['edge'], to: r.toRef, toHash: r.toHash, claim: r.claim, excerpt: r.excerpt, origin: r.origin as EvidenceEdge['origin'] }));
  const ids = docIdsIn(all);
  const docs = await scopedDocs(orgId, ids, opts.allowedSourceSlugs);
  const readable = new Set(docs.map(d => d.id));
  const existing = ids.length
    ? new Set((await db.select({ id: knowledgeDocumentSchema.id }).from(knowledgeDocumentSchema).where(and(eq(knowledgeDocumentSchema.orgId, orgId), inArray(knowledgeDocumentSchema.id, ids)))).map(r => r.id))
    : new Set<number>();
  const edges = all.filter(e => evidenceEdgeVisible(e, { slugs, readable, existing }));
  return new EvidenceGraph({
    edges,
    pages: pages.map(p => ({ slug: p.slug, title: p.title, summary: p.summary })),
    docs: docs.map(d => ({ id: d.id, title: d.title, uri: d.uri })),
    passages: async docId => (readable.has(docId) ? (await passagesOf(orgId, [docId])).get(docId) ?? [] : null),
  });
}

/**
 * Whether one stored edge belongs in a person's graph (`loadEvidenceGraph`).
 * @param e - The edge.
 * @param scope - The pages that exist, the documents the person may read, and the documents that exist at all.
 * @param scope.slugs - The wiki pages that exist.
 * @param scope.readable - The documents in the wiki's scope that this person may read.
 * @param scope.existing - Every document that exists, in any scope.
 */
export function evidenceEdgeVisible(e: Pick<EvidenceEdge, 'from' | 'edge' | 'to'>, scope: { slugs: ReadonlySet<string>; readable: ReadonlySet<number>; existing: ReadonlySet<number> }): boolean {
  for (const ref of [e.from, e.to]) {
    const page = /^(?:wiki|claim):([^#]+)/.exec(ref)?.[1];
    if (page !== undefined && !scope.slugs.has(page)) {
      return false;
    }
    const doc = /^doc:(\d+)$/.exec(ref);
    const id = doc ? Number(doc[1]) : parsePassageRef(ref)?.docId;
    if (id === undefined || scope.readable.has(id)) {
      continue;
    }
    // Out of scope: hidden. Gone: only a citation keeps it, to say so.
    if (scope.existing.has(id) || e.edge !== 'cites') {
      return false;
    }
  }
  return true;
}

/**
 * What the Wiki evidence page shows for a workspace and a person.
 * @param orgId - The workspace.
 * @param opts - `allowedSourceSlugs`: the sources the person may search.
 * @param opts.allowedSourceSlugs - The sources the person may search.
 */
export async function loadEvidenceOverview(orgId: string, opts: { allowedSourceSlugs?: readonly string[] } = {}) {
  const { overviewOf } = await import('@/libs/memory/evidence');
  const graph = await loadEvidenceGraph(orgId, opts);
  const pages = await listWikiPages(orgId);
  const ids = docIdsIn(graph.allEdges());
  const docs = await scopedDocs(orgId, ids, opts.allowedSourceSlugs);
  return overviewOf(graph, pages.map(p => ({ slug: p.slug, title: p.title, summary: p.summary })), docs);
}
