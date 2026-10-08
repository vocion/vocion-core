/**
 * The tool catalog of ONE workspace — what its agents can actually reach.
 *
 * `BUILTIN_TOOLS` (`./catalog.ts`) is the static six. Everything else an agent
 * holds is decided per agent by `buildToolCatalog(ctx)`
 * (`services/agents/tools/registry.ts`): the typed filing tools of its object
 * types, the HubSpot / Apollo / Gmail / Calendar / Zoom / PostHog families its
 * sources unlock, the live reads of every `rest` source it holds, the grants.
 * The Tools page used to render the static six alone, so a workspace that
 * had just connected a REST API with sixty tools saw nothing there.
 *
 * This module builds the union across the workspace's agents through the same
 * context builder every loop uses (`services/agents/runtimeContext.ts`), so
 * the page and the model can never disagree about what a tool is called or
 * who holds it — one shape, used everywhere (design principle 6). Each tool
 * remembers the agents that hold it and the FAMILY it comes from; each family
 * carries its readiness (a vaulted credential for a source, the provider key
 * for a paid built-in) so the page says "connect it" rather than listing a
 * tool that would refuse every call.
 */

import type { InputSchema } from '@/libs/rest/jsonSchema';
import type { RestSourceSpec } from '@/libs/rest/spec';
import type { CapabilityStatus } from '@/libs/tools/types';
import type { AgentContextRow } from '@/services/agents/runtimeContext';
import type { ToolCatalogEntry } from '@/services/agents/tools/registry';
import { eq } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { platformForToolProvider } from '@/libs/platforms/registry';
import { loadRestSources } from '@/libs/rest/sources';
import { endpointDescription, REST_LIST_ACTIONS_TOOL, restToolName, toolPrefixFor } from '@/libs/rest/spec';
import { getConnector, listConnectors } from '@/libs/sources/registry';
import { sourceNameOf } from '@/libs/sources/upsert';
import { agentSchema, knowledgeSourceSchema } from '@/models/Schema';
import { agentScope, runtimeContextFromScope, workspaceScope } from '@/services/agents/runtimeContext';
import { buildToolCatalog } from '@/services/agents/tools/registry';
import { credentialStatusForOrg } from '@/services/SourceCredentialService';
import { BUILTIN_TOOLS, capabilityStatuses } from './catalog';

/** Where a tool comes from. */
export type ToolFamilyKind = 'builtin' | 'records' | 'hubspot' | 'apollo' | 'gmail' | 'calendar' | 'microsoft' | 'zoom' | 'posthog' | 'rest' | 'workspace';

/** Whether the tools of a family (or one paid built-in) can run right now. */
export type ToolReadiness = {
  ready: boolean;
  /** The credential store could not say what the workspace holds — say so, never "needs key". */
  keyStateUnknown: boolean;
};

/** One agent, as the catalog names it. */
export type CatalogAgent = { slug: string; name: string };

/** One source of the workspace that backs a family. */
export type CatalogSource = { id: number; slug: string; name: string };

/** A live REST read: the endpoint behind a `<prefix>_<name>` tool. */
export type RestToolFacts = {
  sourceSlug: string;
  sourceName: string;
  method: string;
  path: string;
  /** Query parameter → template. */
  query: Record<string, string>;
  input: InputSchema;
  /** Dotted path picked out of the response, when the endpoint declares one. */
  pick?: string;
};

export type CatalogTool = {
  name: string;
  /** Human title: the built-in's own, else the name humanised. */
  title: string;
  description: string;
  familyId: string;
  /** Slugs of the agents whose tool set includes this tool, in registry order. */
  agents: string[];
  /** The tool's arguments as JSON Schema, as the model sees them. */
  inputSchema: Record<string, unknown>;
  /** Set for the six built-ins: the provider/key status the catalog already reported. */
  status?: CapabilityStatus;
  /**
   * The brand of the paid provider behind a built-in (`libs/brands/catalog.ts`),
   * read off the provider's credential platform; absent when the provider has
   * none (the built-in page reader, a search the model does itself).
   */
  providerBrand?: string;
  /** Set for a REST source's read tools. */
  rest?: RestToolFacts;
};

