/**
 * HOW MANY TOOLS A TURN CARRIES IN FULL, AND WHICH (ADR 0009).
 *
 * Every agent is built with 90 to 135 tools (`scripts/measure-tools.ts`),
 * 2 to 4 times past the 30 to 50 where a model's tool choice starts to
 * slip. `toolTiers.ts` keeps an agent's recently used tools loaded and puts
 * the rest behind Anthropic's tool search. History alone misses the tools an
 * agent has not used yet: its write path, a new grant, a tool its prompt
 * just started naming. That gap caused the incidents in the ADR.
 *
 * `harness.toolLoading` picks how a turn's tools are loaded:
 *   - `history` (the default): today's behaviour. Recent use, grants and
 *     tools the prompt names stay loaded, and the rest are searchable. With
 *     no history yet, everything is loaded.
 *   - `core`: a set that comes from configuration, not luck. It is the core
 *     tier (acting, deciding and the state basics), every declared
 *     connector's tools, grants, tools named in the prompt, skills or
 *     playbooks, and recent use, all within a budget. Families that do not
 *     fit are deferred and named in the search note, so the model knows
 *     what to search for. If everything fits within the budget, everything
 *     is loaded.
 *   - `all`: nothing is deferred.
 *
 * Everything here is pure. The harness does the I/O (`harness.ts`
 * `tieredTools`).
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';

export const TOOL_LOADING_MODES = ['core', 'history', 'all'] as const;
export type ToolLoading = typeof TOOL_LOADING_MODES[number];
export const DEFAULT_TOOL_LOADING: ToolLoading = 'history';

/**
 * The core tier: how an agent acts, decides, and reads the workspace's
 * state. These stay loaded in `core` mode whatever the history says. Without
 * them, an agent asked to change a record says it cannot (Pipeline Analyst,
 * 2026-10-28).
 */
export const CORE_TOOL_NAMES: readonly string[] = [
  // Acting and deciding.
  'recommend_action',
  'propose_action',
  'withdraw_proposal',
  'decide_proposal',
  'decide_ask',
  'file_ask',
  'withdraw_ask',
  'request_human_review',
  // The state basics.
  'query_state',
  'search_knowledge',
  'lookup_objects',
  'page_context',
  'where_to',
  'list_capabilities',
  'describe_sources',
];

/**
 * How much a turn may carry in full: 40 tools or 64k characters (about 25k
 * tokens), whichever comes first. From the public guidance (selection
 * slips past 30 to 50 tools) and the platform's sizes: the core tier alone
 * is about 30k characters, and a CRM connector family about 25k.
 */
export const TOOL_BUDGET = { maxTools: 40, maxChars: 64_000 } as const;
/**
 * Characters per token for tool definitions. Measured with Anthropic's
 * token counter on the eval agents' full catalogs (2026-10-29, Sonnet 5.5):
 * 2.52 to 2.55. JSON schema is denser than prose.
 */
export const CHARS_PER_TOKEN = 2.5;

type AnyTool = Pick<StructuredToolInterface, 'name' | 'description'> & { schema?: unknown; metadata?: Record<string, unknown> };

/**
 * Size of one tool's definition as the model API receives it (name,
 * description and JSON input schema), in characters.
 * @param t - The tool.
 */
export function toolDefinitionChars(t: AnyTool): number {
  let schema: unknown = t.schema ?? {};
  if (t.schema instanceof z.ZodType) {
    try {
      schema = z.toJSONSchema(t.schema, { io: 'input', unrepresentable: 'any' });
    } catch {
      schema = {};
    }
  }
  return JSON.stringify({ name: t.name, description: t.description ?? '', input_schema: schema }).length;
}

/**
 * The family a tool belongs to (`registry.ts` tags it); untagged tools are "Other".
 * @param t - The tool.
 */
export function toolFamily(t: AnyTool): string {
  const f = t.metadata?.toolFamily;
  return typeof f === 'string' && f ? f : 'Other';
}

/**
 * Whether the tool reads or writes one of the agent's declared connectors.
 * @param t - The tool.
 */
export function isConnectorTool(t: AnyTool): boolean {
  return t.metadata?.connectorTool === true;
}

function alwaysLoaded(t: AnyTool): boolean {
  return t.metadata?.alwaysLoaded === true;
}

/**
 * The mode a turn runs in. An explicit `toolLoading` wins. The old
 * `toolSearch: false` still means `all`. Anything else is the default.
 * @param harness - The agent's harness config (workspace defaults already folded in).
 */
