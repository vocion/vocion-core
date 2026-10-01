/**
 * Open the workspace's setup conversation from the chat client (#1028). A
 * POST from a mounted page, never the server render, so a prefetch cannot
 * open setup unseen. `null` means someone else already opened it.
 * @param deps - What the start needs.
 * @param deps.start - `client.onboarding.start`.
 * @param deps.open - Navigate within the app (router.replace).
 */
export async function startOnboardingConversation(deps: { start: () => Promise<{ conversationId: number | null }>; open: (path: string) => void }): Promise<void> {
  try {
    const { conversationId } = await deps.start();
    if (conversationId !== null) {
      deps.open(`/dashboard/chat?conversation=${conversationId}`);
    }
  } catch (err) {
    console.warn('onboarding: could not open setup', { error: err instanceof Error ? err.message : String(err) });
  }
}
