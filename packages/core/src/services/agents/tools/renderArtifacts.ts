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
import { checkChart, refusalText } from '@/libs/charts/checks';
import { reviewChart } from '@/libs/charts/review';
import { CHART_TYPES, chartSpecSchema } from '@/libs/charts/spec';
import { artifactTitle } from '@/services/artifacts/title';
import { ArtifactError, createArtifact, toPayload } from '@/services/ArtifactService';
import { chartReviewImage, withImage } from '../toolResultImages';

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
 * What `render_chart` tells the model about charting — the method and how to
 * choose the form, by worked example. It stands on its own: every agent with
 * the tool reads it on every turn, and a workspace that cannot mount the base
 * pack's `data-analysis` skill (the full version) points its prompts here.
 * The library lays the chart out; the model picks the form, the series and
 * the finding (Chris, 2026-10-24). See docs/guides/charts.md.
 */
export const RENDER_CHART_DESCRIPTION = [
  'Create a chart artifact with Vocion\'s chart engine. Never hand-write chart HTML or SVG (in a document, use a chart block: <figure class="vocion-chart"><script type="application/json">{spec}</script></figure>).',
  'Choose the form from the question, title it with the finding, and let the library lay it out: it turns bars horizontal when names are long, wraps labels, puts values on the bars, folds series past eight into "Other", and splits a waterfall whose last steps would be slivers.',
  'Examples (numbers invented). Revenue by month with forecast months: type "bar", x ["Jan"…"Dec"], series Invoiced and Weighted pipeline (forecast: true), stack "stack", aggregation "period", forecastFrom "Nov", format "currency", title "On pace for $4.4M, December carried by pipeline".',
  'A P&L bridge: type "waterfall", x ["Revenue","Delivery cost","Gross profit","Operating expenses","Operating profit","Interest","Tax","Net income"], one series, waterfallTotals ["Revenue","Gross profit","Operating profit","Net income"]; full names, never codes. When the question is about the last steps (what took profit from $110K to $46K), start there: waterfallStart "Operating profit".',
  'Year-end scenarios: a small bar chart of the scenarios (x ["Low","Base","High"]), not extra bars on a monthly axis. Comparing many named things (customers, vendors): type "bar" with their full names; it draws them horizontally. A trend or a rate: "line". Shares over time: stack "percent". Never a pie.',
  'Read the numbers once: a whole range in one call split by period (a ledger report with a monthly split, e.g. summarize_by "Month"), never one call per month; every figure ties to a read you made. Keep actuals apart from forecast (pipeline, plan, run-rate are forecast). Always give format (currency with its code, percent, number, or a unit), source and asOf. totals, when given, must equal the stack.',
  'Only data that cannot be drawn honestly is refused (values that are not numbers, a stack that does not sum to its stated totals, two units on one axis). Otherwise the chart renders, and the receipt reviews it as drawn on a phone: judge it, and revise once with update_artifact if it does not answer the question.',
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
      const checks = checkChart(parsed.data);
      if (checks.refusals.length) {
        return `render_chart refused.\n${refusalText(checks)}\nFix the data and call render_chart again.`;
      }
      const n = parsed.data.series.length;
      const receipt = await persistAndEmit(ctx, 'chart', args.title, parsed.data, `${n} series × ${parsed.data.x.length} points`, folder);
      if (!receipt.startsWith('Rendered')) {
        return receipt;
      }
      // The model judges what it drew: the picture where its API takes one.
      const image = await chartReviewImage(ctx, parsed.data);
      return withImage(`${receipt}\n\n${reviewChart(parsed.data, { withImage: image !== null }).text}`, image);
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
        waterfallStart: z.string().optional().describe('Waterfall: start the bridge at this subtotal, leaving out the bars before it'),
        orientation: z.enum(['auto', 'vertical', 'horizontal']).optional().describe('auto (default) lets the layout turn bars horizontal when names are long'),
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
