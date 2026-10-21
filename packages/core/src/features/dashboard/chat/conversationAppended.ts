/**
 * SOMETHING OUTSIDE THE TURN WROTE INTO THIS CONVERSATION — a browser run's
 * result, said after the call that started it had returned
 * (`services/browser/BrowserRunService.ts`, through `tellConversation`). The
 * surface that saw it end says so with this event, and the open chat reads
 * its conversation again when no turn of its own is running
 * (`useChatSession`), so the line appears without a reload.
 */

export const CONVERSATION_APPENDED_EVENT = 'vocion:conversation-appended';

/**
 * Tell the open chat that this conversation may have a new message.
 * @param conversationId - The conversation.
 */
export function announceConversationAppended(conversationId: number): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CONVERSATION_APPENDED_EVENT, { detail: { conversationId } }));
  }
}