export function resolveToolLoading(harness: { toolLoading?: unknown; toolSearch?: unknown } | null | undefined): ToolLoading {
  const mode = harness?.toolLoading;
  if (typeof mode === 'string' && (TOOL_LOADING_MODES as readonly string[]).includes(mode)) {
    return mode as ToolLoading;
  }
  if (harness?.toolSearch === false) {
    return 'all';
  }
  return DEFAULT_TOOL_LOADING;
}

export type ToolLoadPlan = {
  mode: ToolLoading;
  /** Names that stay loaded. Null means nothing is deferred. */
  keep: Set<string> | null;
  loaded: number;
  deferred: number;
  /** Characters of the loaded definitions. */
  loadedChars: number;
  totalChars: number;
  /** In `core` mode: the tools that must stay loaded (core tier, grants, named) are over the budget on their own. */
  overBudget: boolean;
  /** Deferred tools by family, for the search note: family → names. */
  searchable: Array<{ family: string; tools: string[] }>;
};

export type PlanInput = {
  mode: ToolLoading;
  tools: readonly AnyTool[];
  /** The agent's hot tools from its history (`hotToolNames`). Null when there is none. */
  hot: readonly string[] | null;
  /** Tools granted by name (`harness.grantTools`, groups expanded). */
  grants: readonly string[];
  /** Tools the prompt names, and in `core` mode the agent's skills and playbooks too. */
  named: readonly string[];
  budget?: { maxTools: number; maxChars: number };
};

/**
 * Which tools a turn carries in full.
 *
 * In `core` mode, the order when the set must be cut to fit the budget
 * (ADR 0009, "over the budget"):
 *   1. The core tier, `alwaysLoaded` tools, grants and named tools are always
 *      kept, even past the budget. Each is the author's explicit choice, and
 *      deferring one is exactly the incident this is meant to prevent. If
 *      these alone are over budget, the plan says so (`overBudget`) and the
 *      turn records it.
 *   2. Recent use (history), while the budget lasts.
 *   3. Declared connectors, a whole family at a time while it fits. Families
 *      the agent already uses come first, then the smallest. A family that
 *      does not fit is deferred whole and named in the search note.
 * @param input - The turn's tools and what the agent's configuration says.
 */
export function planToolLoading(input: PlanInput): ToolLoadPlan {
  const budget = input.budget ?? TOOL_BUDGET;
  const sizes = new Map(input.tools.map(t => [t.name, toolDefinitionChars(t)] as const));
  const totalChars = [...sizes.values()].reduce((a, b) => a + b, 0);
  const names = new Set(input.tools.map(t => t.name));
  const all = (): ToolLoadPlan => ({ mode: input.mode, keep: null, loaded: input.tools.length, deferred: 0, loadedChars: totalChars, totalChars, overBudget: false, searchable: [] });

  let keep: Set<string>;
  let overBudget = false;
  if (input.mode === 'all') {
    return all();
  }
  if (input.mode === 'history') {
    // Exactly what `toolTiers.ts` did before this mode existed.
    if (!input.hot?.length) {
      return all();
    }
    keep = new Set([...input.hot, ...input.grants, ...input.named].filter(n => names.has(n)));
    for (const t of input.tools) {
      if (alwaysLoaded(t)) {
        keep.add(t.name);
      }
    }
  } else {
    if (input.tools.length <= budget.maxTools && totalChars <= budget.maxChars) {
      return all();
    }
    keep = new Set();
    let chars = 0;
    const add = (n: string) => {
      if (names.has(n) && !keep.has(n)) {
        keep.add(n);
        chars += sizes.get(n) ?? 0;
      }
    };
    const fits = (extra: string[]) => {
      const fresh = extra.filter(n => names.has(n) && !keep.has(n));
      return keep.size + fresh.length <= budget.maxTools && chars + fresh.reduce((s, n) => s + (sizes.get(n) ?? 0), 0) <= budget.maxChars;
    };
    // 1. Always kept.
    for (const n of CORE_TOOL_NAMES) {
      add(n);
    }
    for (const t of input.tools) {
      if (alwaysLoaded(t)) {
        add(t.name);
      }
    }
    for (const n of [...input.grants, ...input.named]) {
      add(n);
    }
    overBudget = keep.size > budget.maxTools || chars > budget.maxChars;
    // 2. Recent use, one at a time while it fits.
    for (const n of input.hot ?? []) {
      if (fits([n])) {
        add(n);
      }
    }
    // 3. Declared connectors, a whole family at a time.
    const families = new Map<string, string[]>();
    for (const t of input.tools) {
      if (isConnectorTool(t)) {
        families.set(toolFamily(t), [...(families.get(toolFamily(t)) ?? []), t.name]);
      }
    }
    const used = (members: string[]) => members.some(n => keep.has(n));
    const ordered = [...families.entries()].sort(([, a], [, b]) => Number(used(b)) - Number(used(a)) || a.length - b.length);
    for (const [, members] of ordered) {
      if (fits(members)) {
        members.forEach(add);
      }
    }
    if (input.tools.every(t => keep.has(t.name))) {
      return all();
    }
  }

  const deferredTools = input.tools.filter(t => !keep.has(t.name));
  const byFamily = new Map<string, string[]>();
  for (const t of deferredTools) {
    byFamily.set(toolFamily(t), [...(byFamily.get(toolFamily(t)) ?? []), t.name]);
  }
  const loadedChars = input.tools.filter(t => keep.has(t.name)).reduce((s, t) => s + (sizes.get(t.name) ?? 0), 0);
  return {
    mode: input.mode,
    keep,
    loaded: input.tools.length - deferredTools.length,
    deferred: deferredTools.length,
    loadedChars,
    totalChars,
    overBudget,
    searchable: [...byFamily.entries()].sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b))).map(([family, tools]) => ({ family, tools })),
  };
}

