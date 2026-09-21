import type { RecordRef } from '@/services/chat/pageContext';

/**
 * A turn that made a record ends with a link to it — deterministically.
 *
 * The room tool tells the model to link the room it opened; the model
 * usually does and sometimes writes "data room #22" with no link, and then
 * the person has nothing to click (Chris, 2026-09-18: "when this happens I
 * should get an inline link that opens the preview"). The tool also emits a
 * typed `record_created` event, and the run appends a link for any created
 * record the answer did not already link. The link renders as a chip; a
 * chip for a room opens the preview.
 * @param text - The finished answer.
 * @param records - Records the turn created, in order.
 */
export function appendRecordLinks(text: string, records: ReadonlyArray<RecordRef>): string {
  const missing = records.filter(r => r.href && !text.includes(r.href));
  if (missing.length === 0) {
    return text;
  }
  const seen = new Set<string>();
  const lines = missing
    .filter(r => (seen.has(r.href!) ? false : (seen.add(r.href!), true)))
    .map(r => `[${(r.label ?? `${r.type} ${r.id}`).replace(/[[\]]/g, '')}](${r.href})`);
  return `${text.trimEnd()}\n\n${lines.join(' · ')}`;
}
