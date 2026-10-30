import type { RuntimeContext } from '../types';
/**
 * locate_evidence / expand_evidence — walking the wiki's evidence graph
 * (ADR 0012). Present only while the `wiki-evidence` plugin is on.
 *
 * `locate_evidence` finds where to start: wiki pages, the claims on them and
 * the documents they rest on, by the question's words. `expand_evidence`
 * opens one node and lists its typed edges both ways — a claim's cited
 * passages (and whether each still holds), a document's `supersedes`,
 * `amends` and `refers_to` — and with `hops` walks one edge type while the
 * path is single, e.g. `superseded_by` to the current version.
 *
 * The tools take the graph from a provider, so the eval walks the same code
 * over made-up documents that a live turn walks over the workspace's.
 */
import type { EvidenceGraph } from '@/libs/memory/evidence';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { EDGE_TYPES, INVERSE, normaliseRef, renderExpanded, WIKI_EVIDENCE_PLUGIN } from '@/libs/memory/evidence';

/**
 * Whether the evidence graph is on for this turn: the plugin, and the wiki it rests on.
 * @param ctx - The turn.
 */
export function evidenceOn(ctx: Pick<RuntimeContext, 'enabledPlugins'>): boolean {
  const on = ctx.enabledPlugins ?? [];
  return on.includes(WIKI_EVIDENCE_PLUGIN) && on.includes('wiki');
}

export type GraphProvider = () => Promise<EvidenceGraph>;

const EDGE_NAMES = [...EDGE_TYPES, ...Object.values(INVERSE), 'claims', 'passages'] as const;

/**
 * The tool that finds where to start.
 * @param graph - Where the graph comes from.
 */
export function locateEvidenceTool(graph: GraphProvider) {
  return tool(
    async ({ terms, within }) => {
      const g = await graph();
      const hits = g.locate(terms, { within: within ?? null, limit: 8 });
      if (hits.length === 0) {
        return `Nothing in the evidence graph matches "${terms}". Search the sources with search_knowledge instead.`;
      }
      return hits.map(h => `- ${h.ref} (${h.kind}) · ${h.label.replace(/\s+/g, ' ').slice(0, 160)}`).join('\n');
    },
    {
      name: 'locate_evidence',
      description: 'Find where to start in the wiki\'s evidence graph: wiki pages, the cited claims on them, and the documents they rest on, matched on the question\'s words. Returns node refs (wiki:<slug>, claim:<slug>#<n>, doc:<id>) to open with expand_evidence. Use it for questions that cross sources or ask what is current; a simple lookup is a search_knowledge.',
      schema: z.object({
        terms: z.string().min(1).describe('The question or its key words.'),
        within: z.string().optional().describe('Optional: stay inside one wiki page (wiki:<slug>) or document (doc:<id>).'),
      }),
    },
  );
}

/**
 * The tool that follows edges.
 * @param graph - Where the graph comes from.
 */
export function expandEvidenceTool(graph: GraphProvider) {
  return tool(
    async ({ node, edges, hops }) => {
      const g = await graph();
      const x = await g.expand(node, { edges: edges ?? null, hops: hops ?? 1 });
      if (!x) {
        return `No node "${normaliseRef(node)}" in the evidence graph. Refs look like wiki:<slug>, claim:<slug>#<n>, doc:<id>, passage:<id>.<n>, or a [src:…] token.`;
      }
      return renderExpanded(x, g);
    },
    {
      name: 'expand_evidence',
      description: 'Open one node of the wiki\'s evidence graph and list its typed edges both ways: a claim\'s cited passages with whether each still holds (or was changed, replaced by a newer document, or removed); a document\'s supersedes / superseded_by, amends / amended_by, refers_to / referred_by; a page\'s claims and links. With hops > 1 and ONE edge type, walks that edge while the path is single and stops at a branch, e.g. edges ["superseded_by"], hops 4 reaches the current version. Cite what you use with the [src:…] token it shows.',
      schema: z.object({
        node: z.string().min(1).describe('A ref from locate_evidence or a page: wiki:<slug>, claim:<slug>#<n>, doc:<id>, passage:<id>.<n>, or a [src:…] token.'),
        edges: z.array(z.enum(EDGE_NAMES)).optional().describe('Optional: only these edge types (or their inverses).'),
        hops: z.number().int().min(1).max(6).optional().describe('Optional: walk this many steps along ONE edge type while the path is single.'),
      }),
    },
  );
}

/**
 * The evidence tools for a turn — empty unless the plugin is on.
 * @param ctx - The turn.
 */
export function evidenceTools(ctx: RuntimeContext) {
  if (!evidenceOn(ctx)) {
    return [];
  }
  let cached: Promise<EvidenceGraph> | null = null;
  const graph: GraphProvider = () => {
    cached ??= import('@/services/memory/EvidenceGraphService').then(m => m.loadEvidenceGraph(ctx.orgId, { allowedSourceSlugs: ctx.allowedSourceSlugs }));
    return cached;
  };
  return [locateEvidenceTool(graph), expandEvidenceTool(graph)];
}
