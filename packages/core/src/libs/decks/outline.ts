/**
 * A deck in one screen — what the agent's receipt, `read_deck` and the chat's
 * grounding all show for a deck: never the slides' HTML. Pure.
 */

import type { DeckSpec } from '@/libs/cards/specs';
import { slideText } from './slides';

/**
 * The deck in one screen: title, then one line per slide — number, id, label,
 * whether it has notes — and the last verdict.
 * @param spec - The deck.
 */
export function deckOutline(spec: DeckSpec): string {
  const lines = [`"${spec.title}" · ${spec.order.length} ${spec.order.length === 1 ? 'slide' : 'slides'}${spec.playbook ? ` · playbook ${spec.playbook}` : ''}`];
  const startOf = new Map(Object.entries(spec.sections ?? {}).map(([k, s]) => [s.start, `${k}: ${s.description}`]));
  spec.order.forEach((id, i) => {
    const section = startOf.get(id);
    if (section) {
      lines.push(`§ ${section}`);
    }
    const t = slideText(spec.slides[id] ?? '');
    lines.push(`${i + 1}. [${id}] ${t.label || '(no text)'}${t.notes ? '' : ' · no notes'}`);
  });
  const assets = Object.keys(spec.assets ?? {});
  if (assets.length) {
    lines.push(`Assets: ${assets.join(', ')}`);
  }
  return lines.join('\n');
}
