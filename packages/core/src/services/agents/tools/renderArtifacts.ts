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
import { lintChart, lintText } from '@/libs/charts/lint';
import { CHART_TYPES, chartSpecSchema } from '@/libs/charts/spec';
import { artifactTitle } from '@/services/artifacts/title';
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
  modelTitle: string,
  spec: unknown,
  summary: string,
  folder?: string,
): Promise<string> {
  // The model names the artifact; the content decides when the name is not
  // one. "Right now — Sep 17, 4:50 PM UTC" was filed as a title today
  // (`services/artifacts/title.ts`). The spec keeps the derived title too, so
  // the pane and the list agree.
  const s = (spec ?? {}) as Record<string, unknown>;
  const title = artifactTitle(modelTitle, {
    ...(typeof s.md === 'string' ? { md: s.md } : {}),
    ...(typeof s.caption === 'string' ? { caption: s.caption } : {}),
  }, kind === 'markdown' ? 'Document' : kind.charAt(0).toUpperCase() + kind.slice(1));
  if (title !== modelTitle && typeof s.title === 'string') {
    spec = { ...s, title };
  }
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

/**
 * What `render_chart` tells the model about charting — the analyst rules in
 * brief, because every agent with the tool reads its description on every
 * turn (the full method is the `data-analysis` skill; docs/guides/charts.md).
 */
export const RENDER_CHART_DESCRIPTION = [
  'Create a chart artifact with Vocion\'s chart engine. NEVER hand-write chart HTML or SVG — here or inside a document (in a document use a chart block: <figure class="vocion-chart"><script type="application/json">{spec}</script></figure>).',
  'Pick the form from the question: amounts over time → bar with each period\'s own amount (aggregation "period"); composition over time → stacked bars by period (stack "stack"); shares over time → stack "percent"; comparing a few categories → grouped bars; a trend or rate → line; how a start became an end → waterfall (waterfallTotals names the start, subtotals and end). Never a pie.',
  'x holds ONE kind of thing: all periods (Jan…Dec, 2026-07, Q3) or all categories. A scenario or forecast is a SERIES, not an x label: mark it forecast: true on the series, or forecastFrom: "<first forecast x>"; actuals and forecast are never one unmarked bar. Running totals are a line, not bars.',
  'Always say the format (currency with currency code, percent, number, or a unit), source and asOf. The title states the finding ("On pace for $5.1M, carried by Q4 renewals"), not the axes. totals, when given, must equal the stack.',
  'The chart is linted before it renders (mixed axes, cumulative bars, too many series or categories for a phone, overlapping labels, missing format, dual axes, stacks that do not sum): an error refuses the chart and says what to fix; fix it and call again. To change a chart afterwards use update_artifact.',
].join(' ');

export function renderChartTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      const { folder, ...rest } = args;
      const spec = Object.fromEntries(Object.entries({
        ...rest,
        x: coerceJson(args.x),
        series: coerceJson(args.series),
        totals: coerceJson(args.totals),
        targets: coerceJson(args.targets),
        marker: coerceJson(args.marker),
      }).filter(([, v]) => v !== undefined));
      const parsed = chartSpecSchema.safeParse(spec);
      if (!parsed.success) {
        return `render_chart rejected: invalid chart spec — ${parsed.error.issues.map(i => `${i.path.join('.') || 'spec'}: ${i.message}`).join('; ')}. Fix the payload and call again.`;
      }
      const lint = lintChart(parsed.data);
      if (lint.errors.length) {
        return `render_chart refused: the chart would mislead or not read on a phone.\n${lintText(lint)}\nFix the spec and call render_chart again.`;
      }
      const n = parsed.data.series.length;
      const receipt = await persistAndEmit(ctx, 'chart', args.title, parsed.data, `${n} series × ${parsed.data.x.length} points`, folder);
      return lint.warnings.length ? `${receipt}\n\n${lintText(lint)}` : receipt;
    },
    {
      name: 'render_chart',
      description: RENDER_CHART_DESCRIPTION,
      schema: z.object({
        title: z.string().describe('The finding, as a short sentence — not the axes'),
        subtitle: z.string().optional(),
        type: z.enum(CHART_TYPES),
        x: z.union([z.array(z.string()), z.string()]).describe('x labels in order: all periods or all categories (array; a JSON string is tolerated)'),
        series: z.union([z.array(z.object({ name: z.string(), values: z.array(z.number().nullable()), forecast: z.boolean().optional() })), z.string()]).describe('[{name, values, forecast?}] aligned with x, null for a gap (array; a JSON string is tolerated)'),
        format: z.enum(['currency', 'percent', 'number']).optional(),
        currency: z.string().length(3).optional().describe('ISO code for format currency, e.g. USD'),
        unit: z.string().optional().describe('A noun unit when not currency or percent, e.g. "deals"'),
        compact: z.boolean().optional().describe('$4.3M rather than $4,297,436 (default true)'),
        stack: z.enum(['none', 'stack', 'percent']).optional(),
        stacked: z.boolean().optional().describe('Legacy: same as stack "stack"'),
        aggregation: z.enum(['period', 'cumulative', 'snapshot']).optional().describe('What one value is: the period\'s own amount, a running total, or a balance'),
        forecastFrom: z.string().optional().describe('The first x label that is forecast'),
        totals: z.union([z.array(z.number().nullable()), z.string()]).optional().describe('The stated total per x; the stack must sum to it'),
        targets: z.union([z.array(z.object({ value: z.number(), label: z.string() })), z.string()]).optional().describe('Up to 3 reference lines, e.g. the plan'),
        marker: z.union([z.object({ x: z.string(), label: z.string() }), z.string()]).optional().describe('A vertical marker at one x, e.g. {x: "Oct", label: "Today"}'),
        waterfallTotals: z.array(z.string()).optional().describe('Waterfall: the x labels drawn as full bars (start, subtotals, end)'),
        trend: z.boolean().optional(),
        source: z.string().optional().describe('Where the numbers came from, e.g. "QuickBooks P&L by month"'),
        asOf: z.string().optional().describe('YYYY-MM-DD the numbers are as of'),
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
