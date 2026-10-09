/**
 * The ONE builder for the `RuntimeContext` an agent's tools close over.
 *
 * Every place that runs an agent's tools used to assemble this object by
 * hand from the agent row — the in-process harness, the claim-verified tool
 * endpoint, the runtime provider's catalog, the automations' recording pass,
 * the skill turn, the AgentCore harness and the MCP bridge — and they drifted:
 * the MCP bridge set neither `restSources` nor `filingTypes`, so a REST source
 * connected on Monday had tools in chat and none over MCP; the recording pass
 * had no `enabledPlugins`, so a `file_<type>` requirement found no tool. Two
 * surfaces doing the same job is a defect (design principle 6): the shape is
 * built here, and a call site says only what is per-call.
 *
 * Two layers, because the reads are the expensive part and some callers
 * already hold them:
 *
 *   - {@link agentScope} reads what the agent's tool set depends on beyond
 *     its row — the workspace's plugins and zone, the agent's typed filing
 *     types, its REST sources. The harness reads it once per blueprint; the
 *     tool endpoint reads it per call because it has no graph.
 *   - {@link runtimeContextFromScope} is synchronous and pure: the row, the
 *     scope and the per-call options become the context. A fresh object every
 *     time — the tools close over it, so nothing another turn does can reach
 *     in (issue #109).
 *
 * {@link runtimeContextForAgent} is the two together, for a caller that holds
 * only the row.
 */

import type { RuntimeContext } from './types';
import type { agentSchema } from '@/models/Schema';
import { ToolMessage } from '@langchain/core/messages';
import { createMiddleware } from 'langchain';
import { loadSourceKinds } from '@/libs/connectors/families';
import { loadRestSources } from '@/libs/rest/sources';
import { resolveTimeZone } from '@/libs/time/zone';
import { loadFilingTypes } from './tools/fileRecord';

/** The columns of an `agent` row the context reads. */
export type AgentContextRow = Pick<
  typeof agentSchema.$inferSelect,
  'slug' | 'connectorSources' | 'objectTypeSlugs' | 'searchConfig' | 'harnessConfig'
>;

/** The workspace facts every agent in it shares. */
export type WorkspaceScope = {
  /** Plugins the workspace has on (`project.enabled_plugins`). */
  enabledPlugins: string[];
  /** The workspace's zone (`project.time_zone`), the fallback when a turn names none. */
  defaultTimeZone: string;
  /** `project.kind`: a personal workspace's agent may reach the person's other workspaces. Absent reads as shared. */
  workspaceKind?: 'shared' | 'personal';
};

/** The workspace facts plus the agent's own resolved tool inputs. */
export type AgentScope = WorkspaceScope & Pick<RuntimeContext, 'filingTypes' | 'restSources' | 'sourceKinds'>;

/**
 * The workspace facts the in-process harness reads once per graph build,
 * read here for a caller that has no graph.
 *
 * Without them the tool set differed from the in-process one: `wikiTools`
 * builds nothing when `enabledPlugins` is absent, so an agent on the container
 * lost the wiki entirely, and every date a tool rendered fell back to UTC
 * instead of the workspace's zone. Never throws: a workspace that cannot be
 * read has no plugins on and the server's zone.
 * @param orgId - The workspace.
 */
export async function workspaceScope(orgId: string): Promise<WorkspaceScope> {
  const { enabledPluginsForOrg } = await import('@/services/PluginService');
  const { workspaceTimeZone } = await import('@/libs/time/workspaceTimeZone');
  const [enabledPlugins, defaultTimeZone, workspaceKind] = await Promise.all([
    enabledPluginsForOrg(orgId).catch(() => [] as string[]),
    workspaceTimeZone(orgId),
    workspaceKindOf(orgId),
  ]);
  return { enabledPlugins, defaultTimeZone, workspaceKind };
}

/**
 * `project.kind` for the workspace. A workspace that cannot be read is shared:
 * that answer only withholds tools, never grants them.
 * @param orgId - The workspace.
 */
