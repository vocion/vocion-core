import type { McpConfig } from '../config';
import { z } from 'zod';
import { toChartSvg, toCsv } from '@/libs/tools/artifacts/build';
import { saveArtifact } from '@/libs/tools/artifacts/store';
import { bfsCrawl } from '@/libs/tools/browse/crawl';
import { getBrowseProvider } from '@/libs/tools/browse/registry';
import { getCodeProvider } from '@/libs/tools/code/registry';
import { getImageProvider } from '@/libs/tools/image/registry';
import { getWebSearchProvider } from '@/libs/tools/websearch/registry';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Built-in capability tools exposed over MCP — the same web search /
 * browse / image / code / artifact capabilities the agent runtime gets,
 * callable by any MCP client.
 * @param config
 */
export function capabilityTools(config: McpConfig): ToolModule[] {
  return [
    {
      name: 'web_search',
      title: 'Search the web',
      description: 'Live web search. Returns ranked titles, URLs, and snippets.',
      inputSchema: { query: z.string(), count: z.number().int().min(1).max(10).default(5) },
      handler: async (input) => {
        const { query, count } = input as { query: string; count?: number };
        return getWebSearchProvider().search(query, { count });
      },
    },
    {
      name: 'fetch_url',
      title: 'Fetch a web page',
      description: 'Fetch one URL and return its readable text/markdown.',
      inputSchema: { url: z.string().url() },
      handler: async (input) => {
        const { url } = input as { url: string };
        return (await getBrowseProvider().fetchPage(url)) ?? { error: 'no readable content' };
      },
    },
    {
      name: 'crawl_site',
      title: 'Crawl a site',
      description: 'Same-origin BFS crawl; returns pages (capped depth + count).',
      inputSchema: {
        start_url: z.string().url(),
        max_depth: z.number().int().min(0).max(3).default(1),
        max_pages: z.number().int().min(1).max(50).default(20),
      },
      handler: async (input) => {
        const { start_url, max_depth, max_pages } = input as { start_url: string; max_depth?: number; max_pages?: number };
        return bfsCrawl(getBrowseProvider(), start_url, { maxDepth: max_depth, maxPages: max_pages });
      },
    },
    {
      name: 'generate_image',
      title: 'Generate an image',
      description: 'Generate an image from a prompt; returns the saved artifact URL.',
      inputSchema: {
        prompt: z.string(),
        size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).default('1024x1024'),
      },
      handler: async (input) => {
        const { prompt, size } = input as { prompt: string; size?: '1024x1024' | '1536x1024' | '1024x1536' | 'auto' };
        const { png } = await getImageProvider().generate(prompt, { size });
        return saveArtifact({ orgId: config.orgId, data: png, ext: 'png', contentType: 'image/png' });
      },
    },
    {
      name: 'run_code',
      title: 'Run a calculation / code',
      description: 'Evaluate a math expression (builtin) or run code (sandbox provider).',
      inputSchema: { code: z.string(), language: z.string().optional() },
      handler: async (input) => {
        const { code, language } = input as { code: string; language?: string };
        return getCodeProvider().run(code, { language });
      },
    },
    {
      name: 'create_artifact',
      title: 'Create an artifact file',
      description: 'Create a CSV, SVG chart, or doc and return its URL.',
      inputSchema: {
        kind: z.enum(['csv', 'chart', 'doc']),
        rows: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).optional(),
        chart: z
          .object({ type: z.enum(['bar', 'line']), title: z.string().optional(), points: z.array(z.object({ label: z.string(), value: z.number() })) })
          .optional(),
        doc: z.object({ format: z.enum(['md', 'html']), content: z.string() }).optional(),
      },
      handler: async (input) => {
        const args = input as {
          kind: 'csv' | 'chart' | 'doc';
          rows?: Array<Record<string, string | number>>;
          chart?: { type: 'bar' | 'line'; title?: string; points: Array<{ label: string; value: number }> };
          doc?: { format: 'md' | 'html'; content: string };
        };
        if (args.kind === 'csv') {
          return saveArtifact({ orgId: config.orgId, data: toCsv(args.rows ?? []), ext: 'csv', contentType: 'text/csv' });
        }
        if (args.kind === 'chart') {
          return saveArtifact({ orgId: config.orgId, data: toChartSvg(args.chart ?? { type: 'bar', points: [] }), ext: 'svg', contentType: 'image/svg+xml' });
        }
        const fmt = args.doc?.format ?? 'md';
        return saveArtifact({ orgId: config.orgId, data: args.doc?.content ?? '', ext: fmt, contentType: fmt === 'html' ? 'text/html' : 'text/markdown' });
      },
    },
  ];
}
