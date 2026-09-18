'use client';

import { useRecordContext } from '@/features/dashboard/context/useRecordContext';
import { recordRef } from '@/services/chat/recordContext';

// Re-exported so existing importers keep working; the chat page reads the same key.
export { CHAT_HANDOFF_KEY, type ChatHandoff } from '@/features/dashboard/chat/agentSurface';

/**
 * The briefing's hook into the ONE conversation surface (058 §6, R4).
 *
 * This used to be a floating composer pill at the bottom of the page, then a
 * bespoke "Ask Vocion" selection pill of its own. Both are gone. What remains
 * is the record declaration: the page says it is about this briefing, so the
 * rail shows an "About: <title>" chip and files the turn against it.
 *
 * Selecting text is now the PLATFORM's pattern, not this page's: the brief
 * sits inside a `CommentLayerProvider`, and the Detail archetype's own
 * `Section` carries `data-comment-field`, so a highlight anywhere in the
 * rendered document raises the standard control — *Ask about this*
 * (`docs/design/patterns.md` § Select → talk). One selection control in the
 * app, not one per page.
 * @param props
 * @param props.briefingId - The brief being viewed.
 * @param props.briefingTitle - Its title, for the record label and the chip.
 */
export const BriefingChatStarter = (props: { briefingId: number; briefingTitle: string }) => {
  useRecordContext(recordRef('briefing', props.briefingId, props.briefingTitle));
  return null;
};
