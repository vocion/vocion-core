/**
 * What the Connectors page knows beyond the rows `/rpc/sources` returns, read
 * once on the server when the page renders:
 *
 * - **recommended** — at most three connectors this workspace should connect
 *   next, each with ONE reason in words. The ranking and the words are the
 *   ones the "Connect your systems" walk in chat uses
 *   (`recommendConnections`, `evidenceLine`), so the page and chat give the
 *   same reason for the same system.
 * - **usedBy** — per connector, the agents and the added apps that read it, by
 *   name, for the row's "Used by" line.
 * - **unavailable** — connectors this server cannot connect at all: a login is
 *   the only way in and no login app is configured for it. The catalog says so
 *   quietly to an admin and leaves them out for everyone else.
 * - **personalHref** — the person's own Personal workspace's Connectors page,
 *   for the one line that says where their own accounts connect.
 *
 * Every read is best-effort: one that fails leaves its part empty, never the
 * page.
 */

import type { ConnectCandidate } from '@/libs/connect/systemsPlan';
import { and, eq } from 'drizzle-orm';
import { evidenceLine } from '@/libs/connect/systemsPlan';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { howToConnectFor } from '@/libs/platforms/registry';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { listConnectors } from '@/libs/sources/registry';
import { agentSchema, knowledgeSourceSchema } from '@/models/Schema';

/** The most connectors the page recommends at once. */
export const MAX_RECOMMENDED = 3;

export type RecommendedConnector = { slug: string; name: string; why: string };

export type ConnectionsOverview = {
  recommended: RecommendedConnector[];
  usedBy: Record<string, string[]>;
  unavailable: string[];
  personalHref: string | null;
};

/**
 * The page's recommendations from the ranked plan: only systems with evidence
 * behind them, best first, at most three, each with its strongest reason.
 * @param candidates - The plan's candidates, highest score first.
 * @param max - How many to keep.
 */
export function pickRecommendations(candidates: ConnectCandidate[], max = MAX_RECOMMENDED): RecommendedConnector[] {
  return candidates
    .filter(c => c.evidence.length > 0)
    .slice(0, max)
    .map(c => ({ slug: c.connector, name: c.name, why: evidenceLine(c.evidence[0]!) }));
}

/**
 * Connectors a person cannot connect on this server: the connector declares a
 * login and nothing to paste, and the server has no app to run the login on.
 * @param connectInfo - Per connector, the login provider's name when one is configured.
 */
export function unavailableConnectors(connectInfo: Record<string, { providerLabel: string | null }>): string[] {
  return listConnectors()
    .filter((c) => {
      const how = howToConnectFor(c.slug);
      return Boolean(how?.login) && !how?.paste && !connectInfo[c.slug]?.providerLabel;
    })
    .map(c => c.slug);
}

/**
 * Per connector, the names of the active agents that search one of its
 * sources and the added apps that read it, each name once, agents first.
 * @param input - What to join.
 * @param input.sources - The workspace's sources (slug + connector).
 * @param input.agents - Active agents with the source slugs they search.
 * @param input.apps - Added apps with the connectors they read.
 */
export function usedByConnector(input: {
  sources: Array<{ slug: string; connector: string }>;
  agents: Array<{ name: string; connectorSources: string[] }>;
  apps: Array<{ name: string; connectors: string[] }>;
}): Record<string, string[]> {
  const connectorOfSlug = new Map(input.sources.map(s => [s.slug, s.connector]));
  const out: Record<string, string[]> = {};
  const add = (connector: string, name: string) => {
    const list = out[connector] ?? [];
    if (!list.includes(name)) {
      list.push(name);
    }
    out[connector] = list;
  };
  for (const agent of input.agents) {
    for (const slug of agent.connectorSources) {
      const connector = connectorOfSlug.get(slug);
      if (connector) {
        add(connector, agent.name);
      }
    }
  }
  for (const app of input.apps) {
    for (const connector of app.connectors) {
      if (input.sources.some(s => s.connector === connector)) {
        add(connector, app.name);
      }
    }
  }
  return out;
}

/**
 * Everything the Connectors page needs beyond its rows.
 * @param ctx - Who is looking, where.
 * @param ctx.orgId - The workspace.
 * @param ctx.userId - The person.
 * @param ctx.accountId - Their Org, for their Personal workspace.
 * @param ctx.isAdmin - Only an admin is offered anything to connect.
 * @param ctx.connectInfo - The page's per-connector login state (`connectInfoForOrg`).
 */
export async function connectionsOverview(ctx: {
  orgId: string;
  userId: string | null | undefined;
  accountId: string | null | undefined;
  isAdmin: boolean;
  connectInfo: Record<string, { providerLabel: string | null }>;
}): Promise<ConnectionsOverview> {
  const [recommended, usedBy, personalHref] = await Promise.all([
    ctx.isAdmin
      ? import('./recommendations')
          .then(m => m.recommendConnections({ orgId: ctx.orgId, userId: ctx.userId ?? undefined }))
          .then(plan => pickRecommendations(plan.candidates))
          .catch(() => [])
      : Promise.resolve([]),
    readUsedBy(ctx.orgId).catch(() => ({})),
    ctx.userId && ctx.accountId
      ? import('@/services/workspace/personalProject')
          .then(m => m.findPersonalProject(ctx.userId!, ctx.accountId!))
          .then(p => (p && p.id !== ctx.orgId ? workspaceUrl(p.slug, '/dashboard/connectors') : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  return { recommended, usedBy, unavailable: unavailableConnectors(ctx.connectInfo), personalHref };
}

/**
 * The "Used by" names for one workspace.
 * @param orgId - The workspace.
 */
async function readUsedBy(orgId: string): Promise<Record<string, string[]>> {
  const { listAppOffers } = await import('@/services/AppCatalogService');
  const [sources, agents, offers] = await Promise.all([
    db.select({ slug: knowledgeSourceSchema.slug, kind: knowledgeSourceSchema.kind, config: knowledgeSourceSchema.configJson })
      .from(knowledgeSourceSchema)
      .where(eq(knowledgeSourceSchema.orgId, orgId)),
    db.select({ name: agentSchema.name, connectorSources: agentSchema.connectorSources })
      .from(agentSchema)
      .where(and(eq(agentSchema.orgId, orgId), eq(agentSchema.active, 'true'))),
    listAppOffers(orgId).catch(() => []),
  ]);
  return usedByConnector({
    sources: sources.map(s => ({ slug: s.slug, connector: connectorOfSource({ slug: s.slug, kind: s.kind, config: (s.config ?? {}) as Record<string, unknown> }) })),
    agents: agents.map(a => ({ name: a.name, connectorSources: a.connectorSources ?? [] })),
    apps: offers.filter(a => a.added).map(a => ({ name: a.name, connectors: a.connectors.map(c => c.slug) })),
  });
}
