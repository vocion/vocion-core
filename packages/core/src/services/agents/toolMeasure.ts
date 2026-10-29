/**
 * The size of an agent's tool catalog, as the model receives it (ADR 0009).
 * Used by `scripts/measure-tools.ts` and by the CI test that holds the
 * catalog under its caps (`toolMeasure.test.ts`). Builds the tools from the
 * agent's configuration alone, with no database and no connector, so REST
 * and MCP tools (declared in the database) and deepagents' own few built-ins
 * are not counted.
 */
import type { ToolLoading, ToolLoadPlan } from './toolLoading';
import type { RuntimeContext } from './types';
import { CHARS_PER_TOKEN, planToolLoading, toolDefinitionChars } from './toolLoading';
import { expandGrants } from './tools/grantGroups';
import { buildDomainTools } from './tools/registry';
import { canonicalToolNames } from './tools/toolAliases';
import { namedInPrompt } from './toolTiers';

export type CatalogAgent = {
  slug: string;
  systemPrompt?: string | null;
  connectorSources: string[];
  grantTools: string[];
  enabledPlugins: string[];
  /** History mode's hot set, when known. */
  history?: string[] | null;
};

/**
 * The context an agent's tools are built on, from its configuration alone.
 * @param agent - The agent.
 */
export function catalogContext(agent: CatalogAgent): RuntimeContext {
  return {
    orgId: 'org_tool_catalog',
    agentSlug: agent.slug,
    connectorSources: agent.connectorSources,
    objectTypeSlugs: [],
    enabledPlugins: agent.enabledPlugins,
    workspaceKind: 'shared',
    filingTypes: [],
    restSources: [],
    mcpSources: [],
    sourceKinds: {},
    searchConfig: {},
    harnessConfig: { grantTools: agent.grantTools },
    defaultTimeZone: 'America/Los_Angeles',
    timeZone: 'America/Los_Angeles',
    emit: () => {},
    userId: 'catalog',
    conversationId: 0,
    citationSeq: { current: 0 },
    delegations: new Map(),
  } as unknown as RuntimeContext;
}

export type CatalogReport = {
  slug: string;
  tools: number;
  chars: number;
  tokens: number;
  /** Largest descriptions first. */
  largest: Array<{ name: string; descriptionChars: number; chars: number }>;
  modes: Record<ToolLoading, Pick<ToolLoadPlan, 'loaded' | 'deferred' | 'loadedChars' | 'overBudget'> & { families: string[] }>;
};

/**
 * Measure one agent's catalog, and what each loading mode would load.
 * @param agent - The agent.
 */
export function measureCatalog(agent: CatalogAgent): CatalogReport {
  const tools = buildDomainTools(catalogContext(agent));
  const names = tools.map(t => t.name);
  const sized = tools.map(t => ({ name: t.name, descriptionChars: (t.description ?? '').length, chars: toolDefinitionChars(t) }));
  const chars = sized.reduce((n, t) => n + t.chars, 0);
  const plan = (mode: ToolLoading) => {
    const p = planToolLoading({
      mode,
      tools,
      hot: agent.history ?? null,
      grants: canonicalToolNames(expandGrants(agent.grantTools)),
      named: canonicalToolNames(namedInPrompt(agent.systemPrompt, names)),
    });
    return { loaded: p.loaded, deferred: p.deferred, loadedChars: p.loadedChars, overBudget: p.overBudget, families: p.searchable.map(s => s.family) };
  };
  return {
    slug: agent.slug,
    tools: tools.length,
    chars,
    tokens: Math.round(chars / CHARS_PER_TOKEN),
    largest: [...sized].sort((a, b) => b.descriptionChars - a.descriptionChars).slice(0, 15),
    modes: { history: plan('history'), core: plan('core'), all: plan('all') },
  };
}
