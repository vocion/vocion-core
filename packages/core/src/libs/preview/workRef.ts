/**
 * A CONVERSATION'S BACKGROUND WORK, AS A PREVIEW.
 *
 * Chris, 2026-10-23: the chat's "12 finished ›" chip opened its own sheet on
 * the far right, beside the preview pane that was already open — "a new
 * sidebar implement". The right column has one pane (`RailColumn`), so the
 * work opens THERE, addressed like every other preview
 * (`?preview=conversation:<id>.work`): linkable, it survives a reload, and
 * Back returns to what was open before it.
 *
 * A view of the conversation, not a new record type, the way a turn's
 * sources are (`sourcesRef.ts`). Pure; the server resolver and the chip share it.
 */

import type { RecordRef } from '@/services/chat/pageContext';

/**
 * The preview ref for the work behind a conversation.
 * @param conversationId - The conversation.
 */
export function workPreviewRef(conversationId: number): Pick<RecordRef, 'type' | 'id'> {
  return { type: 'conversation', id: `${conversationId}.work` };
}

/**
 * Read a work id back, or null when the id is anything else.
 * @param id - The preview ref's id.
 */
export function parseWorkRefId(id: string): { conversationId: number } | null {
  const m = /^(\d+)\.work$/.exec(id.trim());
  return m ? { conversationId: Number(m[1]) } : null;
}
