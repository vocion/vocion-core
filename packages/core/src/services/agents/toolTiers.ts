/**
 * WHICH TOOLS A TURN CARRIES IN FULL — the rest it finds when it needs them.
 *
 * Measured 2026-10-04 (conversation 470, Langfuse trace 43894633): every
 * model call of a chat turn carried 67 tool definitions, 131k characters,
 * about 80% of its input, re-sent on all ten steps — while a dozen tools made
 * nearly every call in two weeks of production chat. So on the direct
 * Anthropic API the tools an agent actually uses stay loaded and every other
 * tool is deferred (`defer_loading`): the model sees it exists only through
 * Anthropic's tool search, and loads its definition the moment it needs it.
 * Nothing is taken away, and the catalog the model reads shrinks to what this
 * agent works with.
 *
 * Which tools are "used" is read from the agent's own `tool_call` history,
 * never from a list written here: core names no tool.
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { toolCallSchema } from '@/models/Schema';

/** How far back an agent's use counts. */
const WINDOW_DAYS = 30;
/** The share of an agent's calls its loaded tools must cover. */
const COVERAGE = 0.9;
const MIN_HOT = 4;
const MAX_HOT = 12;

/** Anthropic's server-side tool search (BM25 over names, descriptions and arguments). */
export const TOOL_SEARCH = { type: 'tool_search_tool_bm25_20251119', name: 'tool_search_tool_bm25' } as const;

/**
 * The tools that cover most of the calls, most-used first. Pure, for its test.
 * @param counts - Tool name → calls, any order.
 */
export function hotFrom(counts: Array<{ tool: string; calls: number }>): string[] {
  const sorted = [...counts].filter(c => c.calls > 0).sort((a, b) => b.calls - a.calls);
  const total = sorted.reduce((n, c) => n + c.calls, 0);
  const hot: string[] = [];
  let covered = 0;
  for (const c of sorted) {
    if (hot.length >= MAX_HOT || (hot.length >= MIN_HOT && covered >= total * COVERAGE)) {
      break;
    }
    hot.push(c.tool);
    covered += c.calls;
  }
  return hot;
}

/**
 * The tools this agent keeps loaded: its own recent use, else the
 * workspace's when it has none yet. Null when nothing has been used at all —
 * then nothing is deferred.
 * @param orgId - The workspace.
 * @param agentSlug - The agent.
 */
export async function hotToolNames(orgId: string, agentSlug: string): Promise<string[] | null> {
  const since = sql`now() - interval '${sql.raw(String(WINDOW_DAYS))} days'`;
  const read = (agentOnly: boolean) => db
    .select({ tool: toolCallSchema.tool, calls: sql<number>`count(*)::int` })
    .from(toolCallSchema)
    .where(and(eq(toolCallSchema.orgId, orgId), gt(toolCallSchema.createdAt, since), ...(agentOnly ? [eq(toolCallSchema.agentSlug, agentSlug)] : [])))
    .groupBy(toolCallSchema.tool)
    .orderBy(desc(sql`count(*)`))
    .limit(60);
  try {
    const own = hotFrom(await read(true));
    if (own.length > 0) {
      return own;
    }
    const workspace = hotFrom(await read(false));
    return workspace.length > 0 ? workspace : null;
  } catch {
    return null;
  }
}

/**
 * The turn's tools with every one outside `keep` deferred, plus the search
 * that finds them. The tools are this request's own objects, built for it.
 * @param tools - The turn's tools.
 * @param keep - Names that stay loaded.
 * @param search - The tool-search entry the model calls to find the rest.
 */
export function deferColdTools<T extends StructuredToolInterface>(tools: T[], keep: ReadonlySet<string>, search: T): T[] {
  for (const t of tools) {
    // A tool may say it is the platform's way to a whole class of question
    // and must never wait behind a search (`metadata.alwaysLoaded`): a new
    // one has no history to earn its place yet, and found only by search it
    // loses to the phrase hunt it exists to replace.
    if (!keep.has(t.name) && (t as { metadata?: Record<string, unknown> }).metadata?.alwaysLoaded !== true) {
      const withExtras = t as T & { extras?: Record<string, unknown> };
      withExtras.extras = { ...withExtras.extras, defer_loading: true };
    }
  }
  return [...tools, search];
}
