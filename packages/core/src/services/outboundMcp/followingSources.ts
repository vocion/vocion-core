/**
 * YOUR CONNECTIONS FOLLOW YOU — a person's own MCP servers in every workspace
 * of their Org (docs/guides/mcp-sources.md, "Your connections follow you").
 *
 * A server declared `auth: person` reads each person as themselves, with
 * their own sign-in and the server's own ACLs, roles and MFA. Before this, it
 * reached a turn only in a workspace that declared it AND assigned it to the
 * answering agent: on 2026-10-23 a founder signed in to Company Knowledge
 * from Finance asked the Revenue lead to "confirm with the company KB" (an at-mention),
 * and Revenue had never declared it. Signed in once, used nowhere else.
 *
 * The rule, as approved:
 *
 *   - **Declared once anywhere in the Org, known Org-wide.** An `auth: person`
 *     server declared in any workspace of the Org (or in the person's own
 *     Personal there) counts as known to the Org.
 *   - **Used in any turn the person starts, in any workspace of that Org.**
 *     The answering agent gets it beside its own sources, read as the person
 *     with their grant. Write tools never travel: a per-person source cannot
 *     declare any (`mcpConfigSchema`), and only `readTools` are carried.
 *   - **Every answer that used one says so**: the step reads "Read your
 *     <server> · your connection, from <workspace>" and is kept with the turn.
 *   - **Missions and automations never get it.** Only a person's chat turn
 *     asks for it (`personTurn`); anything else needs the source declared in
 *     its own workspace, as before.
 *   - **Two switches, both on by default**: the person's "Use in every
 *     workspace" on their sign-in (`api_token.every_workspace`) and the
 *     workspace admin's "Members' own connections"
 *     (`project.members_own_connections`).
 *   - **Without a sign-in**, the agent offers the person the sign-in card once,
 *     the same card a declared per-person source offers.
 *
 * Nothing here turns a personal CONNECTION (mail, calendar, files in a
 * Personal) into a source; that stays Personal-only
 * (`services/personal/connections.ts`). These are servers the Org declared.
 */

import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { db } from '@/libs/DB';
import { mcpEndpoint } from '@/libs/outboundMcp/oauth';
import { loadMcpSources } from '@/libs/outboundMcp/sources';
import { knowledgeSourceSchema, projectSchema } from '@/models/Schema';
import { endpointsKeptToDeclaring } from '@/services/outboundMcp/personSignIn';

/** One of the person's servers, joining a turn in a workspace that does not declare it. */
export type FollowingMcp = {
  /** What the agent names it by in this turn: the declaring slug, unless this workspace uses that slug for something else. */
  slug: string;
  name: string;
  url: string;
  readTools: string[];
  /** The workspace whose declaration it came from. */
  fromOrgId: string;
  fromWorkspace: string;
};

/**
 * Whether members' own connections join turns in this workspace.
 * @param orgId - The workspace.
 */
