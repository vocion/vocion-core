/**
 * render_table / render_markdown / render_chart / render_record — the tools
 * that CREATE an artifact. Each validates its payload against the card's own
 * schema (`libs/cards/specs`), persists an `artifact` row plus its v1, and
 * emits `{ type: 'artifact' }` so the pane beside the conversation opens on
 * it and the message gets a chip. The model gets a one-line receipt back,
 * never the payload — the artifact carries it.
 *
 * Changing one afterwards is `update_artifact` (see `editArtifacts.ts`), not
 * a second render: "sort by owner" should move the artifact the person is
 * looking at, not fork it. The receipt says so, because the alternative is a
 * conversation that ends with six nearly identical tables.
 *
 * Available to every agent by default: they have no side effect outside the
 * conversation (no connector writes, no sends), so there is nothing to gate.
 * `harness.excludeTools` withholds them like any other built-in.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { ArtifactError, createArtifact, toPayload } from '@/services/ArtifactService';

/**
 * Models often stringify nested tool args — parse JSON strings back to objects.
 * @param v
 */
function coerceJson(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/**
 * `agent:<slug>` when an agent is acting, else the person driving the turn.
 * @param ctx
 */
export function authorOf(ctx: RuntimeContext): { kind: 'agent' | 'human'; id: string | null } {
  return ctx.agentSlug
    ? { kind: 'agent', id: `agent:${ctx.agentSlug}` }
    : { kind: 'human', id: ctx.userId ?? null };
}

async function persistAndEmit(
  ctx: RuntimeContext,
  kind: 'table' | 'markdown' | 'chart' | 'record',
  title: string,
  spec: unknown,
  summary: string,
  folder?: string,
): Promise<string> {
  try {
    // A pending shell first, so the pane shows the title and a filling body
    // while a long write lands rather than nothing at all.
    if (kind === 'markdown' && ctx.conversationId) {
      ctx.emit({
        type: 'artifact',
        pending: true,
        artifact: {
          id: -1,
          conversationId: ctx.conversationId,
          messageId: null,
          kind,
          title,
          spec: {},
          folder: null,
          version: 0,
          authorKind: 'agent',
          authorId: ctx.agentSlug ? `agent:${ctx.agentSlug}` : null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }
    const { artifact } = await createArtifact({
      orgId: ctx.orgId,
      conversationId: ctx.conversationId ?? null,
      kind,
      title,
      spec,
      folder,
      author: authorOf(ctx),
      // Same provenance rule as create_artifact: a table or chart rendered
      // inside an unattended mission run is work output, not something a
      // person went looking for.
      visibility: ctx.missionRunId ? 'system' : 'user',
      changeSummary: 'Created',
    });
    ctx.emit({ type: 'artifact', artifact: toPayload(artifact) });
    const where = ctx.conversationId ? ` as artifact #${artifact.id}` : ' (no conversation — not shown beside a chat)';
    return `Rendered ${kind} "${artifact.title}"${summary ? ` (${summary})` : ''}${where}, now open beside the conversation at v1. The artifact carries the content — do NOT repeat it as text; refer to it by title. To change it later call update_artifact(${artifact.id}, …) rather than rendering a second one.`;
  } catch (err) {
    if (err instanceof ArtifactError) {
      return `render_${kind} rejected: ${err.message}. Fix the payload and call again.`;
    }
    return `Could not render ${kind}: ${(err as Error).message ?? 'unknown error'}`;
  }
}

const folderArg = {
  folder: z.string().max(120).optional().describe('Optional path-like grouping for the artifacts log, e.g. "revenue/weekly". Omit unless the person named one.'),
};

export function renderTableTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const columns = coerceJson(args.columns);
      const rows = coerceJson(args.rows);
      const spec = { title: args.title, columns, rows, caption: args.caption, sortBy: args.sort_by, sortDir: args.sort_dir };
      const n = Array.isArray(rows) ? rows.length : 0;
      return persistAndEmit(ctx, 'table', args.title, spec, `${n} rows`, args.folder);
    },
    {
      name: 'render_table',
      description: 'Create a SORTABLE TABLE artifact, opened beside the conversation. Use for any list you assembled (deals, runs, contacts, tasks) instead of a markdown table. Give every column a `type` so numbers align and dates format. To change an existing table use update_artifact, not this.',
      schema: z.object({
        title: z.string().describe('Short title, e.g. "Open deals closing this month"'),
        columns: z.union([z.array(z.object({
          key: z.string(),
          label: z.string().optional(),
          type: z.enum(['text', 'number', 'currency', 'percent', 'date', 'badge', 'link']).optional(),
          hrefKey: z.string().optional().describe('For type=link: the column key holding the URL'),
        })), z.string()]).describe('Column definitions (array; a JSON string is tolerated)'),
        rows: z.union([z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))), z.string()]).describe('Rows as flat objects keyed by column key (array; a JSON string is tolerated)'),
        caption: z.string().optional().describe('One line under the table, e.g. the source and as-of time'),
        sort_by: z.string().optional(),
        sort_dir: z.enum(['asc', 'desc']).optional(),
        ...folderArg,
      }),
    },
  );
}

