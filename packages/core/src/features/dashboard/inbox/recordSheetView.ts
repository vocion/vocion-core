import type { ReviewRow } from '@/services/inbox/reviewRows';
import { recordTitle } from '@/services/inbox/describeActionRun';
import { recordKeyLabel } from '@/services/inbox/recordKey';

/**
 * What the record decision sheet shows, decided away from the page so it can
 * be asserted without a database.
 *
 * The rule that matters: a record key with no rows behind it is NOT a missing
 * page. The URL was right and the work is finished — answering it with a 404
 * told a reviewer who had just decided the last proposal that their own link
 * was broken. It is an empty state, named after the record, with the way back.
 */

export type RecordSheetView
  = | { state: 'empty'; label: string }
    | { state: 'sheet'; name: string; title: string; open: ReviewRow[]; decided: ReviewRow[] };

/**
 * @param recordKey - The key read out of the route.
 * @param rows
 * @param rows.open
 * @param rows.decided
 */
export function recordSheetView(recordKey: string, rows: { open: ReviewRow[]; decided: ReviewRow[] }): RecordSheetView {
  const { open, decided } = rows;
  if (open.length === 0 && decided.length === 0) {
    return { state: 'empty', label: recordKeyLabel(recordKey) };
  }
  // One namer for the sheet: `recordTitle` is what the rest of the inbox uses
  // (it is the one that says "name not synced" rather than passing an id off
  // as a name); the key's own reading is the last resort, for a row that is
  // about nothing.
  const record = (open[0] ?? decided[0])!.described.record;
  const name = record ? recordTitle(record) : recordKeyLabel(recordKey);
  return {
    state: 'sheet',
    name,
    title: `${name} — ${open.length} ${open.length === 1 ? 'proposal' : 'proposals'}`,
    open,
    decided,
  };
}
