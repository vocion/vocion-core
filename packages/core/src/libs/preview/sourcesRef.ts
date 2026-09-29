/**
 * A TURN'S SOURCES, AS A PREVIEW.
 *
 * Chris, 2026-09-29: "clicking source in the sidebar chat chip doesn't do
 * anything -- it should open a second sidebar pane". The rail had no sources
 * drawer, so its "Sources · N" chip had no handler. The rail's second pane is
 * the preview pane (`RailColumn`), so a turn's sources open THERE — one pane,
 * addressed like every other preview (`?preview=conversation:<id>.sources`),
 * so it is linkable, survives a reload, and Back closes it.
 *
 * A view of the conversation, not a new record type: the id is the
 * conversation's with a `.sources` suffix, and optionally the one turn
 * (`412.sources.9051`) whose chip was pressed. Pure; the server resolver and
 * the chip share it.
 */

import type { RecordRef } from '@/services/chat/pageContext';

/** One source as a turn persisted it (`conversation_message.documents_json`). */
export type TurnSource = {
  document_id: string;
  semantic_identifier: string;
  link: string;
  source_type: string;
  blurb: string;
  citationIndex?: number;
  updated_at?: string;
};

/**
 * The preview ref for a conversation's sources, or one turn's.
 * @param conversationId - The conversation.
 * @param messageId - The turn whose chip was pressed, when it is persisted.
 */
export function sourcesPreviewRef(conversationId: number, messageId?: number | null): Pick<RecordRef, 'type' | 'id'> {
  return { type: 'conversation', id: `${conversationId}.sources${messageId ? `.${messageId}` : ''}` };
}

/**
 * Read a sources id back, or null when the id is a plain conversation.
 * @param id - The preview ref's id.
 */
export function parseSourcesRefId(id: string): { conversationId: number; messageId: number | null } | null {
  const m = /^(\d+)\.sources(?:\.(\d+))?$/.exec(id.trim());
  if (!m) {
    return null;
  }
  return { conversationId: Number(m[1]), messageId: m[2] ? Number(m[2]) : null };
}

/**
 * The sources as the pane's markdown body: one entry per source, numbered as
 * the answer cites it, with the excerpt and a link out. Repeats of the same
 * document at the same number are one entry.
 * @param sources - In the order the turn(s) returned them.
 */
export function sourcesMarkdown(sources: readonly TurnSource[]): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const s of sources) {
    const key = `${s.document_id}:${s.citationIndex ?? ''}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const title = (s.semantic_identifier || 'Untitled source').replace(/[[\]]/g, '');
    const n = s.citationIndex != null ? `[${s.citationIndex}] ` : '';
    const head = /^(?:https?:\/\/|\/)/.test(s.link ?? '') ? `${n}**[${title}](${s.link})**` : `${n}**${title}**`;
    const meta = [s.source_type, s.updated_at ? s.updated_at.slice(0, 10) : null].filter(Boolean).join(' · ');
    const blurb = (s.blurb ?? '').trim().replace(/\n{2,}/g, '\n');
    entries.push([head, meta && `_${meta}_`, blurb].filter(Boolean).join('\n\n'));
  }
  return entries.join('\n\n---\n\n');
}
