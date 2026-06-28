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
export type BuiltinTool = {
  name: string;
  title: string;
  description: string;
  /** Key into CapabilityStatus.capability (for provider/key status). */
  capability: string;
  category: 'research' | 'create' | 'compute';
};

export const BUILTIN_TOOLS: BuiltinTool[] = [
  { name: 'web_search', title: 'Web search', capability: 'web_search', category: 'research', description: 'Live web search — ranked titles, URLs, and snippets.' },
  { name: 'fetch_url', title: 'Fetch URL', capability: 'browse', category: 'research', description: 'Read a single web page and return its text.' },
  { name: 'crawl_site', title: 'Crawl site', capability: 'browse', category: 'research', description: 'Same-origin BFS crawl; digest of each page.' },
  { name: 'generate_image', title: 'Generate image', capability: 'generate_image', category: 'create', description: 'Create an image/graphic from a prompt; saved as an artifact.' },
  { name: 'create_artifact', title: 'Create artifact', capability: 'create_artifact', category: 'create', description: 'Produce a CSV, SVG chart, or doc file.' },
  { name: 'run_code', title: 'Run code / calc', capability: 'run_code', category: 'compute', description: 'Evaluate a math expression (builtin) or run code (sandbox).' },
];

/** Provider/key readiness for every capability. Never throws. */
export function capabilityStatuses(): CapabilityStatus[] {
  return [
    webSearchStatus(),
    browseStatus(),
    imageStatus(),
    codeStatus(),
    // create_artifact is builtin and always available.
    { capability: 'create_artifact', provider: 'builtin', ready: true, missingEnv: [] },
  ];
}
