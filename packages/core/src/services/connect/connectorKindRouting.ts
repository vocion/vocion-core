/**
 * Which kind of connector a connect request needs, and what to say when it is
 * not the kind this workspace holds (`libs/connect/connectorKinds.ts`).
 *
 * A shared workspace connects **team connectors**; a person's Personal
 * workspace connects **personal connectors**. The agent tools that put a
 * connect card in front of someone (`connect_system`, `offer_connection`) ask
 * here first, so nobody is ever asked to connect their own inbox as a team
 * connector, or a team system as a personal one: the request that needs the
 * other kind gets one line naming that kind and linking to its page instead.
 *
 * The kind the person means is the model's reading of their words, passed in
 * as `needs`; nothing here reads words.
 */

import type { ConnectorKind } from '@/libs/connect/connectorKinds';
import { eq } from 'drizzle-orm';
import { canBePersonal, CONNECTOR_KIND_NAME, CONNECTORS_PATH, kindOfWorkspace, wrongKindLine } from '@/libs/connect/connectorKinds';
import { db } from '@/libs/DB';
import { workspaceUrl } from '@/libs/links';
import { getConnector } from '@/libs/sources/registry';
import { projectSchema } from '@/models/Schema';

export type KindDecision = { proceed: true } | { proceed: false; reply: string };

/**
 * The decision, given everything it needs.
 * @param input - The request.
 * @param input.workspace - The kind this workspace holds.
 * @param input.needs - The kind the person means; this workspace's when they did not say.
 * @param input.connectors - The connectors asked for, by slug and name.
 * @param input.otherHref - The other kind's page, when it can be linked.
 */
export function decideKind(input: {
  workspace: ConnectorKind;
  needs: ConnectorKind | undefined;
  connectors: Array<{ slug: string; name: string }>;
  otherHref: string | null;
}): KindDecision {
  const needs = input.needs ?? input.workspace;
  if (input.workspace === 'team') {
    // A team request, or a "personal" one for systems nobody connects for
    // themselves (HubSpot is only ever shared): the team flow is right.
    const personal = input.connectors.filter(c => canBePersonal(c.slug));
    if (needs === 'team' || personal.length === 0) {
      return { proceed: true };
    }
    return { proceed: false, reply: `${personal.map(c => wrongKindLine({ name: `Your own ${c.name}`, needs: 'personal', href: input.otherHref })).join(' ')} Say that in one line; show no card here.` };
  }
  // A Personal workspace connects only personal connectors, on its own page.
  const team = input.connectors.filter(c => needs === 'team' || !canBePersonal(c.slug));
  if (team.length > 0) {
    return { proceed: false, reply: `${team.map(c => wrongKindLine({ name: c.name, needs: 'team', href: input.otherHref })).join(' ')} Say that in one line; show no card here.` };
  }
  const names = input.connectors.map(c => c.name);
  return {
    proceed: false,
    reply: `${names.length > 0 ? names.join(', ') : 'Your own accounts'} ${names.length === 1 ? 'is a personal connector' : 'are personal connectors'} — only your personal assistant reads ${names.length === 1 ? 'it' : 'them'}. Connect ${names.length === 1 ? 'it' : 'them'} in [${CONNECTOR_KIND_NAME.personal}](${CONNECTORS_PATH}). Say that in one line with the link; show no card.`,
  };
}

/**
 * The other kind's page for this person: their Personal workspace's from a
 * shared one, and the first shared workspace they can act in from Personal.
 * Null when there is none to link.
 * @param input - Who, where.
 * @param input.orgId - The workspace the turn runs in.
 * @param input.userId - The person.
 * @param input.workspace - The kind this workspace holds.
 */
export async function otherKindHref(input: { orgId: string; userId: string | undefined; workspace: ConnectorKind }): Promise<string | null> {
  if (!input.userId) {
    return null;
  }
  const [project] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, input.orgId)).limit(1);
  if (!project) {
    return null;
  }
  if (input.workspace === 'team') {
    const { findPersonalProject } = await import('@/services/workspace/personalProject');
    const own = await findPersonalProject(input.userId, project.accountId);
    return own ? workspaceUrl(own.slug, CONNECTORS_PATH) : null;
  }
  const { listActingWorkspaces } = await import('@/services/workspace/actingWorkspaces');
  const [first] = await listActingWorkspaces(input.userId, project.accountId);
  return first ? workspaceUrl(first.slug, CONNECTORS_PATH) : null;
}

/**
 * Ask before showing a connect card: proceed, or the one line to say instead.
 * @param ctx - The turn.
 * @param ctx.orgId - The workspace.
 * @param ctx.userId - The person.
 * @param ctx.workspaceKind - `project.kind`.
 * @param slugs - The connectors asked for.
 * @param needs - The kind the person means, when the model read one.
 */
export async function connectKindCheck(ctx: { orgId: string; userId?: string; workspaceKind?: string }, slugs: string[], needs: ConnectorKind | undefined): Promise<KindDecision> {
  const workspace = kindOfWorkspace(ctx.workspaceKind);
  const connectors = slugs.map(slug => ({ slug, name: getConnector(slug)?.name ?? slug }));
  // Cheap first: most requests are the kind the workspace holds.
  const first = decideKind({ workspace, needs, connectors, otherHref: null });
  if (first.proceed) {
    return first;
  }
  const otherHref = await otherKindHref({ orgId: ctx.orgId, userId: ctx.userId, workspace }).catch(() => null);
  return decideKind({ workspace, needs, connectors, otherHref });
}