/** A write an agent may propose against a REST source through `rest.request`. */
export type RestActionEntry = {
  name: string;
  description: string;
  method: string;
  path: string;
  input: InputSchema;
  reversible: boolean;
  sourceSlug: string;
};

export type ToolFamily = {
  /** `builtin`, `records`, a source family's kind, `rest:<source slug>` or `workspace`. */
  id: string;
  kind: ToolFamilyKind;
  label: string;
  /** The brand of the connector behind a source family (`libs/brands/catalog.ts`); absent for the rest. */
  brand?: string;
  description: string;
  /** The workspace sources behind a source-gated family; empty for the rest. */
  sources: CatalogSource[];
  /** Null when readiness is not a question for this family (records, the workspace's own tools). */
  readiness: ToolReadiness | null;
  tools: CatalogTool[];
  /** REST only: the writes reachable through `rest.request`. */
  actions: RestActionEntry[];
};

export type OrgToolCatalog = {
  /** Built-ins first, then records, then each connected source, the workspace's own tools last. */
  families: ToolFamily[];
  agents: CatalogAgent[];
  /** Provider/key readiness of the paid built-ins, when the caller asked for it. */
  statuses: CapabilityStatus[];
};

/** How a source family recognises its sources (by slug) and its tools (by name). */
type SourceFamilyRule = {
  kind: Exclude<ToolFamilyKind, 'builtin' | 'records' | 'rest' | 'workspace'>;
  label: string;
  description: string;
  connectorSlug: string;
  source: RegExp;
  tool: RegExp;
};

/**
 * The source-gated families, in the order the page shows them. The slug
 * tests mirror the gates in `services/agents/tools/*` (`HUBSPOT_SLUG` and
 * friends); the tool tests mirror the names those modules register.
 */
const SOURCE_FAMILIES: SourceFamilyRule[] = [
  { kind: 'hubspot', label: 'HubSpot', description: 'Live CRM reads — contacts, companies, deals, properties, lists — for agents holding a HubSpot source.', connectorSlug: 'hubspot', source: /^hubspot(?:$|-)/, tool: /^hubspot_/ },
  { kind: 'apollo', label: 'Apollo', description: 'Live prospecting and enrichment for agents holding an Apollo source.', connectorSlug: 'apollo', source: /^apollo(?:$|-)/, tool: /^apollo_/ },
  { kind: 'gmail', label: 'Gmail', description: 'Email threads, read through the Gmail source.', connectorSlug: 'gmail', source: /^gmail(?:$|-)/, tool: /^get_gmail_/ },
  { kind: 'calendar', label: 'Calendar', description: 'Events on the connected Google or Outlook calendar.', connectorSlug: 'google-calendar', source: /^(?:google|outlook)-calendar(?:$|-)/, tool: /^calendar_/ },
  { kind: 'microsoft', label: 'Microsoft 365', description: 'Live Outlook mail, Teams channels and chats, and OneDrive and SharePoint files, through the workspace\'s Microsoft login.', connectorSlug: 'outlook-mail', source: /^(?:outlook-mail|microsoft-teams|sharepoint|onedrive)(?:$|-)/, tool: /^(?:outlook_|get_outlook_|msteams_|microsoft_)/ },
  { kind: 'zoom', label: 'Zoom', description: 'Recordings and transcripts of the workspace\'s Zoom calls.', connectorSlug: 'zoom', source: /^zoom(?:$|-)/, tool: /^(?:get_zoom_|find_zoom_)/ },
  { kind: 'posthog', label: 'PostHog', description: 'Daily event counts from the PostHog mirror.', connectorSlug: 'posthog', source: /^posthog(?:$|-)/, tool: /^posthog_/ },
];

/**
 * A family's `brand`, from its connector: spread into the family, so a
 * connector that is not one vendor leaves the key out.
 * @param connectorSlug - The connector behind the family.
 */