/** What an agent with deferred tools is told, in every mode. */
export const TOOL_SEARCH_NOTE = 'You have more tools than the ones listed: search for one with tool_search_tool_bm25 before saying you cannot do something.';

/**
 * The search note with an index of what is deferred, so the model knows what
 * exists before it searches. Without the index, BM25 gets the person's
 * wording, not the tool's. A family is listed with a few of its tools' names.
 * In `history` mode the note is unchanged.
 * @param plan - The turn's plan.
 */
export function toolSearchNote(plan: ToolLoadPlan): string {
  if (plan.mode !== 'core' || plan.searchable.length === 0) {
    return TOOL_SEARCH_NOTE;
  }
  const lines = plan.searchable.map(({ family, tools }) => {
    const shown = tools.slice(0, 4).join(', ');
    return `- ${family}: ${shown}${tools.length > 4 ? `, and ${tools.length - 4} more` : ''}`;
  });
  return `${TOOL_SEARCH_NOTE} Not loaded until you search for them:\n${lines.join('\n')}`;
}

/** The turn's tool loading, as the trace and the run's metadata record it. */
export type ToolLoadingSummary = Pick<ToolLoadPlan, 'mode' | 'loaded' | 'deferred' | 'overBudget'> & { loadedTokens: number; families: string[] };

/**
 * The plan in a few numbers, for `run_meta` and the trace.
 * @param plan - The turn's plan.
 */
export function summarizePlan(plan: ToolLoadPlan): ToolLoadingSummary {
  return {
    mode: plan.mode,
    loaded: plan.loaded,
    deferred: plan.deferred,
    overBudget: plan.overBudget,
    loadedTokens: Math.round(plan.loadedChars / CHARS_PER_TOKEN),
    families: plan.searchable.map(s => s.family),
  };
}

/** Tools deepagents adds to every agent; a call to one of them is not to an unknown tool. */
export const HARNESS_BUILTIN_TOOLS: readonly string[] = ['write_todos', 'ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep', 'execute', 'task'];

/** What a turn did with its tools: per-turn trace fields. */
export type TurnToolStats = {
  /** Tool searches the model ran (server-side). */
  searches: number;
  /** Calls to a name the turn did not have. */
  unknownTools: number;
  /** Tool calls that came back as an error. */
  toolErrors: number;
};

export function emptyTurnToolStats(): TurnToolStats {
  return { searches: 0, unknownTools: 0, toolErrors: 0 };
}

/**
 * Add one model message's tool use to the turn's stats: the searches it ran,
 * and calls to tools the turn does not have.
 * @param stats - Mutated.
 * @param output - The model's message (`on_chat_model_end` output).
 * @param known - Every tool name the turn can run.
 */
export function noteModelToolUse(stats: TurnToolStats, output: unknown, known: ReadonlySet<string>): void {
  const msg = output as { content?: unknown; tool_calls?: Array<{ name?: string }> } | null | undefined;
  if (Array.isArray(msg?.content)) {
    for (const block of msg.content as Array<{ type?: string; name?: string }>) {
      if (block?.type === 'server_tool_use' && typeof block.name === 'string' && block.name.startsWith('tool_search')) {
        stats.searches += 1;
      }
    }
  }
  for (const call of msg?.tool_calls ?? []) {
    if (call?.name && !known.has(call.name)) {
      stats.unknownTools += 1;
    }
  }
}