async function workspaceKindOf(orgId: string): Promise<'shared' | 'personal'> {
  try {
    const [{ db }, { eq }, { projectSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
    const [row] = await db.select({ kind: projectSchema.kind }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    return row?.kind === 'personal' ? 'personal' : 'shared';
  } catch {
    return 'shared';
  }
}

/**
 * Everything an agent's tool set depends on beyond its row: the workspace's
 * plugins and zone, the types it files through their own typed tool
 * (`file_<slug>`, `tools/fileRecord.ts`) and the `rest` sources it holds with
 * their declared endpoints (`tools/restDirect.ts`). The tool builder is
 * synchronous, so these are read here, once, and carried on the context.
 *
 * Never throws: a filing type or a REST source that cannot be read simply
 * yields no tool, which is what the harness has always done.
 * @param orgId - The workspace.
 * @param row - The agent.
 * @param workspace - The workspace facts, when the caller already has them (one read for many agents).
 */
export async function agentScope(orgId: string, row: AgentContextRow, workspace?: WorkspaceScope): Promise<AgentScope> {
  const [ws, filingTypes, restSources, sourceKinds] = await Promise.all([
    workspace ?? workspaceScope(orgId),
    loadFilingTypes(orgId, row.objectTypeSlugs ?? []).catch(() => []),
    loadRestSources(orgId, row.connectorSources ?? []).catch(() => []),
    loadSourceKinds(orgId, row.connectorSources ?? []).catch(() => ({})),
  ]);
  return { ...ws, filingTypes, restSources, sourceKinds };
}

/**
 * What ONE call brings to an agent's context: who is asking, what they may
 * read, where their events go. Every field is per-call, which is why none of
 * it may be cached alongside the agent.
 */
export type RuntimeContextOptions = {
  /** Who triggered the run; omitted for schedules, MCP and API callers. */
  userId?: string;
  /** This person's source ACL (`SourceAccessService`); omitted means no narrowing. */
  allowedSourceSlugs?: string[];
  /** The mission this run belongs to, for mission-scoped tools. */
  missionSlug?: string;
  /** The `mission_run` driving this turn, for the audit trail. */
  missionRunId?: number;
  /** The persisted conversation this turn belongs to, stamped on `tool_call` rows. */
  conversationId?: number;
  /** Where the person is in the app right now, read by the `page_context` tool. */
  pageContext?: RuntimeContext['pageContext'];
  /** The person's message this turn, for gates on the turn's own ask. */
  turnMessage?: string;
  /** The person's own time zone for this turn; falls back to the workspace's. */
  timeZone?: string;
  /** Which harness runs the loop — stamped on tool_call rows. */
  provider?: RuntimeContext['provider'];
  /** Where this turn's structured events go. Dropped when absent. */
  emit?: RuntimeContext['emit'];
  /** Delegation attribution for this turn (taskId → specialist), for a loop that delegates. */
  delegations?: RuntimeContext['delegations'];
  /** The scope already resolved by the caller (a blueprint, a definition), so nothing is read again. */
  scope?: AgentScope;
};

/**
 * The context for one call, from an agent row, its resolved scope and what
 * the call brings. Synchronous and pure; a fresh object every time.
 * @param orgId - Tenant scope — every DB read/write filters by this.
 * @param row - The agent.
 * @param scope - The agent's resolved scope (see {@link agentScope}).
 * @param opts - What this one call brings.
 */
export function runtimeContextFromScope(
  orgId: string,
  row: AgentContextRow,
  scope: AgentScope,
  opts: Omit<RuntimeContextOptions, 'scope'> = {},
): RuntimeContext {
  const evidence = newTurnEvidence();
  return {
    orgId,
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    enabledPlugins: scope.enabledPlugins,
    workspaceKind: scope.workspaceKind,
    filingTypes: scope.filingTypes,
    restSources: scope.restSources,
    sourceKinds: scope.sourceKinds,
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    defaultTimeZone: scope.defaultTimeZone,
    // The person's zone for this turn, else the workspace's.
    timeZone: resolveTimeZone(opts.timeZone, scope.defaultTimeZone),
    emit: noteEvidence(evidence, opts.emit ?? (() => {})),
    evidence,
    userId: opts.userId,
    allowedSourceSlugs: opts.allowedSourceSlugs,
    missionSlug: opts.missionSlug,
    missionRunId: opts.missionRunId,
    conversationId: opts.conversationId,
    pageContext: opts.pageContext,
    turnMessage: opts.turnMessage,
    provider: opts.provider,
    delegations: opts.delegations,
    // Citation numbering restarts each turn, and the numbers the model cites
    // must belong to the sources THIS turn retrieved.
    citationSeq: { current: 0 },
  };
}

/**
 * The turn's emit, noting every cited source on the turn's evidence ledger as
 * its `documents` event goes out — whichever tool found it.
 * @param evidence - The turn's ledger.
 * @param emit - Where the turn's events go.
 */
function noteEvidence(evidence: TurnEvidence, emit: RuntimeContext['emit']): RuntimeContext['emit'] {
  return (event) => {
    if (event.type === 'documents') {
      noteSources(evidence, event.documents);
    }
    emit(event);
  };
}

/**
 * The context for one call, from an agent row alone: resolves the scope
 * (unless the caller passed one) and builds the context.
 * @param orgId - Tenant scope.
 * @param row - The agent.
 * @param opts - What this one call brings, and optionally the scope already in hand.
 */
export async function runtimeContextForAgent(
  orgId: string,
  row: AgentContextRow,
  opts: RuntimeContextOptions = {},
): Promise<RuntimeContext> {
  const { scope, ...rest } = opts;
  return runtimeContextFromScope(orgId, row, scope ?? await agentScope(orgId, row), rest);
}

/* ------------------------------------------------------------------ */
/* Turn evidence — kept in this module, not its own: every module the   */
/* agent tool graph reaches counts once per route (check:route-graph).  */
/* ------------------------------------------------------------------ */

/**
 * TURN EVIDENCE — what one turn has already found, so nothing in it is looked
 * up twice and a consulted teammate starts from it.
 *
 * On 2026-10-09 (trace c126f3ca) one turn searched the same person's name
 * three times and the same company twice, and the consulted Follow Up
 * Coordinator was handed a one-line task and re-ran the lead's searches from
 * scratch — 23 of them, 133 s. The turn held the answers; nothing carried them.
 *
 * One ledger per turn, on the turn's context, which the lead's tools and every
 * teammate's tools share (they close over the same context):
 *
 *   - **Every cited source** is recorded as its `documents` event goes out —
 *     number, title, source, document id — whichever tool found it.
 *   - **Every search** is recorded by its normalised key: the query lowercased
 *     with whitespace collapsed, plus its filters in a stable order. A repeat
 *     returns the earlier result's numbers instead of searching again. That is
 *     the only "near" a repeat is: the words are never compared for meaning.
 *   - **A consult carries the ledger.** The `task` call's description gets the
 *     searches already run and the sources already found, with their numbers,
 *     and the teammate is told not to repeat them.
 */

export type EvidenceSource = { n: number; title: string; source: string; documentId?: string; link?: string; at?: string };
export type EvidenceSearch = { query: string; key: string; numbers: number[]; output: string; hits: number };

export type TurnEvidence = {
  sources: Map<number, EvidenceSource>;
  searches: Map<string, EvidenceSearch>;
  /** Results of read-only lookups that declare `turnMemo`, by tool and canonical arguments. */
  lookups: Map<string, { tool: string; content: string }>;
};

/** A fresh, empty ledger. */
export function newTurnEvidence(): TurnEvidence {
  return { sources: new Map(), searches: new Map(), lookups: new Map() };
}

/**
 * Canonical JSON: keys sorted at every level, so two filters that say the same
 * thing in a different order make the same key.
 * @param value - Any JSON value.
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The key a search is remembered by: its query normalised by case and
 * whitespace only, and its filters canonically ordered.
 * @param tool - The tool searched with.
 * @param args - Its arguments; `query` is the free text.
 */
export function searchKey(tool: string, args: Record<string, unknown>): string {
  const { query, ...filters } = args;
  const q = typeof query === 'string' ? query.toLowerCase().replace(/\s+/g, ' ').trim() : '';
  const sortedFilters = Object.fromEntries(Object.entries(filters).map(([k, v]) => [k, Array.isArray(v) ? [...v].map(String).sort() : v]));
  return `${tool}|${q}|${canonical(sortedFilters)}`;
}

/**
 * Note the sources a `documents` event carried.
 * @param ev - The ledger.
 * @param documents - The event's documents, each with its citation number.
 */
export function noteSources(ev: TurnEvidence, documents: ReadonlyArray<{ citationIndex?: number; semantic_identifier?: string; source_type?: string; document_id?: string; link?: string; updated_at?: string }>): void {
  for (const d of documents) {
    if (typeof d.citationIndex === 'number' && !ev.sources.has(d.citationIndex)) {
      ev.sources.set(d.citationIndex, {
        n: d.citationIndex,
        title: (d.semantic_identifier ?? '').slice(0, 120),
        source: d.source_type ?? 'unknown',
        ...(d.document_id ? { documentId: d.document_id } : {}),
        ...(d.link ? { link: d.link } : {}),
        ...(d.updated_at ? { at: d.updated_at } : {}),
      });
    }
  }
}

/**
 * The line a repeated search returns instead of searching again.
 * @param prior
 */
export function repeatNote(prior: EvidenceSearch): string {
  const nums = prior.numbers.length > 0 ? prior.numbers.map(n => `[${n}]`).join('') : 'nothing';
  return `Already searched this turn with the same query and filters ("${prior.query}"): it found ${prior.hits === 0 ? 'nothing' : nums}. Use those results above; do not run this search again.${prior.hits > 0 ? `\n\n${prior.output}` : ''}`;
}

/** The most sources and searches a hand-off names. */
const HANDOFF_SOURCES = 30;
const HANDOFF_SEARCHES = 20;

/**
 * The block a consult's task description carries: what this turn already
 * searched for and found, by citation number. Empty when nothing has been.
 * @param ev - The ledger.
 */
export function evidenceBlock(ev: TurnEvidence): string {
  if (ev.sources.size === 0 && ev.searches.size === 0) {
    return '';
  }
  const lines = ['', '--- ALREADY GATHERED THIS TURN (by the agent consulting you) ---'];
  if (ev.searches.size > 0) {
    lines.push('Searches already run — do not run these again:');
    for (const s of [...ev.searches.values()].slice(-HANDOFF_SEARCHES)) {
      lines.push(`- "${s.query}" → ${s.hits === 0 ? 'nothing' : s.numbers.map(n => `[${n}]`).join('')}`);
    }
  }
  if (ev.sources.size > 0) {
    lines.push('Sources already found (cite them by these numbers; look further only for what is missing):');
    for (const s of [...ev.sources.values()].slice(0, HANDOFF_SOURCES)) {
      lines.push(`- [${s.n}] ${s.title} (${s.source}${s.at ? `, ${s.at.slice(0, 10)}` : ''})`);
    }
    if (ev.sources.size > HANDOFF_SOURCES) {
      lines.push(`- and ${ev.sources.size - HANDOFF_SOURCES} more`);
    }
  }
  lines.push('Build on this: answer the task from it where it is enough, and search only for what it lacks.');
  return lines.join('\n');
}

/** The tool a lead consults a teammate through (deepagents' subagent tool). */
const CONSULT_TOOL = 'task';

/**
 * Hands a consult what the turn already has: the `task` call's description
 * gets the evidence block appended before the teammate starts.
 * @param ev - The turn's ledger.
 */
export function createEvidenceHandoffMiddleware(ev: TurnEvidence) {
  return createMiddleware({
    name: 'VocionEvidenceHandoff',
    wrapToolCall: async (request, handler) => {
      if (request.toolCall.name !== CONSULT_TOOL) {
        return handler(request);
      }
      const block = evidenceBlock(ev);
      const args = request.toolCall.args as { description?: unknown };
      if (!block || typeof args.description !== 'string') {
        return handler(request);
      }
      return handler({ ...request, toolCall: { ...request.toolCall, args: { ...args, description: `${args.description}\n${block}` } } });
    },
  });
}

/**
 * Whether a tool says its result can be reused within a turn: a read-only
 * lookup whose answer does not change in the seconds a turn takes. Declared by
 * the tool (`metadata: { turnMemo: true }`), never listed here.
 * @param tool - The tool being called.
 */
function memoisable(tool: unknown): boolean {
  return (tool as { metadata?: { turnMemo?: unknown } } | undefined)?.metadata?.turnMemo === true;
}

/**
 * Answers a repeated read-only lookup — same tool, same arguments, by the
 * lead or a teammate — from the turn's first result, saying so.
 * @param ev - The turn's ledger.
 */
export function createLookupMemoMiddleware(ev: TurnEvidence) {
  return createMiddleware({
    name: 'VocionLookupMemo',
    wrapToolCall: async (request, handler) => {
      if (!memoisable(request.tool)) {
        return handler(request);
      }
      const key = searchKey(request.toolCall.name, request.toolCall.args as Record<string, unknown>);
      const prior = ev.lookups.get(key);
      if (prior) {
        return new ToolMessage({
          content: `Already looked up this turn with the same arguments — the same result as before, repeated here; do not call it again:\n\n${prior.content}`,
          tool_call_id: request.toolCall.id ?? '',
          name: request.toolCall.name,
        });
      }
      const result = await handler(request);
      const content = (result as { content?: unknown }).content;
      if (typeof content === 'string' && !(result as { status?: string }).status?.startsWith('error')) {
        ev.lookups.set(key, { tool: request.toolCall.name, content });
      }
      return result;
    },
  });
}
