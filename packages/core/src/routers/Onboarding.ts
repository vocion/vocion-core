import { os } from '@orpc/server';
import { appendMessage, createConversation } from '@/services/ConversationService';
import { claimOnboardingStart, onboardingOpeningMessage, releaseOnboardingStart } from '@/services/OnboardingService';
import { guardAuth, guardRole, loadProject } from './AuthGuards';

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
    await appendMessage({ orgId, conversationId: conversation.id, role: 'assistant', agentSlug: project.leadAgentSlug, content: onboardingOpeningMessage({ workspaceName: project.name, description: project.description }) });
    return { conversationId: conversation.id, reason: null };
  } catch (err) {
    console.warn('onboarding: could not open the setup conversation; released the claim', { orgId, error: (err as Error).message });
    await releaseOnboardingStart(orgId, userId);
    throw err;
  }
});
