import type { ConversationRun } from '@/services/ConversationService';
import { os } from '@orpc/server';
import { listPlugins } from '@/libs/workspace';
import { appendMessage, createConversation } from '@/services/ConversationService';
import { claimOnboardingStart, onboardingOpeningMessage, openerCard, releaseOnboardingStart } from '@/services/OnboardingService';
import { guardAuth, guardRole, loadProject } from './AuthGuards';

/**
 * The opener choice card as the run stored on the opening message, shaped the
 * way a choice card from `ask_choice` is stored (`services/cards/surface.ts`).
 * @param enabledPlugins - Slugs already on in this workspace.
 * @returns A `card` run, or null when the catalog is too small for a card.
 */
function openerCardRun(enabledPlugins: string[]): ConversationRun | null {
  const plugins = listPlugins().map(plugin => ({ slug: plugin.manifest.slug, name: plugin.manifest.name, when: plugin.manifest.recommend.when }));
  const card = openerCard({ plugins, enabled: enabledPlugins });
  if (!card) {
    return null;
  }
  return { type: 'card', id: card.id, kind: card.kind, label: card.title, actionId: '', ...(card.body ? { body: card.body } : {}), ...(card.options ? { options: card.options } : {}), allowOther: card.allowOther, state: card.state };
}

/**
 * Open the workspace's setup conversation, once (#1028). Called by the chat
 * client on mount when `isOnboardingDue` said so: a POST, never a GET side
 * effect, because a `<Link>` prefetch of the chat page would otherwise open
 * setup unseen. The claim is atomic, and a conversation that cannot be
 * created releases it, so the next visit tries again.
 */
export const start = os.handler(async () => {
  const { orgId } = await guardRole('org:admin');
  const { userId } = await guardAuth();
  const project = await loadProject(orgId);
  if (!project?.leadAgentSlug) {
    return { conversationId: null, reason: 'no-lead' as const };
  }
  if (!(await claimOnboardingStart(orgId, userId))) {
    return { conversationId: null, reason: 'already-started' as const };
  }
  try {
    const conversation = await createConversation({ orgId, agentSlug: project.leadAgentSlug, initialTitle: 'Set up this workspace', createdBy: userId });
    const openerRun = openerCardRun(project.enabledPlugins);
    await appendMessage({ orgId, conversationId: conversation.id, role: 'assistant', agentSlug: project.leadAgentSlug, content: onboardingOpeningMessage({ workspaceName: project.name, description: project.description, cardOffered: openerRun !== null }), runs: openerRun ? [openerRun] : null });
    return { conversationId: conversation.id, reason: null };
  } catch (err) {
    console.warn('onboarding: could not open the setup conversation; released the claim', { orgId, error: (err as Error).message });
    await releaseOnboardingStart(orgId, userId);
    throw err;
  }
});
