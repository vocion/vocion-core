/**
 * GETTING STARTED — where a new shared workspace stands, read from what is
 * really there, never from a list of boxes somebody ticked.
 *
 * Five steps, each the first move of a working workspace and each one a card
 * the workspace lead can put in chat (`propose_setup`, `propose_brand`):
 *
 * - **connect** — a system the workspace reads is connected and still live
 *   (`connectorHasLiveSource`: a revoked or expired login is not connected).
 * - **app** — an app, a template or a plugin is on (`project.enabled_plugins`;
 *   an app and a template are the plugins they turn on).
 * - **hire** — an active agent besides the workspace lead core seeded.
 * - **invite** — somebody else is in the account, or an invite is out.
 * - **brand** — "Make it yours": the Org wears its own logo and colours
 *   (`tenant_account.brand`, `services/branding/OrgBrandService.ts`).
 *
 * Read by the sidebar checklist and the lead's `setup_options`, so the two
 * never disagree. Null for a personal workspace, which has its own assistant
 * and nobody to invite.
 */

import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { connectorOfSource } from '@/libs/sources/connectorOf';
import { WORKSPACE_LEAD_SLUG } from '@/libs/workspace/workspaceLead';
import { accountMembershipSchema, agentSchema, inviteSchema, projectSchema, tenantAccountSchema } from '@/models/Schema';

export const GETTING_STARTED_STEPS = ['connect', 'app', 'hire', 'invite', 'brand'] as const;
export type GettingStartedStep = (typeof GETTING_STARTED_STEPS)[number];

export type GettingStarted = {
  /** The steps in order, each with whether the workspace has done it. */
  steps: Array<{ id: GettingStartedStep; done: boolean }>;
  /** How many are done. */
  done: number;
  /** How many there are. */
  total: number;
  /** What is behind each, for the lead to read: connected connector slugs, plugins on, agents hired, people in the account. */
  detail: { connected: string[]; plugins: string[]; agents: string[]; members: number; invites: number };
};

/**
 * The connectors this workspace reads that are still live.
 * @param orgId - The workspace.
 */
export async function connectedConnectors(orgId: string): Promise<string[]> {
  const [{ listSources }, { connectorHasLiveSource }] = await Promise.all([
    import('@/services/SourceSyncService'),
    import('@/services/connect/createSourceOnLogin'),
  ]);
  const connectors = [...new Set((await listSources(orgId)).map(connectorOfSource))];
  const live = await Promise.all(connectors.map(async c => ((await connectorHasLiveSource(orgId, c).catch(() => false)) ? c : null)));
  return live.filter((c): c is string => c !== null);
}

/**
 * Where this workspace stands on its first steps.
 * @param orgId - The workspace (project).
 * @returns Null for a personal workspace or one that does not exist.
 */
export async function gettingStartedFor(orgId: string): Promise<GettingStarted | null> {
  const [project] = await db
    .select({ kind: projectSchema.kind, accountId: projectSchema.accountId, enabledPlugins: projectSchema.enabledPlugins })
    .from(projectSchema)
    .where(eq(projectSchema.id, orgId))
    .limit(1);
  if (!project || project.kind === 'personal') {
    return null;
  }
  const [connected, agents, [members], [invites], [org]] = await Promise.all([
    connectedConnectors(orgId),
    db
      .select({ slug: agentSchema.slug })
      .from(agentSchema)
      .where(and(eq(agentSchema.orgId, orgId), ne(agentSchema.active, 'false'), ne(agentSchema.slug, WORKSPACE_LEAD_SLUG))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(accountMembershipSchema)
      .where(eq(accountMembershipSchema.accountId, project.accountId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(inviteSchema)
      .where(and(eq(inviteSchema.accountId, project.accountId), isNull(inviteSchema.acceptedAt), gt(inviteSchema.expiresAt, new Date()))),
    db
      .select({ branded: sql<boolean>`${tenantAccountSchema.brand} is not null` })
      .from(tenantAccountSchema)
      .where(eq(tenantAccountSchema.id, project.accountId)),
  ]);
  const plugins = project.enabledPlugins ?? [];
  const memberCount = Number(members?.n ?? 0);
  const inviteCount = Number(invites?.n ?? 0);
  const doneBy: Record<GettingStartedStep, boolean> = {
    connect: connected.length > 0,
    app: plugins.length > 0,
    hire: agents.length > 0,
    invite: memberCount > 1 || inviteCount > 0,
    brand: org?.branded === true,
  };
  const steps = GETTING_STARTED_STEPS.map(id => ({ id, done: doneBy[id] }));
  return {
    steps,
    done: steps.filter(s => s.done).length,
    total: steps.length,
    detail: { connected, plugins, agents: agents.map(a => a.slug), members: memberCount, invites: inviteCount },
  };
}
