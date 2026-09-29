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
 *
 * Chris again, same day, on the full-page chat: the drawer that surface kept
 * (`ChatShell`'s bespoke `SourcesPanel`) opened a SECOND pane beside this one,
 * and each card in it showed only a kind, a title and a status — "pretty much
 * empty", his words — because it never resolved what a source actually
 * pointed at. `sourceRecordRef` below is the fix: a source that names one of
 * our own records links into the SAME pane, resolved the way that record's
 * own page renders it, in place of a raw link or a second drawer.
 */

import type { RecordRef } from '@/services/chat/pageContext';
import { previewKey } from './types';

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

/** `lookup_objects` stamps a tracker record's citation `object-<id>`. */
const OBJECT_DOC_ID = /^object-(\d+)$/;
/** `briefingCitation.ts` stamps a briefing's citation `briefing:<id>`. */
const BRIEFING_DOC_ID = /^briefing:(\d+)$/;

/**
 * The Vocion record a source names, when it is one of ours — a tracker
 * record, a briefing, or a hit from `search_knowledge` (every connector's
 * ingested copy is a row in the same mirror, addressed by its own id). Each
 * of these already has a rich preview descriptor
 * (`services/preview/descriptors.ts`) that renders it the way its own page
 * does — its fields and body, not a title and a status line. A source with
 * no ref of its own (a bare external link with nothing ingested) has none,
 * and the pane falls back to linking straight out.
 * @param source - The source as a turn persisted it.
 */
export function sourceRecordRef(source: Pick<TurnSource, 'document_id' | 'source_type'>): Pick<RecordRef, 'type' | 'id'> | null {
  if (source.source_type === 'tracker') {
    const m = OBJECT_DOC_ID.exec(source.document_id);
    if (m) {
      return { type: 'object', id: m[1]! };
    }
  }
  if (source.source_type === 'briefing') {
    const m = BRIEFING_DOC_ID.exec(source.document_id);
    if (m) {
      return { type: 'briefing', id: m[1]! };
    }
  }
  // `search_knowledge` stamps every connector's hit with the ingested
  // mirror's own numeric row id (`knowledge_document.id`) — one ref type for
  // Granola, Zoom, Gmail, Drive, HubSpot and anything else that syncs in.
  if (/^\d+$/.test(source.document_id)) {
    return { type: 'document', id: source.document_id };
  }
  return null;
}

/**
 * The sources as the pane's markdown body: one entry per source, numbered as
 * the answer cites it, with the excerpt and a link out. Repeats of the same
 * document at the same number are one entry. A source that names one of our
 * own records links `?preview=<type>:<id>` — the peek link every preview
 * body already knows how to follow (`PreviewPane`'s `PeekLink`) — so opening
 * it swaps this list for that record's OWN preview, in the same pane,
 * rather than leaving to a raw URL.
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
    const ref = sourceRecordRef(s);
    const href = ref ? `?preview=${encodeURIComponent(previewKey(ref))}` : (/^(?:https?:\/\/|\/)/.test(s.link ?? '') ? s.link : null);
    const head = href ? `${n}**[${title}](${href})**` : `${n}**${title}**`;
    const meta = [s.source_type, s.updated_at ? s.updated_at.slice(0, 10) : null].filter(Boolean).join(' · ');
    const blurb = (s.blurb ?? '').trim().replace(/\n{2,}/g, '\n');
    entries.push([head, meta && `_${meta}_`, blurb].filter(Boolean).join('\n\n'));
  }
  return entries.join('\n\n---\n\n');
}
