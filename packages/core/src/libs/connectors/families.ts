/**
 * CONNECTOR FAMILIES — the kinds of system agents talk to, named for what
 * they are rather than for who sells them. The first three are the ones a
 * software factory talks to; `finance` and `people` are a business's books
 * and its HR system of record.
 *
 * A `repo` is a code host: pull requests, checks, pipeline runs, reviews.
 * A `tracker` is an issue tracker: issues, status transitions, comments,
 * attachments. A `chat` is where people talk: channels, threads, messages,
 * reactions, files. GitHub, Jira and Slack are the first provider of each;
 * Bitbucket, Azure DevOps, GitLab, Linear and Teams are later providers of
 * the same families, and nothing an agent is told names a vendor: its tools
 * are `repo_read_pull`, `tracker_read_issue`, `chat_read_thread`, and the
 * source a workspace connected decides which provider answers.
 *
 * Three more families read a business's numbers the same way: a `warehouse`
 * (Snowflake, BigQuery, Databricks, Redshift) answers one read-only SQL tool,
 * `analytics` (Mixpanel, Amplitude) answers events, funnels and cohorts, and
 * `ads` (LinkedIn Ads, Meta Ads) answers campaigns and what they spent.
 *
 * A `crm` is where a sales team keeps its accounts, contacts and deals, and
 * the activity on them (Salesforce, Pipedrive, Attio: `crm_get_record`,
 * `crm.update_record`). A `meetings` recorder keeps calls and what was said
 * on them (Gong, Fireflies, Google Meet: `meeting_read_transcript`). HubSpot
 * and Zoom predate the families and keep their own tools for now.
 *
 * The family of a source is read off its connector kind
 * (`knowledge_source.kind`, or `config._connector` for a source cloned from a
 * connector pack). An agent reaches a family when one of its
 * `connectorSources` is of that family, and the per-user source ACL
 * (`allowedSourceSlugs`) narrows it the way every source-gated tool is
 * narrowed (`apolloInScope`).
 */

import type { RuntimeContext } from '@/services/agents/types';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { knowledgeSourceSchema } from '@/models/Schema';

export type ConnectorFamily = 'repo' | 'tracker' | 'chat' | 'finance' | 'people' | 'warehouse' | 'analytics' | 'ads' | 'crm' | 'meetings';

/**
 * The connector kinds that belong to each family, first provider first.
 *
 * `finance` is where a business keeps its money: billing (Stripe), the books
 * (QuickBooks, Xero, NetSuite), spend (Ramp) and payables (BILL) — customers,
 * vendors, invoices, bills, payments, read through `finance_list` and
 * `finance_get`. `people` is the HR system of record (Gusto, Rippling,
 * Workday) — workers, departments, time off and pay-run totals, read through
 * `people_list` and `people_get`, with personal identifiers never returned.
 */
export const FAMILY_KINDS: Record<ConnectorFamily, readonly string[]> = {
  repo: ['github'],
  tracker: ['jira'],
  chat: ['slack'],
  finance: ['stripe', 'quickbooks', 'xero', 'netsuite', 'ramp', 'bill'],
  people: ['gusto', 'rippling', 'workday'],
  // A SQL warehouse, read with one query tool and one schema browser whatever
  // the vendor (`services/warehouse/provider.ts`).
  warehouse: ['snowflake', 'bigquery', 'databricks', 'redshift'],
  // Product analytics — events, funnels, cohorts (`services/productAnalytics/provider.ts`).
  analytics: ['mixpanel', 'amplitude'],
  // An ad platform: campaigns, ad sets and what they spent (`services/ads/provider.ts`).
  ads: ['linkedin-ads', 'meta-ads'],
  crm: ['salesforce', 'pipedrive', 'attio'],
  meetings: ['gong', 'fireflies', 'google-meet'],
};

/** How each family and its constructs are named to a person. */
export const FAMILY_LABEL: Record<ConnectorFamily, string> = {
  repo: 'code host',
  tracker: 'issue tracker',
  chat: 'chat',
  finance: 'finance system',
  people: 'HR system',
  warehouse: 'data warehouse',
  analytics: 'product analytics',
  ads: 'ad platform',
  crm: 'CRM',
  meetings: 'meeting recorder',
};

/**
 * The family a connector kind belongs to, or null for a kind in no family.
 * @param kind - A connector kind (`github`, `jira`, `slack`, `hubspot`…).
 */
export function familyOfKind(kind: string | null | undefined): ConnectorFamily | null {
  if (!kind) {
    return null;
  }
  for (const family of Object.keys(FAMILY_KINDS) as ConnectorFamily[]) {
    if (FAMILY_KINDS[family].includes(kind)) {
      return family;
    }
  }
  return null;
}

