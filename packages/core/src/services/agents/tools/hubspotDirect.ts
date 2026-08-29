/**
 * Shared plumbing for the DIRECT-to-HubSpot tools (`hubspot_get_*`,
 * `hubspot_search_*`, `hubspot_list_*`, `hubspot_company_*`,
 * `hubspot_contact_emails`). These call the live API, never the mirror or
 * semantic search — the mirror keeps what it does better (exact counts,
 * facet breakdowns, sums) behind the `hubspot_count_*` tools in `crm.ts`.
 *
 * Access boundary: built only for agents whose `connectorSources` include a
 * hubspot source, AND (when a per-user ACL is set) only when that ACL also
 * permits a hubspot source. Credentials come from the source's vault entry
 * via `firstCredentialed`, exactly like the gmail/zoom live tools.
 *
 * Failures are data (see `libs/hubspot/client.ts`): no vaulted credential →
 * `no_hubspot_credentials`; a 403 → `missing_scope` naming the scope to
 * enable; anything else → `hubspot_error`.
 */

import type { RuntimeContext } from '../types';
import type { HubspotClient, HubspotFailure } from '@/libs/hubspot/client';
import { and, eq, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { createHubspotClient, noHubspotCredentials, tokenFromCredentials } from '@/libs/hubspot/client';
import { knowledgeSourceSchema } from '@/models/Schema';
import { getCredentialsForSource } from '@/services/SourceCredentialService';
import { hasHubspotSource } from './crm';

/** A source slug that belongs to the HubSpot connector family. */
const HUBSPOT_SLUG = /^hubspot(?:$|-)/;

/**
 * Presence gate for the direct tools: the agent must have a hubspot source in
 * scope, and a per-user ACL (when set) must also allow one.
 * @param ctx
 */
export function hubspotDirectInScope(ctx: RuntimeContext): boolean {
  if (!hasHubspotSource(ctx)) {
    return false;
  }
  if (ctx.allowedSourceSlugs) {
    return ctx.allowedSourceSlugs.some(s => HUBSPOT_SLUG.test(s));
  }
  return true;
}

export type HubspotSourceRow = {
  id: number;
  slug: string;
  configJson: Record<string, unknown> | null;
};

/**
 * Every hubspot-family source in the org, with its config.
 * @param orgId
 */
export async function hubspotSourcesForOrg(orgId: string): Promise<HubspotSourceRow[]> {
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
        sql`${knowledgeSourceSchema.slug} ~ '^hubspot(-|$)'`,
        sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'hubspot'`,
      ),
    ));
}

export type CtxClient = {
  ok: true;
  client: HubspotClient;
  /** The source whose vault credential the client runs on. */
  sourceSlug: string;
  /** All hubspot-family sources (for config like stallThresholds). */
  sources: HubspotSourceRow[];
};

/**
 * Resolve a live HubSpot client for this org from the first credentialed
 * hubspot source. `{ok:false}` results are returned to the model verbatim.
 * @param ctx
 */
export async function hubspotClientForCtx(ctx: RuntimeContext): Promise<CtxClient | HubspotFailure> {
  const sources = await hubspotSourcesForOrg(ctx.orgId);
  if (sources.length === 0) {
    return noHubspotCredentials('No HubSpot source is connected in this workspace, so live HubSpot reads are unavailable. Say that rather than guessing.');
  }
  for (const source of sources) {
    const credentials = await getCredentialsForSource(ctx.orgId, source.slug);
    const token = tokenFromCredentials(credentials as Record<string, unknown> | undefined);
    if (token) {
      const baseUrl = typeof source.configJson?.baseUrl === 'string' ? source.configJson.baseUrl : undefined;
      return { ok: true, client: createHubspotClient({ token, baseUrl }), sourceSlug: source.slug, sources };
    }
  }
  return noHubspotCredentials();
}

/**
 * Serialize any tool payload the way every domain tool does.
 * @param payload
 */
export function asJson(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * The query's alphanumeric tokens, longest first — the longest token is the
 * most distinctive ("Corporation" over "the"), used to broaden a missed
 * multi-word search once before concluding nothing exists.
 * @param query
 */
export function distinctiveTokens(query: string): string[] {
  return query
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

/**
 * Clamp a limit argument into [1, max] with a default.
 * @param raw
 * @param fallback
 * @param max
 */
export function clampLimit(raw: number | undefined, fallback: number, max: number): number {
  const n = Number.isFinite(raw) ? Math.trunc(raw!) : fallback;
  return Math.max(1, Math.min(n || fallback, max));
}