function brandOf(connectorSlug: string): { brand?: string } {
  const brand = getConnector(connectorSlug)?.brand;
  return brand ? { brand } : {};
}

/**
 * `list_projects` → "List projects"; `file_request` → "File request".
 * @param name - A snake_case tool name.
 */
export function toolTitle(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/** One tool of the union: the first entry seen, and every agent that holds it. */
type UnionEntry = { entry: ToolCatalogEntry; agents: string[] };

/**
 * The union of every agent's tool surface, keyed by tool name, remembering
 * who holds each. The order is the registry's, from the first agent that
 * holds a tool, so the page reads the way the model's tool list does.
 * @param orgId - The workspace.
 * @param agents - Its agents.
 * @returns The union, plus the names of the typed filing tools seen.
 */
async function toolUnion(orgId: string, agents: AgentContextRow[]): Promise<{ union: Map<string, UnionEntry>; filingToolNames: Set<string> }> {
  const union = new Map<string, UnionEntry>();
  const filingToolNames = new Set<string>();
  if (agents.length === 0) {
    return { union, filingToolNames };
  }
  const workspace = await workspaceScope(orgId);
  for (const row of agents) {
    const scope = await agentScope(orgId, row, workspace);
    for (const type of scope.filingTypes ?? []) {
      filingToolNames.add(type.toolName);
    }
    for (const entry of buildToolCatalog(runtimeContextFromScope(orgId, row, scope))) {
      const seen = union.get(entry.name);
      if (seen) {
        seen.agents.push(row.slug);
      } else {
        union.set(entry.name, { entry, agents: [row.slug] });
      }
    }
  }
  return { union, filingToolNames };
}

/**
 * Whether each source of the workspace has a credential it can spend —
 * without decrypting anything (`credentialStatusForOrg`). A connector that
 * needs no credential is always connected. `null` when the store would not
 * answer, so a family says it could not check rather than "needs key".
 * @param orgId - The workspace.
 * @param sources - Its source rows.
 */
async function sourceConnections(orgId: string, sources: Array<{ id: number; slug: string; configJson: Record<string, unknown> | null }>): Promise<Map<number, boolean> | null> {
  const authKind = new Map(listConnectors().map(c => [c.slug, c.authKind]));
  let status: Awaited<ReturnType<typeof credentialStatusForOrg>>;
  try {
    status = await credentialStatusForOrg(orgId);
  } catch {
    return null;
  }
  const out = new Map<number, boolean>();
  for (const source of sources) {
    const connectorSlug = (source.configJson?._connector as string | undefined) ?? source.slug;
    if (authKind.get(connectorSlug) === 'none') {
      out.set(source.id, true);
      continue;
    }
    const st = status.bySourceId[source.id] ?? status.byConnectorSlug[connectorSlug];
    out.set(source.id, st?.connected ?? false);
  }
  return out;
}

/**
 * The readiness of a family backed by `sources`: ready when any of them is
 * connected; unknown when the store would not say.
 * @param sources - The family's sources.
 * @param connections - Per-source connection, or null when unknown.
 */
function familyReadiness(sources: CatalogSource[], connections: Map<number, boolean> | null): ToolReadiness {
  if (connections === null) {
    return { ready: false, keyStateUnknown: true };
  }
  return { ready: sources.some(s => connections.get(s.id) === true), keyStateUnknown: false };
}

/**
 * A REST source as a family: its declared reads (held or not), the
 * `list_actions` catalog tool, and its writes.
 * @param spec - The source.
 * @param union - The workspace's tool union, for who holds each read.
 * @param readiness - Whether the source has a vaulted credential.
 */
function restFamily(spec: RestSourceSpec, union: Map<string, UnionEntry>, readiness: ToolReadiness): ToolFamily {
  const prefix = toolPrefixFor(spec.slug, spec.config);
  const id = `rest:${spec.slug}`;
  const tools: CatalogTool[] = spec.config.tools.map((endpoint) => {
    const name = restToolName(prefix, endpoint.name);
    const held = union.get(name);
    return {
      name,
      title: toolTitle(endpoint.name),
      description: endpointDescription(endpoint),
      familyId: id,
      agents: held?.agents ?? [],
      inputSchema: held?.entry.inputSchema ?? (endpoint.input as unknown as Record<string, unknown>),
      rest: {
        sourceSlug: spec.slug,
        sourceName: spec.name,
        method: endpoint.method,
        path: endpoint.path,
        query: endpoint.query,
        input: endpoint.input,
        pick: endpoint.response.pick,
      },
    };
  });
  const listActions = restToolName(prefix, REST_LIST_ACTIONS_TOOL);
  const heldList = union.get(listActions);
  tools.push({
    name: listActions,
    title: 'List actions',
    description: `The writes an agent may propose against ${spec.name} through the rest.request action — name, what each does, its input and whether it can be undone.`,
    familyId: id,
    agents: heldList?.agents ?? [],
    inputSchema: heldList?.entry.inputSchema ?? { type: 'object', properties: {} },
  });
  return {
    id,
    kind: 'rest',
    label: spec.name,
    description: `Live reads of ${spec.name}, called at the moment of the question, for every agent holding the ${spec.slug} source. Writes go through rest.request and the review queue.`,
    sources: [{ id: spec.id, slug: spec.slug, name: spec.name }],
    readiness,
    tools,
    actions: spec.config.actions.map(action => ({
      name: action.name,
      description: endpointDescription(action),
      method: action.method,
      path: action.path,
      input: action.input,
      reversible: action.reversible,
      sourceSlug: spec.slug,
    })),
  };
}

/**
 * The workspace's tool catalog: built-ins, typed filing tools, each source
 * family the workspace has connected, every REST source, and the tools every
 * agent has on the workspace itself — each tool with the agents that hold it.
 *
 * Never throws for a workspace with no agents or no sources: the built-ins
 * are listed with nobody holding them, and a REST source nobody holds is
 * listed so a person can see what wiring it to an agent would give.
 * @param orgId - The workspace.
 * @param opts - `withStatuses: false` skips the paid built-ins' provider/key
 * check, which decrypts the workspace's keys — a page about one REST tool has
 * no use for it.
 * @param opts.withStatuses - See above; default true.
 */
export async function toolCatalogForOrg(orgId: string, opts: { withStatuses?: boolean } = {}): Promise<OrgToolCatalog> {
  const agentRows = await db
    .select({ slug: agentSchema.slug, name: agentSchema.name, connectorSources: agentSchema.connectorSources, objectTypeSlugs: agentSchema.objectTypeSlugs, searchConfig: agentSchema.searchConfig, harnessConfig: agentSchema.harnessConfig })
    .from(agentSchema)
    .where(eq(agentSchema.orgId, orgId))
    .orderBy(agentSchema.id);
  const [{ union, filingToolNames }, restSpecs, sourceRows, statuses] = await Promise.all([
    toolUnion(orgId, agentRows),
    loadRestSources(orgId).catch(() => [] as RestSourceSpec[]),
    db
      .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, configJson: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.orgId, orgId))
      .orderBy(knowledgeSourceSchema.id),
    opts.withStatuses === false ? Promise.resolve([] as CapabilityStatus[]) : capabilityStatuses(orgId),
  ]);
  const connections = await sourceConnections(orgId, sourceRows);
  const statusByCapability = new Map(statuses.map(s => [s.capability, s]));
  const claimed = new Set<string>();

  const toolOf = (name: string, familyId: string, held: UnionEntry | undefined, extra: Partial<CatalogTool> = {}): CatalogTool => {
    claimed.add(name);
    return {
      name,
      title: toolTitle(name),
      description: held?.entry.description ?? '',
      familyId,
      agents: held?.agents ?? [],
      inputSchema: held?.entry.inputSchema ?? { type: 'object', properties: {} },
      ...extra,
    };
  };

  // Built-ins: the static six, in their own order, whoever holds them.
  const builtin: ToolFamily = {
    id: 'builtin',
    kind: 'builtin',
    label: 'Built-in',
    description: 'Capabilities every agent can use out of the box — live web search, browsing, image generation, calculation and artifacts. Paid providers run on this workspace\'s own key when it has stored one, and on the Vocion server key otherwise.',
    sources: [],
    readiness: null,
    tools: BUILTIN_TOOLS.map((tool) => {
      const status = statusByCapability.get(tool.capability);
      const providerBrand = status ? platformForToolProvider(status.provider)?.brand : undefined;
      return toolOf(tool.name, 'builtin', union.get(tool.name), { title: tool.title, description: tool.description, ...(status ? { status } : {}), ...(providerBrand ? { providerBrand } : {}) });
    }),
    actions: [],
  };

  // Records: one typed filing tool per opted-in type an agent works with.
  const recordTools = [...union.values()].filter(u => filingToolNames.has(u.entry.name)).map(u => toolOf(u.entry.name, 'records', u));
  const records: ToolFamily | null = recordTools.length > 0
    ? {
        id: 'records',
        kind: 'records',
        label: 'Records',
        description: 'One typed filing tool per object type that opts in (`file_<type>`): the arguments are the record\'s own fields, and the filing rides the review queue like every other write.',
        sources: [],
        readiness: null,
        tools: recordTools,
        actions: [],
      }
    : null;

  // Source-gated families: present when the workspace has such a source, or
  // an agent holds such a tool (a source added by hand under another slug).
  const sourceFamilies: ToolFamily[] = [];
  for (const rule of SOURCE_FAMILIES) {
    const sources = sourceRows
      .filter(s => rule.source.test(s.slug) || s.configJson?._connector === rule.connectorSlug)
      .map(s => ({ id: s.id, slug: s.slug, name: sourceNameOf(s.configJson ?? undefined, s.slug) }));
    const tools = [...union.values()].filter(u => rule.tool.test(u.entry.name)).map(u => toolOf(u.entry.name, rule.kind, u));
    if (sources.length === 0 && tools.length === 0) {
      continue;
    }
    sourceFamilies.push({
      id: rule.kind,
      kind: rule.kind,
      label: rule.label,
      ...brandOf(rule.connectorSlug),
      description: rule.description,
      sources,
      readiness: familyReadiness(sources, connections),
      tools,
      actions: [],
    });
  }

  // REST: one family per source, whoever holds it.
  const restFamilies = restSpecs.map((spec) => {
    const family = restFamily(spec, union, familyReadiness([{ id: spec.id, slug: spec.slug, name: spec.name }], connections));
    for (const tool of family.tools) {
      claimed.add(tool.name);
    }
    return family;
  });

  // Everything else an agent holds: the workspace's own tools — search,
  // records, artifacts, asks, learning, briefings — shown last, compactly.
  const workspaceTools = [...union.values()].filter(u => !claimed.has(u.entry.name)).map(u => toolOf(u.entry.name, 'workspace', u));
  const workspace: ToolFamily | null = workspaceTools.length > 0
    ? {
        id: 'workspace',
        kind: 'workspace',
        label: 'Workspace',
        description: 'What every agent has on the workspace itself — search, records, artifacts, asks, learning, briefings — plus the tools only some agents are granted.',
        sources: [],
        readiness: null,
        tools: workspaceTools,
        actions: [],
      }
    : null;

  return {
    families: [builtin, ...(records ? [records] : []), ...sourceFamilies, ...restFamilies, ...(workspace ? [workspace] : [])],
    agents: agentRows.map(a => ({ slug: a.slug, name: a.name })),
    statuses,
  };
}

/**
 * One tool of the catalog by name, with its family, or null.
 * @param catalog - A workspace's catalog.
 * @param name - The tool name, as the URL carries it.
 */
export function catalogToolByName(catalog: OrgToolCatalog, name: string): { tool: CatalogTool; family: ToolFamily } | null {
  for (const family of catalog.families) {
    const tool = family.tools.find(t => t.name === name);
    if (tool) {
      return { tool, family };
    }
  }
  return null;
}
