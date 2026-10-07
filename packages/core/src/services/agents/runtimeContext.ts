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
    emit: opts.emit ?? (() => {}),
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
