/**
 * create_artifact — produce a downloadable file (CSV, SVG chart, or
 * markdown/HTML doc) from structured input and return its served URL.
 * Builtin, no external provider.
 */

import type { RuntimeContext } from '../types';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { toChartSvg, toCsv } from '@/libs/tools/artifacts/build';
import { saveArtifact } from '@/libs/tools/artifacts/store';

export function createArtifactTool(ctx: RuntimeContext) {
  return tool(
    async (args) => {
      try {
        let data: string;
        let ext: string;
        let contentType: string;

        if (args.kind === 'csv') {
          if (!args.rows?.length) {
            return 'create_artifact(csv) needs a non-empty `rows` array.';
          }
          data = toCsv(args.rows);
          ext = 'csv';
          contentType = 'text/csv';
        } else if (args.kind === 'chart') {
          if (!args.chart?.points?.length) {
            return 'create_artifact(chart) needs `chart.points`.';
          }
          data = toChartSvg(args.chart);
          ext = 'svg';
          contentType = 'image/svg+xml';
        } else {
          if (!args.doc?.content) {
            return 'create_artifact(doc) needs `doc.content`.';
          }
          data = args.doc.content;
          ext = args.doc.format === 'html' ? 'html' : 'md';
          contentType = args.doc.format === 'html' ? 'text/html' : 'text/markdown';
        }

        const artifact = await saveArtifact({ orgId: ctx.orgId, data, ext, contentType });
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
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).optional().describe('CSV rows (array of flat objects)'),
        chart: z
          .object({
            type: z.enum(['bar', 'line']),
            title: z.string().optional(),
            points: z.array(z.object({ label: z.string(), value: z.number() })),
          })
          .optional()
          .describe('Chart spec'),
        doc: z
          .object({ format: z.enum(['md', 'html']), content: z.string() })
          .optional()
          .describe('Document content'),
      }),
    },
  );
}
