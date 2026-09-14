import type { CapabilityStatus } from './types';
import { browseStatus } from './browse/registry';
import { codeStatus } from './code/registry';
import { imageStatus } from './image/registry';
import { webSearchStatus } from './websearch/registry';

/**
 * Canonical list of built-in agent tools. Source of truth for the
 * dashboard Tools catalog and docs. Each tool maps to a capability whose
 * provider/key status is reported by `capabilityStatuses()`.
 */
export type BuiltinToolParam = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

export type BuiltinTool = {
  name: string;
  title: string;
  description: string;
  /** Key into CapabilityStatus.capability (for provider/key status). */
  capability: string;
  category: 'research' | 'create' | 'compute';
  /** Repo path of the implementation (zod schema + handler). */
  sourceFile: string;
  /** Parameter summary mirrored from the zod schema in `sourceFile`. */
  params: BuiltinToolParam[];
};

export const BUILTIN_TOOLS: BuiltinTool[] = [
  {
    name: 'web_search',
    title: 'Web search',
    capability: 'web_search',
    category: 'research',
    description: 'Live web search — ranked titles, URLs, and snippets.',
    sourceFile: 'src/services/agents/tools/webSearch.ts',
    params: [
      { name: 'query', type: 'string', required: true, description: 'The web search query' },
      { name: 'count', type: 'number', required: false, description: 'How many results to return (default 5, max 10)' },
    ],
  },
  {
    name: 'fetch_url',
    title: 'Fetch URL',
    capability: 'browse',
    category: 'research',
    description: 'Read a single web page and return its text.',
    sourceFile: 'src/services/agents/tools/fetchUrl.ts',
    params: [
      { name: 'url', type: 'string (URL)', required: true, description: 'The absolute URL to fetch' },
    ],
  },
  {
    name: 'crawl_site',
    title: 'Crawl site',
    capability: 'browse',
    category: 'research',
    description: 'Same-origin BFS crawl; digest of each page.',
    sourceFile: 'src/services/agents/tools/crawlSite.ts',
    params: [
      { name: 'start_url', type: 'string (URL)', required: true, description: 'URL to start crawling from' },
      { name: 'max_depth', type: 'number', required: false, description: 'Link depth to follow (default 1, max 3)' },
      { name: 'max_pages', type: 'number', required: false, description: 'Max pages to fetch (default 20, max 50)' },
    ],
  },
  {
    name: 'generate_image',
    title: 'Generate image',
    capability: 'generate_image',
    category: 'create',
    description: 'Create an image/graphic from a prompt; saved as an artifact.',
    sourceFile: 'src/services/agents/tools/generateImage.ts',
    params: [
      { name: 'prompt', type: 'string', required: true, description: 'Detailed description of the image to generate' },
      { name: 'size', type: '"1024x1024" | "1536x1024" | "1024x1536" | "auto"', required: false, description: 'Image dimensions (default 1024x1024)' },
    ],
  },
  {
    name: 'create_artifact',
    title: 'Create artifact',
    capability: 'create_artifact',
    category: 'create',
    description: 'Produce a CSV, SVG chart, or doc file.',
    sourceFile: 'src/services/agents/tools/createArtifact.ts',
    params: [
      { name: 'kind', type: '"csv" | "chart" | "doc"', required: true, description: 'What to produce: CSV from rows, bar/line chart from chart.points, or markdown/HTML doc' },
      { name: 'rows', type: 'object[]', required: false, description: 'CSV rows (array of flat objects)' },
      { name: 'chart', type: 'object', required: false, description: 'Chart spec — { type: "bar"|"line", title?, points: [{ label, value }] }' },
      { name: 'doc', type: 'object', required: false, description: 'Document content — { format: "md"|"html", content }' },
    ],
  },
  {
    name: 'run_code',
    title: 'Run code / calc',
    capability: 'run_code',
    category: 'compute',
    description: 'Evaluate a math expression (builtin) or run code (sandbox).',
    sourceFile: 'src/services/agents/tools/runCode.ts',
    params: [
      { name: 'code', type: 'string', required: true, description: 'A math expression to evaluate (builtin) or the code to run (sandbox)' },
      { name: 'language', type: 'string', required: false, description: 'Language (sandbox only), e.g. python or javascript' },
    ],
  },
];

/** create_artifact is builtin: no provider to pick, no key to spend. */
const ARTIFACT_STATUS: CapabilityStatus = {
  capability: 'create_artifact',
  provider: 'builtin',
  ready: true,
  missingEnv: [],
  keySource: 'none',
};

/**
 * Provider/key readiness for every capability. Never throws.
 *
 * Pass the org whose page this is and each capability also reports whether the
 * workspace's own key or the server's is about to be spent. With no org — a
 * deployment-level view, or a caller with no session — the credential store is
 * not consulted at all.
 * @param orgId - The org to report for, or undefined for the server's view.
 */
export async function capabilityStatuses(orgId?: string): Promise<CapabilityStatus[]> {
  const [webSearch, browse, image, code] = await Promise.all([
    webSearchStatus(orgId),
    browseStatus(orgId),
    imageStatus(orgId),
    codeStatus(orgId),
  ]);
  return [webSearch, browse, image, code, ARTIFACT_STATUS];
}

/**
 * Provider/key readiness for one capability. Never throws.
 *
 * The same answer {@link capabilityStatuses} would give for this capability,
 * without resolving the other four. That matters because resolving a
 * capability's status decrypts the org's stored key for it: asking about all
 * five to render one tool's page made every visit to the Tavily page pay for a
 * Firecrawl and an OpenAI decrypt nobody was going to read.
 *
 * An unrecognised capability gets null rather than a throw, in keeping with
 * the rest of this module — the caller is a page that has already decided the
 * tool exists.
 * @param capability - The capability key, e.g. `web_search`.
 * @param orgId - The org to report for, or undefined for the server's view.
 */
export async function capabilityStatus(
  capability: string,
  orgId?: string,
): Promise<CapabilityStatus | null> {
  switch (capability) {
    case 'web_search':
      return webSearchStatus(orgId);
    case 'browse':
      return browseStatus(orgId);
    case 'generate_image':
      return imageStatus(orgId);
    case 'run_code':
      return codeStatus(orgId);
    case 'create_artifact':
      return ARTIFACT_STATUS;
    default:
      return null;
  }
}
