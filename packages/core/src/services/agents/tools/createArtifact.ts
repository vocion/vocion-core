/**
 * create_artifact — produce a downloadable FILE (CSV, SVG chart, or
 * markdown/HTML doc) from structured input and return its served URL.
 * Builtin, no external provider.
 *
 * Not to be confused with the live-artifact family: `render_table` and
 * friends create something the person edits beside the conversation, and
 * `update_artifact` changes it. This one produces a file to download, and
 * records it as a `file` artifact so it shows up in the log.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { toChartSvg, toCsv } from '@/libs/tools/artifacts/build';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { createArtifact as recordArtifact, toPayload } from '@/services/ArtifactService';
import { authorOf } from './renderArtifacts';

/**
 * Models often stringify nested tool args — parse JSON strings back to objects.
 * @param v
 */
function coerceJsonString(v: unknown): unknown {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

export function createArtifactTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        let data: string;
        let ext: string;
        let contentType: string;

        // Coerce JSON-string variants of nested args (see schema note).
        const chart = coerceJsonString(args.chart) as { type: 'bar' | 'line'; title?: string; points?: Array<{ label: string; value: number }> } | undefined;
        const doc = coerceJsonString(args.doc) as { format?: 'md' | 'html'; content?: string } | undefined;

        if (args.kind === 'csv') {
          if (!args.rows?.length) {
            return 'create_artifact(csv) needs a non-empty `rows` array.';
          }
          data = toCsv(args.rows);
          ext = 'csv';
          contentType = 'text/csv';
        } else if (args.kind === 'chart') {
          if (!chart?.points?.length) {
            return 'create_artifact(chart) needs `chart.points`.';
          }
          data = toChartSvg(chart as Parameters<typeof toChartSvg>[0]);
          ext = 'svg';
          contentType = 'image/svg+xml';
        } else {
          if (!doc?.content) {
            return 'create_artifact(doc) needs `doc.content`.';
          }
          data = doc.content;
          ext = doc.format === 'html' ? 'html' : 'md';
          contentType = doc.format === 'html' ? 'text/html' : 'text/markdown';
        }

        const artifact = await saveArtifact({ orgId: ctx.orgId, data, ext, contentType });
        // 0095: the file is also a row, so the artifacts log and the mission
        // page can list it instead of regex-harvesting the URL from prose.
        try {
          const { artifact: row } = await recordArtifact({
            orgId: ctx.orgId,
            conversationId: ctx.conversationId ?? null,
            kind: 'file',
            title: args.title ?? artifact.filename,
            spec: { filename: artifact.filename, contentType: artifact.contentType, bytes: artifact.bytes, url: artifact.url },
            url: artifact.url,
            author: authorOf(ctx),
            changeSummary: 'Created',
          });
          ctx.emit({ type: 'artifact', artifact: toPayload(row) });
        } catch (err) {
          console.warn('[create_artifact] file saved but artifact row not recorded', (err as Error).message);
        }
        return `Artifact created: ${artifact.filename}\nURL: ${artifact.url} (${Math.round(artifact.bytes / 1024) || 1} KB)`;
      } catch (err) {
        return `Could not create artifact: ${(err as Error).message ?? 'unknown error'}`;
      }
    },
    {
      name: 'create_artifact',
      description:
        'Create a downloadable file and return its URL. kind="csv" (from `rows`), kind="chart" (bar/line from `chart.points`), or kind="doc" (markdown/HTML from `doc.content`). Use for deliverables like reports, exports, and simple charts.',
      schema: z.object({
        kind: z.enum(['csv', 'chart', 'doc']),
        title: z.string().optional().describe('Display title for the file card (defaults to the filename)'),
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).optional().describe('CSV rows (array of flat objects)'),
        // Models routinely pass nested objects as a JSON STRING ("{\"format\":…}").
        // A strict object schema rejects that and the tool invoke throws, killing
        // the turn at the finish line. z.preprocess can't serialize to the JSON
        // Schema sent to the model, so: accept string OR object in the schema and
        // coerce in the handler.
        chart: z
          .union([
            z.object({
              type: z.enum(['bar', 'line']),
              title: z.string().optional(),
              points: z.array(z.object({ label: z.string(), value: z.number() })),
            }),
            z.string(),
          ])
          .optional()
          .describe('Chart spec (object; a JSON string is tolerated)'),
        doc: z
          .union([
            z.object({ format: z.enum(['md', 'html']), content: z.string() }),
            z.string(),
          ])
          .optional()
          .describe('Document content: { format: "md"|"html", content } (object; a JSON string is tolerated)'),
      }),
    },
  );
}
