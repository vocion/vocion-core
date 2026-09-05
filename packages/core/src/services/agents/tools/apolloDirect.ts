/**
 * Shared plumbing for the Apollo tools — the gate, the client resolver, and
 * the description suffixes every Apollo tool ends with.
 *
 * Access boundary: built only for agents whose `connectorSources` include an
 * apollo source, AND (when a per-user ACL is set) only when that ACL also
 * permits one. An agent without the source has no Apollo tool to hallucinate a
 * call to, which is also what keeps this whole ticket invisible until the
 * workspace grants it.
 *
 * Failures are data (see `libs/apollo/client.ts`): no vaulted key →
 * `no_apollo_credentials` naming the Sources-page fix; a closed plan tier →
 * `plan_tier_unavailable`; a 429 → `apollo_rate_limited` carrying the wait.
 * Nothing throws into an agent turn.
 */

import type { RuntimeContext } from '../types';
import type { ApolloClient, ApolloFailure } from '@/libs/apollo/client';
import { and, eq, or, sql } from 'drizzle-orm';
import { createApolloClient, keyFromCredentials, noApolloCredentials } from '@/libs/apollo/client';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';
import { getCredentialsForSource } from '@/services/SourceCredentialService';

/** A source slug that belongs to the Apollo connector family. */
const APOLLO_SLUG = /^apollo(?:$|-)/;

/**
 * The routing line every Apollo tool carries. Two systems answer two different
 * questions, and an agent holding both needs to know which is which BEFORE it
 * spends a credit finding out.
 */
export const APOLLO_ROUTING = 'Routing: Apollo is prospecting and enrichment on people we do NOT yet have; HubSpot is the record system for people we DO. Counting our own CRM goes to the hubspot_count_* tools, never here. A prospect worth keeping is handed to HubSpot as a separate, deliberate step.';

/**
 * The spend warning every credit-consuming Apollo tool carries. Search and
 * enrich are two deliberate steps precisely because the first is free and the
 * second is not.
 */
export const APOLLO_CREDITS = 'CREDITS: this call spends Apollo credits, and the response says how many it just spent. Search first (free), let a human pick the shortlist, and only then enrich — never enrich a whole search result set to see what is in it.';

/**
 * An empty result proves the filter matched nothing, never that the person or
 * company does not exist. Carried into every list and search tool.
 */
export const APOLLO_ABSENCE = 'A roster proves presence, never absence: an empty result means nothing matched THIS query, not that nobody exists. Say which.';

/**
 * Whether the agent has an apollo source in scope, and a per-user ACL (when
 * set) allows one.
 * @param ctx - The agent runtime context.
 */
export function apolloInScope(ctx: RuntimeContext): boolean {
  if (!ctx.connectorSources.some(slug => APOLLO_SLUG.test(slug))) {
    return false;
  }
  if (ctx.allowedSourceSlugs) {
    return ctx.allowedSourceSlugs.some(slug => APOLLO_SLUG.test(slug));
  }
  return true;
}

export type ApolloSourceRow = {
  id: number;
  slug: string;
  configJson: Record<string, unknown> | null;
};

/**
 * Every apollo-family source in the org, with its config.
 * @param orgId - The workspace to look in.
 */
export async function apolloSourcesForOrg(orgId: string): Promise<ApolloSourceRow[]> {
  return db
    .select({
      id: knowledgeSourceSchema.id,
      slug: knowledgeSourceSchema.slug,
      configJson: knowledgeSourceSchema.configJson,
    })
    .from(knowledgeSourceSchema)
    .where(and(
      eq(knowledgeSourceSchema.orgId, orgId),
      or(
        sql`${knowledgeSourceSchema.slug} ~ '^apollo(-|$)'`,
        sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'apollo'`,
      ),
    ));
}

export type ApolloCtxClient = {
  ok: true;
  client: ApolloClient;
  /** The source whose vault credential the client runs on. */
  sourceSlug: string;
};

/**
 * Resolve a live Apollo client for this agent's org from the first credentialed
 * apollo source. `{ok:false}` results go back to the model verbatim.
 * @param ctx - The agent runtime context.
 */
export async function apolloClientForCtx(ctx: RuntimeContext): Promise<ApolloCtxClient | ApolloFailure> {
  const sources = await apolloSourcesForOrg(ctx.orgId);
  if (sources.length === 0) {
    return noApolloCredentials('No Apollo source is connected in this workspace, so live Apollo reads are unavailable. Say that rather than guessing.');
  }
  for (const source of sources) {
    const credentials = await getCredentialsForSource(ctx.orgId, source.slug);
    const apiKey = keyFromCredentials(credentials as Record<string, unknown> | undefined);
    if (apiKey) {
      const baseUrl = typeof source.configJson?.baseUrl === 'string' ? source.configJson.baseUrl : undefined;
      return {
        ok: true,
        client: createApolloClient({ apiKey, baseUrl, orgId: ctx.orgId }),
        sourceSlug: source.slug,
      };
    }
  }
  return noApolloCredentials();
}

/**
 * Whether a tool name is granted to this agent. The two list WRITES need this
 * on top of the source gate: a list can feed one of the client's live Apollo
 * cadences, so adding to one can indirectly start outreach.
 * @param ctx - The agent runtime context.
 * @param toolName - The tool being built.
 */
export function apolloWriteGranted(ctx: RuntimeContext, toolName: string): boolean {
  return new Set(ctx.harnessConfig.grantTools ?? []).has(toolName);
}