type ScopeCtx = Pick<RuntimeContext, 'connectorSources' | 'allowedSourceSlugs' | 'sourceKinds'>;

/**
 * The connector kind of a source the agent names, as the context recorded it
 * at graph build; a context built before kinds were recorded reads the slug
 * as the kind, which is how every workspace names its first source of a kind.
 * @param ctx - The turn.
 * @param slug - A source slug from `connectorSources`.
 */
export function kindOfSource(ctx: ScopeCtx, slug: string): string {
  return ctx.sourceKinds?.[slug] ?? slug;
}

/**
 * The agent's sources of one family, as slugs: those of its `connectorSources`
 * whose kind is in the family, narrowed by the person's source ACL when one is set.
 * @param ctx - The turn.
 * @param family - The family asked about.
 */
export function familySourceSlugs(ctx: ScopeCtx, family: ConnectorFamily): string[] {
  const kinds = FAMILY_KINDS[family];
  const slugs = ctx.connectorSources.filter(slug => kinds.includes(kindOfSource(ctx, slug)));
  if (!ctx.allowedSourceSlugs) {
    return slugs;
  }
  const allowed = new Set(ctx.allowedSourceSlugs);
  return slugs.filter(slug => allowed.has(slug));
}

/**
 * Whether this agent reaches a family at all — the gate for the family's
 * read tools, which are present only when there is a source to read.
 * @param ctx - The turn.
 * @param family - The family asked about.
 */
export function familyInScope(ctx: ScopeCtx, family: ConnectorFamily): boolean {
  return familySourceSlugs(ctx, family).length > 0;
}

/**
 * Whether the agent's harness grants a tool or action by any of its names —
 * the name it has now, or a former name a workspace wrote before a rename
 * (`github_read_check_logs` → `repo_read_check_logs`).
 * @param ctx - The turn.
 * @param names - The current name first, then any former names.
 */
export function granted(ctx: Pick<RuntimeContext, 'harnessConfig'>, ...names: string[]): boolean {
  const grants = new Set(ctx.harnessConfig.grantTools ?? []);
  return names.some(name => grants.has(name));
}

export type FamilySource = {
  id: number;
  slug: string;
  kind: string;
  config: Record<string, unknown>;
  apiTokenId: string | null;
};

/**
 * The connector kind of each source slug, read once at graph build so the
 * synchronous tool builder can tell a family's sources from the rest
 * (`RuntimeContext.sourceKinds`). Empty when nothing is asked.
 * @param orgId - The workspace.
 * @param slugs - The agent's `connectorSources`.
 */
export async function loadSourceKinds(orgId: string, slugs: readonly string[]): Promise<Record<string, string>> {
  if (slugs.length === 0) {
    return {};
  }
  const rows = await db
    .select({ slug: knowledgeSourceSchema.slug, kind: knowledgeSourceSchema.kind, config: knowledgeSourceSchema.configJson })
    .from(knowledgeSourceSchema)
    .where(eq(knowledgeSourceSchema.orgId, orgId));
  const wanted = new Set(slugs);
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!wanted.has(row.slug)) {
      continue;
    }
    const connector = (row.config as { _connector?: unknown } | null)?._connector;
    out[row.slug] = typeof connector === 'string' && connector ? connector : row.kind;
  }
  return out;
}

/**
 * Every enabled source of a family in the workspace, with its config and the
 * credential it points at — what a provider needs to answer for the org
 * (which site, which repositories, which channels, with which token).
 * @param orgId - The workspace.
 * @param family - The family asked about.
 * @param slugs - Only these slugs, when the caller is scoped to an agent's sources.
 */
export async function familySourcesForOrg(orgId: string, family: ConnectorFamily, slugs?: readonly string[]): Promise<FamilySource[]> {
  const kinds = FAMILY_KINDS[family];
  const rows = await db
    .select({ id: knowledgeSourceSchema.id, slug: knowledgeSourceSchema.slug, kind: knowledgeSourceSchema.kind, config: knowledgeSourceSchema.configJson, enabled: knowledgeSourceSchema.enabled, apiTokenId: knowledgeSourceSchema.apiTokenId })
    .from(knowledgeSourceSchema)
    .where(slugs && slugs.length > 0 ? and(eq(knowledgeSourceSchema.orgId, orgId), inArray(knowledgeSourceSchema.slug, [...slugs])) : eq(knowledgeSourceSchema.orgId, orgId));
  return rows
    .filter(row => row.enabled === 'true')
    .map((row) => {
      const connector = (row.config as { _connector?: unknown } | null)?._connector;
      return { id: row.id, slug: row.slug, kind: typeof connector === 'string' && connector ? connector : row.kind, config: (row.config ?? {}) as Record<string, unknown>, apiTokenId: row.apiTokenId ?? null };
    })
    .filter(row => kinds.includes(row.kind));
}
