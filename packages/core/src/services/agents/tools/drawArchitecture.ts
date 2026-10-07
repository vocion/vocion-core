/**
 * draw_architecture — the system, handed over as a typed graph and drawn by
 * the platform, filed on the product where the Products page reads it.
 *
 * After the Release seat has read a product's repositories (`repo_read_tree`
 * and the manifests in them), the deliverable is not a paragraph about the
 * architecture: it is the architecture, as data — components with their
 * kinds and repositories, the edges between them, optional groups. The
 * platform lays that graph out and draws it the same way every time
 * (`libs/factory/architectureDiagram.ts`), files the picture and a markdown
 * summary on the product as versioned artifacts, and writes the pointers
 * onto the product record itself (`services/factory/architectureDiagram.ts`),
 * so the page redraws while the person watches.
 *
 * Structural, not prompted: the model cannot draw a box the schema refuses,
 * cannot wire an edge to a node it did not declare, and cannot hand back a
 * Mermaid block nothing here renders.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ArchitectureGraphSchema, ArchitectureGraphShape, MAX_EDGES, MAX_NODES } from '@/libs/factory/architectureDiagram';
import { notWritableMessage, recordWritable } from './recordWrite';

export const DRAW_ARCHITECTURE_TOOL = 'draw_architecture';

const mappedFromSchema = z.object({
  repo: z.string().trim().min(1).max(140).describe('The repository, as owner/name.'),
  ref: z.string().trim().min(1).max(120).describe('The branch or tag that was read.'),
  sha: z.string().trim().min(7).max(64).optional().describe('The commit that was read, when known.'),
});

const inputSchema = z.object({
  productId: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]).describe('The product record\'s id.'),
  // The shape in the schema, the cross-references in the handler: a model
  // routinely sends a nested object as JSON text, and a strict object schema
  // would throw the turn away at the finish line (`createArtifact.ts`); and
  // an edge to a node it never declared comes back as words it can act on.
  graph: z.union([ArchitectureGraphShape, z.string()]).describe('The system as data: nodes (components), edges (who talks to whom), optional groups. This is the deliverable. An object; JSON text is tolerated.'),
  summary: z.string().trim().min(1).max(1200).describe('What the system is, in prose: what it does, how a request moves through it, where state lives. At most 1200 characters.'),
  mappedFrom: z.array(mappedFromSchema).min(1).max(20).describe('Every repository the graph was read from, at the ref (and commit) that was read.'),
});

/**
 * Models often send a nested object as JSON text — read it back as the object.
 * @param v - The raw `graph`.
 */
function coerceGraph(v: unknown): unknown {
  if (typeof v !== 'string') {
    return v;
  }
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

export function drawArchitectureTool(ctx: RuntimeContext) {
  return tool(
    async (raw) => {
      const args = raw as { productId: number | string; graph: unknown; summary: string; mappedFrom: Array<{ repo: string; ref: string; sha?: string }> };
      const productId = Number(args.productId);
      const { getBusinessObject } = await import('@/services/BusinessObjectService');
      const row = await getBusinessObject(productId, ctx.orgId);
      if (!row?.type) {
        return `Refused: no record #${productId} in this workspace.`;
      }
      // THE RECORD MUST BE A PRODUCT — the type the plugin names for that
      // role, never a slug written here.
      const { factoryTypes } = await import('@/libs/factory/types');
      const types = await factoryTypes(ctx.orgId);
      if (row.type.slug !== types.product) {
        return `Refused: ${row.type.label.toLowerCase()} #${productId} "${row.title}" is not a product (its type is "${row.type.slug}"; products are "${types.product}"). An architecture is filed on the product the repositories make; pass that record's id.`;
      }
      if (!recordWritable(ctx, row.type.slug, productId)) {
        return notWritableMessage(ctx, row.type.slug, productId);
      }
      const graph = ArchitectureGraphSchema.safeParse(coerceGraph(args.graph));
      if (!graph.success) {
        return `Refused: the graph did not validate — ${graph.error.issues.slice(0, 8).map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}. Fix the graph and call again; do not describe the architecture in prose instead.`;
      }

      const { fileArchitecture } = await import('@/services/factory/architectureDiagram');
      const out = await fileArchitecture({
        orgId: ctx.orgId,
        productId,
        graph: graph.data,
        summary: args.summary,
        mappedFrom: args.mappedFrom,
        actor: ctx,
      });
      if (!out.ok) {
        return `Refused: nothing was filed (${out.step}): ${out.reason}`;
      }

      const { toPayload } = await import('@/services/ArtifactService');
      for (const a of out.artifacts) {
        ctx.emit({ type: 'artifact', artifact: toPayload(a as Parameters<typeof toPayload>[0]) });
      }
      const label = `${out.product.typeLabel.toLowerCase()} #${out.product.id} "${out.product.title}"`;
      const filed = `Filed on ${label}: diagram #${out.diagramArtifactId} (${graph.data.nodes.length} components, ${graph.data.edges.length} connections), summary #${out.summaryArtifactId}.`;
      const page = `The product page (/dashboard/objects/${out.product.id}) shows the diagram under "How it looks" and the summary under "About it".`;
      const warn = out.warnings.length > 0 ? ` Note: ${out.warnings.join('; ')}.` : '';
      if (out.write.status === 'pending') {
        return `${filed} Pointing the product at them is PENDING a person's decision (run #${out.write.runId}); do NOT say the page shows them yet.${warn}`;
      }
      if (out.write.status === 'failed') {
        return `${filed} But the product record was not updated: ${out.write.reason ?? 'the write did not land'}. The page will not show the diagram until it is.${warn}`;
      }
      return `${filed} ${page}${out.write.version ? ` The record is at version ${out.write.version.to}.` : ''} Say in one or two lines what the system is; do not repeat the component list or these ids.${warn}`;
    },
    {
      name: DRAW_ARCHITECTURE_TOOL,
      description: `THE way to record a product's architecture after reading its repositories: hand over the system as a typed graph and the platform draws the diagram, files it and a summary on the product, and points the product record at them. One call per product, after repo_read_tree (and the manifests, compose files and infra it shows) has been read for every repository the product is made of. The graph IS the deliverable: components as nodes (at most ${MAX_NODES}; kind: service, web, mobile, api, worker, database, queue, storage, external, package, infra; a node's repo is the owner/name it lives in), edges for who calls, reads, writes, publishes to, deploys or depends on what (at most ${MAX_EDGES}), optional groups. Do NOT invent components you did not see in a tree or a manifest; a managed service the code names (a database URL, a queue client) is a node with no repo. Never draw the architecture as text, Mermaid or a markdown document instead.`,
      schema: inputSchema,
    },
  );
}

/**
 * The architecture tool, for an agent that works with records — the type
 * check at call time refuses anything that is not the plugin's product — or
 * one granted it by name.
 * @param ctx - The turn.
 */
export function drawArchitectureTools(ctx: RuntimeContext) {
  // Granted-only, like record_verdict: the plugin names the seat that maps
  // the code (`harness.grantTools`), and no other agent carries a tool about
  // repositories it was never asked to read.
  const granted = (ctx.harnessConfig.grantTools ?? []).includes(DRAW_ARCHITECTURE_TOOL);
  return granted ? [drawArchitectureTool(ctx)] : [];
}
