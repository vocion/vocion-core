/**
 * Agent-tools bridge — the domain tool registry over MCP.
 *
 * `services/agents/tools/registry.ts` is the single source of truth for the
 * domain tool surface (search_knowledge, typed CRM reads, freshen_source,
 * propose_action, discovery…). The in-process harness, the BYOA tool
 * endpoint, and the catalog serialization already consume it; this module is
 * the fourth consumer, so the source/grant gates inside `buildDomainTools`
 * apply here identically.
 *
 * Tools run AS AN AGENT: the ctx is rebuilt from a real `agent` row exactly
 * the way `toolEndpoint.ts` does (connectorSources, objectTypeSlugs,
 * searchConfig, harnessConfig from the row). The default
 * agent is `config.agentSlug` (env `VOCION_MCP_AGENT_SLUG`) or the org's
 * workspace lead; every bridged tool also accepts an optional `agent_slug`
 * to run as another agent, re-resolved and re-gated at call time.
 *
 * Identity: `ctx.userId` comes from the caller — `'mcp'` on stdio,
 * `token:<id>` over HTTP — never from tool input. The autonomy gate is
 * untouched: `propose_action` hardcodes an agent principal (autonomy 2), so
 * every external write still lands in the review queue regardless of the
 * bearer token's own grants.
 *
 * Cost note: building the module runs two indexed queries (project + agent
 * row). Over HTTP that is per request, matching the stateless transport.
 */

import type { StructuredToolInterface } from '@langchain/core/tools';
import type { McpConfig } from '../config';
import type { AgentEvent, RuntimeContext } from '@/services/agents/types';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '@/libs/DB';
import { agentSchema, projectSchema } from '@/models/Schema';
import { buildDomainTools } from '@/services/agents/tools/registry';

type ToolModule = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodRawShape;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
};

/**
 * Already served by `capability-tools.ts` under the same names (they are the
 * ctx-independent registry tools) — bridging them again would collide.
 */
const CAPABILITY_DUPLICATES = new Set([
  'web_search',
  'fetch_url',
  'crawl_site',
  'generate_image',
  'run_code',
  'create_artifact',
]);

/**
 * Tools whose only effect is `ctx.emit` into a live agent stream (or that
 * need a mission run). Over MCP there is no stream and no mission — they
 * would silently no-op, which reads as success. Excluded rather than lied
 * about; `propose_action` is the durable (review-queue) path and stays.
 */
const EMIT_ONLY = new Set([
  'request_human_review',
  'recommend_action',
  'update_mission_notes',
]);

type AgentRow = typeof agentSchema.$inferSelect;

async function loadAgentRow(orgId: string, slug: string): Promise<AgentRow | undefined> {
  const [row] = await db
    .select()
    .from(agentSchema)
    .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.slug, slug)));
  return row;
}

/**
 * Rebuild the exact RuntimeContext the harness would use for this agent —
 * fresh per call: the emit buffer and citation counter must never be shared
 * across concurrent tool calls.
 * @param orgId
 * @param row
 * @param userId
 * @param events
 */
function ctxFor(orgId: string, row: AgentRow, userId: string, events: AgentEvent[]): RuntimeContext {
  return {
    orgId,
    userId,
    citationSeq: { current: 0 },
    agentSlug: row.slug,
    connectorSources: row.connectorSources ?? [],
    objectTypeSlugs: row.objectTypeSlugs ?? [],
    searchConfig: (row.searchConfig as RuntimeContext['searchConfig']) ?? {},
    harnessConfig: row.harnessConfig ?? {},
    emit: e => events.push(e),
  };
}

function bridgeableTools(ctx: RuntimeContext): StructuredToolInterface[] {
  const excludeTools = new Set(ctx.harnessConfig.excludeTools ?? []);
  return buildDomainTools(ctx).filter(
    t => !excludeTools.has(t.name) && !CAPABILITY_DUPLICATES.has(t.name) && !EMIT_ONLY.has(t.name),
  );
}

/**
 * Registry tools return strings — usually pre-stringified JSON. The server
 * JSON.stringifies handler results, so pass parsed JSON through (or the
 * client would see double-encoded text) and leave prose as-is.
 * @param raw
 */
function unwrap(raw: unknown): unknown {
  if (typeof raw !== 'string') {
    return raw;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

const AGENT_SLUG_ARG = z
  .string()
  .optional()
  .describe('Run as this agent instead of the default — its sources, grants, and tool exclusions apply.');

/**
 * Bridge the domain tool registry into MCP tool modules for the configured
 * default agent. Returns `[]` when the org has no resolvable agent (fresh or
 * config-only installs still serve the base MCP surface).
 * @param config
 * @param identity
 * @param identity.userId
 */
export async function agentTools(
  config: McpConfig,
  identity?: { userId: string },
): Promise<ToolModule[]> {
  const userId = identity?.userId ?? 'mcp';

  let defaultSlug = config.agentSlug;
  if (!defaultSlug) {
    const [project] = await db
      .select({ leadAgentSlug: projectSchema.leadAgentSlug })
      .from(projectSchema)
      .where(eq(projectSchema.id, config.orgId));
    defaultSlug = project?.leadAgentSlug ?? undefined;
  }
  if (!defaultSlug) {
    return [];
  }

  const defaultRow = await loadAgentRow(config.orgId, defaultSlug);
  if (!defaultRow) {
    return [];
  }

  // Catalog ctx: names/descriptions/schemas only — real calls build a fresh
  // ctx (and events buffer) per invocation.
  const catalogCtx = ctxFor(config.orgId, defaultRow, userId, []);

  return bridgeableTools(catalogCtx).map((t) => {
    const baseShape
      = t.schema instanceof z.ZodObject ? (t.schema as z.ZodObject<z.ZodRawShape>).shape : {};
    const shape: z.ZodRawShape = { ...baseShape, agent_slug: AGENT_SLUG_ARG };

    return {
      name: t.name,
      title: t.name,
      description: `${t.description ?? ''}\n\nRuns as agent "${defaultRow.slug}" by default; pass agent_slug to run as another agent.`,
      inputSchema: shape,
      handler: async (input: Record<string, unknown>) => {
        const { agent_slug, ...rest } = input;
        const slug = typeof agent_slug === 'string' && agent_slug.trim() !== '' ? agent_slug.trim() : defaultRow.slug;
        const row = slug === defaultRow.slug ? defaultRow : await loadAgentRow(config.orgId, slug);
        if (!row) {
          throw new Error(`agent "${slug}" not found in this workspace`);
        }

        const events: AgentEvent[] = [];
        const ctx = ctxFor(config.orgId, row, userId, events);
        // Re-gate at call time: a different agent's sources/grants/exclusions
        // decide what IT can reach, not what the default agent could.
        const toolObj = bridgeableTools(ctx).find(candidate => candidate.name === t.name);
        if (!toolObj) {
          throw new Error(`tool "${t.name}" is not available for agent "${slug}"`);
        }

        const raw = await toolObj.invoke(rest as never);
        const output = unwrap(raw);
        return events.length > 0 ? { output, events } : output;
      },
    };
  });
}
