/**
 * THE ARCHITECTURE DIAGRAM, FILED ON THE PRODUCT.
 *
 * `libs/factory/architectureDiagram.ts` decides what the picture and the
 * summary look like; this is the half that knows the tables. Given a typed
 * graph for a product, it draws the SVG, files it as the artifact at role
 * `architecture-diagram`, files the summary as the markdown artifact at role
 * `architecture-summary`, and writes the pointers onto the product record's
 * `architecture` field through `objects.update_meta` — the same write path
 * every agent write takes, so the write is on the record's history with who
 * and why, the trust rule for the product type decides whether a person is
 * asked, and `version_written` tells the Products page to redraw.
 *
 * ONE ARTIFACT PER ROLE, VERSIONED. A remap is a new version of the same
 * diagram, not a second diagram beside the first (principle 7: anything
 * referenced, versioned or previewed is an artifact — once). A remap that
 * changed nothing files no version at all (`upsertRecordArtifact` is
 * content-stable), which is what a deterministic drawing buys.
 *
 * NOTHING HERE THROWS PAST ITS STEP. Each step reports in words a person or
 * an agent can act on: a graph that did not validate says which edge named
 * which missing node; a write the type refuses says which field to declare.
 */

import type { ArchitectureGraph } from '@/libs/factory/architectureDiagram';
import type { RuntimeContext } from '@/services/agents/types';
import type { Author } from '@/services/ArtifactService';
import { Buffer } from 'node:buffer';
import { ARCHITECTURE_FIELD, architectureDiagramSvg, ArchitectureGraphSchema, architectureSummaryMarkdown } from '@/libs/factory/architectureDiagram';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { writeRecordAsAgent } from '@/services/agents/tools/recordWrite';
import { upsertRecordArtifact } from '@/services/ArtifactService';
import { getBusinessObject } from '@/services/BusinessObjectService';

/** The picture: an SVG `file` artifact, one per product. */
export const ARCHITECTURE_DIAGRAM_ROLE = 'architecture-diagram';
/** The words: a `markdown` artifact, one per product, indexed for search. */
export const ARCHITECTURE_SUMMARY_ROLE = 'architecture-summary';
/** The field on the product record that points at both. */
export { ARCHITECTURE_FIELD };
/** The summary kept on the record itself, so the page needs no artifact read to show one line. */
export const RECORD_SUMMARY_MAX = 600;

/** A repository the graph was read from, at the commit it was read at. */
export type MappedFrom = { repo: string; ref: string; sha?: string };

/** What the product record carries after a map: the pointers, the line, the provenance. */
export type ArchitectureField = {
  diagramArtifactId: number;
  summaryArtifactId: number;
  summary: string;
  mappedAt: string;
  mappedFrom: MappedFrom[];
};

export type FileArchitectureInput = {
  orgId: string;
  /** The product record. */
  productId: number;
  /** The graph as the agent handed it over; validated here. */
  graph: unknown;
  /** What the system is, in prose. */
  summary: string;
  mappedFrom: MappedFrom[];
  /** The turn doing the filing: who the versions and the write are recorded as. */
  actor: RuntimeContext;
  now?: Date;
};

/** An artifact row as `upsertRecordArtifact` returns it. */
type FiledArtifact = Awaited<ReturnType<typeof upsertRecordArtifact>>['artifact'];

export type FileArchitectureResult
  = | { ok: false; step: 'graph' | 'product' | 'diagram' | 'summary'; reason: string; warnings: string[] }
    | {
      ok: true;
      diagramArtifactId: number;
      summaryArtifactId: number;
      /** The artifact rows, for the caller to announce on the stream. */
      artifacts: FiledArtifact[];
      /** How the write onto the product record went. */
      write: { status: 'done' | 'pending' | 'failed'; runId?: number; version?: { from: number | null; to: number }; reason?: string };
      /** The product as the person knows it, for the tool's reply. */
      product: { id: number; title: string; typeSlug: string; typeLabel: string };
      warnings: string[];
    };

function authorOf(ctx: RuntimeContext): Author {
  return { kind: 'agent', id: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null };
}

function issuesOf(error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string {
  return error.issues.slice(0, 8).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

/**
 * The summary as the record keeps it: one paragraph, cut at a word.
 * @param summary - The agent's prose.
 */
export function recordSummary(summary: string): string {
  const one = summary.replace(/\s+/g, ' ').trim();
  if (one.length <= RECORD_SUMMARY_MAX) {
    return one;
  }
  const cut = one.slice(0, RECORD_SUMMARY_MAX - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > RECORD_SUMMARY_MAX * 0.6 ? cut.slice(0, atWord) : cut).trim()}…`;
}

/**
 * The provenance block under the summary: each repository at the commit it
 * was read at, and when.
 * @param mappedFrom - The repositories.
 * @param at - When they were read.
 */
export function mappedFromMarkdown(mappedFrom: MappedFrom[], at: Date): string {
  if (mappedFrom.length === 0) {
    return '';
  }
  const day = at.toISOString().slice(0, 10);
  const lines = mappedFrom.map(m => `- \`${m.repo}\` at \`${m.ref}\`${m.sha ? ` (${m.sha.slice(0, 12)})` : ''} — read ${day}`);
  return `\n## Mapped from\n\n${lines.join('\n')}\n`;
}

/**
 * Draw, file and link this product's architecture.
 * @param input - The product, the graph, the prose and the turn.
 */
