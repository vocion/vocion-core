/**
 * render_table / render_markdown / render_chart / render_record — the canvas
 * tools. Each validates its payload against the card's own schema
 * (`libs/cards/specs`), persists an `artifact` row for the conversation, and
 * emits `{ type: 'artifact' }` so the chat shows the card inline and the
 * canvas beside the conversation places a tile. The model gets a one-line
 * receipt back, never the payload — the card carries it.
 *
 * Available to every agent by default: they have no side effect outside the
 * conversation (no connector writes, no sends), so there is nothing to gate.
 * `harness.excludeTools` withholds them like any other built-in.
 *
 * `tile_slot` exists for the canvas's empty tiles: a person types into slot
 * 3 "open deals by stage", the message reads `Fill tile 3: open deals by
 * stage`, and the model passes `tile_slot: 3` so the artifact lands there.
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

const tileArgs = {
  tile_slot: z.number().int().min(0).max(63).optional().describe('Canvas slot to place this in — ONLY when the user asked to fill a specific tile ("Fill tile 3: …").'),
  tile_span: z.number().int().min(1).max(3).optional().describe('Width in canvas columns (1–3). Default: 2 for tables/charts, 1 otherwise.'),
};

async function persistAndEmit(ctx: RuntimeContext, kind: 'table' | 'markdown' | 'chart' | 'record', title: string, spec: unknown, tile: { tile_slot?: number; tile_span?: number }, summary: string): Promise<string> {
  try {
    const row = await createArtifact({
      orgId: ctx.orgId,
      conversationId: ctx.conversationId ?? null,
      kind,
      title,
      spec,
      slot: tile.tile_slot ?? null,
      span: (tile.tile_span as 1 | 2 | 3 | undefined) ?? null,
      createdBy: ctx.agentSlug ? `agent:${ctx.agentSlug}` : ctx.userId ?? null,
    });
    ctx.emit({ type: 'artifact', artifact: toPayload(row) });
    const where = ctx.conversationId ? ` as artifact #${row.id}` : ' (no conversation — not placed on a canvas)';
    return `Rendered ${kind} "${row.title}"${summary ? ` (${summary})` : ''}${where}. The card carries the content — do NOT repeat it as text; refer to it by title.`;
  } catch (err) {
    if (err instanceof ArtifactError) {
      return `render_${kind} rejected: ${err.message}. Fix the payload and call again.`;
    }
    return `Could not render ${kind}: ${(err as Error).message ?? 'unknown error'}`;
  }
}

export function renderTableTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const columns = coerceJson(args.columns);
      const rows = coerceJson(args.rows);
      const spec = { title: args.title, columns, rows, caption: args.caption, sortBy: args.sort_by, sortDir: args.sort_dir };
      const n = Array.isArray(rows) ? rows.length : 0;
      return persistAndEmit(ctx, 'table', args.title, spec, args, `${n} rows`);
    },
    {
      name: 'render_table',
      description: 'Render rows and columns as a SORTABLE TABLE card in the answer and on the canvas. Use for any list you assembled (deals, runs, contacts, tasks) instead of a markdown table. Give every column a `type` so numbers align and dates format.',
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
        ...tileArgs,
      }),
    },
  );
}

export function renderMarkdownTool(ctx: RuntimeContext) {
  return tool(
    async args => persistAndEmit(ctx, 'markdown', args.title, { title: args.title, md: args.md }, args, `${args.md.length} chars`),
    {
      name: 'render_markdown',
      description: 'Render a markdown document as a card the person keeps beside the conversation — a plan, a brief section, a checklist, meeting notes. Use when the content is a deliverable, not a reply. GFM tables and task lists are supported.',
      schema: z.object({
        title: z.string(),
        md: z.string().min(1).describe('Markdown body'),
        ...tileArgs,
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
      return persistAndEmit(ctx, 'chart', args.title, spec, args, `${n} series × ${Array.isArray(x) ? x.length : 0} points`);
    },
    {
      name: 'render_chart',
      description: 'Render a line, bar, or area chart (one y axis, up to 8 series) as a card. Use for change over time or magnitude across categories. Every series must have exactly one value per x label (null for missing).',
      schema: z.object({
        title: z.string(),
        type: z.enum(['line', 'bar', 'area']),
        x: z.union([z.array(z.string()), z.string()]).describe('x labels in order (array; a JSON string is tolerated)'),
        series: z.union([z.array(z.object({ name: z.string(), values: z.array(z.number().nullable()) })), z.string()]).describe('[{name, values}] aligned with x (array; a JSON string is tolerated)'),
        unit: z.string().optional().describe('"$", "%", or a noun like "deals"'),
        stacked: z.boolean().optional(),
        ...tileArgs,
      }),
    },
  );
}

export function renderRecordTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const fields = coerceJson(args.fields);
      const spec = { type: args.type, id: args.id, label: args.label, href: args.href, fields: fields ?? [], status: args.status };
      return persistAndEmit(ctx, 'record', args.label, spec, args, args.type);
    },
    {
      name: 'render_record',
      description: 'Render ONE entity — a deal, contact, agent, mission, run — as a compact card with a few fields, an optional status, and a link into the app. Use when the answer is a thing the person will open, not a paragraph about it.',
      schema: z.object({
        type: z.string().describe('Entity type label, e.g. "Deal"'),
        id: z.string(),
        label: z.string().describe('Display name'),
        href: z.string().optional().describe('In-app route (/dashboard/…) or external URL'),
        fields: z.union([z.array(z.object({ k: z.string(), v: z.union([z.string(), z.number(), z.boolean(), z.null()]) })), z.string()]).optional().describe('Up to ~8 {k, v} pairs (array; a JSON string is tolerated)'),
        status: z.string().optional(),
        ...tileArgs,
      }),
    },
  );
}

export function renderArtifactTools(ctx: RuntimeContext) {
  return [renderTableTool(ctx), renderMarkdownTool(ctx), renderChartTool(ctx), renderRecordTool(ctx)];
}
