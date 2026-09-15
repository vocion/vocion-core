/**
 * First-party Card registry side-effects. Importing this module registers
 * all built-in Cards. Order matters only insofar as collisions overwrite:
 * later registrations win.
 *
 * Boot order: `libs/cards/firstParty/index.ts` is imported by the app's
 * server boot (see `app/[locale]/(auth)/dashboard/workflows/[slug]/runs/[runId]/page.tsx`
 * — every page that calls `resolveCard()` needs the cards registered).
 */

import { registerCard } from '../registry';
import { chartCard } from './chart';
import { dataTableCard } from './dataTable';
import { jsonDumpCard } from './jsonDump';
import { keyValueCard } from './keyValue';
import { linkCard } from './link';
import { markdownCard } from './markdown';
import { recordCard } from './record';
import { sendStubCard } from './sendStub';

let registered = false;

/**
 * Idempotently register all first-party Cards. Called from server-side
 * boot. Safe to call multiple times.
 */
export function registerFirstPartyCards(): void {
  if (registered) {
    return;
  }
  registerCard(jsonDumpCard);
  registerCard(keyValueCard);
  registerCard(sendStubCard);
  // Canvas cards (0095): what `render_table` / `render_markdown` /
  // `render_chart` / `render_record` produce, on the chat and canvas surfaces.
  registerCard(dataTableCard);
  registerCard(markdownCard);
  registerCard(chartCard);
  registerCard(recordCard);
  registerCard(linkCard);
  registered = true;
}

// Eager registration so simply importing `firstParty` is sufficient. Modules
// that need a deterministic boot order can call `registerFirstPartyCards()`
// explicitly.
registerFirstPartyCards();

export { CHART_SLUG, chartCard } from './chart';
export { DATA_TABLE_SLUG, dataTableCard } from './dataTable';
export { JSON_DUMP_SLUG, jsonDumpCard } from './jsonDump';
export { KEY_VALUE_SLUG, keyValueCard } from './keyValue';
export { LINK_SLUG, linkCard } from './link';
export { MARKDOWN_SLUG, markdownCard } from './markdown';
export { RECORD_SLUG, recordCard } from './record';
export { SEND_STUB_SLUG, sendStubCard } from './sendStub';