export async function membersOwnConnectionsOn(orgId: string): Promise<boolean> {
  const [row] = await db.select({ on: projectSchema.membersOwnConnections }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
  return row?.on !== false;
}

/**
 * The workspace admin's "Members' own connections".
 * @param orgId - The workspace.
 * @param on - Whether members' own connections join turns here.
 */
export async function setMembersOwnConnections(orgId: string, on: boolean): Promise<void> {
  await db.update(projectSchema).set({ membersOwnConnections: on }).where(eq(projectSchema.id, orgId));
}

/**
 * Every `auth: person` server declared in the Org, one per endpoint: the
 * person's Org's shared workspaces and their own Personal, never another
 * person's Personal. The first declaration found names it.
 * @param input - Who and where.
 * @param input.userId - The person.
 * @param input.accountId - The Org.
 */
export async function orgPersonMcpServers(input: { userId: string; accountId: string }): Promise<FollowingMcp[]> {
  const workspaces = await db
    .select({ id: projectSchema.id, name: projectSchema.name })
    .from(projectSchema)
    .where(and(
      eq(projectSchema.accountId, input.accountId),
      isNull(projectSchema.archivedAt),
      or(ne(projectSchema.kind, 'personal'), eq(projectSchema.ownerUserId, input.userId)),
    ));
  if (workspaces.length === 0) {
    return [];
  }
  const nameOf = new Map(workspaces.map(w => [w.id, w.name]));
  const rows = await db
    .select({ orgId: knowledgeSourceSchema.orgId, slug: knowledgeSourceSchema.slug })
    .from(knowledgeSourceSchema)
    .where(and(
      inArray(knowledgeSourceSchema.orgId, workspaces.map(w => w.id)),
      ne(knowledgeSourceSchema.enabled, 'false'),
      sql`${knowledgeSourceSchema.configJson} ->> '_connector' = 'mcp'`,
    ));
  const out = new Map<string, FollowingMcp>();
  for (const orgId of [...new Set(rows.map(r => r.orgId))].sort()) {
    for (const source of await loadMcpSources(orgId, rows.filter(r => r.orgId === orgId).map(r => r.slug))) {
      if (source.config.auth !== 'person' || !source.config.url) {
        continue;
      }
      const endpoint = mcpEndpoint(source.config.url);
      if (!out.has(endpoint)) {
        out.set(endpoint, { slug: source.slug, name: source.name, url: source.config.url, readTools: source.config.readTools, fromOrgId: orgId, fromWorkspace: nameOf.get(orgId) ?? orgId });
      }
    }
  }
  return [...out.values()];
}

/**
 * The person's servers that join their turn in this workspace: every one the
 * Org declares, less those the person keeps to the declaring workspaces, and
 * none at all when the workspace's admin has members' own connections off.
 * Signed in or not: a server the person has not signed in to yet still joins,
 * and reading it offers the sign-in once. A server the answering agent already
 * holds as its own source is dropped when the tools are built (`mcpTools`), so
 * the agent sees each endpoint once.
 *
 * Only for a turn a PERSON starts: the caller says so with `personTurn`, and
 * a mission or automation never does.
 * @param input - The turn.
 * @param input.userId - The person in the turn.
 * @param input.orgId - The workspace the turn is in.
 * @param input.personTurn - True only for a person's own chat turn.
 */
export async function followingMcpSources(input: { userId?: string | null; orgId: string; personTurn?: boolean }): Promise<FollowingMcp[]> {
  if (!input.personTurn || !input.userId) {
    return [];
  }
  const [workspace] = await db
    .select({ accountId: projectSchema.accountId, kind: projectSchema.kind, ownerUserId: projectSchema.ownerUserId, on: projectSchema.membersOwnConnections })
    .from(projectSchema)
    .where(eq(projectSchema.id, input.orgId))
    .limit(1);
  // Someone else's Personal is never a place this person's turn runs; refuse rather than guess.
  if (!workspace || workspace.on === false || (workspace.kind === 'personal' && workspace.ownerUserId !== input.userId)) {
    return [];
  }
  const [servers, slugsHere, kept] = await Promise.all([
    orgPersonMcpServers({ userId: input.userId, accountId: workspace.accountId }),
    sourceSlugsIn(input.orgId),
    endpointsKeptToDeclaring(input.userId),
  ]);
  return servers
    .filter(s => !kept.has(mcpEndpoint(s.url)))
    // A server declared HERE keeps its own slug; one from elsewhere whose slug
    // this workspace already uses for another source is renamed, never shadowing it.
    .map(s => (s.fromOrgId !== input.orgId && slugsHere.has(s.slug) ? { ...s, slug: `${s.slug}-yours` } : s));
}

/**
 * The person's servers for a Connections page: every `auth: person` server the
 * Org declares, with the person's sign-in state and their "Use in every
 * workspace" choice.
 * @param input - Who and which Org.
 * @param input.userId - The person.
 * @param input.accountId - The Org.
 */
export async function yourOrgConnections(input: { userId: string; accountId: string }): Promise<Array<FollowingMcp & { signedIn: boolean; everyWorkspace: boolean }>> {
  const { personGrantUse } = await import('@/services/outboundMcp/personSignIn');
  const servers = await orgPersonMcpServers(input);
  return Promise.all(servers.map(async s => ({ ...s, ...(await personGrantUse(input.userId, s.url)) })));
}

/**
 * The slugs of every source this workspace declares.
 * @param orgId - The workspace.
 */
async function sourceSlugsIn(orgId: string): Promise<Set<string>> {
  const rows = await db.select({ slug: knowledgeSourceSchema.slug }).from(knowledgeSourceSchema).where(eq(knowledgeSourceSchema.orgId, orgId));
  return new Set(rows.map(r => r.slug));
}