export function renderMarkdownTool(ctx: RuntimeContext) {
  return tool(
    async args => persistAndEmit(ctx, 'markdown', args.title, { title: args.title, md: args.md }, `${args.md.length} chars`, args.folder),
    {
      name: 'render_markdown',
      description: 'Create a markdown document artifact the person keeps beside the conversation — a plan, a brief section, a checklist, meeting notes. Use when the content is a deliverable, not a reply. GFM tables and task lists are supported. To revise it later use update_artifact, not this.',
      schema: z.object({
        title: z.string(),
        md: z.string().min(1).describe('Markdown body'),
        ...folderArg,
      }),
    },
  );
}

export function renderChartTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const series = coerceJson(args.series);
      const x = coerceJson(args.x);
      const spec = { title: args.title, type: args.type, x, series, unit: args.unit, stacked: args.stacked };
      const n = Array.isArray(series) ? series.length : 0;
      return persistAndEmit(ctx, 'chart', args.title, spec, `${n} series × ${Array.isArray(x) ? x.length : 0} points`, args.folder);
    },
    {
      name: 'render_chart',
      description: 'Create a line, bar, or area chart artifact (one y axis, up to 8 series). Use for change over time or magnitude across categories. Every series must have exactly one value per x label (null for missing).',
      schema: z.object({
        title: z.string(),
        type: z.enum(['line', 'bar', 'area']),
        x: z.union([z.array(z.string()), z.string()]).describe('x labels in order (array; a JSON string is tolerated)'),
        series: z.union([z.array(z.object({ name: z.string(), values: z.array(z.number().nullable()) })), z.string()]).describe('[{name, values}] aligned with x (array; a JSON string is tolerated)'),
        unit: z.string().optional().describe('"$", "%", or a noun like "deals"'),
        stacked: z.boolean().optional(),
        ...folderArg,
      }),
    },
  );
}

export function renderRecordTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const fields = coerceJson(args.fields);
      const spec = { type: args.type, id: args.id, label: args.label, href: args.href, fields: fields ?? [], status: args.status };
      return persistAndEmit(ctx, 'record', args.label, spec, args.type, args.folder);
    },
    {
      name: 'render_record',
      description: 'Create a card artifact for ONE entity — a deal, contact, agent, mission, run — with a few fields, an optional status, and a link into the app. Use when the answer is a thing the person will open, not a paragraph about it.',
      schema: z.object({
        type: z.string().describe('Entity type label, e.g. "Deal"'),
        id: z.string(),
        label: z.string().describe('Display name'),
        href: z.string().optional().describe('In-app route (/dashboard/…) or external URL'),
        fields: z.union([z.array(z.object({ k: z.string(), v: z.union([z.string(), z.number(), z.boolean(), z.null()]) })), z.string()]).optional().describe('Up to ~8 {k, v} pairs (array; a JSON string is tolerated)'),
        status: z.string().optional(),
        ...folderArg,
      }),
    },
  );
}

export function renderArtifactTools(ctx: RuntimeContext) {
  return [renderTableTool(ctx), renderMarkdownTool(ctx), renderChartTool(ctx), renderRecordTool(ctx)];
}