export async function fileArchitecture(input: FileArchitectureInput): Promise<FileArchitectureResult> {
  const warnings: string[] = [];
  const now = input.now ?? new Date();

  const parsed = ArchitectureGraphSchema.safeParse(input.graph);
  if (!parsed.success) {
    return { ok: false, step: 'graph', reason: `the graph did not validate — ${issuesOf(parsed.error)}`, warnings };
  }
  const graph: ArchitectureGraph = parsed.data;

  const row = await getBusinessObject(input.productId, input.orgId).catch(() => null);
  if (!row?.type) {
    return { ok: false, step: 'product', reason: `no record #${input.productId} in this workspace`, warnings };
  }
  const product = { id: row.id, title: row.title, typeSlug: row.type.slug, typeLabel: row.type.label };
  const record = (role: string) => ({ type: 'object', id: String(product.id), role });
  const author = authorOf(input.actor);
  const artifacts: FiledArtifact[] = [];

  // THE PICTURE.
  let diagramArtifactId: number;
  try {
    const svg = architectureDiagramSvg(graph);
    const file = await saveArtifact({ orgId: input.orgId, data: Buffer.from(svg, 'utf8'), ext: 'svg', contentType: 'image/svg+xml' });
    const { artifact, unchanged } = await upsertRecordArtifact({
      orgId: input.orgId,
      kind: 'file',
      title: `${product.title} — architecture`,
      spec: { filename: file.filename, contentType: file.contentType, bytes: file.bytes, url: file.url, caption: `${graph.nodes.length} components, mapped ${now.toISOString().slice(0, 10)}` },
      url: file.url,
      record: record(ARCHITECTURE_DIAGRAM_ROLE),
      author,
      conversationId: input.actor.conversationId ?? null,
      changeSummary: `Drawn from ${graph.nodes.length} components and ${graph.edges.length} connections read in ${input.mappedFrom.map(m => m.repo).join(', ') || 'the repositories'}`,
      // Work output beside the product, not a thing a person went looking for in the artifact log.
      visibility: input.actor.missionRunId ? 'system' : 'user',
    });
    diagramArtifactId = artifact.id;
    artifacts.push(artifact);
    if (unchanged) {
      warnings.push('the diagram is the same as the one already filed, so no new version was written');
    }
  } catch (err) {
    return { ok: false, step: 'diagram', reason: `the diagram could not be filed: ${(err as Error).message}`, warnings };
  }

  // THE WORDS.
  let summaryArtifactId: number;
  try {
    const md = architectureSummaryMarkdown(graph, input.summary) + mappedFromMarkdown(input.mappedFrom, now);
    const { artifact } = await upsertRecordArtifact({
      orgId: input.orgId,
      kind: 'markdown',
      title: `${product.title} — architecture summary`,
      spec: { title: `${product.title} — architecture summary`, md, summary: recordSummary(input.summary).slice(0, 200) },
      record: record(ARCHITECTURE_SUMMARY_ROLE),
      author,
      conversationId: input.actor.conversationId ?? null,
      changeSummary: `Summarised from ${input.mappedFrom.map(m => m.repo).join(', ') || 'the repositories'}`,
      visibility: input.actor.missionRunId ? 'system' : 'user',
    });
    summaryArtifactId = artifact.id;
    artifacts.push(artifact);
  } catch (err) {
    return { ok: false, step: 'summary', reason: `the diagram is filed as artifact #${diagramArtifactId}, but the summary could not be: ${(err as Error).message}`, warnings };
  }

  // THE POINTERS, ON THE RECORD. Through the agent write path so the write
  // is on the record's history, under the type's trust rule, and announced.
  const field: ArchitectureField = {
    diagramArtifactId,
    summaryArtifactId,
    summary: recordSummary(input.summary),
    mappedAt: now.toISOString(),
    mappedFrom: input.mappedFrom.map(m => (m.sha ? { repo: m.repo, ref: m.ref, sha: m.sha } : { repo: m.repo, ref: m.ref })),
  };
  const label = `${product.typeLabel.toLowerCase()} #${product.id}`;
  let write: Extract<FileArchitectureResult, { ok: true }>['write'];
  try {
    const res = await writeRecordAsAgent(input.actor, {
      objectType: product.typeSlug,
      id: product.id,
      set: { [ARCHITECTURE_FIELD]: field },
      reason: `Architecture mapped from ${input.mappedFrom.map(m => m.repo).join(', ') || 'the repositories'}: diagram #${diagramArtifactId}, summary #${summaryArtifactId}.`,
      confidence: 0.9,
      label,
    });
    if (res.status === 'done') {
      write = { status: 'done', runId: res.runId, ...(res.version ? { version: { from: res.version.from, to: res.version.to } } : {}) };
    } else if (res.status === 'pending' || res.status === 'awaiting_execution') {
      write = { status: 'pending', runId: res.runId };
    } else {
      write = { status: 'failed', runId: res.runId, reason: res.error ?? res.status };
    }
  } catch (err) {
    write = { status: 'failed', reason: (err as Error).message };
  }
  if (write.status === 'failed') {
    warnings.push(`both artifacts are filed on ${label}, but the record's "${ARCHITECTURE_FIELD}" field was not written: ${write.reason ?? 'the write did not land'}`);
  }

  return { ok: true, diagramArtifactId, summaryArtifactId, artifacts, write, product, warnings };
}
