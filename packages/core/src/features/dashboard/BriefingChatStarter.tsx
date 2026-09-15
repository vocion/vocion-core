'use client';

import { useRecordContext } from '@/features/dashboard/context/useRecordContext';
import { recordRef } from '@/services/chat/recordContext';
import { AskAboutThis } from './context/AskAboutThis';

// Re-exported so existing importers keep working; the chat page reads the same key.
export { CHAT_HANDOFF_KEY, type ChatHandoff } from '@/features/dashboard/chat/agentSurface';

/**
 * The briefing's hook into the ONE conversation surface (058 §6, R4).
 *
 * This used to be a floating composer pill at the bottom of the page. With the
 * dock open beside the brief that made two inputs on one page, so the pill is
 * gone. What remains: the page declares the briefing as its record (the rail
 * opens by default beside it and shows an "About: <title>" chip), and
 * highlighting text inside [data-briefing-root] pops the "Ask Vocion" pill,
 * which opens the rail with the passage quoted and the composer focused —
 * never a second input. Per-section and per-bullet asks live in
 * `BriefingSections`.
 * @param props
 * @param props.briefingId - The brief being viewed.
 * @param props.briefingTitle - Its title, for the record label and the chip.
 * @param props.briefingContent - Fallback context when no surface is mounted (full-page chat handoff).
 * @param props.agentSlug - The brief's team lead, preferred for the turn.
 */
export const BriefingChatStarter = (props: { briefingId: number; briefingTitle: string; briefingContent: string; agentSlug?: string }) => {
  const record = recordRef('briefing', props.briefingId, props.briefingTitle);
  useRecordContext(record);
  return (
    <AskAboutThis
      record={record}
      variant="none"
      selectionRoot="[data-briefing-root]"
      agentSlug={props.agentSlug}
      fallbackContext={props.briefingContent}
    />
  );
};
