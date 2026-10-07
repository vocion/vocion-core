/**
 * ONE NUMBER, EVERYONE'S OWN ASSISTANT (Vocion 3.0, phase 2b).
 *
 * A number bound to a workspace answers as that workspace's agent, whoever
 * texts it. An account that wants each person to reach THEIR OWN assistant
 * binds one shared number with the agent `*` ({@link SENDERS_OWN_ASSISTANT}):
 * a text to it is routed by who sent it, not by where it went.
 *
 * - The sender is resolved by the medium's own channel (`memberOf`; for a text,
 *   the member whose profile holds the number, `me.set_phone`), inside the
 *   binding's account and nowhere else: the binding's tenancy still decides
 *   which people can be found.
 * - The person's personal workspace on that account is made if it is not there
 *   yet (`ensurePersonalProject`), and the conversation lives in it, so it is
 *   private to them like everything else there.
 * - Whoever leads that workspace answers (`project.lead_agent_slug`, the
 *   person's assistant); with no lead, the workspace's own first-turn router
 *   picks. With no agent at all the person is told so, in one line.
 *
 * Everything after the route is the ordinary chat-surface path: the thread is
 * `<surface>:<number>:<their number>`, a reply that decides a card waiting in
 * it is read as a decision (`approvalFromThread`), anything else is a turn.
 */

import type { RoutedWorkspace } from './workspaceRoute';

/**
 * The agent a binding names when it answers each sender with their own
 * assistant. The same spelling the channel catch-all uses for "any channel".
 */
export const SENDERS_OWN_ASSISTANT = '*';

/**
 * Whether a binding routes by sender.
 * @param binding - The resolved binding.
 * @param binding.agentSlug - Its agent.
 */
export function routesBySender(binding: { agentSlug: string }): boolean {
  return binding.agentSlug === SENDERS_OWN_ASSISTANT;
}

/** Where a sender's text goes, or why it cannot go anywhere. */
export type OwnAssistantRoute
  = | (RoutedWorkspace & { userId: string })
    | { routed: null; why: 'unknown_sender' | 'no_assistant'; reply: string };

export type OwnAssistantDeps = {
  /** The member behind a sender on this medium, inside the binding's account. */
  member: (orgId: string, surface: string, externalUserId: string) => Promise<{ userId: string | null; email?: string | null }>;
  /** How a sender becomes someone Vocion knows on this medium. */
  signInHint: (surface: string) => Promise<string>;
  /** The account a workspace belongs to. */
  accountOf: (orgId: string) => Promise<string | null>;
  /** The person's own workspace on that account, made if missing. */
  personal: (userId: string, accountId: string) => Promise<{ id: string }>;
  /** Who leads a workspace, if anyone. */
  lead: (orgId: string) => Promise<string | null>;
  /** The agent a workspace's own first-turn router picks for a message, if any. */
  pick: (orgId: string, message: string, surface: string) => Promise<string | null>;
};

/**
 * Route a text on a shared number to the sender's own assistant. Never throws
 * on a missing person or agent: those come back as a line to say.
 * @param binding - The shared binding.
 * @param binding.orgId - The workspace it was bound in; only its account matters.
 * @param inbound - The message.
 * @param inbound.surface - The medium.
 * @param inbound.externalUserId - The sender on that medium.
 * @param inbound.text - What they said, for the router when there is no lead.
 * @param seams - Seams for tests.
 */
export async function routeToOwnAssistant(
  binding: { orgId: string },
  inbound: { surface: string; externalUserId: string; text: string },
  seams?: OwnAssistantDeps,
): Promise<OwnAssistantRoute> {
  // eslint-disable-next-line ts/no-use-before-define -- read at call time, after the module has loaded
  const deps = seams ?? defaultDeps;
  const who = await deps.member(binding.orgId, inbound.surface, inbound.externalUserId);
  const accountId = who.userId ? await deps.accountOf(binding.orgId) : null;
  if (!who.userId || !accountId) {
    return { routed: null, why: 'unknown_sender', reply: `This number answers members of a Vocion workspace, each with their own assistant. To text it, add ${await deps.signInHint(inbound.surface)}.` };
  }
  const personal = await deps.personal(who.userId, accountId);
  const agentSlug = (await deps.lead(personal.id)) ?? (await deps.pick(personal.id, inbound.text, inbound.surface).catch(() => null));
  if (!agentSlug) {
    return { routed: null, why: 'no_assistant', reply: 'Your own assistant in Vocion is not set up yet, so nothing answered this. Open your personal workspace in Vocion to set it up, then text again.' };
  }
  return { orgId: personal.id, agentSlug, routed: 'sender', reason: 'the sender\'s own assistant', userId: who.userId };
}

const defaultDeps: OwnAssistantDeps = {
  async member(orgId, surface, externalUserId) {
    const { channelBySurface } = await import('./channels');
    const channel = channelBySurface(surface);
    return channel ? channel.memberOf(orgId, externalUserId) : { userId: null };
  },
  async signInHint(surface) {
    const { channelBySurface } = await import('./channels');
    return channelBySurface(surface)?.signInHint(null) ?? 'a way for Vocion to know you on this medium';
  },
  async accountOf(orgId) {
    const [{ db }, { eq }, { projectSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
    const [row] = await db.select({ accountId: projectSchema.accountId }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    return row?.accountId ?? null;
  },
  async personal(userId, accountId) {
    const { ensurePersonalProject } = await import('@/services/workspace/personalProject');
    return ensurePersonalProject(userId, accountId);
  },
  async lead(orgId) {
    const [{ db }, { eq }, { projectSchema }] = await Promise.all([import('@/libs/DB'), import('drizzle-orm'), import('@/models/Schema')]);
    const [row] = await db.select({ lead: projectSchema.leadAgentSlug }).from(projectSchema).where(eq(projectSchema.id, orgId)).limit(1);
    return row?.lead?.trim() || null;
  },
  async pick(orgId, message, surface) {
    const { routeMessage } = await import('@/services/agents/router');
    const decision = await routeMessage({ orgId, message, surface });
    return decision?.chosen ?? null;
  },
};
